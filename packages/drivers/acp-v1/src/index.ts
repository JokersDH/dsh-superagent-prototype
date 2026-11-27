/**
 * Standard ACP Client. No Agent/Server facade, vendor RPC extensions, model loop or Store writer.
 * ACP itself provides no sandbox proof. Only a trusted in-process host can prepare the original
 * enforced policy; profile text, initialize and explicit trial consent can never replace it.
 */
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { client, methods, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import type { AnyMessage, ClientConnection, InitializeRequest, InitializeResponse, NewSessionResponse, PermissionOption,
  RequestPermissionResponse, SessionConfigOption, SessionNotification } from '@agentclientprotocol/sdk'
import type { AgentDriverV1, AttemptIO, ProbeHost, RecoveryHost } from '../../../contracts/src/ports.ts'
import type { AgentProfile, AttemptSpec, CriticalFact, Json, PreparedExecutionPolicy, ProbeReport,
  ReconcileReport, RunnerCommand, RuntimeFactKind, ServeExit } from '../../../contracts/src/types.ts'
import { AttemptRefSchema, ExecutionInputSchema, JsonSchema, NativeAnswerPayloadSchema,
  NativeQuestionBindingSchema, PreparedExecutionPolicySchema, RunnerCommandSchema, ScopeSchema,
  UserQuestionSchema } from '../../../contracts/src/schemas.ts'
import { canonicalDigest } from '../../../contracts/src/canonical.ts'
import { parseQuestionAnswer, parseRuntimeFactPayload } from '../../../contracts/src/validation.ts'
import { attemptIdentity, CommandQueue, criticalFact, factIdFor } from '../../../driver-kit/src/index.ts'
import { admitPreparedPolicy } from '../../../policy-preparation/src/index.ts'
import { classifyCompatibility, classifyStandardAcpConformance, toProbeReport, type CompatibilityVerdict, type ProtocolSurface, type RequiredSurface,
  type VerifiedVersion } from '../../../catalog/src/compatibility.ts'
import { acpStream, deadline, ACP_SDK_ENTRYPOINT, ACP_SDK_VERSION, AcpProtocolError,
  type AcpByteTransport } from './protocol.ts'
import { acpV1ConformanceDeclaration } from './conformance.ts'

export * from './protocol.ts'
export * from './conformance.ts'

const absolute = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes('\0'), 'Workspace must be an absolute path')
export const AcpV1SettingsSchema = z.strictObject({
  kind: z.literal('acp-v1-settings/1'), workspacePath: absolute, scope: ScopeSchema,
  timeoutMs: z.number().int().min(1000).max(1800000).default(600000),
  modeId: z.string().min(1).max(1024).optional(),
  configSelections: z.array(z.strictObject({ configId: z.string().min(1).max(1024),
    value: z.union([z.string().max(4096), z.boolean()]) })).max(32).readonly().optional(),
}).refine(value => new Set(value.configSelections?.map(item => item.configId)).size === (value.configSelections?.length ?? 0), 'Config IDs must be unique')
export type AcpV1Settings = z.infer<typeof AcpV1SettingsSchema>

export type AcpPolicyInput = {
  spec: AttemptSpec; settings: AcpV1Settings; initialized: InitializeResponse; session: NewSessionResponse; io: AttemptIO
  resourceRef?: string
}
/** Installation-time trusted dependency, never read from Profile, HTTP, environment or native text. */
export type AcpPolicyHost = {
  beforeSpawn?(input: { spec: AttemptSpec; settings: AcpV1Settings; io: AttemptIO }): Promise<void>
  prepare(input: AcpPolicyInput): Promise<{ policy: PreparedExecutionPolicy; currentFingerprint: string }>
  currentFingerprint(input: AcpPolicyInput): Promise<string>
}
export type AcpHandshake = { protocolVersion: number; agentName?: string; agentVersion?: string;
  capabilities: Json; evidenceRefs: string[] }
export type AcpDriverOptions = {
  /** Controlled stream injection; it does not bypass the original policy gate. */
  connect?: (spec: AttemptSpec, io: AttemptIO) => Promise<AcpByteTransport>
  policyHost?: AcpPolicyHost
  handshake?: (profile: AgentProfile) => Promise<AcpHandshake>
  verifiedVersions?: readonly VerifiedVersion[]
  beforeAnswerWrite?: (command: RunnerCommand) => Promise<void>
  /** Original Runner's synchronous admission state; not a Profile or native capability claim. */
  businessOpen?: () => boolean
  clientInfo?: { name: string; version: string }
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'], reject!: Deferred<T>['reject']
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}
const same = (a: unknown, b: unknown) => canonicalDigest(JsonSchema.parse(a)) === canonicalDigest(JsonSchema.parse(b))
const requestKey = (id: number | string) => `${typeof id}:${String(id)}`
type PendingPermission = {
  binding: ReturnType<typeof NativeQuestionBindingSchema.parse>; question: ReturnType<typeof UserQuestionSchema.parse>
  result: Deferred<RequestPermissionResponse>; written: Deferred<void>; options: Map<string, string>
  answered: boolean; sessionId: string; command?: RunnerCommand; cancelled: boolean
}

export class AcpDriver implements AgentDriverV1 {
  private readonly options: AcpDriverOptions
  constructor(options: AcpDriverOptions = {}) { this.options = options }
  async inspect(profile: AgentProfile, host: ProbeHost): Promise<ProbeReport> {
    return (await inspectAcpCompatibility(profile, host, this.options)).report
  }
  async reconcile(ref: Parameters<AgentDriverV1['reconcile']>[0], host: RecoveryHost): Promise<ReconcileReport> {
    try {
      const observed = await host.inspectRuntime(ref)
      return { ...observed, evidenceRefs: [...observed.evidenceRefs, 'acp-owned-runtime-observation'] }
    } catch { return { status: 'indeterminate', writer: 'indeterminate', evidenceRefs: ['acp-runtime-observation-unavailable'] } }
  }
  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    const ref = attemptIdentity(spec)
    let sequence = 0, factTail: Promise<void> = Promise.resolve(), connection: ClientConnection | undefined
    const record = (kind: RuntimeFactKind, value: unknown): Promise<void> => {
      const fact = criticalFact(spec, { factId: factIdFor(spec.attemptId, ++sequence), source: 'acp-v1', kind, payloadRef: 'pending' })
      const payload = JsonSchema.parse(parseRuntimeFactPayload(fact, { kind, value }))
      const run = factTail.then(async () => { const payloadRef = await io.payloads.store(payload, 'critical'); await io.record({ ...fact, payloadRef }) })
      factTail = run
      return run
    }
    const permissions = new Map<string, PendingPermission>(), byRequest = new Map<string, PendingPermission>()
    const pendingRequestKeys = new Set<string>(), permissionMessageOwners = new WeakMap<object, PendingPermission>()
    let permissionSequence = 0
    let sessionId: string | undefined, ended = false, cancelRequested = false, progressText = '', began = false, promptSettled = false
    let cancelDelivery: Promise<void> | undefined
    let nativeCancelWrite: Promise<void> | undefined
    let activePrompt: Promise<unknown> | undefined
    const businessCommands = new CommandQueue({ maxPending: 32 })
    const outcome = deferred<ServeExit>(), promptWritten = deferred<void>()
    const finish = (reason: ServeExit['reason'], evidenceRef: string) => {
      if (!ended) { ended = true; outcome.resolve({ reason, evidenceRefs: [evidenceRef] }) }
    }
    const error = async (code: 'protocol_error' | 'transport_lost' | 'unsupported_capability' | 'state_indeterminate', evidenceRef: string,
      dispatch?: { commandId: string; delivery: 'indeterminate'; retry: 'reconcile_first'; evidenceRefs: string[] }) => {
      await record('runtime.error', { code, message: evidenceRef, ...(dispatch ? { dispatch } : {}), evidenceRefs: [evidenceRef] })
    }
    // Control must not wait for a durable fact ACK: the coordinator may already have revoked the
    // attempt and legitimately refuse that ACK. The one original command stream remains authoritative.
    const sendNativeCancel = (): Promise<void> => {
      if (!connection || !sessionId) return Promise.resolve()
      nativeCancelWrite ??= connection.agent.notify(methods.agent.session.cancel, { sessionId })
      void nativeCancelWrite.catch(() => undefined)
      return nativeCancelWrite
    }
    const deliverCancel = async (command: RunnerCommand) => {
      cancelRequested = true
      businessCommands.close('cancel_requested', true)
      for (const pending of permissions.values()) if (!pending.answered) {
        pending.cancelled = true; pending.result.resolve({ outcome: { outcome: 'cancelled' } })
      }
      if (connection && sessionId) {
        await sendNativeCancel()
        void (async () => {
          await record('dispatch.observed', { commandId: command.id, delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['acp-cancel-written'] })
          await record('cancel.observed', { dispatch: { commandId: command.id, delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['acp-cancel-written'] },
            acknowledged: false, evidenceRefs: ['acp-cancel-written'] })
        })().catch(() => undefined)
      }
      if (!began) finish('cancelled', 'acp-cancel-before-begin')
    }
    void (async () => {
      try {
        for await (const input of io.commands) {
          const command = RunnerCommandSchema.parse(input)
          if (!same({ ticketId: command.ticketId, assignmentId: command.assignmentId, attemptId: command.attemptId,
            fenceEpoch: command.fenceEpoch, contract: command.contract }, ref)) {
            void error('state_indeterminate', 'acp-command-attempt-mismatch').catch(() => undefined)
            continue
          }
          if (command.kind === 'cancel' || command.kind === 'pause_at_boundary') {
            cancelDelivery ??= deliverCancel(command)
            void cancelDelivery.catch(() => { finish('error', 'acp-cancel-write-unknown') })
          } else if (!cancelRequested && !ended) businessCommands.push(command)
        }
      } catch { finish('error', 'acp-command-channel-failed') }
      finally { businessCommands.close('acp-command-channel-ended') }
    })()
    try {
      const settings = AcpV1SettingsSchema.parse(await io.payloads.read(spec.policySnapshotRef))
      const policyHost = this.options.policyHost
      if (!policyHost) {
        await error('unsupported_capability', 'acp-trusted-policy-host-required')
        return { reason: 'error', evidenceRefs: ['acp-trusted-policy-host-required'] }
      }
      await policyHost.beforeSpawn?.({ spec, settings, io })
      const transport = this.options.connect ? await this.options.connect(spec, io) : await this.ownedTransport(spec, io, record)
      let policyInput: AcpPolicyInput | undefined, policy: PreparedExecutionPolicy | undefined, preparedPolicyRef = ''
      const currentPolicy = async () => {
        if (!policy || !policyInput) throw new AcpProtocolError('policy_missing', 'ACP has no prepared policy')
        const gate = admitPreparedPolicy(policy, spec, { profile: spec.profile, currentFingerprint: await policyHost.currentFingerprint(policyInput) })
        if (!gate.allowed) throw new AcpProtocolError('policy_refused', gate.reason)
      }
      const cancellationMessage = (message: AnyMessage) => {
        if ('method' in message) {
          const params = message.params as { sessionId?: unknown } | undefined
          return message.method === methods.agent.session.cancel && sessionId !== undefined && params?.sessionId === sessionId
        }
        if (!('id' in message) || message.id === null || !('result' in message) ||
            !(permissionMessageOwners.get(message) ?? byRequest.get(requestKey(message.id)))) return false
        const result = message.result as { outcome?: { outcome?: unknown } } | undefined
        return result?.outcome?.outcome === 'cancelled'
      }
      const assertWriteCurrent = (message: AnyMessage) => {
        if (cancellationMessage(message)) return
        if (ended || cancelRequested || this.options.businessOpen?.() === false)
          throw new AcpProtocolError('business_revoked', 'Only original cancellation traffic is allowed after business closure')
        if ('id' in message && !('method' in message) && message.id !== null && 'result' in message) {
          const result = message.result as { outcome?: { outcome?: unknown } } | undefined
          if (result?.outcome?.outcome === 'selected') {
            const pending = permissionMessageOwners.get(message) ?? byRequest.get(requestKey(message.id))
            if (!pending?.command || pending.cancelled || !pending.answered)
              throw new AcpProtocolError('answer_expired', 'Selected permission has no current original answer')
          }
        }
      }
      const stream = acpStream(transport, {
        beforeWrite: async message => {
          if ('id' in message && !('method' in message) && message.id !== null && 'result' in message) {
            const result = message.result as { outcome?: { outcome?: unknown } } | undefined
            const pending = byRequest.get(requestKey(message.id))
            if (pending && ['selected', 'cancelled'].includes(String(result?.outcome?.outcome))) permissionMessageOwners.set(message, pending)
          }
          assertWriteCurrent(message)
          if (!('id' in message) || 'method' in message || message.id === null) return
          const pending = permissionMessageOwners.get(message)
          if (cancellationMessage(message)) return
          if (!pending?.command) return
          try {
            if (ended || cancelRequested) throw new AcpProtocolError('answer_expired', 'ACP permission is no longer current')
            await currentPolicy()
            if (!this.options.beforeAnswerWrite) throw new AcpProtocolError('answer_guard_missing', 'Fresh native-write guard is required')
            await this.options.beforeAnswerWrite(pending.command)
            if (ended || cancelRequested) throw new AcpProtocolError('answer_expired', 'ACP permission was revoked while checking admission')
            assertWriteCurrent(message)
          } catch (cause) { pending.written.reject(cause); throw cause }
        },
        beforeBytesWrite: assertWriteCurrent,
        afterWrite: message => {
          if ('method' in message && message.method === methods.agent.session.prompt) promptWritten.resolve()
          const pending = permissionMessageOwners.get(message)
          if (pending && 'id' in message && message.id !== null) {
            const key = requestKey(message.id)
            if (byRequest.get(key) === pending) { byRequest.delete(key); pendingRequestKeys.delete(key) }
            pending.written.resolve()
          }
        },
      })
      const app = client({ name: this.options.clientInfo?.name ?? 'personal-agent' })
      app.onNotification(methods.client.session.update, ({ params }) => {
        if (ended || params.sessionId !== sessionId) return
        progressText = this.progress(params, spec, io, progressText)
      })
      app.onRequest(methods.client.session.requestPermission, async context => {
        if (ended || cancelRequested) return { outcome: { outcome: 'cancelled' } }
        if (context.params.sessionId !== sessionId || context.requestId === null ||
            (typeof context.requestId === 'number' && !Number.isSafeInteger(context.requestId)))
          throw new RequestError(-32602, 'Permission does not belong to the active ACP session')
        const nativeRequestId = typeof context.requestId === 'number'
          ? { kind: 'integer' as const, decimal: String(context.requestId) }
          : { kind: 'string' as const, value: context.requestId }
        const request = requestKey(context.requestId)
        if (pendingRequestKeys.has(request)) throw new RequestError(-32600, 'Duplicate pending permission request ID')
        pendingRequestKeys.add(request)
        const id = canonicalDigest(JsonSchema.parse([spec.attemptId, nativeRequestId, ++permissionSequence])).slice(0, 40)
        let registered = false
        try {
          const raw = await io.payloads.store(JsonSchema.parse({ method: context.method, id: context.requestId, params: context.params }), 'critical')
          const binding = NativeQuestionBindingSchema.parse({ ...ref, id: `acp-target-${id}`, connectionEpoch: 1,
            nativeRequestId, nativeMethod: context.method, provenanceRef: raw })
          const mapped = permissionOptions(context.params.options)
          // ACP ToolCallUpdate permits an omitted title (DSH sends only toolCallId). Keep the
          // native request unchanged and supply a display label, never a new permission identity.
          const prompt = context.params.toolCall.title?.trim() || `Agent requests permission for tool call ${context.params.toolCall.toolCallId}`
          const question = UserQuestionSchema.parse({ id: `acp-question-${id}`, version: 1, kind: 'permission', contract: spec.contract,
            scope: settings.scope, prompt, nativePayloadRef: raw,
            presentation: { kind: 'choices', multiple: false, options: mapped.items }, targets: [binding], openedAt: new Date().toISOString(), validity: 'open' })
          const pending: PendingPermission = { binding, question, options: mapped.native, result: deferred(), written: deferred(),
            answered: false, sessionId: context.params.sessionId, cancelled: false }
          permissions.set(binding.id, pending); byRequest.set(request, pending); registered = true
          const abort = () => { pending.cancelled = true; pending.result.resolve({ outcome: { outcome: 'cancelled' } }) }
          context.signal.addEventListener('abort', abort, { once: true })
          try {
            await record('question.opened', question)
            if (context.signal.aborted || cancelRequested || ended) abort()
            return await pending.result.promise
          } finally { context.signal.removeEventListener('abort', abort) }
        } catch (cause) { if (!registered) pendingRequestKeys.delete(request); throw cause }
      })
      connection = app.connect(stream)
      const activeConnection = connection
      void connection.closed.then(() => {
        const cause = new AcpProtocolError('connection_closed', 'ACP connection closed; reconcile before retry')
        promptWritten.reject(cause)
        for (const pending of permissions.values()) { pending.written.reject(cause); pending.result.resolve({ outcome: { outcome: 'cancelled' } }) }
        finish('disconnected', 'acp-connection-closed')
      })
      const initializeRequest: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
        clientInfo: this.options.clientInfo ?? { name: 'personal-agent', version: '0.1.0' },
      }
      const initialized = await deadline(connection.agent.request(methods.agent.initialize, initializeRequest), settings.timeoutMs, 'initialize_timeout')
      if (initialized.protocolVersion !== PROTOCOL_VERSION) throw new AcpProtocolError('version_mismatch', 'ACP v1 is required')
      const session = await deadline(connection.agent.request(methods.agent.session.new, { cwd: settings.workspacePath, mcpServers: [] }), settings.timeoutMs, 'session_timeout')
      sessionId = session.sessionId
      await this.configure(connection, settings, session)
      const preparationInput: AcpPolicyInput = { spec, settings, initialized, session, io, ...(transport.resourceRef ? { resourceRef: transport.resourceRef } : {}) }
      policyInput = preparationInput
      const prepared = await policyHost.prepare(preparationInput)
      policy = PreparedExecutionPolicySchema.parse(prepared.policy)
      const gate = admitPreparedPolicy(policy, spec, { profile: spec.profile, currentFingerprint: prepared.currentFingerprint })
      if (!gate.allowed) throw new AcpProtocolError('policy_refused', gate.reason)
      preparedPolicyRef = await io.payloads.store(JsonSchema.parse(policy), 'critical')
      await record('policy.prepared', policy)
      const commands = businessCommands[Symbol.asyncIterator]()
      const nextCommand = async (): Promise<IteratorResult<RunnerCommand>> => commands.next()
      let next = nextCommand()
      while (!ended) {
        const event = await Promise.race([next.then(command => ({ kind: 'command' as const, command })), outcome.promise.then(exit => ({ kind: 'exit' as const, exit }))])
        if (event.kind === 'exit') break
        if (event.command.done) {
          if (cancelRequested && began) { await outcome.promise; break }
          finish('disconnected', 'acp-command-channel-ended'); break
        }
        const command = RunnerCommandSchema.parse(event.command.value)
        if (!same({ ticketId: command.ticketId, assignmentId: command.assignmentId, attemptId: command.attemptId,
          fenceEpoch: command.fenceEpoch, contract: command.contract }, ref)) { await error('state_indeterminate', 'acp-command-attempt-mismatch'); next = nextCommand(); continue }
        if (command.kind === 'begin') {
          if (began) { await error('protocol_error', 'acp-duplicate-begin-refused'); next = nextCommand(); continue }
          if (command.preparedPolicyRef !== preparedPolicyRef) throw new AcpProtocolError('policy_ref_mismatch', 'ACP begin names another prepared policy')
          await currentPolicy()
          const input = ExecutionInputSchema.parse(await io.payloads.read(command.inputRef))
          if (!same(input.contract, spec.contract)) throw new AcpProtocolError('contract_mismatch', 'ACP begin input has another contract')
          if (ended || cancelRequested) throw new AcpProtocolError('business_revoked', 'ACP business input has been revoked')
          began = true
          const writtenRecorded = deferred<void>()
          const prompt = deadline(activeConnection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: input.text }] }), settings.timeoutMs, 'prompt_timeout')
          activePrompt = prompt
          void prompt.then(async result => {
            promptSettled = true
            await writtenRecorded.promise
            // ACP v1 has no turn-start ACK. The corresponding prompt response is the first native
            // proof that this exact business request was consumed; a byte write is never promoted.
            await record('dispatch.observed', { commandId: command.id, delivery: 'native_accepted', retry: 'none', nativeRef: sessionId,
              evidenceRefs: ['acp-prompt-response-consumed'] })
            const cancelled = result.stopReason === 'cancelled', completed = result.stopReason === 'end_turn' && !cancelRequested
            await record('turn.ended', { nativeTurnRef: sessionId!, outcome: cancelled || cancelRequested ? 'cancelled' : completed ? 'completed' : 'failed',
              candidateAvailable: completed, evidenceRefs: [`acp-stop:${result.stopReason}`] })
            finish(cancelled || cancelRequested ? 'cancelled' : completed ? 'terminal' : 'error', `acp-stop:${result.stopReason}`)
          }).catch(async () => {
            await error('transport_lost', 'acp-prompt-result-unknown', { commandId: command.id, delivery: 'indeterminate', retry: 'reconcile_first', evidenceRefs: ['acp-prompt-result-unknown'] }).catch(() => undefined)
            finish('error', 'acp-prompt-result-unknown')
          })
          try {
            await Promise.race([promptWritten.promise, outcome.promise.then(() => { throw new AcpProtocolError('prompt_write_unknown', 'ACP write outcome is unknown') })])
            await record('dispatch.observed', { commandId: command.id, delivery: 'written', retry: 'reconcile_first', nativeRef: sessionId, evidenceRefs: ['acp-prompt-written'] })
            writtenRecorded.resolve()
          } catch (cause) { writtenRecorded.reject(cause); throw cause }
        } else if (command.kind === 'answer') {
          const binding = NativeQuestionBindingSchema.parse(await io.payloads.read(command.nativeBindingRef))
          const answer = NativeAnswerPayloadSchema.parse(await io.payloads.read(command.answerRef))
          const pending = permissions.get(binding.id)
          if (!pending || pending.answered || pending.cancelled || pending.sessionId !== sessionId || !same(binding, pending.binding) ||
              !same(answer.nativeBinding, binding) || answer.questionId !== pending.question.id || answer.questionVersion !== pending.question.version) {
            await error('state_indeterminate', 'acp-answer-target-mismatch'); next = nextCommand(); continue
          }
          const parsed = parseQuestionAnswer(pending.question, answer.answer)
          if (parsed.kind !== 'choices' || parsed.optionIds.length !== 1 || !pending.options.has(parsed.optionIds[0]!)) {
            await error('unsupported_capability', 'acp-answer-option-invalid'); next = nextCommand(); continue
          }
          pending.answered = true; pending.command = command
          pending.result.resolve({ outcome: { outcome: 'selected', optionId: pending.options.get(parsed.optionIds[0]!)! } })
          await deadline(pending.written.promise, settings.timeoutMs, 'answer_write_unknown')
          await record('dispatch.observed', { commandId: command.id, delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['acp-permission-response-written'] })
          await record('answer.observed', { answerId: answer.answerId, targetBindingId: binding.id, status: 'response_written', evidenceRefs: ['acp-permission-response-written'] })
        } else await error('unsupported_capability', 'acp-deliver-not-supported')
        next = nextCommand()
      }
      await factTail
      return await outcome.promise
    } catch {
      await error('state_indeterminate', 'acp-serve-refused-or-unknown').catch(() => undefined)
      return { reason: 'error', evidenceRefs: ['acp-serve-refused-or-unknown'] }
    } finally {
      ended = true
      businessCommands.close('acp-serve-ended', true)
      for (const pending of permissions.values()) { pending.cancelled = true; pending.result.resolve({ outcome: { outcome: 'cancelled' } }) }
      // A local/fact-ACK failure cannot abandon a still-active native prompt. Revoke it through
      // the same once-only standard cancel write before closing the connection. No synthetic user
      // command ID or durable cancel receipt is invented, and this is never quiescence evidence.
      if (began && !promptSettled) { cancelRequested = true; cancelDelivery ??= sendNativeCancel() }
      if (cancelDelivery) await deadline(cancelDelivery, 250, 'cancel_write_unknown').catch(() => undefined)
      // Leave a bounded opportunity to consume the standard prompt cancellation response. This is
      // protocol draining only; its success or deadline never grants physical quiescence.
      if (nativeCancelWrite && activePrompt && !promptSettled)
        await deadline(activePrompt, 100, 'cancel_reply_unknown').catch(() => undefined)
      connection?.close()
    }
  }

  private progress(params: SessionNotification, spec: AttemptSpec, io: AttemptIO, previous: string): string {
    const update = params.update
    if (update.sessionUpdate !== 'agent_message_chunk' || update.content.type !== 'text') return previous
    // Runner progress is newest-wins. Publish a bounded tail SNAPSHOT, not deltas that coalescing
    // would lose. This is live diagnostic progress, never a complete conversation archive.
    let text = (previous + update.content.text).slice(-8192)
    const first = text.charCodeAt(0)
    if (first >= 0xdc00 && first <= 0xdfff) text = text.slice(1)
    io.publishProgress({ ...attemptIdentity(spec), text, observedAt: new Date().toISOString() })
    return text
  }
  private async configure(connection: ClientConnection, settings: AcpV1Settings, session: NewSessionResponse): Promise<void> {
    if (settings.modeId !== undefined) {
      if (!session.modes?.availableModes.some(mode => mode.id === settings.modeId)) throw new AcpProtocolError('mode_unsupported', 'Requested ACP mode is not advertised')
      if (session.modes.currentModeId !== settings.modeId)
        await deadline(connection.agent.request(methods.agent.session.setMode, { sessionId: session.sessionId, modeId: settings.modeId }), settings.timeoutMs, 'mode_timeout')
    }
    let options: SessionConfigOption[] = session.configOptions ?? []
    for (const selection of settings.configSelections ?? []) {
      const option = options.find(item => item.id === selection.configId)
      if (!option) throw new AcpProtocolError('config_unsupported', 'Requested ACP config option is not advertised')
      if (option.type === 'select') {
        const values = option.options.flatMap(item => 'options' in item ? item.options : [item])
        if (typeof selection.value !== 'string' || !values.some(item => item.value === selection.value)) throw new AcpProtocolError('config_value_unsupported', 'Requested ACP config value is not advertised')
      } else throw new AcpProtocolError('boolean_config_unsupported', 'Boolean config capability is not advertised by this Client')
      if (option.currentValue === selection.value) continue
      const result = await deadline(connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: session.sessionId, configId: selection.configId, value: selection.value as string,
      }), settings.timeoutMs, 'config_timeout')
      options = result.configOptions
      const applied = options.find(item => item.id === selection.configId)
      if (!applied || applied.currentValue !== selection.value) throw new AcpProtocolError('config_not_applied', 'Agent did not confirm the requested ACP config value')
    }
  }
  private async ownedTransport(spec: AttemptSpec, io: AttemptIO, record: (kind: RuntimeFactKind, value: unknown) => Promise<void>): Promise<AcpByteTransport> {
    const child = await io.runtime.spawn({ executable: spec.profile.executable, argv: [...spec.profile.argv], cwdRef: spec.workspaceRef, environmentRef: spec.attemptId })
    await record('writer.observed', { resources: [{ resourceRef: child.resourceRef, ownership: 'spawned_process', status: 'active', evidenceRefs: ['acp-owned-process-spawned'] }] })
    void (async () => { for await (const _ of child.stderr) { /* private diagnostics are not copied to public progress */ } })().catch(() => undefined)
    // Exit is a fact for this resource only, never a complete quiescence proof.
    void child.exited.then(value => record('runtime.exited', { resourceRef: child.resourceRef, exitCode: value.code,
      signal: value.signal, evidenceRefs: ['acp-owned-process-exited'] })).catch(() => undefined)
    return { resourceRef: child.resourceRef, stdout: child.stdout, write: bytes => io.runtime.write(child.resourceRef, bytes) }
  }
}

function permissionOptions(options: PermissionOption[]) {
  if (!options.length || new Set(options.map(option => option.optionId)).size !== options.length)
    throw new AcpProtocolError('invalid_permission_options', 'ACP permission options must be nonempty and unique')
  const native = new Map<string, string>()
  const items = options.map((option, index) => {
    const id = `acp-option-${index + 1}`; native.set(id, option.optionId)
    return { id, label: option.name, semantic: option.kind === 'allow_once' ? 'allow_once' as const : option.kind === 'reject_once' ? 'deny' as const : 'native_other' as const }
  })
  return { items, native }
}

export function acpRequiredSurface(): RequiredSurface {
  return { wireVersion: 'acp-v1', methods: ['initialize', 'session/new', 'session/prompt'], requestFields: {
    initialize: ['protocolVersion', 'clientCapabilities', 'clientInfo'], 'session/new': ['cwd', 'mcpServers'],
    'session/prompt': ['sessionId', 'prompt'], 'session/request_permission': ['sessionId', 'toolCall', 'options'],
  }, enums: { 'session/request_permission': ['allow_once', 'allow_always', 'reject_once', 'reject_always'] },
  notifications: ['session/update', 'session/cancel'], serverRequestPatterns: ['session/request_permission'], requestIdTypes: ['integer', 'string'] }
}
export function acpObservedSurface(handshake: AcpHandshake): ProtocolSurface {
  return { wireVersion: 'acp-v1', schemaDigest: createHash('sha256').update(JSON.stringify({ sdk: ACP_SDK_VERSION, entrypoint: ACP_SDK_ENTRYPOINT, handshake })).digest('hex'),
    methods: ['initialize'], requestFields: { initialize: ['protocolVersion', 'clientCapabilities', 'clientInfo'] },
    enums: {}, notifications: [], serverRequests: [], requestIdTypes: ['integer'] }
}
export type AcpCompatibilityInspection = {
  report: ProbeReport; verdict: CompatibilityVerdict
  declaration?: ReturnType<typeof acpV1ConformanceDeclaration>
  observation?: { status: 'partial'; surface: ProtocolSurface; reason: string; evidenceRefs: string[] }
  observedVerdict?: CompatibilityVerdict
}
export async function inspectAcpCompatibility(profile: AgentProfile, host: ProbeHost, options: AcpDriverOptions = {}): Promise<AcpCompatibilityInspection> {
  const checkedAt = new Date().toISOString(), required = acpRequiredSurface()
  const failure = (reason: string) => {
    const probe: ProbeReport = { capabilities: [], readiness: 'needs_setup', checkedAt, evidenceRefs: [reason] }
    return { report: probe, verdict: classifyCompatibility({ profile, probe, required,
      surface: { status: 'failed', reason, evidenceRefs: [reason] }, verifiedVersions: options.verifiedVersions ?? [] }) }
  }
  if (!options.handshake) return failure('acp-owned-probe-required')
  try {
    const [executable, config, handshake] = await Promise.all([host.inspectExecutable(profile), host.inspectConfig(profile.nativeConfigRef), options.handshake(profile)])
    if (handshake.protocolVersion !== PROTOCOL_VERSION) return failure('acp-version-mismatch')
    const surface = acpObservedSurface(handshake), declaration = acpV1ConformanceDeclaration(handshake)
    const probe: ProbeReport = { identity: { profileId: profile.id, profileRevision: profile.revision, executableDigest: executable.digest,
      nativeVersion: executable.version, driverRelease: profile.driverRelease, driverApiMajor: 1,
      sdkVersion: ACP_SDK_VERSION, sdkEntrypoint: ACP_SDK_ENTRYPOINT, wireVersion: 'acp-v1', schemaDigest: declaration.schemaDigest,
      resolvedConfigFingerprint: config.fingerprint, permissionPolicyRevision: profile.permissionPolicyRevision,
      configStability: config.stability, platform: process.platform, architecture: process.arch, runtimeVersion: process.version },
      capabilities: profile.requiredFeatures.map(feature => ({ feature, advertised: { standardProtocolVersion: 1, operationVerified: false }, observed: { initialize: true },
        test: 'NOT_TESTED', policy: ['chat.turn', 'chat', 'turn', 'session.new', 'approval.request', 'cancel'].includes(feature) ? 'requires_review' : 'blocked', evidenceRefs: handshake.evidenceRefs })),
      readiness: 'inspection_passed', checkedAt, evidenceRefs: [executable.evidenceRef, ...handshake.evidenceRefs] }
    const observation = { status: 'partial' as const, surface, reason: 'initialize_only', evidenceRefs: handshake.evidenceRefs }
    const observedProbe = { ...probe, identity: { ...probe.identity!, schemaDigest: surface.schemaDigest } }
    const observedVerdict = classifyCompatibility({ profile, probe: observedProbe, required, surface: observation,
      verifiedVersions: options.verifiedVersions ?? [], environment: { platform: process.platform, architecture: process.arch, runtimeVersion: process.version } })
    const verdict = classifyStandardAcpConformance({ profile, probe, declaration,
      environment: { platform: process.platform, architecture: process.arch, runtimeVersion: process.version } })
    return { verdict, report: toProbeReport(verdict), declaration, observation, observedVerdict }
  } catch { return failure('acp-inspection-unavailable') }
}

/** Caller supplies an original owned transport. This helper never spawns, creates a session or prompts. */
export async function probeAcpHandshake(options: { transport: AcpByteTransport; timeoutMs?: number }): Promise<AcpHandshake> {
  const connection = client({ name: 'personal-agent-inspection' }).connect(acpStream(options.transport))
  try {
    const value = await deadline(connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: 'personal-agent-inspection', version: '0.1.0' },
    }), options.timeoutMs ?? 12000, 'initialize_timeout')
    if (value.protocolVersion !== PROTOCOL_VERSION) throw new AcpProtocolError('version_mismatch', 'ACP v1 is required')
    return { protocolVersion: value.protocolVersion, ...(value.agentInfo?.name ? { agentName: value.agentInfo.name } : {}),
      ...(value.agentInfo?.version ? { agentVersion: value.agentInfo.version } : {}), capabilities: JsonSchema.parse(value.agentCapabilities ?? {}), evidenceRefs: ['acp-initialize-observed'] }
  } finally { connection.close(); await options.transport.closeInput?.() }
}
