/**
 * The single-writer lock (REL-03). The coordinator holds a lockfile in the state directory and a
 * registry row keyed by its nonce. A second instance is refused while the holder is verifiably
 * alive. A dead holder (ESRCH) is safely taken over. A *live* PID whose nonce is unknown to the
 * registry is reported as `suspect_pid_reuse` and is never auto-taken over: a PID alone is not a
 * death or a life proof, and lease or file-lock age alone never justifies a takeover.
 */
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

export interface LockContent {
  pid: number
  nonce: string
  startedAt: string
}

export type LockVerdict = 'free' | 'in_use' | 'stale' | 'suspect_pid_reuse'
export interface LockProbe {
  verdict: LockVerdict
  holder: LockContent | null
  /** Whether the holder's nonce is registered by this product in the database. */
  registryMatch: boolean
}

/** The registry of coordinator instances the product keeps in its database. */
export interface LockRegistry {
  has(nonce: string): boolean
  register(entry: LockContent): void
  beat(nonce: string): void
}

export class WriterLockHeld extends Error {
  readonly verdict: LockVerdict
  readonly holder: LockContent | null
  constructor(verdict: LockVerdict, holder: LockContent | null) {
    super(verdict === 'suspect_pid_reuse'
      ? 'A live process holds the lock with an unknown instance nonce (possible PID reuse); refusing to take over'
      : 'Another coordinator instance holds the writer lock')
    this.verdict = verdict
    this.holder = holder
  }
}

const isAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class WriterLock {
  private readonly stateDir: string
  private readonly registry: LockRegistry | undefined
  private held: LockContent | undefined
  constructor(stateDir: string, registry?: LockRegistry) {
    this.stateDir = stateDir
    this.registry = registry
  }

  get lockPath(): string { return join(this.stateDir, 'coordinator.lock') }
  get holder(): LockContent | undefined { return this.held }

  /** Reads the lockfile and the registry without mutating anything, and reports what the state means. */
  probe(): LockProbe {
    let raw: string
    try {
      raw = readFileSync(this.lockPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { verdict: 'free', holder: null, registryMatch: false }
      throw error
    }
    let holder: LockContent | null = null
    try {
      const parsed = JSON.parse(raw) as Partial<LockContent>
      if (typeof parsed.pid === 'number' && typeof parsed.nonce === 'string') {
        holder = { pid: parsed.pid, nonce: parsed.nonce, startedAt: String(parsed.startedAt ?? '') }
      }
    } catch { /* an empty or corrupt lockfile has no live holder evidence; reported as stale below */ }
    if (!holder) return { verdict: 'stale', holder: null, registryMatch: false }
    const registryMatch = this.registry?.has(holder.nonce) ?? false
    if (!isAlive(holder.pid)) return { verdict: 'stale', holder, registryMatch }
    return { verdict: registryMatch ? 'in_use' : 'suspect_pid_reuse', holder, registryMatch }
  }

  /**
   * Takes the writer lock. Free or verifiably stale (dead holder) states are acquired; a live
   * holder — registered or a suspected reused PID — throws {@link WriterLockHeld}.
   */
  acquire(): LockContent {
    const probe = this.probe()
    if (probe.verdict === 'in_use' || probe.verdict === 'suspect_pid_reuse') throw new WriterLockHeld(probe.verdict, probe.holder)
    if (probe.verdict === 'stale') {
      // The dead holder's lockfile is removed; its registry row stays for audit.
      try { unlinkSync(this.lockPath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const content: LockContent = { pid: process.pid, nonce: randomUUID(), startedAt: new Date().toISOString() }
    const fd = this.createExclusive()
    try {
      writeSync(fd, JSON.stringify(content))
    } finally {
      closeSync(fd)
    }
    this.registry?.register(content)
    this.held = content
    return content
  }

  /** Updates the instance heartbeat; a no-op unless this instance still holds the lock here. */
  heartbeat(): void {
    if (this.held) this.registry?.beat(this.held.nonce)
  }

  /** Releases the lock if this instance still holds it. */
  release(): void {
    if (!this.held) return
    try {
      const current = JSON.parse(readFileSync(this.lockPath, 'utf8')) as Partial<LockContent>
      if (current.nonce === this.held.nonce) unlinkSync(this.lockPath)
    } catch { /* already gone */ }
    this.held = undefined
  }

  private createExclusive(): number {
    try {
      return openSync(this.lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const probe = this.probe()
        if (probe.verdict !== 'stale') throw new WriterLockHeld(probe.verdict, probe.holder)
        unlinkSync(this.lockPath)
        return openSync(this.lockPath, 'wx', 0o600)
      }
      throw error
    }
  }
}
