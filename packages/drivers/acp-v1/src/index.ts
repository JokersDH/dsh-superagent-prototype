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
import { attemptIdentity, criticalFact, factIdFor } from '../../../driver-kit/src/index.ts'
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
}

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

/** Observed ACP surface after initialize: protocol methods are v1-defined, capabilities are advertised. */
export function acpObservedSurface(handshake: AcpHandshake): ProtocolSurface {
  const required = acpRequiredSurface()
  const canonical = {
    wireVersion: 'acp-v1',
    protocolVersion: handshake.protocolVersion,
    methods: [...required.methods].sort(),
    requestFields: required.requestFields,
    enums: required.enums,
    notifications: required.notifications,
    serverRequests: ['session/request_permission'],
    requestIdTypes: ['integer', 'string'],
    capabilities: handshake.capabilities,
  }
  const digest = createDigest(canonical)
  return {
    wireVersion: 'acp-v1', schemaDigest: digest,
    methods: required.methods, requestFields: required.requestFields, enums: required.enums,
    notifications: required.notifications, serverRequests: ['session/request_permission'],
    requestIdTypes: ['integer', 'string'],
  }
}

function createDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
/** Zero-model ACP initialize against one installed CLI. No session, no prompt, no model turn. */
export async function probeAcpHandshake(options: { executable: string; argv?: readonly string[]; timeoutMs?: number; clientInfo?: { name: string; version: string } }): Promise<AcpHandshake> {
  const child = spawn(options.executable, [...(options.argv ?? [])], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const connection = new AcpConnection(bytes => { try { child.stdin.write(bytes) } catch { /* peer closed */ } })
  const stderr: string[] = []
  child.stderr.on('data', chunk => { if (stderr.join('').length < 4096) stderr.push(String(chunk).slice(0, 1024)) })
  child.stdout.on('data', chunk => { try { connection.receive(chunk as Uint8Array) } catch { /* invalid frame fails the probe */ } })
  const timeout = options.timeoutMs ?? 12000
  try {
    const result = await withTimeout(connection.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: options.clientInfo ?? { name: 'personal-agent', version: '0.0.0-m04' },
    }), timeout, 'initialize_timeout')
    const value = result as Record<string, Json>
    const agentInfo = (value.agentInfo ?? {}) as Record<string, Json>
    const protocolVersion = typeof value.protocolVersion === 'number' ? value.protocolVersion : 0
    const handshake: AcpHandshake = {
      protocolVersion,
      ...(typeof agentInfo.name === 'string' ? { agentName: agentInfo.name } : {}),
      ...(typeof agentInfo.version === 'string' ? { agentVersion: agentInfo.version } : {}),
      capabilities: (value.agentCapabilities ?? {}) as Json,
      evidenceRefs: [`acp-initialize:${protocolVersion}`, `acp-agent:${String(agentInfo.name ?? 'unknown')}/${String(agentInfo.version ?? 'unknown')}`],
    }
    if (protocolVersion !== ACP_PROTOCOL_VERSION) throw new AcpProtocolError('protocol_version_mismatch', `ACP protocolVersion ${protocolVersion} != ${ACP_PROTOCOL_VERSION}`)
    return handshake
  } catch (error) {
    if (error instanceof AcpProtocolError) throw error
    throw new AcpProtocolError('initialize_failed', `${String((error as Error)?.message ?? error).slice(0, 200)} stderr=${stderr.join('').slice(0, 200)}`)
  } finally {
    try { child.stdin.end() } catch {}
    const exited = await Promise.race([
      new Promise<boolean>(resolve => child.once('exit', () => resolve(true))),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1500)),
    ])
    if (!exited) child.kill('SIGTERM')
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
  bindingRef: string
  requestId: number | string
  nativeRequestId: { kind: 'string'; value: string } | { kind: 'integer'; decimal: string }
  options: Array<{ optionId: string; name?: string; kind?: string }>
  answered: boolean
  sessionId: string
}

export class AcpDriver implements AgentDriverV1 {
  readonly #options: AcpDriverOptions
  constructor(options: AcpDriverOptions = {}) { this.#options = options }

  async inspect(profile: AgentProfile, host: ProbeHost): Promise<ProbeReport> {
    const inspection = await inspectAcpCompatibility(profile, host, this.#options)
    return inspection.report
  }

  async reconcile(ref: Parameters<AgentDriverV1['reconcile']>[0], host: RecoveryHost): Promise<ReconcileReport> {
    // Read the original Runner journal only; never send a prompt or a business command.
    try {
      const facts = await host.readJournal(ref.journalRef ?? ref.attemptId)
      const ended = facts.some(fact => fact.kind === 'turn.ended' || fact.kind === 'runtime.exited')
      const cancelled = facts.some(fact => fact.kind === 'cancel.observed')
      return {
        status: ended ? 'terminal' : 'indeterminate',
        writer: ended ? 'quiescent' : 'indeterminate',
        ...(ref.nativeSessionRef === undefined ? {} : { nativeCursor: ref.nativeSessionRef }),
        evidenceRefs: [ended ? `acp-journal-terminal:${facts.length}` : `acp-journal-open:${facts.length}`,
          ...(cancelled ? ['acp-journal-cancelled'] : [])],
      }
    } catch {
      return { status: 'indeterminate', writer: 'indeterminate', evidenceRefs: ['acp-reconcile-journal-unavailable'] }
    }
  }

  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    attemptIdentity(spec)
    const timeoutMs = this.#options.timeoutMs ?? 30000
    const policy = await io.payloads.read(spec.policySnapshotRef)
    const policyObject = (policy ?? {}) as Record<string, Json>
    const workspacePath = typeof policyObject.workspacePath === 'string' && policyObject.workspacePath.startsWith('/')
      ? policyObject.workspacePath
      : (spec.workspaceRef.startsWith('/') ? spec.workspaceRef : undefined)
    if (!workspacePath) {
      return { reason: 'error', evidenceRefs: ['acp-policy-workspace-missing'] }
    }
    const scope = isScope(policyObject.scope) ? policyObject.scope : { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: [], externalActions: [] }

    let connection: AcpConnection
    let closeTransport: (() => void) | undefined
    if (this.#options.connect) {
      const transport = await this.#options.connect()
      connection = new AcpConnection(transport.send)
      transport.onData(chunk => { try { connection.receive(chunk) } catch { connection.close('acp-framing-failed') } })
      closeTransport = transport.close
    } else {
      const child = await io.runtime.spawn({ executable: spec.profile.executable, argv: [...spec.profile.argv], cwdRef: spec.workspaceRef, environmentRef: spec.attemptId })
      connection = new AcpConnection(bytes => { void io.runtime.write(child.resourceRef, bytes) })
      void (async () => { for await (const chunk of child.stdout) connection.receive(chunk) })().catch(() => connection.close('acp-read-failed'))
      void (async () => { for await (const _chunk of child.stderr) { void _chunk } })().catch(() => undefined)
      void child.exited.then(() => connection.close('acp-exited'))
      closeTransport = () => { void io.runtime.stopOwned(child.resourceRef, 1500) }
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
    const fallbackPermission = { kind: 'choices' as const, options: [
      { id: 'allow', label: 'Allow', semantic: 'allow_once' as const },
      { id: 'deny', label: 'Deny', semantic: 'deny' as const },
    ], multiple: false }

    let resolveTerminal!: () => void
    const terminalSignal = new Promise<void>(resolve => { resolveTerminal = resolve })
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

    const handleNotification = async (method: string, params: Json | undefined): Promise<void> => {
      if (method === 'session/update') {
        const value = (params ?? {}) as Record<string, Json>
        const update = (value.update ?? {}) as Record<string, Json>
        if (update.sessionUpdate === 'agent_message_chunk') {
          const content = (update.content ?? {}) as Record<string, Json>
          if (content.type === 'text' && typeof content.text === 'string') {
            transcript.push(content.text)
            io.publishProgress({ ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract, text: content.text.slice(0, 8192), observedAt: new Date().toISOString() })
          }
        }
        return
      }
    }

    // Pump notifications/requests without blocking the command loop.
    const pump = (async () => {
      for (;;) {
        if (terminal) return
        const notifications = connection.takeNotifications()
        for (const note of notifications) await handleNotification(note.method, note.params)
        const requests = connection.takeRequests()
        for (const request of requests) {
          if (request.method !== 'session/request_permission') { connection.respondError(request.id, -32601, 'unsupported server request'); continue }
          const value = (request.params ?? {}) as Record<string, Json>
          const rawOptions = Array.isArray(value.options) ? value.options : []
          const options = rawOptions.filter(item => item && typeof item === 'object').map(item => {
            const option = item as Record<string, Json>
            return { optionId: String(option.optionId ?? ''), ...(typeof option.name === 'string' ? { name: option.name } : {}), ...(typeof option.kind === 'string' ? { kind: option.kind } : {}) }
          }).filter(item => item.optionId.length > 0)
          const bindingRef = `acp-${String(request.id)}`.slice(0, 120)
          const nativeRequestId = typeof request.id === 'number'
            ? { kind: 'integer' as const, decimal: String(request.id) }
            : { kind: 'string' as const, value: String(request.id) }
          permissions.set(bindingRef, { bindingRef, requestId: request.id, nativeRequestId, options, answered: false, sessionId: String(value.sessionId ?? sessionId ?? '') })
          const presentation = options.length > 0
            ? { kind: 'choices' as const, multiple: false, options: options.map(option => ({ id: option.optionId, label: option.name ?? option.optionId, semantic: /reject|deny/i.test(option.kind ?? '') ? 'deny' as const : 'allow_once' as const })) }
            : fallbackPermission
          await record('question.opened', {
            id: `q-${spec.attemptId}-${String(request.id)}`.slice(0, 128), version: 1, kind: 'permission', contract: spec.contract,
            scope, prompt: String((value.toolCall as Record<string, Json> | undefined)?.title ?? 'ACP requests permission').slice(0, 16384),
            nativePayloadRef: `native-${String(request.id)}`.slice(0, 128), presentation,
            targets: [{
              ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract,
              id: bindingRef, connectionEpoch: 1, nativeRequestId, nativeMethod: request.method.slice(0, 256), provenanceRef: `native-${String(request.id)}`.slice(0, 128),
            }],
            openedAt: new Date().toISOString(), validity: 'open',
          }, bindingRef)
          evidence.push(`acp-permission:${String(request.id)}`)
        }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
    })()
    void pump.catch(() => undefined)

    try {
      await withTimeout(connection.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        clientInfo: this.#options.clientInfo ?? { name: 'personal-agent', version: '0.0.0-m04' },
      }), timeoutMs, 'acp_initialize_timeout')
      evidence.push('acp-initialized')

      const commands = io.commands[Symbol.asyncIterator]()
      while (!terminal) {
        const next = await Promise.race([
          commands.next().then(value => ({ kind: 'command' as const, value })).catch(() => ({ kind: 'end' as const })),
          terminalSignal.then(() => ({ kind: 'terminal' as const })),
        ])
        if (next.kind !== 'command' || next.value.done) break
        const command = next.value.value
        if (command.kind === 'begin') {
          if (sessionId) {
            await record('runtime.error', { code: 'protocol_error', message: 'duplicate begin', evidenceRefs: ['duplicate-begin'] })
            continue
          }
          const created = await withTimeout(connection.request('session/new', { cwd: workspacePath, mcpServers: [] }), timeoutMs, 'acp_session_timeout') as Record<string, Json>
          if (typeof created.sessionId !== 'string' || created.sessionId.length === 0) throw new AcpProtocolError('invalid_session', 'session/new returned no sessionId')
          sessionId = created.sessionId
          evidence.push(`acp-session:${sessionId}`)
          promptPromise = withTimeout(connection.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: String(command.inputRef) }] }), timeoutMs, 'acp_prompt_timeout')
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
          // ACP v1 has no steer operation. Never create a new turn to imitate one.
          await record('runtime.error', { code: 'unsupported_capability', message: 'ACP session does not support steer; deliver was not sent', evidenceRefs: ['acp-steer-unsupported'] })
          continue
        }
        if (command.kind === 'answer') {
          const pending = permissions.get(String(command.nativeBindingRef))
          if (!pending || pending.answered) {
            await record('runtime.error', { code: 'state_indeterminate', message: 'ACP answer has no open permission request', evidenceRefs: ['acp-answer-unmatched'] })
            continue
          }
          pending.answered = true
          const option = chooseOption(pending.options, String(command.answerRef))
          if (!option) {
            connection.respondError(pending.requestId, -32602, 'no matching permission option')
            await record('runtime.error', { code: 'unsupported_capability', message: 'ACP answer did not match a permission option', evidenceRefs: ['acp-answer-option-missing'] })
            continue
          }
          connection.respond(pending.requestId, { outcome: { outcome: 'selected', optionId: option.optionId } })
          // A written response is not proof the host applied it: record response_written, never native_applied.
          await record('answer.observed', { answerId: String(command.answerRef), targetBindingId: pending.bindingRef, status: 'response_written', evidenceRefs: ['acp-permission-response-written'] })
          evidence.push(`acp-answer:${pending.bindingRef}`)
          continue
        }
        if (command.kind === 'cancel' || command.kind === 'pause_at_boundary') {
          if (!sessionId) { finish('cancelled', ['cancel-before-session']); break }
          connection.notify('session/cancel', { sessionId })
          await record('cancel.observed', { dispatch: { commandId: command.id, delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['session-cancel-written'] }, acknowledged: false, evidenceRefs: ['session-cancel-written'] })
          evidence.push('acp-cancel-written')
          // Wait for the prompt response (or the driver's transport close); the Runner owns physical stop.
          if (promptPromise) await promiseWithDeadline(promptPromise, timeoutMs)
          finish('cancelled', ['session-cancel'])
          break
        }
      }
    } catch (error) {
      await record('runtime.error', { code: error instanceof AcpProtocolError ? 'protocol_error' : 'transport_lost', message: String((error as Error)?.message ?? error).slice(0, 2000), evidenceRefs: ['acp-serve-error'] }).catch(() => undefined)
      finish('error', ['acp-serve-error'])
    } finally {
      closeTransport?.()
      connection.close('serve-ended')
    }
    return exit
  }
}

function promiseWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))])
}

function chooseOption(options: PendingPermission['options'], answerRef: string): { optionId: string } | undefined {
  const exact = options.find(option => option.optionId === answerRef)
  if (exact) return exact
  const normalized = answerRef.toLowerCase()
  if (/allow|approv|once/.test(normalized)) return options.find(option => /allow/i.test(option.kind ?? '') || /allow/i.test(option.name ?? ''))
  if (/deny|reject|no/.test(normalized)) return options.find(option => /reject|deny/i.test(option.kind ?? '') || /reject|deny/i.test(option.name ?? ''))
  return undefined
}

type AcpScope = { projectId: string; allowedPaths: string[]; excludedPaths: string[]; externalActions: string[] }
function isScope(value: Json | undefined): value is AcpScope & Json {
  const scope = value as Record<string, Json> | undefined
  return !!scope && typeof scope.projectId === 'string' && Array.isArray(scope.allowedPaths) && Array.isArray(scope.excludedPaths) && Array.isArray(scope.externalActions)
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
    surface: { status: 'observed', surface, evidenceRefs: handshake.evidenceRefs },
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
