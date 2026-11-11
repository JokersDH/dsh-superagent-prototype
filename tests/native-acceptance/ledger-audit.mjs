/**
 * B1 ledger audit (wave-06): reconcile the original native grant against real evidence.
 *
 * The task packet requires: "核对原grant所有reserved/used/unknown与对应begin/attempt来源；
 * 不一致先阻断真实发送" and "不能从旧摘要推定余额".
 *
 * Why this exists: `grantView('wave03-b-native', 4)` happily answers `used: 0, remaining: 4`
 * when NO ledger file exists at all, because `loadLedger` falls back to an empty ledger. That
 * silently converts "we have no record" into "nothing was ever spent" - the exact inference the
 * packet forbids. This module separates those two facts:
 *
 *   ledgerPresent   - does a persisted reservation ledger exist on disk?
 *   ledgerGrants    - what it actually records (empty when absent)
 *   declaredGrants  - what committed status docs CLAIM happened
 *   beginSources    - whether any begin/attempt source was captured alongside the claim
 *
 * A grant may only be treated as "has verified remainder" when the ledger exists, its grant row
 * is present, every task carries a state, and the totals agree with itself. Anything else is
 * UNVERIFIED and blocks a real send rather than granting capacity.
 */
import { existsSync, readFileSync } from 'node:fs'

/** Consumed states: everything that is not provably-not-sent. Mirrors budget.mjs. */
const CONSUMING = new Set(['reserved', 'sent', 'unknown'])

function readLedger(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // A corrupt ledger is not an empty ledger.
    return { corrupt: true }
  }
}

/**
 * Audit one grant.
 *
 * @param ledgerPath absolute path to the persisted reservation ledger
 * @param grantId    the grant to reconcile
 * @param limit      the grant's ceiling as dispatched
 * @param declared   what status docs claim, with the document that says it
 */
export function auditGrant(ledgerPath, grantId, limit, declared) {
  const ledger = readLedger(ledgerPath)
  const ledgerPresent = ledger !== undefined && ledger.corrupt !== true
  const grants = ledgerPresent && Array.isArray(ledger?.grants) ? ledger.grants : []
  const grant = grants.find(item => item.grantId === grantId)

  const recorded = { reserved: 0, sent: 0, unknown: 0, aborted: 0, consumed: 0 }
  const beginSources = []
  const tasks = Array.isArray(grant?.tasks) ? grant.tasks : []
  for (const task of tasks) {
    // Keep a missing state distinct from any real state so it can be reported below.
    const state = typeof task.state === 'string' ? task.state : 'unspecified'
    if (state in recorded) recorded[state] += 1
    if (CONSUMING.has(state)) recorded.consumed += 1
    const commandId = typeof task.commandId === 'string' ? task.commandId : null
    // A begin/attempt source means the row carries the identity a native attempt would be keyed by.
    const hasBeginOrAttempt = Boolean(commandId) || typeof task.beginSeq === 'number' || typeof task.attemptId === 'string'
    beginSources.push({ taskId: String(task.taskId ?? '(none)'), commandId, state, hasBeginOrAttempt })
  }

  const reasons = []
  let verdict = 'VERIFIED'

  if (!existsSync(ledgerPath)) {
    verdict = 'UNVERIFIED'
    reasons.push(
      `no reservation ledger at ${ledgerPath}: the grant has no persisted history, so its remainder cannot be computed`,
    )
  } else if (ledger?.corrupt) {
    verdict = 'UNVERIFIED'
    reasons.push('the reservation ledger exists but is not valid JSON; a corrupt ledger is not an empty one')
  } else if (!grant) {
    verdict = 'UNVERIFIED'
    reasons.push(`the ledger exists but has no row for ${grantId}; a missing row is not proof of zero usage`)
  } else if (tasks.some(task => typeof task.state !== 'string' || task.state === 'unspecified')) {
    verdict = 'UNVERIFIED'
    reasons.push('at least one task row has no consumption state; reserved/used/unknown cannot be separated')
  }

  if (verdict === 'VERIFIED') {
    // Cross-check the self-reported number against the rows we actually counted.
    if (declared.used !== null && declared.used !== recorded.consumed) {
      verdict = 'MISMATCH'
      reasons.push(
        `${declared.source} declares used=${declared.used} but the ledger records ${recorded.consumed} consumed task(s)`,
      )
    }
    const limitRow = typeof grant?.limit === 'number' ? grant.limit : null
    if (limitRow !== null && limitRow !== limit) {
      verdict = 'MISMATCH'
      reasons.push(`ledger limit ${limitRow} disagrees with the dispatched limit ${limit}`)
    }
    if (recorded.consumed > limit) {
      verdict = 'MISMATCH'
      reasons.push(`consumed ${recorded.consumed} exceeds limit ${limit}`)
    }
    // A consumed task with no begin/attempt identity cannot be tied to a native attempt.
    const unidentified = beginSources.filter(item => CONSUMING.has(item.state) && !item.hasBeginOrAttempt)
    if (unidentified.length > 0) {
      verdict = 'UNVERIFIED'
      reasons.push(`${unidentified.length} consumed task(s) carry no begin/attempt identity to reconcile against`)
    }
  }

  return {
    grantId,
    limit,
    ledgerPresent,
    ledgerGrantFound: Boolean(grant),
    recorded,
    declared,
    beginSources,
    verdict,
    reasons,
  }
}

/**
 * May a real (possibly billed) send proceed on this grant?
 *
 * Fail-closed: only a VERIFIED grant with remaining capacity allows a send. This is deliberately
 * narrower than "remaining > 0", because an unverified remaining is not capacity - it is a rumor.
 */
export function maySendReal(audit) {
  if (audit.verdict !== 'VERIFIED') {
    return { allowed: false, reason: `grant ${audit.grantId} is ${audit.verdict}: ${audit.reasons.join('; ')}` }
  }
  const left = audit.limit - audit.recorded.consumed
  if (left <= 0) return { allowed: false, reason: `grant ${audit.grantId} has no remainder (${audit.recorded.consumed}/${audit.limit})` }
  return { allowed: true, reason: `${left} of ${audit.limit} reserved slots remain and the ledger reconciles` }
}
