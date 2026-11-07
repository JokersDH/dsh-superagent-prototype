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
import { CONTRACT_IDENTITY } from '../../contracts/src/identity.ts'

export const FAKE_AGENT_PATH = fileURLToPath(new URL('./fake-agent.ts', import.meta.url))

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
    const recordFact = async (kind: RuntimeFactKind, payload: Json, nativeRef?: string): Promise<void> => {
      const payloadRef = await io.payloads.store({ kind, value: payload }, 'critical')
      factSeq += 1
      const fact: CriticalFact = criticalFact(spec, {
        factId: factIdFor(spec.attemptId, factSeq),
        source: 'fake-driver',
        kind,
        payloadRef,
        ...(nativeRef === undefined ? {} : { nativeRef }),
      })
      await io.record(fact)
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
          await io.runtime.write(resource.resourceRef, encodeFrame({ type: command.kind, id: command.id, ...command }))
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
          await recordFact('question.opened', {
            questionId: String(value.questionId ?? 'q-1'),
            nativeRequestId: value.nativeRequestId ?? null,
            attemptId: spec.attemptId,
          }, String(value.questionId ?? 'q-1'))
          diagnostics.push(evidence('question-open'))
          break
        case 'answer_observed':
          await recordFact('answer.observed', { answerRef: String(value.answerRef ?? 'unknown'), evidenceRefs: [evidence('answer')] })
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
      new Promise<{ code: number | null; signal: string | null }>(resolve => setTimeout(() => resolve({ code: null, signal: null }), 3000)),
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
    await stderrDrain.catch(() => undefined)
    return { ...finalExit, evidenceRefs: [...finalExit.evidenceRefs, evidence(`stderr-bytes-${stderrBytes}`)] }
  }
}

function sameAttempt(command: RunnerCommand, spec: AttemptSpec): boolean {
  return command.attemptId === spec.attemptId && command.fenceEpoch === spec.fenceEpoch && command.assignmentId === spec.assignmentId && command.ticketId === spec.ticketId
}
