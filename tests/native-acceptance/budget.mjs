/**
 * Model-task budget ledger (product-wave-03 B1).
 *
 * A model task is counted per `begin` that actually reached a native attempt — never per HTTP request,
 * never per case. The ledger persists across runs so a restart, a date change or a retry cannot
 * silently refresh the allowance. An uncertain send is recorded as such and still counts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const BUDGET_LEDGER = new URL('./reports/model-budget.json', import.meta.url)

export function loadLedger(path = BUDGET_LEDGER) {
  const file = path instanceof URL ? path.pathname : path
  if (!existsSync(file)) {
    return { grants: [], note: 'one grant per explicitly dispatched package; never reset by date, retry or phase change' }
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Record one model task.
 *
 * @param grantId the package grant this task belongs to
 * @param limit   the allowance that grant carries
 * @param entry   { workId, attemptId, beganAt, certain } — `certain:false` means the send outcome is
 *                unknown; it is recorded and still consumes capacity.
 */
export function recordTask({ grantId, limit, entry }, path = BUDGET_LEDGER) {
  const file = path instanceof URL ? path.pathname : path
  const ledger = loadLedger(path)
  let grant = ledger.grants.find(item => item.grantId === grantId)
  if (!grant) {
    grant = { grantId, limit, tasks: [], createdAt: new Date().toISOString() }
    ledger.grants.push(grant)
  }
  // Keep the allowance the grant was created with; a re-run must not raise it.
  grant.limit = Math.min(grant.limit ?? limit, limit)
  if (grant.tasks.length >= grant.limit) {
    throw new Error(`Model-task budget exhausted for ${grantId}: ${grant.tasks.length}/${grant.limit}`)
  }
  grant.tasks.push({ ...entry, ordinal: grant.tasks.length + 1 })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`)
  return grant
}

/** Remaining capacity for a grant; `null` when the grant has no recorded allowance yet. */
export function remaining(grantId, limit, path = BUDGET_LEDGER) {
  const grant = loadLedger(path).grants.find(item => item.grantId === grantId)
  const effective = grant?.limit ?? limit
  return effective - (grant?.tasks.length ?? 0)
}

/** Count every task already spent across all grants (historical ledger is preserved). */
export function totalSpent(path = BUDGET_LEDGER) {
  return loadLedger(path).grants.reduce((sum, grant) => sum + grant.tasks.length, 0)
}
