/**
 * ACP v1 Driver (Agent Client Protocol) — Milestone 04 second real protocol.
 *
 * The original Runner/AttemptIO boundary is unchanged: `inspect` performs a zero-model initialize,
 * `serve` sends a prompt only after the original legal begin, and `reconcile` only reads the original
 * journal/owned runtime. The ACP line protocol lives entirely inside this Driver.
 *
 * Honesty boundaries:
 * - an ACP `session/update` or a written response is not `native_applied`;
 * - a cancel notification/acknowledgement is not physical quiescence (the original Runner barrier is);
 * - steer/session-resume/clarification are not simulated with a new prompt: unsupported commands are
 *   reported and ignored;
 * - an unverified ACP version is `compatible_unverified` (trial-only), never `native_test_passed`.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { AgentDriverV1, AttemptIO, ProbeHost, RecoveryHost } from '../../../contracts/src/ports.ts'
import type {
  AgentProfile,
  AttemptSpec,
  CriticalFact,
  Json,
  ProbeReport,
  ReconcileReport,
  RunnerCommand,
  RuntimeFactKind,
  ServeExit,
} from '../../../contracts/src/types.ts'
import { z } from 'zod'
import {
  AttemptRefSchema,
  ExecutionInputSchema,
  IdSchema,
  JsonSchema,
  NativeAnswerPayloadSchema,
  NativeQuestionBindingSchema,
  PreparedExecutionPolicySchema,
  RunnerCommandSchema,
  ScopeSchema,
  UserQuestionSchema,
} from '../../../contracts/src/schemas.ts'
import { parseQuestionAnswer } from '../../../contracts/src/validation.ts'
import { canonicalDigest } from '../../../contracts/src/canonical.ts'
import { attemptIdentity, criticalFact, factIdFor } from '../../../driver-kit/src/index.ts'
import { admitPreparedPolicy } from '../../../policy-preparation/src/index.ts'
import { classifyCompatibility, toProbeReport, type ProtocolSurface, type RequiredSurface, type VerifiedVersion } from '../../../catalog/src/compatibility.ts'
import { ACP_PROTOCOL_VERSION, AcpConnection, AcpProtocolError } from './protocol.ts'

export * from './protocol.ts'

export type AcpHandshake = {
  protocolVersion: number
  agentName?: string
  agentVersion?: string
  capabilities: Json
  evidenceRefs: string[]
}

export type AcpDriverOptions = {
  /** Test/consumer injection: an already-connected ACP transport. Production spawns io.runtime. */
  connect?: () => Promise<{
    send: (bytes: Uint8Array) => void
    onData: (listener: (chunk: Uint8Array) => void) => void
    close: () => void
  }>
  /** Test/consumer injection for the zero-model initialize probe. Production spawns the profile CLI. */
  handshake?: (profile: AgentProfile) => Promise<AcpHandshake>
  verifiedVersions?: readonly VerifiedVersion[]
  timeoutMs?: number
  clientInfo?: { name: string; version: string }
  /** Original main/Broker fresh guard. Every answer is refused if this is absent or throws. */
  beforeAnswerWrite?: (command: RunnerCommand) => Promise<void>
}

/** Reviewed ACP policy input. A missing scope is a refusal, never "the whole project". */
export const AcpV1SettingsSchema = z.strictObject({
  kind: z.literal('acp-v1-settings/1'),
  workspacePath: z.string().min(1).refine(value => value.startsWith('/'), 'ACP workspace must be absolute'),
  scope: ScopeSchema,
  model: z.string().max(160).optional(),
  mode: z.enum(['build', 'plan']).optional(),
  enforcement: z.enum(['enforced', 'approval_guarded']),
  verification: z.enum(['passed', 'not_tested', 'failed']),
  policyEvidenceRef: IdSchema.optional(),
  timeoutMs: z.number().int().min(1000).max(1800000).default(600000),
}).superRefine((value, ctx) => {
  if (value.enforcement === 'enforced' && (value.verification !== 'passed' || !value.policyEvidenceRef))
    ctx.addIssue({ code: 'custom', message: 'Enforced ACP policy needs passed verification and evidence' })
  if (value.enforcement === 'approval_guarded' && value.verification === 'passed')
    ctx.addIssue({ code: 'custom', message: 'Approval guarding is not proof of enforced restriction' })
})
export type AcpV1Settings = z.infer<typeof AcpV1SettingsSchema>

/** Trusted policy evidence supplied by main; the Driver only checks its exact binding. */
export const AcpPolicyEvidenceSchema = z.strictObject({
  kind: z.literal('acp-v1-policy-evidence/1'),
  workspacePath: z.string().min(1),
  scopeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  enforcement: z.literal('enforced'),
  verification: z.literal('passed'),
  evidenceRefs: z.array(IdSchema).max(32).readonly(),
})
export type AcpPolicyEvidence = z.infer<typeof AcpPolicyEvidenceSchema>

const LegacyControlledSettingsSchema = z.strictObject({
  workspacePath: z.string().min(1), scope: ScopeSchema,
})

/** The ACP v1 surface the Driver actually uses; checked against a zero-model initialize. */
export function acpRequiredSurface(): RequiredSurface {
  return {
    wireVersion: 'acp-v1',
    methods: ['initialize', 'session/new', 'session/prompt'],
    requestFields: {
      initialize: ['protocolVersion', 'clientCapabilities', 'clientInfo'],
      'session/new': ['cwd', 'mcpServers'],
      'session/prompt': ['sessionId', 'prompt'],
      'session/request_permission': ['sessionId', 'toolCall', 'options'],
    },
    enums: { 'session/request_permission': ['allow_once', 'allow_always', 'reject_once', 'reject_always'] },
    notifications: ['session/update', 'session/cancel'],
    serverRequestPatterns: ['session/request_permission'],
    requestIdTypes: ['integer', 'string'],
  }
}

/**
 * The ACP surface actually observed by the zero-model probe. Only initialize is sent/answered; the
 * required prompt/permission/cancel/notification/id shapes are NOT observed here and must not be
 * copied from the expectation. A controlled consumer can supply a richer observation separately.
 */
export function acpObservedSurface(handshake: AcpHandshake): ProtocolSurface {
  const canonical = {
    wireVersion: 'acp-v1',
    protocolVersion: handshake.protocolVersion,
    methods: ['initialize'],
    requestFields: { initialize: ['protocolVersion', 'clientCapabilities', 'clientInfo'] },
    notifications: [],
    serverRequests: [],
    requestIdTypes: ['integer'],
    capabilities: handshake.capabilities,
  }
  return {
    wireVersion: 'acp-v1', schemaDigest: createDigest(canonical),
    methods: ['initialize'], requestFields: { initialize: ['protocolVersion', 'clientCapabilities', 'clientInfo'] },
    enums: {}, notifications: [], serverRequests: [], requestIdTypes: ['integer'],
  }
}

function createDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
/** Zero-model ACP initialize against one installed CLI. No session, no prompt, no model turn. */
export type AcpProbeProcessHost = {
  spawn(spec: { executable: string; argv: string[]; cwdRef: string; environmentRef: string }): Promise<{
    resourceRef: string
    stdout: AsyncIterable<Uint8Array>
    stderr: AsyncIterable<Uint8Array>
    exited: Promise<{ code: number | null; signal: string | null }>
  }>
  write(resourceRef: string, bytes: Uint8Array): Promise<void>
  closeInput(resourceRef: string): Promise<void>
  stopOwned(resourceRef: string, deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }>
}

/** Zero-model ACP initialize against one installed CLI. No session, no prompt, no model turn. */
export async function probeAcpHandshake(options: {
  executable: string
  argv?: readonly string[]
  timeoutMs?: number
  clientInfo?: { name: string; version: string }
  /** Original owned process host. When supplied, the probe runs under its identity and exits normally. */
  processHost?: AcpProbeProcessHost
  cwdRef?: string
  environmentRef?: string
}): Promise<AcpHandshake> {
  const timeoutMs = options.timeoutMs ?? 12000
  let connection: AcpConnection
  let stdoutTask: Promise<void>
  let exited: Promise<{ code: number | null; signal: string | null }>
  let writeBytes: (bytes: Uint8Array) => void
  let closeInput: () => Promise<void>
  let stopOwned: (() => Promise<unknown>) | undefined
  const stderr: string[] = []
  if (options.processHost) {
    const host = options.processHost
    const child = await host.spawn({ executable: options.executable, argv: [...(options.argv ?? [])], cwdRef: options.cwdRef ?? 'acp-probe', environmentRef: options.environmentRef ?? 'acp-probe' })
    connection = new AcpConnection(bytes => { try { writeBytes(bytes) } catch { /* peer closed */ } })
    writeBytes = bytes => { void host.write(child.resourceRef, bytes).catch(() => undefined) }
    stdoutTask = (async () => { for await (const chunk of child.stdout) { try { connection.receive(chunk) } catch { /* invalid frame fails probe */ } } })()
    void (async () => { for await (const chunk of child.stderr) { if (stderr.join('').length < 4096) stderr.push(Buffer.from(chunk).toString('utf8').slice(0, 1024)) } })().catch(() => undefined)
    exited = child.exited
    closeInput = () => host.closeInput(child.resourceRef)
    stopOwned = () => host.stopOwned(child.resourceRef, 1500)
  } else {
    // Diagnostic fallback only. It records the exact argv and waits for normal EOF; it never kills.
    const child = spawn(options.executable, [...(options.argv ?? [])], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    connection = new AcpConnection(bytes => { try { child.stdin.write(bytes) } catch { /* peer closed */ } })
    writeBytes = bytes => { child.stdin.write(bytes) }
    stdoutTask = (async () => { for await (const chunk of child.stdout) { try { connection.receive(chunk as Uint8Array) } catch { /* invalid frame */ } } })()
    child.stderr.on('data', chunk => { if (stderr.join('').length < 4096) stderr.push(String(chunk).slice(0, 1024)) })
    exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    closeInput = async () => { child.stdin.end() }
    stopOwned = undefined
  }
  try {
    const result = await withTimeout(connection.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: options.clientInfo ?? { name: 'personal-agent', version: '0.0.0-m04' },
    }), timeoutMs, 'initialize_timeout')
    const value = result as Record<string, Json>
    const agentInfo = (value.agentInfo ?? {}) as Record<string, Json>
    const protocolVersion = typeof value.protocolVersion === 'number' ? value.protocolVersion : 0
    if (protocolVersion !== ACP_PROTOCOL_VERSION) throw new AcpProtocolError('protocol_version_mismatch', `ACP protocolVersion ${protocolVersion} != ${ACP_PROTOCOL_VERSION}`)
    return {
      protocolVersion,
      ...(typeof agentInfo.name === 'string' ? { agentName: agentInfo.name } : {}),
      ...(typeof agentInfo.version === 'string' ? { agentVersion: agentInfo.version } : {}),
      capabilities: (value.agentCapabilities ?? {}) as Json,
      evidenceRefs: [`acp-initialize:${protocolVersion}`, `acp-agent:${String(agentInfo.name ?? 'unknown')}/${String(agentInfo.version ?? 'unknown')}`],
    }
  } catch (error) {
    if (error instanceof AcpProtocolError) throw error
    throw new AcpProtocolError('initialize_failed', `${String((error as Error)?.message ?? error).slice(0, 200)} stderr=${stderr.join('').slice(0, 200)}`)
  } finally {
    // Normal EOF first; the owned host's ordinary stop is used only if the peer does not exit.
    try { await closeInput() } catch {}
    const natural = await Promise.race([exited.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000))])
    if (!natural) {
      if (stopOwned) await stopOwned().catch(() => undefined)
      throw new AcpProtocolError('probe_exit_timeout', 'ACP probe did not exit after stdin EOF')
    }
    await stdoutTask.catch(() => undefined)
    connection.close('probe-complete')
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AcpProtocolError(code, `ACP wait exceeded ${ms}ms`)), ms)
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

type PendingPermission = {
  binding: ReturnType<typeof NativeQuestionBindingSchema.parse>
  question: ReturnType<typeof UserQuestionSchema.parse>
  requestId: number | string
  sessionId: string
  answered: boolean
  /** question option id -> original ACP option id */
  nativeOptionByQuestionId: Map<string, string>
}

export class AcpDriver implements AgentDriverV1 {
  readonly #options: AcpDriverOptions
  constructor(options: AcpDriverOptions = {}) { this.#options = options }

  async inspect(profile: AgentProfile, host: ProbeHost): Promise<ProbeReport> {
    const inspection = await inspectAcpCompatibility(profile, host, this.#options)
    return inspection.report
  }

  async reconcile(ref: Parameters<AgentDriverV1['reconcile']>[0], host: RecoveryHost): Promise<ReconcileReport> {
    // Facts are diagnostic only. Quiescence must come from the original complete owned-resource
    // inspection; a turn.ended/runtime.exited fact, a cancel reply or a prompt stop is not a barrier.
    try {
      const report = await host.inspectRuntime(ref)
      const facts = await host.readJournal(ref.journalRef ?? ref.attemptId).catch(() => [] as const)
      return {
        status: report.status,
        writer: report.writer,
        ...(report.nativeCursor ?? ref.nativeSessionRef ? { nativeCursor: report.nativeCursor ?? ref.nativeSessionRef } : {}),
        evidenceRefs: [...new Set([...report.evidenceRefs, `acp-journal-facts:${facts.length}`, 'acp-reconcile-owned-runtime'])],
      }
    } catch {
      return { status: 'indeterminate', writer: 'indeterminate', evidenceRefs: ['acp-reconcile-owned-runtime-unavailable'] }
    }
  }

  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    attemptIdentity(spec)
    const requested = await io.payloads.read(spec.policySnapshotRef)
    const strict = AcpV1SettingsSchema.safeParse(requested)
    // Injected transports are controlled Driver tests, never a product admission path. They may carry
    // the old simplified policy object; real spawned ACP requires the reviewed settings contract.
    const controlledLegacy = !strict.success && this.#options.connect !== undefined
    let settings: AcpV1Settings
    if (strict.success) settings = strict.data
    else if (controlledLegacy) {
      const legacy = LegacyControlledSettingsSchema.safeParse(requested)
      if (!legacy.success) return { reason: 'error', evidenceRefs: ['acp-policy-invalid'] }
      settings = { kind: 'acp-v1-settings/1', workspacePath: legacy.data.workspacePath, scope: legacy.data.scope,
        enforcement: 'approval_guarded', verification: 'not_tested', timeoutMs: this.#options.timeoutMs ?? 30000 }
    } else return { reason: 'error', evidenceRefs: ['acp-policy-settings-missing'] }

    const timeoutMs = settings.timeoutMs
    let connection: AcpConnection
    let closeConnection: (() => void) | undefined
    let childResource: string | undefined
    if (this.#options.connect) {
      const transport = await this.#options.connect()
      connection = new AcpConnection(transport.send)
      transport.onData(chunk => { try { connection.receive(chunk) } catch { connection.close('acp-framing-failed') } })
      closeConnection = transport.close
    } else {
      const child = await io.runtime.spawn({ executable: spec.profile.executable, argv: [...spec.profile.argv], cwdRef: spec.workspaceRef, environmentRef: spec.attemptId })
      childResource = child.resourceRef
      connection = new AcpConnection(bytes => { void io.runtime.write(child.resourceRef, bytes) })
      void (async () => { for await (const chunk of child.stdout) connection.receive(chunk) })().catch(() => connection.close('acp-read-failed'))
      void (async () => { for await (const _chunk of child.stderr) { void _chunk } })().catch(() => undefined)
      void child.exited.then(() => connection.close('acp-exited'))
      closeConnection = () => { connection.close('serve-ended') }
    }

    let sequence = 0
    let terminal = false
    let sessionId: string | undefined
    let promptPromise: Promise<Json> | undefined
    let resolveExit: ((exit: ServeExit) => void) | undefined
    const permissions = new Map<string, PendingPermission>()
    const transcript: string[] = []
    const evidence: string[] = []
    const exit = new Promise<ServeExit>(resolve => { resolveExit = resolve })
    let resolveTerminal!: () => void
    const terminalSignal = new Promise<void>(resolve => { resolveTerminal = resolve })
    let policyRef = ''
    let policyRecord: ReturnType<typeof PreparedExecutionPolicySchema.parse> | undefined

    const record = async (kind: RuntimeFactKind, value: unknown, nativeRef?: string): Promise<void> => {
      const payloadRef = await io.payloads.store({ kind, value } as Json, 'critical')
      const fact: CriticalFact = criticalFact(spec, { factId: factIdFor(spec.attemptId, ++sequence), source: 'acp-v1', kind, payloadRef, ...(nativeRef === undefined ? {} : { nativeRef }) })
      await io.record(fact)
    }
    const finish = (reason: ServeExit['reason'], extra: string[]): void => {
      if (terminal) return
      terminal = true
      resolveTerminal()
      resolveExit?.({ reason, evidenceRefs: [...new Set([...evidence, ...extra])] })
    }

    const pump = (async () => {
      for (;;) {
        if (terminal) return
        for (const note of connection.takeNotifications()) {
          if (note.method !== 'session/update') continue
          const value = (note.params ?? {}) as Record<string, Json>
          const update = (value.update ?? {}) as Record<string, Json>
          if (update.sessionUpdate !== 'agent_message_chunk') continue
          const content = (update.content ?? {}) as Record<string, Json>
          if (content.type === 'text' && typeof content.text === 'string') {
            transcript.push(content.text)
            io.publishProgress({ ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract, text: content.text.slice(0, 8192), observedAt: new Date().toISOString() })
          }
        }
        for (const request of connection.takeRequests()) {
          if (request.method !== 'session/request_permission') {
            connection.respondError(request.id, -32601, 'unsupported server request')
            continue
          }
          const value = (request.params ?? {}) as Record<string, Json>
          const rawOptions = Array.isArray(value.options) ? value.options : []
          const options = rawOptions.filter(item => item && typeof item === 'object').map(item => {
            const option = item as Record<string, Json>
            return { optionId: String(option.optionId ?? ''), ...(typeof option.name === 'string' ? { name: option.name } : {}), ...(typeof option.kind === 'string' ? { kind: option.kind } : {}) }
          }).filter(item => item.optionId.length > 0)
          if (options.length === 0) {
            connection.respondError(request.id, -32602, 'permission request has no original options')
            await record('runtime.error', { code: 'protocol_error', message: 'ACP permission request has no options', evidenceRefs: ['acp-permission-no-options'] })
            continue
          }
          const raw = await io.payloads.store(JsonSchema.parse({ method: request.method, params: value, id: request.id }), 'critical')
          const mapped = questionOptions(options)
          const nativeRequestId = typeof request.id === 'number'
            ? { kind: 'integer' as const, decimal: String(request.id) }
            : { kind: 'string' as const, value: String(request.id) }
          const targetId = `acp-target-${canonicalDigest(JsonSchema.parse([spec.attemptId, nativeRequestId])).slice(0, 40)}`
          const binding = NativeQuestionBindingSchema.parse({
            ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch,
            contract: spec.contract, id: targetId, connectionEpoch: 1, nativeRequestId,
            nativeMethod: request.method.slice(0, 256), provenanceRef: raw,
          })
          const toolCall = (value.toolCall ?? {}) as Record<string, Json>
          const question = UserQuestionSchema.parse({
            id: `acp-question-${canonicalDigest(JsonSchema.parse([spec.attemptId, nativeRequestId])).slice(0, 40)}`,
            version: 1, kind: 'permission', contract: spec.contract, scope: settings.scope,
            prompt: String(toolCall.title ?? 'ACP requests permission').slice(0, 16384), nativePayloadRef: raw,
            presentation: { kind: 'choices', multiple: false, options: mapped.items },
            targets: [binding], openedAt: new Date().toISOString(), validity: 'open',
          })
          permissions.set(binding.id, { binding, question, requestId: request.id,
            sessionId: String(value.sessionId ?? sessionId ?? ''), answered: false, nativeOptionByQuestionId: mapped.nativeOptionByQuestionId })
          await record('question.opened', question, binding.id)
          evidence.push(`acp-permission:${String(request.id)}`)
        }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    })()
    void pump.catch(() => undefined)

    try {
      const initialized = await withTimeout(connection.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        clientInfo: this.#options.clientInfo ?? { name: 'personal-agent', version: '0.0.0-m04' },
      }), timeoutMs, 'acp_initialize_timeout') as Record<string, Json>
      const protocolVersion = typeof initialized.protocolVersion === 'number' ? initialized.protocolVersion : 0
      if (protocolVersion !== ACP_PROTOCOL_VERSION) throw new AcpProtocolError('protocol_version_mismatch', `ACP protocolVersion ${protocolVersion} != ${ACP_PROTOCOL_VERSION}`)
      evidence.push(`acp-initialize:${protocolVersion}`)

      const applied = JsonSchema.parse({
        kind: 'acp-v1-applied/1',
        cwd: settings.workspacePath,
        scope: settings.scope,
        ...(settings.model === undefined ? {} : { model: settings.model }),
        ...(settings.mode === undefined ? {} : { mode: settings.mode }),
        protocolVersion,
        agent: initialized.agentInfo ?? {},
      })
      const appliedRef = await io.payloads.store(applied, 'critical')
      let evidenceRef = appliedRef
      if (settings.enforcement === 'enforced') {
        if (!settings.policyEvidenceRef) throw new Error('ACP enforced policy has no evidence reference')
        const proof = AcpPolicyEvidenceSchema.parse(await io.payloads.read(settings.policyEvidenceRef))
        const scopeDigest = canonicalDigest(JsonSchema.parse(settings.scope))
        if (proof.workspacePath !== settings.workspacePath || proof.scopeDigest !== scopeDigest ||
            proof.enforcement !== 'enforced' || proof.verification !== 'passed')
          throw new Error('ACP policy evidence does not bind this workspace/scope/enforcement')
        evidenceRef = settings.policyEvidenceRef
      }
      const prepared = PreparedExecutionPolicySchema.parse({
        ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract,
        requestedPolicyRevision: spec.profile.permissionPolicyRevision,
        nativeAppliedSettingsRef: appliedRef,
        effectiveConfigFingerprint: canonicalDigest(applied),
        enforcement: settings.enforcement,
        verification: settings.verification,
        evidenceRef,
      })
      policyRecord = prepared
      policyRef = await io.payloads.store(JsonSchema.parse(prepared), 'critical')
      await record('policy.prepared', prepared)
      evidence.push('acp-policy-prepared')

      const commands = io.commands[Symbol.asyncIterator]()
      while (!terminal) {
        const next = await Promise.race([
          commands.next().then(value => ({ kind: 'command' as const, value })).catch(() => ({ kind: 'end' as const })),
          terminalSignal.then(() => ({ kind: 'terminal' as const })),
        ])
        if (next.kind !== 'command' || next.value.done) break
        const command = next.value.value
        RunnerCommandSchema.parse(command)
        if (!same(AttemptRefSchema.parse(attemptOfCommand(command)), attemptIdentity(spec))) {
          await record('runtime.error', { code: 'state_indeterminate', message: 'ACP command belongs to another attempt', evidenceRefs: ['acp-command-identity-mismatch'] })
          continue
        }
        if (command.kind === 'begin') {
          if (sessionId) {
            await record('runtime.error', { code: 'protocol_error', message: 'duplicate begin', evidenceRefs: ['duplicate-begin'] })
            continue
          }
          // The original prepared-policy proof gates the first business write. A controlled injected
          // test may use its legacy snapshot ref; the real spawned product path never may.
          if (!controlledLegacy) {
            if (!policyRecord || command.preparedPolicyRef !== policyRef ||
                !admitPreparedPolicy(policyRecord, spec, { profile: spec.profile, currentFingerprint: policyRecord.effectiveConfigFingerprint }).allowed) {
              throw new Error('ACP begin has no current prepared policy')
            }
          } else if (command.preparedPolicyRef !== spec.policySnapshotRef) {
            throw new Error('Controlled ACP begin names another policy snapshot')
          }
          const input = ExecutionInputSchema.parse(await io.payloads.read(command.inputRef))
          if (!same(input.contract, spec.contract)) throw new Error('ACP input has another contract')
          const created = await withTimeout(connection.request('session/new', { cwd: settings.workspacePath, mcpServers: [] }), timeoutMs, 'acp_session_timeout') as Record<string, Json>
          if (typeof created.sessionId !== 'string' || created.sessionId.length === 0) throw new AcpProtocolError('invalid_session', 'session/new returned no sessionId')
          sessionId = created.sessionId
          evidence.push(`acp-session:${sessionId}`)
          promptPromise = withTimeout(connection.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: input.text }] }), timeoutMs, 'acp_prompt_timeout')
          await record('dispatch.observed', { commandId: command.id, delivery: 'written', retry: 'reconcile_first', nativeRef: sessionId, evidenceRefs: ['session-prompt-written'] })
          void promptPromise.then(async result => {
            const value = (result ?? {}) as Record<string, Json>
            const stopReason = typeof value.stopReason === 'string' ? value.stopReason : 'end_turn'
            const cancelled = stopReason === 'cancelled'
            await record('turn.ended', { nativeTurnRef: sessionId, outcome: cancelled ? 'cancelled' : stopReason === 'refusal' ? 'failed' : 'completed', candidateAvailable: !cancelled && stopReason !== 'refusal', evidenceRefs: [`acp-stop:${stopReason}`, ...(transcript.length ? ['acp-transcript'] : [])] }, sessionId ?? undefined)
            finish(cancelled ? 'cancelled' : 'terminal', [`acp-stop:${stopReason}`])
          }).catch(() => { void record('runtime.error', { code: 'transport_lost', message: 'ACP prompt response lost', evidenceRefs: ['prompt-response-lost'] }); finish('error', ['prompt-response-lost']) })
          continue
        }
        if (command.kind === 'deliver') {
          // ACP v1 has no steer operation. Never create a new prompt to imitate one.
          await record('runtime.error', { code: 'unsupported_capability', message: 'ACP session does not support steer; deliver was not sent', evidenceRefs: ['acp-steer-unsupported'] })
          continue
        }
        if (command.kind === 'answer') {
          const binding = NativeQuestionBindingSchema.parse(await io.payloads.read(command.nativeBindingRef))
          const answer = NativeAnswerPayloadSchema.parse(await io.payloads.read(command.answerRef))
          const pending = permissions.get(binding.id)
          if (!pending || pending.answered || !same(pending.binding, binding) || !same(answer.nativeBinding, binding) ||
              answer.questionId !== pending.question.id || answer.questionVersion !== pending.question.version ||
              pending.sessionId !== sessionId) {
            await record('runtime.error', { code: 'state_indeterminate', message: 'ACP answer does not match the open question/target/session', evidenceRefs: ['acp-answer-stale'] })
            continue
          }
          const parsed = parseQuestionAnswer(pending.question, answer.answer)
          if (parsed.kind !== 'choices' || parsed.optionIds.length !== 1) {
            await record('runtime.error', { code: 'unsupported_capability', message: 'ACP permission requires one original option', evidenceRefs: ['acp-answer-unparsed'] })
            continue
          }
          const nativeOptionId = pending.nativeOptionByQuestionId.get(parsed.optionIds[0]!)
          if (nativeOptionId === undefined) {
            await record('runtime.error', { code: 'unsupported_capability', message: 'ACP answer option is not the original option id', evidenceRefs: ['acp-answer-option-mismatch'] })
            continue
          }
          if (!this.#options.beforeAnswerWrite) {
            await record('runtime.error', { code: 'state_indeterminate', message: 'ACP answer has no fresh native-write guard', evidenceRefs: ['acp-answer-guard-unavailable'] })
            continue
          }
          try { await this.#options.beforeAnswerWrite(command) }
          catch { await record('runtime.error', { code: 'state_indeterminate', message: 'ACP answer was refused by the fresh guard', evidenceRefs: ['acp-answer-guard-refused'] }); continue }
          pending.answered = true
          connection.respond(pending.requestId, { outcome: { outcome: 'selected', optionId: nativeOptionId } })
          await record('answer.observed', { answerId: answer.answerId, targetBindingId: binding.id, status: 'response_written', evidenceRefs: ['acp-permission-response-written'] })
          evidence.push(`acp-answer:${binding.id}`)
          continue
        }
        if (command.kind === 'cancel' || command.kind === 'pause_at_boundary') {
          if (!sessionId) { finish('cancelled', ['cancel-before-session']); break }
          connection.notify('session/cancel', { sessionId })
          await record('cancel.observed', { dispatch: { commandId: command.id, delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['session-cancel-written'] }, acknowledged: false, evidenceRefs: ['session-cancel-written'] })
          evidence.push('acp-cancel-written')
          if (promptPromise) await promiseWithDeadline(promptPromise, timeoutMs)
          finish('cancelled', ['session-cancel'])
          break
        }
      }
    } catch (error) {
      await record('runtime.error', { code: error instanceof AcpProtocolError ? 'protocol_error' : 'transport_lost', message: String((error as Error)?.message ?? error).slice(0, 2000), evidenceRefs: ['acp-serve-error'] }).catch(() => undefined)
      finish('error', ['acp-serve-error'])
    } finally {
      closeConnection?.()
    }
    return exit
  }
}

function promiseWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))])
}

function same(a: unknown, b: unknown): boolean {
  return canonicalDigest(JsonSchema.parse(a)) === canonicalDigest(JsonSchema.parse(b))
}

function attemptOfCommand(command: RunnerCommand) {
  return { ticketId: command.ticketId, assignmentId: command.assignmentId, attemptId: command.attemptId, fenceEpoch: command.fenceEpoch, contract: command.contract }
}

function semanticFor(kind: string | undefined): 'allow_once' | 'deny' | 'native_other' {
  switch (kind) {
    case 'allow_once':
    case 'allow_always': return 'allow_once'
    case 'reject_once':
    case 'reject_always': return 'deny'
    default: return 'native_other'
  }
}

function questionOptions(options: Array<{ optionId: string; name?: string; kind?: string }>) {
  const used = new Set<string>()
  const nativeOptionByQuestionId = new Map<string, string>()
  const items = options.map((option, index) => {
    let id = IdSchema.safeParse(option.optionId).success ? option.optionId : `acp-option-${index + 1}`
    while (used.has(id)) id = `${id}-${index + 1}`
    used.add(id)
    nativeOptionByQuestionId.set(id, option.optionId)
    return { id, label: option.name ?? option.optionId, semantic: semanticFor(option.kind) }
  })
  return { items, nativeOptionByQuestionId }
}

export type AcpCompatibilityInspection = { report: ProbeReport; verdict: ReturnType<typeof classifyCompatibility> }

/** Shared zero-model ACP inspection; main/D consume this verdict before any admission. */
export async function inspectAcpCompatibility(profile: AgentProfile, host: ProbeHost, options: AcpDriverOptions = {}): Promise<AcpCompatibilityInspection> {
  const checkedAt = new Date().toISOString()
  const executable = await host.inspectExecutable(profile).catch(() => undefined)
  const config = await host.inspectConfig(profile.nativeConfigRef).catch(() => undefined)
  if (!executable || !config) {
    const report: ProbeReport = { capabilities: [], readiness: 'needs_setup', checkedAt, evidenceRefs: ['acp-probe-host-failed'] }
    return { report, verdict: classifyCompatibility({ profile, probe: report,
      surface: { status: 'failed', reason: 'probe_host_failed', evidenceRefs: report.evidenceRefs },
      required: acpRequiredSurface(), verifiedVersions: options.verifiedVersions ?? [] }) }
  }
  let handshake: AcpHandshake
  try {
    handshake = options.handshake ? await options.handshake(profile) : await probeAcpHandshake({ executable: profile.executable, argv: profile.argv, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }), ...(options.clientInfo === undefined ? {} : { clientInfo: options.clientInfo }) })
  } catch (error) {
    const report: ProbeReport = { capabilities: [], readiness: 'needs_setup', checkedAt,
      evidenceRefs: [`acp-probe-failed:${String((error as Error)?.message ?? error).slice(0, 160)}`] }
    return { report, verdict: classifyCompatibility({ profile, probe: report,
      surface: { status: 'failed', reason: 'acp_initialize_failed', evidenceRefs: report.evidenceRefs },
      required: acpRequiredSurface(), verifiedVersions: options.verifiedVersions ?? [] }) }
  }
  if (handshake.protocolVersion !== ACP_PROTOCOL_VERSION) {
    const report: ProbeReport = { capabilities: [], readiness: 'incompatible', checkedAt,
      evidenceRefs: [`acp-initialize:${handshake.protocolVersion}`, `acp-required:${ACP_PROTOCOL_VERSION}`] }
    return { report, verdict: classifyCompatibility({ profile, probe: report,
      surface: { status: 'failed', reason: 'acp_protocol_version_mismatch', evidenceRefs: report.evidenceRefs },
      required: acpRequiredSurface(), verifiedVersions: options.verifiedVersions ?? [] }) }
  }
  const surface = acpObservedSurface(handshake)
  const identity = {
    profileId: profile.id, profileRevision: profile.revision, executableDigest: executable.digest,
    nativeVersion: handshake.agentVersion ?? executable.version, driverRelease: profile.driverRelease, driverApiMajor: 1 as const,
    wireVersion: surface.wireVersion, schemaDigest: surface.schemaDigest, resolvedConfigFingerprint: config.fingerprint,
    permissionPolicyRevision: profile.permissionPolicyRevision, configStability: config.stability,
    platform: process.platform, architecture: process.arch, runtimeVersion: process.version,
  }
  const capabilities = acpCapabilities(profile.requiredFeatures, handshake)
  const probe: ProbeReport = { identity, capabilities, readiness: 'inspection_passed', checkedAt,
    evidenceRefs: [...new Set([executable.evidenceRef, ...handshake.evidenceRefs, ...capabilities.flatMap(cap => cap.evidenceRefs), `config:${config.fingerprint}`])] }
  const verdict = classifyCompatibility({
    profile, probe,
    surface: { status: 'partial', surface, reason: 'initialize_only', evidenceRefs: handshake.evidenceRefs },
    required: acpRequiredSurface(), verifiedVersions: options.verifiedVersions ?? [],
    environment: { platform: process.platform, architecture: process.arch, runtimeVersion: process.version },
  })
  return { verdict, report: toProbeReport(verdict) }
}

function acpCapabilities(required: readonly string[], handshake: AcpHandshake): ProbeReport['capabilities'] {
  const capabilities = (handshake.capabilities ?? {}) as Record<string, Json>
  const promptCaps = (capabilities.promptCapabilities ?? {}) as Record<string, Json>
  const sessionCaps = (capabilities.sessionCapabilities ?? {}) as Record<string, Json>
  const supported: Record<string, { present: boolean; evidence: string[] }> = {
    'chat.turn': { present: handshake.protocolVersion === 1, evidence: ['acp-initialize:1', 'acp-protocol:session/prompt'] },
    chat: { present: handshake.protocolVersion === 1, evidence: ['acp-protocol:session/prompt'] },
    turn: { present: handshake.protocolVersion === 1, evidence: ['acp-protocol:session/prompt'] },
    'session.new': { present: handshake.protocolVersion === 1, evidence: ['acp-protocol:session/new'] },
    'approval.request': { present: true, evidence: ['acp-protocol:session/request_permission'] },
    questions: { present: true, evidence: ['acp-protocol:session/request_permission'] },
    cancel: { present: true, evidence: ['acp-protocol:session/cancel'] },
    deliver: { present: false, evidence: ['acp-no-steer'] },
    'pause_at_boundary': { present: true, evidence: ['acp-protocol:session/cancel'] },
    'session.resume': { present: sessionCaps.resume !== undefined || capabilities.loadSession === true, evidence: ['acp-initialize:sessionCapabilities'] },
    'prompt.image': { present: promptCaps.image === true, evidence: ['acp-initialize:promptCapabilities'] },
    'prompt.embeddedContext': { present: promptCaps.embeddedContext === true, evidence: ['acp-initialize:promptCapabilities'] },
  }
  return required.map(feature => {
    const found = supported[feature]
    if (!found || !found.present) return { feature, advertised: {}, observed: {}, test: 'NOT_TESTED' as const, policy: 'blocked' as const, evidenceRefs: [] }
    return { feature, advertised: { acp: true }, observed: { initialized: true }, test: 'PASS' as const, policy: 'allowed' as const, evidenceRefs: [...found.evidence, ...handshake.evidenceRefs] }
  })
}
