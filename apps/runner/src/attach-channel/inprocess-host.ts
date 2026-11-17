/**
 * wave-36: an in-process `RunnerHost` at the existing RunnerHost/RunnerLink boundary.
 *
 * The product factory (`NativeProductAttempt.launch`) hard-codes a native `RunnerLink` spawn, so a
 * zero-native run cannot return *its* handle. This host implements the same interface with the real
 * `serveRunner` service, the real recovery endpoint and a caller-supplied scripted driver: `launch()`
 * genuinely returns a `RunningAttempt` (feed/stop/waitExit/attachPort/attachCallbacks), and the
 * callbacks are the caller's real ones (Store ingress / immutable payload / fresh guard). It is an
 * embedded controlled host, NOT the native factory: it spawns no child and grants no permission.
 *
 * Quiescence is never inferred here. `stop()` reports `indeterminate` unless the caller supplies its
 * own confirmation (`confirmQuiescence`), because a closed channel is not process/child/fd completion.
 */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { AttemptSpec, Json, RunnerCommand, ServeExit } from '../../../../packages/contracts/src/types.ts'
import type { AttachedAttemptCallbacks } from '../../../../packages/execution/src/attached-attempt.ts'
import type { AttachedAttemptPort, Quiescence, RunningAttempt, RunnerHost } from '../../../../packages/execution/src/contracts.ts'
import { serveRunner, type RunnerServiceHandle, type RunnerServiceOptions } from '../runner-service.ts'
import { endpointDirectory } from '../recovery-endpoint.ts'

/** The real registration data the service publishes once its recovery endpoint exists. */
export type InProcessRegistration = AttachedAttemptPort

export type InProcessHostOptions = {
  /** Parent directory for this host's temporary state; created if missing. */
  readonly stateRoot: string
  /** Scripted/embedded driver. No native process is started by the host. */
  readonly createDriver: RunnerServiceOptions['createDriver']
  /** Build the real callbacks for the port this run published. */
  readonly callbacks: (port: InProcessRegistration) => AttachedAttemptCallbacks
  readonly sink?: RunnerServiceOptions['sink']
  readonly guard?: (command: RunnerCommand) => Promise<void>
  readonly payloads?: { read(reference: string): Promise<Json> }
  readonly source?: string
  readonly runnerIdentityRef?: string
  /** Frames retained for diagnostics; the oldest are dropped beyond this bound. */
  readonly frameLimit?: number
}

export type InProcessRunning = RunningAttempt & {
  readonly registration: InProcessRegistration
  /** Resolves with the service's own exit report; never a fabricated success. */
  readonly done: Promise<ServeExit>
  /** Stop the embedded service and release its temporary state. */
  shutdown(): Promise<void>
  /** Bounded diagnostic view of the frames this host observed. */
  frames(): ReadonlyArray<Record<string, unknown>>
}

const DEFAULT_FRAME_LIMIT = 512

function waitUntil(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error(`${label} did not arrive within ${timeoutMs}ms`)
  })()
}

/**
 * One embedded Runner service per `launch()`. Each launch gets its own state root, endpoint and
 * driver; nothing is shared with another attempt.
 */
export class InProcessRunnerHost implements RunnerHost {
  readonly #options: InProcessHostOptions
  readonly #stateRoot: string
  readonly #runs = new Set<{ shutdown(): Promise<void> }>()

  constructor(options: InProcessHostOptions) {
    this.#options = options
    this.#stateRoot = options.stateRoot
    mkdirSync(this.#stateRoot, { recursive: true, mode: 0o700 })
  }

  async launch(spec: AttemptSpec): Promise<InProcessRunning> {
    const root = mkdtempSync(join(this.#stateRoot, 'inprocess-'))
    const recoveryRoot = join(root, 'recovery')
    const input = new PassThrough()
    const frameLimit = this.#options.frameLimit ?? DEFAULT_FRAME_LIMIT
    const frames: Array<Record<string, unknown>> = []
    const source = this.#options.source ?? 'inprocess-host'
    const runnerIdentityRef = this.#options.runnerIdentityRef ?? `inprocess-${spec.attemptId}`
    const producer = {
      attempt: {
        ticketId: spec.ticketId,
        assignmentId: spec.assignmentId,
        attemptId: spec.attemptId,
        fenceEpoch: spec.fenceEpoch,
        contract: spec.contract,
      },
      runnerIdentityRef,
      source,
    }

    const serving = serveRunner({
      input,
      write: frame => {
        frames.push({ ...frame } as Record<string, unknown>)
        if (frames.length > frameLimit) frames.splice(0, frames.length - frameLimit)
      },
      payloads: { read: async reference => (this.#options.payloads ? this.#options.payloads.read(reference) : null) },
      createDriver: this.#options.createDriver,
      ...(this.#options.sink ? { sink: this.#options.sink } : {}),
      ...(this.#options.guard ? { beforeNativeWrite: this.#options.guard } : {}),
      recoveryRoot,
    })
    serving.catch(() => undefined)

    let handle: RunnerServiceHandle | undefined
    let closed = false
    const shutdown = async (): Promise<void> => {
      if (closed) return
      closed = true
      try {
        input.end()
      } catch {
        // already ended
      }
      handle ??= await serving.catch(() => undefined)
      await handle?.shutdown().catch(() => undefined)
      rmSync(root, { recursive: true, force: true })
    }
    this.#runs.add({ shutdown })

    const send = (frame: Record<string, unknown>): void => {
      input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
    }
    send({
      type: 'bootstrap',
      id: 'bootstrap',
      spec,
      payloadRoot: join(root, 'payloads'),
      journalPath: join(root, 'journal'),
      producer: { source, runnerIdentityRef },
    })
    await waitUntil(() => frames.some(frame => frame.type === 'ready'), 20_000, 'runner ready')

    const directory = endpointDirectory(recoveryRoot, spec.attemptId)
    const socketPath = join(directory, 'runner.sock')
    await waitUntil(() => {
      try {
        lstatSync(socketPath)
        return true
      } catch {
        return false
      }
    }, 20_000, 'recovery socket')
    const stat = lstatSync(socketPath)
    const registration: InProcessRegistration = {
      registration: {
        socketPath,
        credentialPath: join(directory, 'runner.credential'),
        socketIdentity: { dev: stat.dev, ino: stat.ino },
      },
      producer,
    }

    const done = (async (): Promise<ServeExit> => {
      await waitUntil(() => frames.some(frame => frame.type === 'exited'), 60_000, 'runner exit')
      const exit = frames.find(frame => frame.type === 'exited')?.exit
      return (exit as ServeExit | undefined) ?? { reason: 'error', evidenceRefs: ['runner-exit-frame-missing'] }
    })()
    void done.catch(() => undefined)

    return {
      attemptId: spec.attemptId,
      registration,
      attachPort: registration,
      attachCallbacks: this.#options.callbacks(registration),
      feed: async command => {
        if (closed) throw new Error('in-process host is closed')
        send({ type: 'command', id: command.id, command })
      },
      waitExit: () => done,
      stop: async (deadlineMs: number): Promise<Quiescence> => {
        // A closed channel is not physical completion: report indeterminate unless the caller's own
        // barrier confirms it. A shaped `confirmed` is deliberately not fabricated here.
        send({ type: 'shutdown', id: `shutdown${spec.attemptId}` })
        await Promise.race([done, new Promise(resolve => setTimeout(resolve, Math.max(1, deadlineMs)))])
        return { quiescence: 'indeterminate', evidenceRefs: ['inprocess-host-shutdown-sent'] }
      },
      done,
      shutdown,
      frames: () => frames.slice(),
    }
  }

  /** Close every run this host started, whether or not the test observed its exit. */
  async shutdown(): Promise<void> {
    for (const run of [...this.#runs]) {
      this.#runs.delete(run)
      await run.shutdown()
    }
    rmSync(this.#stateRoot, { recursive: true, force: true })
  }
}

/** Convenience for a caller that already has a temporary directory. */
export function createInProcessHost(options: Omit<InProcessHostOptions, 'stateRoot'> & { stateRoot?: string }): InProcessRunnerHost {
  return new InProcessRunnerHost({ ...options, stateRoot: options.stateRoot ?? mkdtempSync(join(tmpdir(), 'pa-inprocess-')) })
}
