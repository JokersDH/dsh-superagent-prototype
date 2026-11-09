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
        outputLimited: false, groupAlive: false, spawnError: String((error as Error).message ?? error),
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

    const groupAlive = (): boolean => {
      if (!pid) return false
      try { process.kill(-pid, 0); return true } catch { return false }
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
    const append = (current: string, chunk: Buffer): string => {
      if (outputLimited) return current
      const next = current + chunk.toString('utf8')
      if (Buffer.byteLength(next) > options.maxOutputBytes) {
        outputLimited = true
        terminate()
        return next.slice(0, options.maxOutputBytes)
      }
      return next
    }
    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.on('error', error => {
      spawnError = String((error as Error).message ?? error)
      if (!settled) {
        settled = true
        cleanup()
        resolve({ code: null, signal: null, stdout, stderr, timedOut, cancelled, outputLimited, groupAlive: false, spawnError })
      }
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      void (async () => {
        let alive = groupAlive()
        if (alive) {
          try { process.kill(-pid!, 'SIGKILL') } catch { /* gone */ }
          await delay(120)
          alive = groupAlive()
        }
        resolve({
          code, signal, stdout, stderr, timedOut, cancelled, outputLimited, groupAlive: alive,
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
      quiescence: result.groupAlive ? 'indeterminate' : 'confirmed',
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
    }
  },
}
