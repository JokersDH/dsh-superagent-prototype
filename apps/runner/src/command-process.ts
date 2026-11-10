import { isAbsolute } from 'node:path'
import type { ProcessHost, OwnedProcess } from './process-host.ts'

export interface CommandProcessOptions {
  cwd: string
  env: Record<string, string>
  signal?: AbortSignal
  timeoutMs: number
  maxOutputBytes: number
}

export interface CommandProcessResult {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
  outputLimited: boolean
  quiescence: 'confirmed' | 'indeterminate'
  resourceRef?: string
  evidenceRefs: readonly string[]
  spawnError?: string
}

/** Preparation is a Runner-owned command, not an unregistered coordinator subprocess. */
export class RunnerCommandProcess {
  private readonly host: ProcessHost
  private readonly beforeSpawn: () => Promise<void>
  constructor(host: ProcessHost, beforeSpawn: () => Promise<void> = async () => {}) {
    this.host = host
    this.beforeSpawn = beforeSpawn
  }

  async run(executable: string, args: readonly string[], options: CommandProcessOptions): Promise<CommandProcessResult> {
    if (!isAbsolute(executable) || !isAbsolute(options.cwd) ||
        !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0')) ||
        !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 1800000 ||
        !Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1 || options.maxOutputBytes > 8 * 1024 * 1024 ||
        !options.env || Object.entries(options.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')))
      throw new TypeError('Invalid bounded Runner command')
    const result: CommandProcessResult = {
      code: null, signal: null, stdout: '', stderr: '', timedOut: false,
      cancelled: options.signal?.aborted === true, outputLimited: false,
      quiescence: 'confirmed', evidenceRefs: ['no-command-started'],
    }
    if (result.cancelled) return result
    await this.beforeSpawn()
    if (options.signal?.aborted) return { ...result, cancelled: true }

    let child: OwnedProcess
    try { child = await this.host.spawnCommand({ executable, argv: args }, { cwd: options.cwd, env: { ...options.env } }) }
    catch (error) {
      // Admission can close while a spawn is in progress; retain the host's uncertain inventory.
      const inventory = this.host.inventory()
      return {
        ...result, quiescence: inventory.some(item => item.writer !== 'quiescent') ? 'indeterminate' : 'confirmed',
        evidenceRefs: ['command-spawn-refused'], spawnError: (error as { reason?: string }).reason ?? 'command_spawn_failed',
      }
    }
    result.resourceRef = child.resourceRef
    let stopping: Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> | undefined
    let reportStop!: (value: { quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }) => void
    const stopped = new Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }>(resolve => { reportStop = resolve })
    const stop = () => {
      if (!stopping) {
        stopping = this.host.stopOwned(child.resourceRef, 500).catch(() => ({ quiescence: 'indeterminate' as const, evidenceRefs: ['command-stop-observation-failed'] }))
        void stopping.then(reportStop)
      }
      return stopping
    }
    const onAbort = () => { result.cancelled = true; void stop() }
    const timer = setTimeout(() => { result.timedOut = true; void stop() }, options.timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let captured = 0
    const capture = async (stream: AsyncIterable<Uint8Array>, output: Buffer[]) => {
      try {
        for await (const chunk of stream) {
          const buffer = Buffer.from(chunk)
          const remaining = options.maxOutputBytes - captured
          const length = Math.min(remaining, buffer.byteLength)
          if (length) { output.push(buffer.subarray(0, length)); captured += length }
          if (buffer.byteLength > remaining) { result.outputLimited = true; void stop() }
        }
      } catch {
        void stop()
      }
    }
    const readers = Promise.all([capture(child.stdout, stdout), capture(child.stderr, stderr)])
    // A stopped/unknown group may retain open pipes; neither pipe EOF nor leader exit is authority.
    const completed = Promise.race([
      child.exited.then(exit => { result.code = exit.code; result.signal = exit.signal; return stop() }),
      stopped,
    ])
    try {
      const stopped = await completed
      result.quiescence = stopped.quiescence
      result.evidenceRefs = stopped.evidenceRefs
      if (stopped.quiescence === 'confirmed') {
        let drainTimer: ReturnType<typeof setTimeout> | undefined
        const drained = await Promise.race([readers.then(() => true), new Promise<boolean>(resolve => { drainTimer = setTimeout(() => resolve(false), 200) })])
        if (drainTimer) clearTimeout(drainTimer)
        if (!drained) { result.outputLimited = true; result.evidenceRefs = [...result.evidenceRefs, 'command-output-not-drained'] }
      }
      child.closeOutput()
      const text = (buffers: Buffer[], budget: number) => new TextDecoder().decode(Buffer.from(Buffer.concat(buffers).toString('utf8')).subarray(0, budget), { stream: true })
      result.stdout = text(stdout, options.maxOutputBytes)
      result.stderr = text(stderr, options.maxOutputBytes - Buffer.byteLength(result.stdout))
      return result
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
}
