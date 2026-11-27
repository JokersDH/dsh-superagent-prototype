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
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createTargetedProcessObserver } from './owned-process-observer.ts'
import type { OwnedProcessObserver, ProcessSnapshot } from './owned-process-observer.ts'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { OwnedProcessHost } from '../../../packages/contracts/src/ports.ts'
import type { ProcessSpec } from '../../../packages/contracts/src/types.ts'
import { DriverError } from '../../../packages/driver-kit/src/index.ts'
import type { StderrRing } from './journal.ts'

export type ProcessIdentity = {
  readonly pid: number
  readonly groupId: number
  readonly nonce: string
  readonly executable: string
  readonly canonicalExecutable: string
  readonly argv0: string
  readonly argv: readonly string[]
  readonly uid: number | null
  readonly parentPid: number
  readonly cwd: string
  readonly cwdRef: string
  readonly environmentRef: string
  readonly operation: 'spawn'
  /** `ps -o lstart=` value captured at spawn; null when it could not be read. */
  readonly startMarker: string | null
  readonly spawnedAt: number
}

export type OwnedProcess = {
  resourceRef: string
  identity: ProcessIdentity
  stdout: AsyncIterable<Uint8Array>
  stderr: AsyncIterable<Uint8Array>
  exited: Promise<{ code: number | null; signal: string | null }>
  write(frame: Uint8Array): Promise<void>
  closeOutput(): void
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
  /** Trusted in-process seams for deterministic control tests. Never read from profile/env/HTTP. */
  observer?: OwnedProcessObserver
  spawnProcess?: typeof spawn
  signalProcess?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void | Promise<void>
  wait?: (ms: number) => Promise<void>
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
  #spawnAdmissionClosed = false
  readonly #now: () => number
  readonly #killGraceMs: number
  readonly #resolveCwd: (ref: string) => string
  readonly #resolveEnv: (ref: string) => NodeJS.ProcessEnv
  readonly #readStartMarker: ((pid: number) => string | null) | undefined
  readonly #observer: OwnedProcessObserver
  readonly #spawnProcess: typeof spawn
  readonly #signalProcess: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void | Promise<void>
  readonly #wait: (ms: number) => Promise<void>
  #stopping: Promise<void> = Promise.resolve()
  #stopWindows = 0
  readonly #resourceStopping = new Set<string>()
  readonly #stderrRing: StderrRing | undefined

  constructor(options: ProcessHostOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#killGraceMs = options.killGraceMs ?? 500
    this.#resolveCwd = options.resolveCwd ?? (() => process.cwd())
    this.#resolveEnv = options.resolveEnv ?? (() => process.env)
    this.#readStartMarker = options.readStartMarker
    this.#observer = options.observer ?? createTargetedProcessObserver()
    this.#spawnProcess = options.spawnProcess ?? spawn
    this.#signalProcess = options.signalProcess ?? ((pid, signal) => { process.kill(pid, signal) })
    this.#wait = options.wait ?? sleep
    this.#stderrRing = options.stderrRing
  }

  resources(): readonly string[] {
    return [...this.#handles.keys()]
  }
  inventory() { return [...this.#inventory.values()].map(item => structuredClone(item)) }
  /** Read only the original spawn record; never discover, infer or adopt a process by PID. */
  originalIdentity(resourceRef: string): ProcessIdentity | undefined {
    const handle = this.#handles.get(resourceRef)
    return handle && !handle.exited.done ? structuredClone(handle.identity) : undefined
  }
  closeAdmission(): void { this.#admissionClosed = true; this.#spawnAdmissionClosed = true }
  /** A bounded cancellation drain may write to existing owned FDs, but must never spawn new work. */
  closeSpawnAdmission(): void { this.#spawnAdmissionClosed = true }

  async spawn(spec: ProcessSpec): Promise<OwnedProcess> {
    return this.#admitSpawn(spec)
  }

  /** Trusted Runner preparation commands share the same inventory and cancellation admission. */
  async spawnCommand(
    command: { executable: string; argv: readonly string[] },
    context: { cwd: string; env: NodeJS.ProcessEnv },
  ): Promise<OwnedProcess> {
    const process = await this.#admitSpawn({ ...command, cwdRef: 'runner-command', environmentRef: 'runner-command' }, context)
    const input = this.#handles.get(process.resourceRef)?.child.stdin
    input?.once('error', () => undefined)
    input?.end()
    return process
  }

  async #admitSpawn(spec: ProcessSpec, context?: { cwd: string; env: NodeJS.ProcessEnv }): Promise<OwnedProcess> {
    if (this.#admissionClosed || this.#spawnAdmissionClosed) throw new DriverError('state_indeterminate', 'admission_closed', 'Process admission is closed')
    if (this.#stopWindows > 0) throw new DriverError('state_indeterminate', 'stop_observation_in_progress', 'Original resource stop observation is in progress')
    const pending = this.#spawn(spec, context)
    this.#spawning.add(pending)
    try { return await pending } finally { this.#spawning.delete(pending) }
  }
  async #spawn(spec: ProcessSpec, context?: { cwd: string; env: NodeJS.ProcessEnv }): Promise<OwnedProcess> {
    validateSpec(spec)
    let cwd: string, canonicalExecutable: string
    try { cwd = realpathSync(context?.cwd ?? this.#resolveCwd(spec.cwdRef)); canonicalExecutable = realpathSync(spec.executable) }
    catch { throw new DriverError('executable_missing', 'spawn_inputs_unobserved', 'Trusted executable or workspace identity is unavailable') }
    const startedAt = this.#now()
    const child = this.#spawnProcess(spec.executable, [...spec.argv], {
      shell: false,
      detached: true, // own process group; required for group stop and identity
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: context?.env ?? this.#resolveEnv(spec.environmentRef),
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
    const expected = {
      pid, groupId: pid, nonce: randomUUID(), executable: spec.executable, canonicalExecutable,
      argv0: spec.executable, argv: Object.freeze([...spec.argv]), uid: process.geteuid?.() ?? null,
      parentPid: process.pid, cwd, cwdRef: spec.cwdRef, environmentRef: spec.environmentRef,
      operation: 'spawn' as const, spawnedAt: startedAt,
    }
    const observed = this.#processObservation(pid)
    let group: ReturnType<OwnedProcessObserver['group']>
    try { group = this.#observer.group(pid) } catch { group = { kind: 'unknown', reason: 'spawn-group-unobserved' } }
    const attributable = observed !== undefined && matchesOriginal(expected, observed) &&
      group.kind === 'observed' && group.pids.length === 1 && group.pids[0] === pid
    const identity: ProcessIdentity = Object.freeze({ ...expected, startMarker: attributable ? observed.startMarker : null })
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

    if (this.#admissionClosed || this.#spawnAdmissionClosed) {
      // The explicit stop owner waits for this spawn to settle, then validates the WHOLE plan.
      // Never signal recursively from an admission-close race or around a missing identity.
      throw new DriverError('state_indeterminate', 'admission_closed', 'Process admission closed during spawn')
    }
    return {
      resourceRef,
      identity,
      stdout: child.stdout as unknown as AsyncIterable<Uint8Array>,
      stderr: this.#teeStderr(child.stderr),
      exited: exitPromise,
      write: (frame: Uint8Array) => this.#write(handle, frame),
      closeOutput: () => { child.stdout.destroy(); child.stderr.destroy() },
    }
  }

  async write(resourceRef: string, frame: Uint8Array): Promise<void> {
    const handle = this.#handles.get(resourceRef)
    if (!handle) throw new DriverError('transport_lost', 'unknown_resource', `Unknown resource: ${resourceRef}`)
    await this.#write(handle, frame)
  }
  /** Normal EOF for one original owned stdin. It sends no signal and grants no exit/quiescence. */
  async closeInput(resourceRef: string): Promise<void> {
    const handle = this.#handles.get(resourceRef)
    if (!handle) throw new DriverError('transport_lost', 'unknown_resource', `Unknown resource: ${resourceRef}`)
    if (handle.child.stdin.writableEnded || handle.child.stdin.destroyed) return
    await new Promise<void>((resolve, reject) => {
      const clean = () => { handle.child.stdin.off('error', failed); handle.child.stdin.off('finish', finished) }
      const failed = (error: Error) => { clean(); reject(error) }
      const finished = () => { clean(); resolve() }
      handle.child.stdin.once('error', failed)
      handle.child.stdin.once('finish', finished)
      handle.child.stdin.end()
    })
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
    if (!this.#handles.has(resourceRef)) return { quiescence: 'indeterminate', evidenceRefs: ['unknown-resource'] }
    const window = this.#stopWindow(deadlineMs)
    this.#resourceStopping.add(resourceRef)
    this.#stopWindows++
    try { return await this.#serializedStop(() => this.#stopResources([resourceRef], window)) }
    finally { this.#stopWindows-- }
  }

  #stopWindow(deadlineMs: number) {
    const termDeadline = this.#now() + Math.max(0, deadlineMs)
    return { termDeadline, finalDeadline: termDeadline + this.#killGraceMs }
  }
  async #awaitSpawning(deadline: number): Promise<boolean> {
    const pending = [...this.#spawning]
    if (pending.length === 0) return true
    const remaining = deadline - this.#now()
    if (remaining <= 0) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([Promise.allSettled(pending).then(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), remaining) })])
    } finally { if (timer) clearTimeout(timer) }
  }

  #serializedStop<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#stopping.then(operation, operation)
    this.#stopping = run.then(() => undefined, () => undefined)
    return run
  }
  #processObservation(pid: number): ProcessSnapshot | undefined {
    try {
      const result = this.#observer.process(pid)
      if (result.kind !== 'observed') return undefined
      const value = structuredClone(result.process)
      if (this.#readStartMarker) value.startMarker = this.#readStartMarker(pid) ?? ''
      return value
    } catch { return undefined }
  }
  #plan(refs: readonly string[]): Array<{ ref: string; state: 'live' | 'quiescent' | 'unknown'; evidence: string; pendingExit?: boolean }> {
    return refs.map(ref => {
      if (this.#inventory.get(ref)?.writer === 'quiescent') return { ref, state: 'quiescent' as const, evidence: 'original-confirmed-barrier' }
      const handle = this.#handles.get(ref), identity = handle?.identity
      if (!handle || !identity?.startMarker || identity.uid === null || identity.groupId !== identity.pid)
        return { ref, state: 'unknown' as const, evidence: 'original-spawn-identity-incomplete' }
      try {
        const group = this.#observer.group(identity.groupId)
        if (group.kind !== 'observed') return { ref, state: 'unknown' as const, evidence: 'owned-group-unobserved' }
        if (group.pids.length === 0) return handle.exited.done
          ? { ref, state: 'quiescent' as const, evidence: 'original-exit-and-observed-empty-group' }
          : { ref, state: 'unknown' as const, evidence: 'original-exit-not-observed', pendingExit: true }
        if (group.pids.length !== 1 || group.pids[0] !== identity.pid)
          return { ref, state: 'unknown' as const, evidence: 'unregistered-group-member' }
        if (handle.exited.done) return { ref, state: 'unknown' as const, evidence: 'group-not-empty-after-original-exit' }
        const process = this.#processObservation(identity.pid)
        if (!process || !matchesOriginal(identity, process) || process.startMarker !== identity.startMarker || process.state.startsWith('Z'))
          return { ref, state: 'unknown' as const, evidence: 'fresh-process-identity-mismatch-or-missing' }
        const again = this.#observer.group(identity.groupId)
        if (again.kind !== 'observed' || again.pids.length !== 1 || again.pids[0] !== identity.pid)
          return { ref, state: 'unknown' as const, evidence: 'owned-group-changed-during-preflight' }
        return { ref, state: 'live' as const, evidence: 'full-original-identity-and-singleton-group' }
      } catch { return { ref, state: 'unknown' as const, evidence: 'owned-plan-observation-failed' } }
    })
  }
  #rememberQuiescence(plan: Array<{ ref: string; state: 'live' | 'quiescent' | 'unknown'; evidence: string; pendingExit?: boolean }>, evidence: readonly string[]): void {
    for (const item of plan) if (item.state === 'quiescent' && this.#handles.has(item.ref)) {
      const handle = this.#handles.get(item.ref)!
      this.#inventory.set(item.ref, { ref: item.ref, ownership: 'spawned_process', writer: 'quiescent',
        evidence: [...evidence, item.evidence, 'group-quiescent', `leader:${exitEvidence(handle)}`].slice(-32) })
      this.#handles.delete(item.ref)
    }
  }
  async #stopResources(targets: readonly string[], window: { termDeadline: number; finalDeadline: number }): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    if (!await this.#awaitSpawning(window.termDeadline))
      return { quiescence: 'indeterminate', evidenceRefs: ['original-spawn-completion-unobserved-before-deadline'] }
    const universe = [...this.#handles.keys()], evidence: string[] = []
    const result = (confirmed: boolean, why?: string) => {
      if (why) evidence.push(why)
      if (!confirmed) for (const ref of targets) if (this.#handles.has(ref))
        this.#inventory.set(ref, { ref, ownership: 'spawned_process', writer: 'indeterminate', evidence: [...evidence].slice(-32) })
      return { quiescence: confirmed ? 'confirmed' as const : 'indeterminate' as const, evidenceRefs: [...evidence] }
    }
    const inspect = () => {
      const plan = this.#plan(universe)
      this.#rememberQuiescence(plan, evidence)
      return plan
    }
    const complete = () => targets.every(ref => this.#inventory.get(ref)?.writer === 'quiescent')
    let plan = inspect()
    if (complete()) return result(true, 'original-complete-group-barrier')
    if (plan.some(item => item.state === 'unknown')) return result(false, plan.find(item => item.state === 'unknown')!.evidence)

    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      for (const ref of targets) {
        if (this.#inventory.get(ref)?.writer === 'quiescent') continue
        // Whole-plan revalidation, including OTHER original resources, happens immediately before
        // EVERY ordinary signal and escalation. A group number alone is never a signal authority.
        plan = inspect()
        const missing = plan.find(item => item.state === 'unknown')
        if (missing) return result(false, `pre-${signal.toLowerCase()}:${missing.evidence}`)
        const target = plan.find(item => item.ref === ref)
        if (target?.state !== 'live') continue
        if (this.#now() >= (signal === 'SIGTERM' ? window.termDeadline : window.finalDeadline))
          return result(false, `pre-${signal.toLowerCase()}:preflight-deadline-exceeded`)
        const handle = this.#handles.get(ref)!
        try {
          // The admitted cohort is exactly one original leader per group. Signal that exact PID,
          // never an unregistered child that could join the group between observation and delivery.
          await this.#signalProcess(handle.identity.pid, signal)
          evidence.push(`${signal.toLowerCase()}-owned-pid:${handle.identity.pid}`)
        } catch { return result(false, `${signal.toLowerCase()}-delivery-unconfirmed`) }
      }
      const until = signal === 'SIGTERM' ? window.termDeadline : window.finalDeadline
      for (;;) {
        plan = inspect()
        if (complete()) return result(true, 'original-complete-group-barrier')
        const failure = plan.find(item => item.state === 'unknown' && !item.pendingExit)
        if (failure) return result(false, `after-${signal.toLowerCase()}:${failure.evidence}`)
        if (this.#now() >= until) break
        await this.#wait(Math.min(20, Math.max(1, until - this.#now())))
      }
    }
    return result(false, 'owned-writer-still-active-or-unobserved')
  }

  /** Stop the original complete inventory; a single unknown entry prevents every new signal. */
  async stopAll(deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly string[] }> {
    const window = this.#stopWindow(deadlineMs)
    this.closeAdmission()
    return this.#serializedStop(async () => {
      if (!await this.#awaitSpawning(window.termDeadline))
        return { quiescence: 'indeterminate', evidenceRefs: ['original-spawn-completion-unobserved-before-deadline'] }
      const refs = [...this.#handles.keys()]
      if (refs.length === 0) return { quiescence: 'confirmed', evidenceRefs: ['no-owned-resources'] }
      return this.#stopResources(refs, window)
    })
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
    if (this.#resourceStopping.has(handle.resourceRef)) throw new DriverError('state_indeterminate', 'resource_stopping', 'Original resource write admission is closed')
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


/** Match observed OS fields to the immutable caller-selected spawn record, not to another label. */
function matchesOriginal(identity: Pick<ProcessIdentity, 'pid' | 'groupId' | 'canonicalExecutable' | 'argv0' | 'argv' | 'uid' | 'parentPid' | 'cwd'>, observed: ProcessSnapshot): boolean {
  return identity.pid === observed.pid && identity.groupId === observed.groupId && identity.uid !== null && identity.uid === observed.uid &&
    identity.parentPid === observed.parentPid && identity.canonicalExecutable === observed.executable && identity.argv0 === observed.argv0 &&
    identity.cwd === observed.cwd && identity.argv.length === observed.argv.length && identity.argv.every((argument, index) => argument === observed.argv[index])
}
