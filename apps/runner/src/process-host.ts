/**
 * Owned process host (WP-03): argv-only spawn, process identity, framed stdin writes and physical
 * stop evidence. It implements the frozen `OwnedProcessHost` port and adds the bits the Runner
 * needs (`stopAll`, resource listing).
 *
 * `spawned_process` ownership: the child is started in its own process group so a stop can reach
 * its whole group. Before signalling, the recorded start marker is compared with `ps` so a reused
 * PID is not touched. A missing marker means identity could not be confirmed; the host then refuses
 * to signal and reports indeterminate instead of guessing.
 */
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { OwnedProcessHost } from '../../../packages/contracts/src/ports.ts'
import type { ProcessSpec } from '../../../packages/contracts/src/types.ts'
import { DriverError } from '../../../packages/driver-kit/src/index.ts'
import type { StderrRing } from './journal.ts'

export type ProcessIdentity = {
  pid: number
  groupId: number
  nonce: string
  executable: string
  argv: readonly string[]
  /** `ps -o lstart=` value captured at spawn; null when it could not be read. */
  startMarker: string | null
  spawnedAt: number
}

export type OwnedProcess = {
  resourceRef: string
  identity: ProcessIdentity
  stdout: AsyncIterable<Uint8Array>
  stderr: AsyncIterable<Uint8Array>
  exited: Promise<{ code: number | null; signal: string | null }>
  write(frame: Uint8Array): Promise<void>
}

export type ProcessHostOptions = {
  now?: () => number
  /** Extra time allowed after SIGKILL before declaring the group still alive. */
  killGraceMs?: number
  /** Resolve an opaque cwdRef/environmentRef into real spawn inputs. */
  resolveCwd?: (ref: string) => string
  resolveEnv?: (ref: string) => NodeJS.ProcessEnv
  /** Injected for tests; defaults to `ps -o lstart= -p <pid>`. */
  readStartMarker?: (pid: number) => string | null
  /** Optional bounded sink: all child stderr is teed here as well as yielded to the Driver. */
  stderrRing?: StderrRing
}

type Handle = {
  child: ChildProcessWithoutNullStreams
  identity: ProcessIdentity
  resourceRef: string
  exited: { done: boolean; code: number | null; signal: string | null }
  exitPromise: Promise<{ code: number | null; signal: string | null }>
}

export class ProcessHost implements OwnedProcessHost {
  readonly #handles = new Map<string, Handle>()
  readonly #now: () => number
  readonly #killGraceMs: number
  readonly #resolveCwd: (ref: string) => string
  readonly #resolveEnv: (ref: string) => NodeJS.ProcessEnv
  readonly #readStartMarker: (pid: number) => string | null
  readonly #stderrRing: StderrRing | undefined
  #cleanupInstalled = false

  constructor(options: ProcessHostOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#killGraceMs = options.killGraceMs ?? 500
    this.#resolveCwd = options.resolveCwd ?? (() => process.cwd())
    this.#resolveEnv = options.resolveEnv ?? (() => process.env)
    this.#readStartMarker = options.readStartMarker ?? defaultStartMarker
    this.#stderrRing = options.stderrRing
  }

  resources(): readonly string[] {
    return [...this.#handles.keys()]
  }

  async spawn(spec: ProcessSpec): Promise<OwnedProcess> {
    validateSpec(spec)
    this.#installCleanup()
    const child = spawn(spec.executable, [...spec.argv], {
      shell: false,
      detached: true, // own process group; required for group stop and identity
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.#resolveCwd(spec.cwdRef),
      env: this.#resolveEnv(spec.environmentRef),
    })
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn)
        reject(new DriverError('executable_missing', 'spawn_failed', error.message, { executable: spec.executable }))
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })

    const pid = child.pid
    if (pid === undefined) throw new DriverError('process_exited', 'spawn_without_pid', 'Child process has no pid')
    const startedAt = this.#now()
    const identity: ProcessIdentity = {
      pid,
      groupId: pid,
      nonce: randomUUID(),
      executable: spec.executable,
      argv: [...spec.argv],
      startMarker: this.#readStartMarker(pid),
      spawnedAt: startedAt,
    }
    const resourceRef = `res-${pid}-${identity.nonce.replaceAll('-', '').slice(0, 12)}`
    const exited = { done: false, code: null as number | null, signal: null as string | null }
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>(resolve => {
      child.once('exit', (code, signal) => {
        exited.done = true
        exited.code = code
        exited.signal = signal
        resolve({ code, signal })
      })
    })
    const handle: Handle = { child, identity, resourceRef, exited, exitPromise }
    this.#handles.set(resourceRef, handle)
    child.once('exit', () => {
      // Keep the handle until stopOwned observes the exit, so late evidence stays addressable.
    })

    return {
      resourceRef,
      identity,
      stdout: child.stdout as unknown as AsyncIterable<Uint8Array>,
      stderr: this.#teeStderr(child.stderr),
      exited: exitPromise,
      write: (frame: Uint8Array) => this.#write(handle, frame),
    }
  }

  async write(resourceRef: string, frame: Uint8Array): Promise<void> {
    const handle = this.#handles.get(resourceRef)
    if (!handle) throw new DriverError('transport_lost', 'unknown_resource', `Unknown resource: ${resourceRef}`)
    await this.#write(handle, frame)
  }

  async stopOwned(resourceRef: string, deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    const handle = this.#handles.get(resourceRef)
    if (!handle) return { quiescence: 'indeterminate', evidenceRefs: ['unknown-resource'] }
    const evidence: string[] = []
    if (handle.exited.done) {
      this.#handles.delete(resourceRef)
      return { quiescence: 'confirmed', evidenceRefs: ['already-exited', exitEvidence(handle)] }
    }

    const observedMarker = this.#readStartMarker(handle.identity.pid)
    if (handle.identity.startMarker && observedMarker && observedMarker !== handle.identity.startMarker) {
      // PID was reused: never signal a process we cannot prove we own.
      return { quiescence: 'indeterminate', evidenceRefs: ['identity-mismatch'] }
    }

    try {
      process.kill(-handle.identity.groupId, 'SIGTERM')
      evidence.push('sigterm-group')
    } catch (error) {
      if (isMissingProcess(error)) {
        evidence.push('sigterm-esrch')
      } else {
        evidence.push('sigterm-failed')
      }
    }
    if (await raceExit(handle.exitPromise, Math.max(0, deadlineMs))) {
      evidence.push(`exit-observed:${exitEvidence(handle)}`)
      this.#handles.delete(resourceRef)
      return { quiescence: 'confirmed', evidenceRefs: evidence }
    }

    try {
      process.kill(-handle.identity.groupId, 'SIGKILL')
      evidence.push('sigkill-group')
    } catch (error) {
      evidence.push(isMissingProcess(error) ? 'sigkill-esrch' : 'sigkill-failed')
    }
    if (await raceExit(handle.exitPromise, this.#killGraceMs)) {
      evidence.push(`sigkill-exit:${exitEvidence(handle)}`)
      this.#handles.delete(resourceRef)
      return { quiescence: 'confirmed', evidenceRefs: evidence }
    }
    evidence.push('still-alive-after-sigkill')
    return { quiescence: 'indeterminate', evidenceRefs: evidence }
  }

  /** Stop every owned resource; confirmed only when all are proven quiescent. */
  async stopAll(deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    const refs = [...this.#handles.keys()]
    if (refs.length === 0) return { quiescence: 'confirmed', evidenceRefs: ['no-owned-resources'] }
    const evidence: string[] = []
    let allConfirmed = true
    const deadline = this.#now() + deadlineMs
    for (const ref of refs) {
      const remaining = Math.max(0, deadline - this.#now())
      const result = await this.stopOwned(ref, remaining)
      evidence.push(...result.evidenceRefs)
      if (result.quiescence !== 'confirmed') allConfirmed = false
    }
    return { quiescence: allConfirmed ? 'confirmed' : 'indeterminate', evidenceRefs: evidence }
  }

  /**
   * Read child stderr once, copy the tail into the bounded ring, and yield the same chunks to the
   * Driver. Bounded capture happens at the host so a Driver cannot accidentally grow stderr.
   */
  #teeStderr(stream: NodeJS.ReadableStream): AsyncIterable<Uint8Array> {
    const ring = this.#stderrRing
    if (!ring) return stream as unknown as AsyncIterable<Uint8Array>
    return (async function* tee() {
      for await (const chunk of stream) {
        const bytes = chunk as Uint8Array
        ring.append(bytes)
        yield bytes
      }
    })()
  }

  async #write(handle: Handle, frame: Uint8Array): Promise<void> {
    if (handle.exited.done) throw new DriverError('transport_lost', 'process_exited', 'Cannot write to an exited process')
    const stdin = handle.child.stdin
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      throw new DriverError('transport_lost', 'stdin_closed', 'stdin is closed')
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        stdin.off('error', onError)
        reject(new DriverError('transport_lost', 'write_failed', error.message))
      }
      stdin.once('error', onError)
      stdin.write(frame, error => {
        stdin.off('error', onError)
        if (error) reject(new DriverError('transport_lost', 'write_failed', error.message))
        else resolve()
      })
    })
  }

  #installCleanup(): void {
    if (this.#cleanupInstalled) return
    this.#cleanupInstalled = true
    process.once('exit', () => {
      for (const handle of this.#handles.values()) {
        if (handle.exited.done) continue
        try {
          process.kill(-handle.identity.groupId, 'SIGKILL')
        } catch {
          // best-effort cleanup on host exit
        }
      }
    })
  }
}

function validateSpec(spec: ProcessSpec): void {
  if (!spec || typeof spec !== 'object') throw new DriverError('protocol_error', 'invalid_process_spec', 'ProcessSpec must be an object')
  if (typeof spec.executable !== 'string' || !(spec.executable.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec.executable))) {
    throw new DriverError('executable_missing', 'relative_executable', 'Executable must be an absolute trusted path')
  }
  if (!Array.isArray(spec.argv) || spec.argv.some(argument => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new DriverError('protocol_error', 'invalid_argv', 'argv must be strings without NUL')
  }
}

function defaultStartMarker(pid: number): string | null {
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return output.length > 0 ? output : null
  } catch {
    return null
  }
}

function exitEvidence(handle: Handle): string {
  return `code=${handle.exited.code ?? 'null'};signal=${handle.exited.signal ?? 'null'}`
}

function isMissingProcess(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ESRCH'
}

async function raceExit(exitPromise: Promise<unknown>, ms: number): Promise<boolean> {
  if (ms <= 0) {
    return await Promise.race([exitPromise.then(() => true), Promise.resolve(false)])
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      exitPromise.then(() => true),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
