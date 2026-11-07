/**
 * Reference fake Driver (WP-03 test double).
 *
 * Implements the frozen `AgentDriverV1` port against the programmable fake agent process. Its job is
 * to be the conformance subject for DriverKit/Runner behaviour, not a vendor adapter: payload bodies
 * are fixture-shaped and must be validated with `packages/contracts` at integration.
 *
 * Control discipline (RT-03): `serve` runs a dedicated command loop that forwards `cancel` as soon
 * as it arrives, independently of any business `await` (question pending, turn pending).
 */
import { fileURLToPath } from 'node:url'
import type { AgentDriverV1, AttemptIO, ProbeHost, RecoveryHost } from '../../contracts/src/ports.ts'
import type {
  AttemptSpec,
  CriticalFact,
  Json,
  ProbeReport,
  ReconcileReport,
  RunnerCommand,
  RuntimeFactKind,
  ServeExit,
} from '../../contracts/src/types.ts'
import { DriverError, JsonLineDecoder, attemptIdentity, criticalFact, encodeFrame, factIdFor } from '../../driver-kit/src/index.ts'
import { parseRuntimeFactPayload } from '../../contracts/src/validation.ts'
import { CONTRACT_IDENTITY } from '../../contracts/src/identity.ts'

export const FAKE_AGENT_PATH = fileURLToPath(new URL('./fake-agent.ts', import.meta.url))
/** Placeholder used only to build a fact for validation; replaced by the real store reference. */
const PENDING_PAYLOAD_REF = 'pending-payload'

export type FakeDriverOptions = {
  scenario?: string
  /** A begin whose prepared policy ref differs is refused before any native request (RT-02). */
  preparedPolicyRef?: string
  startTimeoutMs?: number
  now?: () => number
}

export class FakeDriver implements AgentDriverV1 {
  readonly #scenario: string
  readonly #preparedPolicyRef: string
  readonly #startTimeoutMs: number
  readonly #now: () => number

  constructor(options: FakeDriverOptions = {}) {
    this.#scenario = options.scenario ?? 'happy'
    this.#preparedPolicyRef = options.preparedPolicyRef ?? 'prepared-1'
    this.#startTimeoutMs = options.startTimeoutMs ?? 2000
    this.#now = options.now ?? Date.now
  }

  async inspect(_profile: AttemptSpec['profile'], _host: ProbeHost): Promise<ProbeReport> {
    return {
      identity: {
        profileId: 'profile-fake',
        profileRevision: 1,
        executableDigest: 'b'.repeat(64),
        nativeVersion: '0.0.0',
        driverRelease: '0.0.0-g1',
        driverApiMajor: 1,
        wireVersion: 'fake/1',
        schemaDigest: CONTRACT_IDENTITY.schemaHash,
        resolvedConfigFingerprint: 'c'.repeat(64),
        permissionPolicyRevision: 'policy-1',
        configStability: 'frozen',
        platform: process.platform,
        architecture: process.arch,
        runtimeVersion: process.version,
      },
      capabilities: [],
      readiness: 'inspection_passed',
      checkedAt: '2026-11-07T00:00:00.000Z',
      evidenceRefs: ['probe-fake-1'],
    }
  }

  async reconcile(_ref: Parameters<AgentDriverV1['reconcile']>[0], _host: RecoveryHost): Promise<ReconcileReport> {
    return { status: 'indeterminate', writer: 'indeterminate', evidenceRefs: ['reconcile-fake-1'] }
  }

  async serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit> {
    attemptIdentity(spec)
    const resource = await io.runtime.spawn({
      executable: process.execPath,
      argv: [FAKE_AGENT_PATH, '--scenario', this.#scenario],
      cwdRef: 'cwd-fake',
      environmentRef: 'env-fake',
    })

    // Drain stderr immediately: it is diagnostic only (REL-07) and must never fill the pipe.
    // The drain must not outlive the serve: a killed process can leave stderr unclosed, so it is
    // bounded by the same exit the outcome waits for, never awaited unconditionally.
    let stderrBytes = 0
    const stderrDrain = (async () => {
      try {
        for await (const chunk of resource.stderr) stderrBytes += (chunk as Uint8Array).byteLength
      } catch {
        // stderr is diagnostic; a read failure does not change the outcome
      }
    })()
    void stderrDrain.catch(() => undefined)

    let factSeq = 0
    let began = false
    let terminal = false
    let exitInfo: { code: number | null; signal: string | null } | undefined
    const diagnostics: string[] = []
    const nativeRequests: string[] = []
    const controlLatencies: number[] = []
    let resolveOutcome: ((exit: ServeExit) => void) | undefined
    const outcome = new Promise<ServeExit>(resolve => {
      resolveOutcome = resolve
    })

    const evidence = (suffix: string): string => `fake-${spec.attemptId}-${suffix}`
    /**
     * Every critical fact is validated with the frozen `parseRuntimeFactPayload` *before* it is
     * stored or recorded, so the fake Driver cannot smuggle a simplified object past the
     * authoritative ingress (it would be rejected there anyway; failing here keeps the fixture honest).
     */
    const recordFact = async (kind: RuntimeFactKind, value: unknown, nativeRef?: string): Promise<void> => {
      factSeq += 1
      const factId = factIdFor(spec.attemptId, factSeq)
      const pending = criticalFact(spec, { factId, source: 'fake-driver', kind, payloadRef: PENDING_PAYLOAD_REF, ...(nativeRef === undefined ? {} : { nativeRef }) })
      let parsed: ReturnType<typeof parseRuntimeFactPayload>
      try {
        parsed = parseRuntimeFactPayload(pending, { kind, value })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (process.env.FAKE_DRIVER_DEBUG) process.stderr.write(`[fake-driver] payload ${kind} rejected: ${message}\n`)
        throw new DriverError('protocol_error', 'invalid_fact_payload', `Fact ${kind} does not match the frozen payload schema: ${message}`)
      }
      // Payloads are JSON: deep-copy away the readonly markers the schema types carry.
      const payloadRef = await io.payloads.store(JSON.parse(JSON.stringify(parsed)) as Json, 'critical')
      await io.record({ ...pending, payloadRef })
    }

    const finish = (reason: ServeExit['reason'], extra: string[]): void => {
      if (terminal) return
      terminal = true
      resolveOutcome?.({ reason, evidenceRefs: [...new Set([...diagnostics, ...extra])] })
    }

    // Startup handshake: the process must prove it is alive before the Driver accepts control.
    const decoder = new JsonLineDecoder({ maxFrameBytes: 4 * 1024 * 1024, maxBufferedBytes: 8 * 1024 * 1024 })
    const frames: unknown[] = []
    let ready = false
    let waiters: Array<() => void> = []
    const notify = (): void => {
      const pending = waiters
      waiters = []
      for (const wake of pending) wake()
    }
    const pump = (async () => {
      try {
        for await (const chunk of resource.stdout) {
          for (const frame of decoder.push(chunk as Uint8Array)) {
            frames.push(frame.value)
            notify()
            const value = frame.value as Record<string, unknown> | null
            if (value && value.type === 'ready') ready = true
          }
        }
        // EOF: stdout closed. The process may still be alive (eof scenario) or gone.
        if (!terminal) {
          diagnostics.push(evidence('eof'))
          // EOF may leave the process alive (eof scenario): stop what we own before reporting.
          await io.runtime.stopOwned(resource.resourceRef, 250).catch(() => undefined)
          if (!exitInfo) {
            try {
              await recordFact('runtime.error', { code: 'transport_lost', message: 'stdout EOF before terminal turn', evidenceRefs: [evidence('eof')] })
            } catch {
              // ingress may be saturated; the exit reason is still reported
            }
          }
          finish('disconnected', [evidence('eof')])
        }
      } catch (error) {
        diagnostics.push(evidence('framing-error'))
        const driverError = error instanceof DriverError ? error : new DriverError('protocol_error', 'framing_failed', String(error))
        await io.runtime.stopOwned(resource.resourceRef, 250).catch(() => undefined)
        try {
          await recordFact('runtime.error', { code: driverError.code, message: driverError.message, evidenceRefs: [evidence('framing-error')] })
        } catch {
          // The ingress itself may be saturated; the Driver still reports the exit.
        }
        finish('error', [evidence('framing-error')])
      } finally {
        notify()
      }
    })()

    // Startup deadline.
    const startDeadline = this.#now() + this.#startTimeoutMs
    while (!ready && !terminal && this.#now() < startDeadline) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 25)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    if (!ready) {
      diagnostics.push(evidence('start-timeout'))
      await io.runtime.stopOwned(resource.resourceRef, 250).catch(() => undefined)
      finish('error', [evidence('start-timeout')])
    }

    // Control loop: forwards every command and never awaits business work.
    const control = (async () => {
      try {
        for await (const command of io.commands) {
          if (terminal) break
          if (!sameAttempt(command, spec)) {
            diagnostics.push(evidence('identity-mismatch'))
            await recordFact('runtime.error', { code: 'protocol_error', message: 'command identity does not match attempt', evidenceRefs: [evidence('identity-mismatch')] })
            continue
          }
          if (command.kind === 'begin') {
            if (began) {
              diagnostics.push(evidence('duplicate-begin'))
              await recordFact('runtime.error', { code: 'protocol_error', message: 'duplicate begin refused', evidenceRefs: [evidence('duplicate-begin')] })
              continue
            }
            began = true
            if (command.preparedPolicyRef !== this.#preparedPolicyRef) {
              // RT-02: policy was not prepared for this attempt; do not touch the native protocol.
              diagnostics.push(evidence('policy-gate'))
              await recordFact('runtime.error', { code: 'state_indeterminate', message: 'prepared policy mismatch', evidenceRefs: [evidence('policy-gate')] })
              continue
            }
          }
          const startedAt = this.#now()
          await io.runtime.write(resource.resourceRef, encodeFrame({ ...command, type: command.kind, id: command.id }))
          nativeRequests.push(command.kind)
          if (command.kind === 'cancel') controlLatencies.push(this.#now() - startedAt)
        }
      } catch (error) {
        diagnostics.push(evidence('control-error'))
        const driverError = error instanceof DriverError ? error : new DriverError('transport_lost', 'control_write_failed', String(error))
        try {
          await recordFact('runtime.error', { code: driverError.code, message: driverError.message, evidenceRefs: [evidence('control-error')] })
        } catch {
          // ignore
        }
        finish('error', [evidence('control-error')])
      }
    })()
    void control.catch(() => undefined)

    // Business pump: consume agent events until a terminal outcome.
    while (!terminal) {
      if (frames.length === 0) {
        await new Promise<void>(resolve => waiters.push(resolve))
        if (frames.length === 0 && terminal) break
        continue
      }
      const value = frames.shift() as Record<string, unknown> | null
      if (!value || typeof value !== 'object') continue
      switch (value.type) {
        case 'ready':
          diagnostics.push(evidence('started'))
          break
        case 'progress':
          io.publishProgress({
            ticketId: spec.ticketId,
            assignmentId: spec.assignmentId,
            attemptId: spec.attemptId,
            fenceEpoch: spec.fenceEpoch,
            contract: spec.contract,
            text: String(value.text ?? 'progress'),
            observedAt: new Date(this.#now()).toISOString(),
          })
          break
        case 'question':
          await recordFact('question.opened', fakeQuestion(spec, value), String(value.questionId ?? 'q-1'))
          diagnostics.push(evidence('question-open'))
          break
        case 'answer_observed':
          await recordFact('answer.observed', fakeAnswerDelivery(value), String(value.answerRef ?? 'unknown'))
          break
        case 'cancel_observed':
          await recordFact('cancel.observed', {
            dispatch: { commandId: String(value.commandId ?? 'cancel'), delivery: 'native_accepted', retry: 'none', evidenceRefs: [evidence('cancel')] },
            acknowledged: true,
            evidenceRefs: [evidence('cancel')],
          }, String(value.commandId ?? 'cancel'))
          diagnostics.push(evidence('cancel-ack'))
          finish('cancelled', [])
          break
        case 'turn_ended':
          await recordFact('turn.ended', {
            nativeTurnRef: String(value.nativeTurnRef ?? 'turn'),
            outcome: value.outcome === 'cancelled' ? 'cancelled' : value.outcome === 'failed' ? 'failed' : 'completed',
            candidateAvailable: Boolean(value.candidateAvailable),
            evidenceRefs: [evidence('turn')],
          }, String(value.nativeTurnRef ?? 'turn'))
          diagnostics.push(evidence('turn-ended'))
          finish('terminal', [])
          process.exitCode = 0
          break
        case 'fatal':
          await recordFact('runtime.error', { code: 'protocol_error', message: String(value.code ?? 'fatal'), evidenceRefs: [evidence('fatal')] }).catch(() => undefined)
          diagnostics.push(evidence('fatal'))
          finish('error', [evidence('fatal')])
          break
        default:
          // Unknown notification: diagnostic only; never a business fact (REL-07).
          diagnostics.push(evidence('unknown-notification'))
          break
      }
    }

    // A terminal Driver exit must leave no live owned process: stop what we started, then observe it.
    if (terminal) await io.runtime.stopOwned(resource.resourceRef, 1000).catch(() => undefined)
    const exit = await Promise.race([
      resource.exited,
      new Promise<{ code: number | null; signal: string | null }>(resolve => {
        const timer = setTimeout(() => resolve({ code: null, signal: null }), 3000)
        if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
      }),
    ])
    exitInfo = exit
    if (!terminal) {
      await recordFact('runtime.exited', { resourceRef: resource.resourceRef, exitCode: exit.code, signal: exit.signal, evidenceRefs: [evidence('exit')] }, resource.resourceRef)
        .catch(() => undefined)
      finish('error', [evidence('exit')])
    } else {
      await recordFact('runtime.exited', { resourceRef: resource.resourceRef, exitCode: exit.code, signal: exit.signal, evidenceRefs: [evidence('exit')] }, resource.resourceRef)
        .catch(() => undefined)
      await pump.catch(() => undefined)
    }
    const finalExit = await outcome
    // Never block the serve on an unclosed stderr pipe; give it a bounded grace period only.
    await Promise.race([
      stderrDrain.catch(() => undefined),
      new Promise(resolve => {
        const timer = setTimeout(resolve, 250)
        if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
      }),
    ])
    return { ...finalExit, evidenceRefs: [...finalExit.evidenceRefs, evidence(`stderr-bytes-${stderrBytes}`)] }
  }
}

function sameAttempt(command: RunnerCommand, spec: AttemptSpec): boolean {
  return command.attemptId === spec.attemptId && command.fenceEpoch === spec.fenceEpoch && command.assignmentId === spec.assignmentId && command.ticketId === spec.ticketId
}

/**
 * A schema-complete `UserQuestion` for the fake native protocol.
 *
 * The frozen schema requires contract/scope/presentation/targets with a `NativeQuestionBinding`
 * carrying a lossless `WireRequestId`, so a "simplified" object cannot pass the authoritative
 * ingress. Options are fixed so `permission` questions keep their exact native choices.
 */
export function fakeQuestion(spec: AttemptSpec, frame: Record<string, unknown>): {
  id: string
  version: number
  kind: 'permission'
  contract: AttemptSpec['contract']
  scope: {
    projectId: string
    allowedPaths: string[]
    excludedPaths: string[]
    externalActions: string[]
  }
  prompt: string
  nativePayloadRef: string
  presentation: { kind: 'choices'; options: Array<{ id: string; label: string; semantic: 'allow_once' | 'deny' }>; multiple: boolean }
  targets: Array<{
    ticketId: string
    assignmentId: string
    attemptId: string
    fenceEpoch: number
    contract: AttemptSpec['contract']
    id: string
    connectionEpoch: number
    nativeRequestId: { kind: 'string'; value: string }
    nativeMethod: string
    provenanceRef: string
  }>
  openedAt: string
  validity: 'open'
} {
  const questionId = String(frame.questionId ?? 'q-1')
  const nativeId = String(frame.nativeRequestId ?? 'req-1')
  return {
    id: questionId,
    version: 1,
    kind: 'permission',
    contract: spec.contract,
    scope: { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    prompt: `Approve ${String(frame.prompt ?? 'the requested native action')}?`,
    nativePayloadRef: 'native-question-1',
    presentation: {
      kind: 'choices',
      options: [
        { id: 'allow', label: 'Allow once', semantic: 'allow_once' },
        { id: 'deny', label: 'Deny', semantic: 'deny' },
      ],
      multiple: false,
    },
    targets: [
      {
        ticketId: spec.ticketId,
        assignmentId: spec.assignmentId,
        attemptId: spec.attemptId,
        fenceEpoch: spec.fenceEpoch,
        contract: spec.contract,
        id: `binding-${spec.attemptId}-${nativeId}`,
        connectionEpoch: 1,
        nativeRequestId: { kind: 'string', value: nativeId },
        nativeMethod: 'question/ask',
        provenanceRef: 'native-question-1',
      },
    ],
    openedAt: '2026-11-07T00:00:00.000Z',
    validity: 'open',
  }
}

/** A schema-complete `AnswerDelivery` for the fake native protocol. */
export function fakeAnswerDelivery(frame: Record<string, unknown>): {
  answerId: string
  targetBindingId: string
  status: 'local_recorded' | 'response_written' | 'native_applied' | 'indeterminate' | 'expired'
  evidenceRefs: string[]
} {
  return {
    answerId: String(frame.answerRef ?? 'answer-1'),
    targetBindingId: String(frame.targetBindingId ?? 'binding-1'),
    status: 'native_applied',
    evidenceRefs: ['fake-answer-evidence'],
  }
}
