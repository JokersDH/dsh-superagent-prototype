/**
 * Direct harness for the fake native agent: spawn it, frame its stdout, wait for specific events and
 * read the side-channel receipt file. Used for framing/control tests that do not need the Runner.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonLineDecoder, encodeFrame } from '../../driver-kit/src/index.ts'
import { FAKE_AGENT_PATH } from './fake-driver.ts'

export type AgentFrame = Record<string, unknown>
export type AgentReceipt = Record<string, unknown> & { at: number }

export type FakeAgentOptions = {
  scenario?: string
  delayMs?: number
  /** Extra environment for the child. */
  env?: Record<string, string>
  /** Directory for the receipt side file; a fresh temp dir is used by default. */
  receiptsDir?: string
  stderrLimitBytes?: number
  /** Reader-side frame bounds; tests set small values to exercise the framing limits. */
  maxFrameBytes?: number
  maxBufferedBytes?: number
}

export class FakeAgentSession {
  readonly child: ChildProcessWithoutNullStreams
  readonly frames: AgentFrame[] = []
  readonly receiptsPath: string
  readonly #waiters: Array<() => void> = []
  readonly #decoder: JsonLineDecoder
  #stderr = ''
  #stderrBytes = 0
  #decoderError: Error | undefined
  readonly #stderrLimit: number
  readonly #exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly #stderrChunks: string[] = []

  private constructor(
    child: ChildProcessWithoutNullStreams,
    receiptsPath: string,
    stderrLimitBytes: number,
    limits: { maxFrameBytes: number; maxBufferedBytes: number },
  ) {
    this.child = child
    this.receiptsPath = receiptsPath
    this.#stderrLimit = stderrLimitBytes
    this.#decoder = new JsonLineDecoder(limits)
    this.#exit = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.#decoder.push(chunk)) {
          this.frames.push(frame.value as AgentFrame)
          this.#wake()
        }
      } catch (error) {
        this.#decoderError = error as Error
        this.#wake()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.#stderrBytes += chunk.byteLength
      if (this.#stderr.length < this.#stderrLimit) this.#stderr += chunk.toString('utf8').slice(0, this.#stderrLimit - this.#stderr.length)
      this.#stderrChunks.push(chunk.toString('utf8'))
    })
    child.on('exit', () => this.#wake())
  }

  static async start(options: FakeAgentOptions = {}): Promise<FakeAgentSession> {
    const receiptsDir = options.receiptsDir ?? (await mkdtemp(join(tmpdir(), 'g1-fake-agent-')))
    const receiptsPath = join(receiptsDir, 'receipts.jsonl')
    const args = [FAKE_AGENT_PATH, '--scenario', options.scenario ?? 'happy']
    if (options.delayMs !== undefined) args.push('--delay-ms', String(options.delayMs))
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FAKE_AGENT_RECEIPTS: receiptsPath, ...options.env },
    }) as ChildProcessWithoutNullStreams
    const session = new FakeAgentSession(child, receiptsPath, options.stderrLimitBytes ?? 64 * 1024, {
      maxFrameBytes: options.maxFrameBytes ?? 8 * 1024 * 1024,
      maxBufferedBytes: options.maxBufferedBytes ?? 16 * 1024 * 1024,
    })
    await session.waitForFrame(frame => frame.type === 'ready', 3000)
    return session
  }

  get stderrBytes(): number {
    return this.#stderrBytes
  }

  get stderrText(): string {
    return this.#stderr
  }

  get decoderError(): Error | undefined {
    return this.#decoderError
  }

  get rawStderrChunks(): readonly string[] {
    return this.#stderrChunks
  }

  send(value: unknown): void {
    this.child.stdin.write(encodeFrame(value))
  }

  async waitForFrame(predicate: (frame: AgentFrame) => boolean, timeoutMs = 3000): Promise<AgentFrame> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = this.frames.find(predicate)
      if (found) return found
      if (this.#decoderError) throw this.#decoderError
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new Error(`fake agent exited before the expected frame; seen=${JSON.stringify(this.frames.map(frame => frame.type))}`)
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`timed out waiting for frame; seen=${JSON.stringify(this.frames.map(frame => frame.type))}`)
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, Math.min(remaining, 25))
        this.#waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  waitForExit(timeoutMs = 3000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return Promise.race([
      this.#exit,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for fake agent exit')), timeoutMs)),
    ])
  }

  receipts(): AgentReceipt[] {
    if (!existsSync(this.receiptsPath)) return []
    return readFileSync(this.receiptsPath, 'utf8')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as AgentReceipt)
  }

  receiptFor(type: string): AgentReceipt | undefined {
    return this.receipts().find(receipt => receipt.type === type)
  }

  async shutdown(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try {
        this.send({ type: 'shutdown' })
      } catch {
        // stdin may already be closed
      }
      try {
        await this.waitForExit(1000)
      } catch {
        this.child.kill('SIGKILL')
        await this.#exit
      }
    }
  }

  #wake(): void {
    const waiters = this.#waiters.splice(0)
    for (const wake of waiters) wake()
  }
}
