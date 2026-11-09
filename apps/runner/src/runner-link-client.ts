/**
 * Client side of the Runner bridge (wave-02 B2).
 *
 * The coordinator spawns one independent Runner process per attempt and speaks protocol v1 over its
 * stdio. This class is the module-level fixture coordinator port: it is the consumer the main-line
 * adapter will wrap, and it deliberately exposes only bootstrap/command/query/reset — never a
 * business shortcut, and never a route that starts a second attempt.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AttemptSpec, CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { JsonLineDecoder, encodeFrame } from '../../../packages/driver-kit/src/index.ts'
import {
  RUNNER_BRIDGE_PROTOCOL,
  parseBridgeFrame,
  type BridgeDownstream,
  type BridgeUpstream,
} from './bridge-protocol.ts'

export type RunnerLinkOptions = {
  /** Executable that runs the service entry (usually `process.execPath`). */
  executable: string
  /** Module specifier or file path of the service entry. */
  entry: string
  /** Extra argv for the entry. */
  args?: string[]
  /** Directory for the journal and payload roots; a temp dir is created when omitted. */
  stateRoot?: string
  env?: Record<string, string>
  payloads?: { read(reference: string): Promise<Json> }
  beforeNativeWrite?: (command: RunnerCommand) => Promise<void>
  onProgress?: (text: string) => void
  producer?: { source: string; runnerIdentityRef: string }
}

export type SpawnedRunner = {
  pid: number
  stateRoot: string
  journalPath: string
  /** Send a command; the return value is the Runner's accepted id, not the native effect. */
  command(command: RunnerCommand): Promise<void>
  /** Resolve with the served exit when the attempt ends. */
  waitExit(): Promise<BridgeDownstream & { type: 'exited' }>
  receipts: DurableReceipt[]
  progress: string[]
  /** Stop the process; resolves with its exit code. */
  close(): Promise<number | null>
}

export class RunnerLink {
  readonly #options: RunnerLinkOptions
  readonly #payloads: Map<string, Json>

  constructor(options: RunnerLinkOptions) {
    this.#options = options
    this.#payloads = new Map()
  }

  /** Bind a payload reference to its value; the Runner only ever sees references. */
  bindPayload(reference: string, value: Json): void {
    this.#payloads.set(reference, value)
  }

  /**
   * Spawn one Runner for one attempt.
   *
   * Order is deliberate: spawn -> bootstrap -> **ready** -> any command. A command before ready is a
   * protocol error on both sides.
   */
  async spawnAttempt(
    spec: AttemptSpec,
    sink: (fact: CriticalFact) => Promise<DurableReceipt>,
  ): Promise<SpawnedRunner> {
    const stateRoot = this.#options.stateRoot ?? (await mkdtemp(join(tmpdir(), 'runner-attempt-')))
    await mkdir(join(stateRoot, 'payloads'), { recursive: true })
    const journalPath = join(stateRoot, 'critical.journal')

    const child: ChildProcessWithoutNullStreams = spawn(
      this.#options.executable,
      [this.#options.entry, ...(this.#options.args ?? [])],
      { stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, ...this.#options.env } },
    ) as ChildProcessWithoutNullStreams

    const decoder = new JsonLineDecoder({ maxFrameBytes: 8 * 1024 * 1024, maxBufferedBytes: 16 * 1024 * 1024 })
    const receipts: DurableReceipt[] = []
    const progress: string[] = []
    let exitFrame: (BridgeDownstream & { type: 'exited' }) | undefined
    let exited: ((frame: BridgeDownstream & { type: 'exited' }) => void) | undefined
    const waiters: Array<() => void> = []
    const notify = (): void => {
      const wake = waiters.splice(0)
      for (const item of wake) item()
    }
    let stderr = ''

    const exitPromise = new Promise<BridgeDownstream & { type: 'exited' }>(resolve => {
      exited = resolve
    })
    child.once('exit', () => {
      if (!exitFrame) {
        exitFrame = { v: 1, type: 'exited', id: 'process-exit', exit: { reason: 'disconnected', evidenceRefs: ['process-exit'] } } as never
        exited?.(exitFrame)
      }
      notify()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 65536) stderr += chunk.toString('utf8')
    })

    const write = (frame: BridgeUpstream | Record<string, unknown>): void => {
      child.stdin.write(encodeFrame({ v: RUNNER_BRIDGE_PROTOCOL, ...frame }))
    }

    let ready = false
    let coordinatorSink: ((fact: CriticalFact) => Promise<DurableReceipt>) | undefined
    const handle = (frame: BridgeDownstream | Record<string, unknown>): void => {
      if (frame.type === 'native-write-intent') {
        const incoming = frame as { id: string; command: RunnerCommand }
        void this.#options.beforeNativeWrite?.(incoming.command).then(() => write({ type: 'write-admission', id: incoming.id, allowed: true })).catch(() => write({ type: 'write-admission', id: incoming.id, allowed: false }))
        if (!this.#options.beforeNativeWrite) write({ type: 'write-admission', id: incoming.id, allowed: false })
        return
      }
      // A fact crosses the bridge so the coordinator's authoritative ingress decides its receipt.
      if ((frame as { type?: string }).type === 'fact') {
        const incoming = frame as unknown as { id: string; fact: CriticalFact }
        void (async () => {
          try {
            if (!coordinatorSink) throw Object.assign(new Error('no coordinator sink configured'), { code: 'state_indeterminate', reason: 'no_sink' })
            const receipt = await coordinatorSink(incoming.fact)
            receipts.push(receipt)
            write({ type: 'receipt', id: incoming.id, factId: incoming.fact.factId, receipt })
          } catch (error) {
            write({ type: 'ack-failed', id: incoming.id, factId: incoming.fact.factId, reason: (error as { reason?: string }).reason ?? 'ack_failed' })
          }
        })()
        return
      }
      // The Runner asks for payloads; only the coordinator holds the immutable store.
      if ((frame as { type?: string }).type === 'payload-read') {
        const request = frame as { requestId: string; reference: string }
        void (async () => {
          const value = this.#payloads.get(request.reference) ?? await this.#options.payloads?.read(request.reference)
          if (value === undefined) throw new Error('Missing payload')
          write({ type: 'payload', id: request.requestId, requestId: request.requestId, value })
        })().catch(() => { stderr += '\nmissing immutable payload'; child.kill('SIGTERM') })
        return
      }
      const downstream = frame as BridgeDownstream
      switch (downstream.type) {
        case 'ready':
          ready = true
          break
        case 'receipt':
          receipts.push(downstream.receipt)
          break
        case 'progress':
          progress.push(downstream.text)
          this.#options.onProgress?.(downstream.text)
          break
        case 'exited':
          exitFrame = downstream
          exited?.(downstream)
          break
        default:
          break
      }
      notify()
    }

    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const decoded of decoder.push(chunk)) handle(parseBridgeFrame(decoded.value) as BridgeDownstream)
      } catch (error) {
        stderr += `\nbridge decode error: ${(error as Error).message}`
      }
    })

    coordinatorSink = sink

    // Bootstrap first, then wait for the ready frame before any command is allowed.
    write({
      type: 'bootstrap',
      id: 'bootstrap',
      spec,
      payloadRoot: join(stateRoot, 'payloads'),
      journalPath,
      producer: this.#options.producer ?? { source: 'runner-link', runnerIdentityRef: `runner-${spec.attemptId}` },
    })
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        clearInterval(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setInterval(() => {
        if (ready) settle()
        else if (child.exitCode !== null) settle(new Error(`runner exited before ready: ${stderr}`))
      }, 10)
      const timeout = setTimeout(() => settle(new Error(`runner did not become ready within 10s: ${stderr}`)), 10_000)
      if (typeof (timeout as { unref?: () => void }).unref === 'function') (timeout as { unref: () => void }).unref()
    })

    return {
      pid: child.pid ?? -1,
      stateRoot,
      journalPath,
      receipts,
      progress,
      command: async command => {
        write({ type: 'command', id: command.id, command })
      },
      waitExit: () => exitPromise,
      close: async () => {
        try {
          write({ type: 'shutdown' })
          child.stdin.end()
        } catch {
          // stdin may already be closed
        }
        const code = await Promise.race([
          new Promise<number | null>(resolve => child.once('exit', value => resolve(value))),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
        ])
        if (code === null) child.kill('SIGKILL')
        return code
      },
    }
  }
}

