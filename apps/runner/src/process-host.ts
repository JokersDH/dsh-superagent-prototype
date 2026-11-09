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
  readonly #inventory = new Map<string, { ref: string; ownership: 'spawned_process'; writer: 'active' | 'quiescent' | 'indeterminate'; evidence: string[] }>()
  readonly #spawning = new Set<Promise<OwnedProcess>>()
  #admissionClosed = false
  readonly #now: () => number
  readonly #killGraceMs: number
  readonly #resolveCwd: (ref: string) => string
  readonly #resolveEnv: (ref: string) => NodeJS.ProcessEnv
  readonly #readStartMarker: (pid: number) => string | null
  readonly #stderrRing: StderrRing | undefined

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
  inventory() { return [...this.#inventory.values()].map(item => structuredClone(item)) }
  closeAdmission(): void { this.#admissionClosed = true }

  async spawn(spec: ProcessSpec): Promise<OwnedProcess> {
    if (this.#admissionClosed) throw new DriverError('state_indeterminate', 'admission_closed', 'Process admission is closed')
    const pending = this.#spawn(spec)
    this.#spawning.add(pending)
    try { return await pending } finally { this.#spawning.delete(pending) }
  }
  async #spawn(spec: ProcessSpec): Promise<OwnedProcess> {
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
    this.#inventory.set(resourceRef, { ref: resourceRef, ownership: 'spawned_process', writer: 'active', evidence: ['owned-process-spawn'] })
    child.once('exit', () => {
      // Keep the handle until stopOwned observes the exit, so late evidence stays addressable.
    })

    if (this.#admissionClosed) {
      await this.stopOwned(resourceRef, 1500)
      throw new DriverError('state_indeterminate', 'admission_closed', 'Process admission closed during spawn')
    }
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
    const previous = this.#inventory.get(resourceRef)
    if (previous?.writer === 'quiescent') return { quiescence: 'confirmed', evidenceRefs: [...previous.evidence] }
    const result = await this.#stopOwned(resourceRef, deadlineMs)
    if (this.#inventory.has(resourceRef)) this.#inventory.set(resourceRef, { ref: resourceRef, ownership: 'spawned_process',
      writer: result.quiescence === 'confirmed' ? 'quiescent' : 'indeterminate', evidence: [...result.evidenceRefs].slice(0, 32) })
    return result
  }
  async #stopOwned(resourceRef: string, deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
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

    const observation = this.#observeGroup(group)
    if (observation.kind === 'unobservable') {
      evidence.push(`group-unobservable:${observation.why}`)
      return { quiescence: 'indeterminate', evidenceRefs: evidence }
    }
    evidence.push(`still-alive:${observation.live.length}`, ...observation.live.slice(0, 5).map(member => `member:${member.pid}:${member.state}`))
    return { quiescence: 'indeterminate', evidenceRefs: evidence }
  }

  /**
   * A group is quiescent when the leader has exited, the group could be **observed**, and no
   * non-zombie member remains. An observation failure is never treated as "empty": an unreadable
   * `ps` (missing tool, permission, parse error) yields `unknown`, which keeps the stop indeterminate.
   */
  async #groupQuiescent(handle: Handle, group: number): Promise<boolean> {
    if (!handle.exited.done) return false
    const observation = this.#observeGroup(group)
    return observation.kind === 'observed' && observation.live.length === 0
  }

  /**
   * Observe a process group. Returns:
   * - `observed` with the live (non-zombie) members, possibly none — a *positive* observation;
   * - `unobservable` when `ps` cannot be run or its output cannot be trusted (ESRCH is the one
   *   failure that does prove the group has no members on this platform).
   */
  #observeGroup(group: number): { kind: 'observed'; live: Array<{ pid: number; state: string }> } | { kind: 'unobservable'; why: string } {
    let text: string
    try {
      // `ps -g` is unreliable across platforms (it exits 1 even for an existing group on macOS), so
      // enumerate every process with its group and filter here: a successful listing is a positive
      // observation, and an empty filtered set genuinely means "no members".
      text = execFileSync('ps', ['-A', '-o', 'pid=,stat=,pgid='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        // A bounded buffer: output overflow is an observation failure, never "no members".
        maxBuffer: 8 * 1024 * 1024,
      })
    } catch (error) {
      const code = (error as { code?: string } | null)?.code
      // A failed or truncated listing cannot prove absence; only a successful one can.
      return { kind: 'unobservable', why: code ?? 'ps_failed' }
    }
    const members: Array<{ pid: number; state: string }> = []
    for (const line of text.split('\n')) {
      const [pidText, state, pgidText] = line.trim().split(/\s+/)
      if (!pidText || !state || !pgidText) continue
      const pid = Number(pidText)
      const pgid = Number(pgidText)
      if (!Number.isFinite(pid) || pgid !== group) continue
      // Z = zombie (already dead, waiting to be reaped); Z+ is the same with session-leader flag.
      const base = state.replace('+', '')
      if (base.startsWith('Z')) continue
      members.push({ pid, state })
    }
    return { kind: 'observed', live: members }
  }

  /** Distinct from "no members": used for evidence when a stop cannot observe the group. */
  #observationFailed(group: number): boolean {
    return this.#observeGroup(group).kind === 'unobservable'
  }

  /** Stop every owned resource; confirmed only when all are proven quiescent. */
  async stopAll(deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    await Promise.allSettled([...this.#spawning])
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
    if (this.#admissionClosed) throw new DriverError('state_indeterminate', 'admission_closed', 'Native write admission is closed')
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

  /**
   * Register best-effort cleanup once per process, not once per host: a listener per host would
   * accumulate across tests and keep the event loop alive.
   */
  #installCleanup(): void {
    const registry = (globalThis as { __g1ProcessHostRegistry?: Set<ProcessHost> }).__g1ProcessHostRegistry
    if (registry) {
      registry.add(this)
      return
    }
    const hosts = new Set<ProcessHost>([this])
    ;(globalThis as { __g1ProcessHostRegistry?: Set<ProcessHost> }).__g1ProcessHostRegistry = hosts
    process.once('exit', () => {
      for (const host of hosts) {
        for (const handle of host.#handles.values()) {
          if (handle.exited.done) continue
          try {
            process.kill(-handle.identity.groupId, 'SIGKILL')
          } catch {
            // best-effort cleanup on process exit
          }
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

/**
 * Referenced sleep. It is deliberately **not** unref'd: `stopOwned()`'s completion is part of the
 * caller's awaited work, so a top-level `await stop(...)` must keep the event loop alive until the
 * stop resolves. Relying on some other unrelated handle to exist made the process exit early (13).
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
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
