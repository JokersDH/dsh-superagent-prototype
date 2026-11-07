/**
 * The single-writer lock (REL-03). Ownership is an atomic database claim; the lockfile is an
 * advisory breadcrumb and never authority:
 *
 * - `writer_claim` holds at most one row. Claim (`INSERT OR IGNORE`), stale takeover (CAS
 *   `UPDATE ... WHERE nonce = observed`), and release (conditional `DELETE`) are single SQL
 *   statements, so concurrent acquirers and stale takers can never both win.
 * - The lockfile is created with its full content atomically (a written temp file is `link`ed
 *   into place), so no reader ever sees an in-flight empty file. After a supported takeover the
 *   claim winner alone replaces it with an atomic rename.
 * - Empty, unknown, or corrupt lockfile content is NOT death evidence: acquisition fails closed.
 *   A stale takeover requires the registry and a verifiably dead holder (ESRCH). A live PID is
 *   never assumed dead, and lease or file age is never used as proof.
 */
import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

export interface LockContent {
  pid: number
  nonce: string
  startedAt: string
}

/** `unknown` is the fail-closed verdict for empty/corrupt lockfile content that proves nothing. */
export type LockVerdict = 'free' | 'in_use' | 'stale' | 'suspect_pid_reuse' | 'unknown'

export interface LockProbe {
  verdict: LockVerdict
  holder: LockContent | null
  /** Whether the holder's nonce is registered by this product in its audit table. */
  registryMatch: boolean
}

/**
 * The authoritative instance registry. `claim`/`takeOver`/`release` must each be a single atomic
 * database operation; `register` is an audit row that never grants ownership.
 */
export interface LockRegistry {
  /** The current claim, if any. */
  current(): LockContent | undefined
  /** Whether the nonce has an audit row in this product's instance table. */
  has(nonce: string): boolean
  /** Atomically inserts the claim when none exists; returns false when another claim exists. */
  claim(entry: LockContent): boolean
  /** Atomically replaces the claim only when it still belongs to `observedNonce`; false when another taker won. */
  takeOver(observedNonce: string, entry: LockContent): boolean
  /** Atomically drops the claim only when it still belongs to `nonce`; false after a takeover. */
  release(nonce: string): boolean
  /** Audit record of this instance; a failure must not leave ownership behind. */
  register(entry: LockContent): void
  beat(nonce: string): void
}

export class WriterLockHeld extends Error {
  readonly verdict: LockVerdict
  readonly holder: LockContent | null
  constructor(verdict: LockVerdict, holder: LockContent | null) {
    super(verdict === 'suspect_pid_reuse'
      ? 'A live process claims the writer lock with an unregistered instance nonce (possible PID reuse); refusing to take over'
      : verdict === 'unknown'
        ? 'The writer lock file has empty or corrupt content, which proves nothing about a holder; refusing to acquire'
        : verdict === 'stale'
          ? 'The previous writer holder is dead, but takeover needs the atomic instance registry; refusing'
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

interface LockFile {
  state: 'missing' | 'valid' | 'corrupt'
  content: LockContent | null
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

  /** Reads the claim and the lockfile without mutating anything; the claim is authoritative. */
  probe(): LockProbe {
    const claim = this.registry?.current()
    if (claim) {
      const registryMatch = this.registry!.has(claim.nonce)
      if (!isAlive(claim.pid)) return { verdict: 'stale', holder: claim, registryMatch }
      return { verdict: registryMatch ? 'in_use' : 'suspect_pid_reuse', holder: claim, registryMatch }
    }
    const file = this.readLockFile()
    if (file.state === 'missing') return { verdict: 'free', holder: null, registryMatch: false }
    if (file.state === 'corrupt' || !file.content) return { verdict: 'unknown', holder: null, registryMatch: false }
    const holder = file.content
    const registryMatch = this.registry?.has(holder.nonce) ?? false
    if (!isAlive(holder.pid)) return { verdict: 'stale', holder, registryMatch }
    return { verdict: registryMatch ? 'in_use' : 'suspect_pid_reuse', holder, registryMatch }
  }

  /**
   * Takes the writer lock. With a registry, ownership is the atomic claim; a verifiably dead
   * holder is taken over by CAS so exactly one taker wins. Without a registry only a free state
   * is acquired — stale takeover and unknown content fail closed.
   */
  acquire(): LockContent {
    const me: LockContent = { pid: process.pid, nonce: randomUUID(), startedAt: new Date().toISOString() }
    if (!this.registry) return this.acquireLockfileOnly(me)
    // A short retry loop absorbs claim races (a release or takeover between our read and act).
    for (let attempt = 0; attempt < 3; attempt++) {
      const claim = this.registry.current()
      if (claim && claim.nonce !== me.nonce) {
        if (isAlive(claim.pid)) {
          throw new WriterLockHeld(this.registry.has(claim.nonce) ? 'in_use' : 'suspect_pid_reuse', claim)
        }
        // Dead holder: the CAS is the ownership decision; a lost CAS re-reads and refuses.
        if (this.registry.takeOver(claim.nonce, me)) return this.finish(me)
        continue
      }
      if (claim && claim.nonce === me.nonce) return this.finish(me)
      // No claim yet. The lockfile can neither grant nor prove ownership, so fail closed on
      // unknown content and on a live foreign holder; a dead breadcrumb is inert and the atomic
      // claim below decides between concurrent takers.
      const file = this.readLockFile()
      if (file.state === 'corrupt') throw new WriterLockHeld('unknown', null)
      if (file.state === 'valid' && file.content && isAlive(file.content.pid)) {
        throw new WriterLockHeld(this.registry.has(file.content.nonce) ? 'in_use' : 'suspect_pid_reuse', file.content)
      }
      if (this.registry.claim(me)) return this.finish(me)
      // Another instance claimed first; re-read and refuse or take over its dead claim.
    }
    const current = this.registry.current()
    throw new WriterLockHeld(current && !isAlive(current.pid) ? 'stale' : 'in_use', current ?? null)
  }

  /** Updates the instance heartbeat; a no-op unless this instance still holds the lock here. */
  heartbeat(): void {
    if (this.held) this.registry?.beat(this.held.nonce)
  }

  /** Releases the claim and breadcrumb only if they still belong to this instance. */
  release(): void {
    if (!this.held) return
    this.registry?.release(this.held.nonce)
    this.removeLockFileIfOwned(this.held.nonce)
    this.held = undefined
  }

  /** Lockfile-only mode: an empty/corrupt file proves nothing; a stale holder needs the registry. */
  private acquireLockfileOnly(me: LockContent): LockContent {
    const file = this.readLockFile()
    if (file.state === 'corrupt') throw new WriterLockHeld('unknown', null)
    if (file.state === 'valid' && file.content) {
      throw new WriterLockHeld(isAlive(file.content.pid) ? 'in_use' : 'stale', file.content)
    }
    try {
      this.createLockFile(me)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const now = this.readLockFile()
        throw new WriterLockHeld(now.state === 'corrupt' ? 'unknown' : 'in_use', now.content)
      }
      throw error
    }
    this.held = me
    return me
  }

  /** Completes a claim: audit row plus breadcrumb. Any failure releases the claim so ownership never leaks. */
  private finish(me: LockContent): LockContent {
    try {
      this.registry!.register(me)
      this.writeLockFile(me)
    } catch (error) {
      try { this.registry!.release(me.nonce) } catch { /* best effort cleanup */ }
      this.removeLockFileIfOwned(me.nonce)
      throw error
    }
    this.held = me
    return me
  }

  private readLockFile(): LockFile {
    let raw: string
    try {
      raw = readFileSync(this.lockPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', content: null }
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as Partial<LockContent>
      if (typeof parsed.pid === 'number' && typeof parsed.nonce === 'string' && typeof parsed.startedAt === 'string') {
        return { state: 'valid', content: { pid: parsed.pid, nonce: parsed.nonce, startedAt: parsed.startedAt } }
      }
    } catch { /* corrupt content is reported, never treated as stale */ }
    return { state: 'corrupt', content: null }
  }

  /** Creates the lockfile with its full content in one atomic step, so no empty in-flight window exists. */
  private createLockFile(content: LockContent): void {
    const temp = `${this.lockPath}.${content.nonce}.tmp`
    this.writeTemp(temp, content)
    try { linkSync(temp, this.lockPath) } finally { try { unlinkSync(temp) } catch { /* already removed */ } }
  }

  /** Replaces the breadcrumb atomically; only the claim winner calls this, so no concurrent replacer exists. */
  private writeLockFile(content: LockContent): void {
    const temp = `${this.lockPath}.${content.nonce}.tmp`
    this.writeTemp(temp, content)
    renameSync(temp, this.lockPath)
  }

  private writeTemp(temp: string, content: LockContent): void {
    const fd = openSync(temp, 'wx', 0o600)
    try {
      writeSync(fd, JSON.stringify(content))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  private removeLockFileIfOwned(nonce: string): void {
    const file = this.readLockFile()
    if (file.state === 'valid' && file.content?.nonce === nonce) {
      try { unlinkSync(this.lockPath) } catch { /* already gone */ }
    }
  }
}
