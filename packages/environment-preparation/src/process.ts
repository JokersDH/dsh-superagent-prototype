import { spawn } from 'node:child_process'

export interface OwnedRunOptions {
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}

export interface OwnedRunResult {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
  outputLimited: boolean
  /** The owned process group could not be proven gone after SIGKILL. */
  groupAlive: boolean
  /** Three-state group observation: only ESRCH proves the group is gone. */
  groupState: 'alive' | 'gone' | 'unknown'
  spawnError?: string
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Runs one argv-only child in its own process group with bounded time/output. Cancellation, timeout
 * and output limits TERM the group, then KILL it; the result reports whether the group is proven gone.
 */
export async function runOwned(
  command: string,
  args: readonly string[],
  options: OwnedRunOptions,
): Promise<OwnedRunResult> {
  return new Promise<OwnedRunResult>(resolve => {
    let child
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        code: null, signal: null, stdout: '', stderr: '', timedOut: false, cancelled: false,
        outputLimited: false, groupAlive: true, groupState: 'unknown', spawnError: String((error as Error).message ?? error),
      })
      return
    }
    const pid = child.pid
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let cancelled = false
    let outputLimited = false
    let spawnError: string | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined

    // Only ESRCH is proof that the group is gone. EPERM (or any other observation failure) means the
    // group may still exist, so it must never be reported as confirmed quiescence.
    const groupState = (): 'alive' | 'gone' | 'unknown' => {
      if (!pid) return 'unknown'
      try { process.kill(-pid, 0); return 'alive' } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown'
      }
    }
    const terminate = (): void => {
      if (!pid) return
      try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ }
      if (!killTimer) {
        killTimer = setTimeout(() => {
          try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ }
        }, 300)
      }
    }
    const onAbort = (): void => { cancelled = true; terminate() }
    const timer = setTimeout(() => { timedOut = true; terminate() }, options.timeoutMs)
    options.signal?.addEventListener('abort', onAbort)
    const cleanup = (): void => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    // One byte budget is shared by stdout and stderr in arrival order. Decoding is per stream but
    // clipping counts UTF-8 bytes of whole code points, so a multi-byte character is never split and
    // the combined result can never exceed the declared limit.
    let remaining = options.maxOutputBytes
    const decoders = { stdout: new TextDecoder('utf-8'), stderr: new TextDecoder('utf-8') }
    const clip = (text: string, budget: number): { text: string; used: number } => {
      let out = ''
      let used = 0
      for (const character of text) {
        const bytes = Buffer.byteLength(character)
        if (used + bytes > budget) break
        out += character
        used += bytes
      }
      return { text: out, used }
    }
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (outputLimited || remaining <= 0) return
      const decoded = decoders[stream].decode(chunk, { stream: true })
      if (Buffer.byteLength(decoded) > remaining) {
        const clipped = clip(decoded, remaining)
        if (stream === 'stdout') stdout += clipped.text
        else stderr += clipped.text
        remaining -= clipped.used
        outputLimited = true
        terminate()
        return
      }
      if (stream === 'stdout') stdout += decoded
      else stderr += decoded
      remaining -= Buffer.byteLength(decoded)
    }
    const flush = (): void => {
      for (const stream of ['stdout', 'stderr'] as const) {
        if (remaining <= 0) { decoders[stream].decode(); continue }
        const tail = decoders[stream].decode()
        if (!tail) continue
        if (Buffer.byteLength(tail) > remaining) {
          const clipped = clip(tail, remaining)
          if (stream === 'stdout') stdout += clipped.text
          else stderr += clipped.text
          remaining -= clipped.used
          outputLimited = true
        } else {
          if (stream === 'stdout') stdout += tail
          else stderr += tail
          remaining -= Buffer.byteLength(tail)
        }
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.on('error', error => {
      spawnError = String((error as Error).message ?? error)
      if (!settled) {
        settled = true
        cleanup()
        flush()
        resolve({ code: null, signal: null, stdout, stderr, timedOut, cancelled, outputLimited, groupAlive: true, groupState: 'unknown', spawnError })
      }
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      void (async () => {
        flush()
        let state = groupState()
        if (state === 'alive') {
          try { process.kill(-pid!, 'SIGKILL') } catch { /* observation below decides */ }
          await delay(120)
          state = groupState()
        }
        resolve({
          code, signal, stdout, stderr, timedOut, cancelled, outputLimited,
          groupAlive: state !== 'gone', groupState: state,
          ...(spawnError ? { spawnError } : {}),
        })
      })()
    })
  })
}

import type { EnvironmentProcessPort, EnvironmentProcessResult } from './types.ts'

/** Safe default port: detached group, bounded output/time, group-quiescence verification. */
export const standaloneProcessPort: EnvironmentProcessPort = {
  async run(command, args, options): Promise<EnvironmentProcessResult> {
    const result = await runOwned(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    return {
      code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
      timedOut: result.timedOut, cancelled: result.cancelled, outputLimited: result.outputLimited,
      quiescence: result.groupState === 'gone' ? 'confirmed' : result.groupState === 'alive' ? 'indeterminate' : 'unknown',
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
    }
  },
}
