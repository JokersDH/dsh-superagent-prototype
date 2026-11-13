/**
 * Activity guard for destructive state operations (upgrade rollback, state moves).
 *
 * Before any rename of a state directory, the caller must prove no other process owns it. This
 * module checks three independent authorities:
 *
 * - the product writer claim in the database (`writer_claim` + `coordinator_instances` heartbeat);
 * - open file handles for the SQLite database/WAL/SHM files (OS resource ownership, including
 *   processes that never took the writer lock);
 * - the caller's own managed-instance record is checked by the launcher, not here.
 *
 * An unreadable database, a live writer, a writer claim whose process is gone, or any other process
 * holding the files is treated as ACTIVE/UNKNOWN and must refuse the destructive operation. A stop
 * request is not proof of physical stop; a missing breadcrumb is not proof a process disappeared.
 */
import { execFile } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { PortabilityError } from './errors.ts'
import type { WriterClaimFacts } from './manifest.ts'

const execute = promisify(execFile)

export interface StateHolder {
  readonly pid: number
  readonly command: string | null
}

export interface StateActivityCheck {
  readonly id: string
  readonly ok: boolean
  readonly detail?: unknown
}

export interface WriterActivity {
  readonly claim: WriterClaimFacts
  readonly pidAlive: boolean
}

export interface StateActivity {
  readonly stateDir: string
  readonly status: 'inactive' | 'active' | 'unknown'
  readonly checks: readonly StateActivityCheck[]
  readonly holders: readonly StateHolder[]
  readonly writer: WriterActivity | null
  readonly reasons: readonly string[]
}

export interface StateActivityOptions {
  /** The calling process is not treated as an external holder (it may hold a read snapshot). */
  readonly selfPid?: number
  readonly timeoutMs?: number
}

const DATABASE_FILES = ['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'state.sqlite-journal'] as const

async function processAlive(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
  try {
    const stat = (await execute('ps', ['-p', String(pid), '-o', 'stat='], { timeout: 2000, encoding: 'utf8' })).stdout.trim()
    return stat !== '' && !stat.toUpperCase().startsWith('Z')
  } catch {
    return false
  }
}

/** lsof reports every process holding the state database files (including non-writer handles). */
async function fileHolders(stateDir: string, timeoutMs: number): Promise<StateHolder[]> {
  const files = DATABASE_FILES.map((name) => join(stateDir, name)).filter((path) => existsSync(path))
  if (files.length === 0) return []
  try {
    const { stdout } = await execute('lsof', ['-F', 'pc', '--', ...files], { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 256 * 1024 })
    const holders = new Map<number, string | null>()
    let currentPid: number | null = null
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        const pid = Number(line.slice(1))
        if (Number.isSafeInteger(pid) && pid > 1) {
          currentPid = pid
          if (!holders.has(pid)) holders.set(pid, null)
        } else currentPid = null
      } else if (line.startsWith('c') && currentPid !== null) {
        holders.set(currentPid, line.slice(1).slice(0, 128))
      }
    }
    return [...holders].map(([pid, command]) => ({ pid, command }))
  } catch (error) {
    const code = (error as { code?: number | string }).code
    // lsof exits 1 with no output when nothing matches; a missing lsof is an unknown condition.
    if (code === 1) return []
    if (String(code) === 'ENOENT')
      throw new PortabilityError('writer_uncertain', 'Cannot prove state file ownership: lsof is unavailable', {
        stateDir,
      })
    throw new PortabilityError('writer_uncertain', 'Cannot inspect open state files', { stateDir, cause: String(code) })
  }
}

function readWriterClaim(databasePath: string): WriterClaimFacts | null {
  if (!existsSync(databasePath)) return null
  let db: Database.Database
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new PortabilityError('writer_uncertain', 'Cannot open the state database to read the writer claim', {
      cause: String((error as { message?: string }).message ?? error),
    })
  }
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name),
    )
    if (!tables.has('writer_claim')) return null
    const claim = db.prepare('SELECT nonce, pid, started_at FROM writer_claim WHERE id = 1').get() as
      | { nonce: string; pid: number; started_at: string }
      | undefined
    if (!claim) return null
    let heartbeatAt: string | null = null
    if (tables.has('coordinator_instances')) {
      const row = db.prepare('SELECT heartbeat_at FROM coordinator_instances WHERE nonce = ?').get(claim.nonce) as
        | { heartbeat_at: string }
        | undefined
      heartbeatAt = row?.heartbeat_at ?? null
    }
    return { pid: Number(claim.pid), startedAt: String(claim.started_at), heartbeatAt }
  } finally {
    db.close()
  }
}

/**
 * Inspect a state directory without modifying it. Never throws for an active state; callers decide
 * how to report. Throws only when the state cannot be inspected at all (`writer_uncertain`), because
 * an uninspectable state is also unsafe to move.
 */
export async function inspectStateActivity(stateDir: string, options: StateActivityOptions = {}): Promise<StateActivity> {
  const timeoutMs = options.timeoutMs ?? 3000
  const selfPid = options.selfPid ?? process.pid
  let stat
  try {
    stat = lstatSync(stateDir)
  } catch {
    throw new PortabilityError('invalid_root', 'State directory does not exist', { stateDir })
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new PortabilityError('unsafe_root', 'State directory must be a real directory', { stateDir })
  const checks: StateActivityCheck[] = []
  const reasons: string[] = []

  const claim = readWriterClaim(join(stateDir, 'state.sqlite'))
  let writer: WriterActivity | null = null
  if (claim !== null) {
    const alive = await processAlive(claim.pid)
    writer = { claim, pidAlive: alive }
    if (claim.pid === selfPid) reasons.push('writer_claim held by the calling process')
    else if (alive) reasons.push(`writer_claim held by live pid ${claim.pid}`)
    else reasons.push(`writer_claim exists but pid ${claim.pid} is not alive (unknown writer)`)
  }
  checks.push({
    id: 'writer_claim',
    ok: claim === null || writer?.pidAlive === false ? claim === null : false,
    detail: claim === null ? { present: false } : { ...claim, pidAlive: writer?.pidAlive ?? false },
  })

  const holders = await fileHolders(stateDir, timeoutMs)
  const external = holders.filter((holder) => holder.pid !== selfPid)
  checks.push({ id: 'file_holders', ok: external.length === 0, detail: { holders: holders.map((holder) => holder.pid) } })
  for (const holder of external) reasons.push(`pid ${holder.pid}${holder.command ? ` (${holder.command})` : ''} holds the state database`)

  const active = reasons.some((reason) => !reason.includes('unknown writer'))
  const unknown = reasons.some((reason) => reason.includes('unknown writer'))
  const status = active ? 'active' : unknown ? 'unknown' : 'inactive'
  return { stateDir, status, checks, holders, writer, reasons }
}

/** Throw unless the state is provably inactive. Active and unknown states are both refused. */
export async function assertStateInactive(stateDir: string, options: StateActivityOptions = {}): Promise<StateActivity> {
  const activity = await inspectStateActivity(stateDir, options)
  if (activity.status === 'active')
    throw new PortabilityError('state_in_use', 'State is in use; refusing a destructive operation', {
      stateDir,
      reasons: activity.reasons,
      holders: activity.holders,
      writer: activity.writer?.claim ?? null,
    })
  if (activity.status === 'unknown')
    throw new PortabilityError('writer_uncertain', 'A writer claim exists but its process is gone; reconcile before moving state', {
      stateDir,
      reasons: activity.reasons,
      writer: activity.writer?.claim ?? null,
    })
  return activity
}

export { DATABASE_FILES }
