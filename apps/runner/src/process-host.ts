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

  /**
   * Stop an owned process and prove that **everything in its group** is gone.
   *
   * A parent exit is not enough: a same-group descendant (a tool the agent spawned) can keep
   * running and holding resources. The stop is confirmed only when
   *   (a) the group leader exited, **and**
   *   (b) no live (non-zombie) member of the group remains (B-PROCESS-GROUP).
   *
   * Identity cannot be confirmed when the recorded start marker is missing (B-START-MARKER): the
   * host then fails closed and refuses to signal, because a reused PID may now own that group.
   */
  async stopOwned(resourceRef: string, deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    const handle = this.#handles.get(resourceRef)
    if (!handle) return { quiescence: 'indeterminate', evidenceRefs: ['unknown-resource'] }
    const evidence: string[] = []
    const group = handle.identity.groupId

    // Identity gate: a missing or drifted marker means we cannot prove this group is ours.
    if (!handle.identity.startMarker) {
      return { quiescence: 'indeterminate', evidenceRefs: ['identity-unconfirmed:no-start-marker'] }
    }
    const observedMarker = this.#readStartMarker(handle.identity.pid)
    if (!observedMarker) {
      // The leader is already gone. Its group may still hold descendants we cannot attribute.
      evidence.push('leader-gone-without-marker')
    } else if (observedMarker !== handle.identity.startMarker) {
      return { quiescence: 'indeterminate', evidenceRefs: ['identity-mismatch'] }
    }

    // Signal the whole group; a gone leader does not mean the group is empty.
    try {
      process.kill(-group, 'SIGTERM')
      evidence.push('sigterm-group')
    } catch (error) {
      evidence.push(isMissingProcess(error) ? 'sigterm-esrch' : 'sigterm-failed')
    }
    const deadline = this.#now() + Math.max(0, deadlineMs)
    while (this.#now() < deadline) {
      if (await this.#groupQuiescent(handle, group)) {
        evidence.push('group-quiescent', `leader:${exitEvidence(handle)}`)
        this.#handles.delete(resourceRef)
        return { quiescence: 'confirmed', evidenceRefs: evidence }
      }
      await sleep(Math.min(20, Math.max(1, deadline - this.#now())))
    }

    // Escalate on the next round-trip that is still attributable to this group.
    try {
      process.kill(-group, 'SIGKILL')
      evidence.push('sigkill-group')
    } catch (error) {
      evidence.push(isMissingProcess(error) ? 'sigkill-esrch' : 'sigkill-failed')
    }
    const killDeadline = this.#now() + this.#killGraceMs
    while (this.#now() < killDeadline) {
      if (await this.#groupQuiescent(handle, group)) {
        evidence.push('group-quiescent-after-sigkill', `leader:${exitEvidence(handle)}`)
        this.#handles.delete(resourceRef)
        return { quiescence: 'confirmed', evidenceRefs: evidence }
      }
      await sleep(Math.min(20, Math.max(1, killDeadline - this.#now())))
    }

    const alive = this.#liveMembers(group)
    evidence.push(`still-alive:${alive.length}`, ...alive.slice(0, 5).map(member => `member:${member.pid}:${member.state}`))
    return { quiescence: 'indeterminate', evidenceRefs: evidence }
  }

  /**
   * A group is quiescent when the leader has exited and no non-zombie member remains.
   * `ps -o pgid=` is used rather than `kill(0)` so a zombie is not mistaken for a live writer.
   */
  async #groupQuiescent(handle: Handle, group: number): Promise<boolean> {
    if (!handle.exited.done) return false
    return this.#liveMembers(group).length === 0
  }

  #liveMembers(group: number): Array<{ pid: number; state: string }> {
    let text: string
    try {
      text = execFileSync('ps', ['-o', 'pid=,stat=,pgid=', '-g', String(group)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      // `ps -g` exits non-zero when the group has no processes at all.
      return []
    }
    const members: Array<{ pid: number; state: string }> = []
    for (const line of text.split('\n')) {
      const [pidText, state] = line.trim().split(/\s+/)
      if (!pidText || !state) continue
      const pid = Number(pidText)
      if (!Number.isFinite(pid)) continue
      // Z = zombie (already dead, waiting to be reaped); Z+ is the same with session-leader flag.
      const base = state.replace('+', '')
      if (base.startsWith('Z')) continue
      members.push({ pid, state })
    }
    return members
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
  })
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
