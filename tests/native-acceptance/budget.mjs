/**
 * Model-task budget ledger with atomic pre-send reservation (wave-04 B2).
 *
 * A model task is counted per `begin` that reached a native attempt — never per HTTP request or per
 * case. Two invariants the wave-03 version lacked:
 *
 * 1. **Reserve before sending.** `reserve()` persists `grantId/taskId/commandId/instance/remaining`
 *    atomically (O_EXCL lock file) BEFORE any request is issued, so a crash, a concurrent CLI or a
 *    repeated run can never overspend.
 * 2. **Uncertain sends still cost capacity.** A reservation is marked `sent` (accepted), `unknown`
 *    (the outcome was never observed) or `aborted` (provably not sent); `unknown` consumes the grant.
 *
 * The ledger stores identities and counts only: no tokens, no native session text.
 */
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

export const BUDGET_LEDGER = new URL('./reports/model-budget.json', import.meta.url)

const fileOf = path => (path instanceof URL ? path.pathname : path)

function emptyLedger() {
  return { grants: [], note: 'one grant per explicitly dispatched package; never reset by date, retry or phase change' }
}

export function loadLedger(path = BUDGET_LEDGER) {
  const file = fileOf(path)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : emptyLedger()
}

function saveLedger(ledger, path) {
  const file = fileOf(path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`)
}

/** Serialize ledger mutations across processes with a short-lived exclusive lock. */
function withLock(path, work) {
  const file = fileOf(path)
  const lock = `${file}.lock`
  mkdirSync(dirname(file), { recursive: true })
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      closeSync(fd)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      // A stale lock (crashed holder) is reclaimed after a bounded age.
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 10_000) {
        try {
          unlinkSync(lock)
        } catch {}
        continue
      }
      if (Date.now() > deadline) throw new Error(`budget lock is held: ${lock}`)
    }
  }
  try {
    return work()
  } finally {
    try {
      unlinkSync(lock)
    } catch {}
  }
}

/** Capacity an `unknown` reservation still consumes, plus every recorded task. */
/**
 * A reservation consumes capacity from the moment it is durable: `reserved` (in flight or crashed
 * before settling), `sent` and `unknown` all count. Only a provable `aborted` frees a slot.
 */
const consumed = grant => grant.reservations.filter(item => item.state !== 'aborted').length

export function grantView(grantId, limit, path = BUDGET_LEDGER) {
  const grant = loadLedger(path).grants.find(item => item.grantId === grantId)
  const effectiveLimit = Math.min(grant?.limit ?? limit, limit)
  const used = grant ? consumed(grant) : 0
  return { limit: effectiveLimit, used, remaining: effectiveLimit - used, tasks: grant?.reservations ?? [] }
}

/**
 * Reserve capacity BEFORE a model is started.
 *
 * Throws when the grant is exhausted. The reservation is durable, so a later crash cannot free it.
 */
export function reserve({ grantId, limit, taskId, commandId, instance }, path = BUDGET_LEDGER) {
  return withLock(path, () => {
    const ledger = loadLedger(path)
    let grant = ledger.grants.find(item => item.grantId === grantId)
    if (!grant) {
      grant = { grantId, limit, reservations: [], createdAt: new Date().toISOString() }
      ledger.grants.push(grant)
    }
    // A re-run must never raise the allowance the grant was created with: refuse the request
    // outright instead of silently narrowing it and continuing.
    if (grant.limit !== undefined && limit > grant.limit) {
      throw new Error(`Grant ${grantId} was created with limit ${grant.limit}; refusing a larger limit of ${limit}`)
    }
    grant.limit = Math.min(grant.limit ?? limit, limit)
    if (grant.reservations.some(item => item.taskId === taskId)) {
      return grant.reservations.find(item => item.taskId === taskId)
    }
    const used = consumed(grant)
    if (used >= grant.limit) {
      throw new Error(`Model-task budget exhausted for ${grantId}: ${used}/${grant.limit}`)
    }
    const reservation = {
      taskId,
      commandId,
      instance,
      state: 'reserved',
      remainingAtReserve: grant.limit - used - 1,
      reservedAt: new Date().toISOString(),
    }
    grant.reservations.push(reservation)
    saveLedger(ledger, path)
    return reservation
  })
}

/** Mark a reservation's outcome; `unknown` keeps consuming capacity. */
export function settle({ grantId, taskId, state, detail }, path = BUDGET_LEDGER) {
  if (!['sent', 'unknown', 'aborted'].includes(state)) throw new Error(`Invalid reservation state: ${state}`)
  return withLock(path, () => {
    const ledger = loadLedger(path)
    const grant = ledger.grants.find(item => item.grantId === grantId)
    const reservation = grant?.reservations.find(item => item.taskId === taskId)
    if (!reservation) throw new Error(`No reservation ${taskId} in ${grantId}`)
    // A settled reservation is immutable: a later guess must not rewrite history.
    if (reservation.state !== 'reserved') return reservation
    reservation.state = state
    reservation.settledAt = new Date().toISOString()
    if (detail !== undefined) reservation.detail = detail
    saveLedger(ledger, path)
    return reservation
  })
}

/** Total spent across every grant, including uncertain sends. */
export function totalSpent(path = BUDGET_LEDGER) {
  return loadLedger(path).grants.reduce((sum, grant) => sum + consumed(grant), 0)
}

/** Existing helpers kept for the earlier callers. */
export function recordTask({ grantId, limit, entry }, path = BUDGET_LEDGER) {
  const taskId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  reserve({ grantId, limit, taskId, commandId: entry.workId ?? 'unknown', instance: 'legacy' }, path)
  return settle({ grantId, taskId, state: entry.certain === false ? 'unknown' : 'sent' }, path)
}

export function remaining(grantId, limit, path = BUDGET_LEDGER) {
  return grantView(grantId, limit, path).remaining
}
