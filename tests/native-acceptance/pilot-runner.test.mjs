/**
 * Negative cases for the pilot run boundary (wave-06 B2).
 *
 * The pilot is only meaningful if the arms are what they claim to be. The tests below pin the
 * ways that could silently break:
 *
 *   - a "fresh" reviewer that actually inherits or persists the author thread
 *   - a "continue" arm with no real author checkpoint to continue from
 *   - a billable run that reaches a send with no reservation hook, or with no named price source
 *   - a report that is malformed or bound to a different subject being read as PASS
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARMS, classifyReport, planRun, subjectDigestOf } from './pilot-runner.mjs'

const DIGEST = 'a'.repeat(64)
const bound = (priceSource = 'provider-price-table-2026-11-11', usageSource = 'thread-token-usage') => ({
  maxInputTokens: 60_000, maxOutputTokens: 8_000, maxReasoningTokens: 4_000, maxToolRounds: 4,
  basis: { priceSource, usageSource },
})
const hook = (admitted = true, reason) => ({
  reserve: () => (admitted ? { admitted: true, reservationId: 'r1' } : { admitted: false, reason: 'grant exhausted' }),
})
const base = (over = {}) => ({
  arm: 'fresh_session', caseId: 'case-1', turn: 1, materialDigest: DIGEST,
  subjectFrozen: true, bound: bound(), budgetHook: hook(), ...over,
})

test('a fresh reviewer is ephemeral and never inherits the author thread', () => {
  const plan = planRun(base())
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.session, { kind: 'fresh', ephemeral: true })
})

test('a fresh arm cannot be given the author thread and still pass', () => {
  // Even if a caller supplies a thread id, the fresh arm ignores it rather than resuming it.
  const plan = planRun(base({ authorThreadId: 'thread-author' }))
  assert.equal(plan.ok, true)
  assert.equal(plan.session.kind, 'fresh')
  assert.equal('sourceThreadId' in plan.session, false, 'a fresh run must not carry an author thread id')
})

test('a continue arm without a real author thread is refused', () => {
  const plan = planRun(base({ arm: 'author_continue', authorThreadId: undefined }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'author_thread_required')
})

test('a continue arm resumes the real author thread when no cut point is given', () => {
  const plan = planRun(base({ arm: 'author_continue', authorThreadId: 'thread-author' }))
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.session, { kind: 'resume_author', sourceThreadId: 'thread-author' })
})

test('a continue arm with a cut point forks at that turn instead of resuming', () => {
  const plan = planRun(base({ arm: 'author_continue', authorThreadId: 'thread-author', lastTurnId: 'turn-3' }))
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.session, { kind: 'fork_author', sourceThreadId: 'thread-author', lastTurnId: 'turn-3' })
})

test('an unknown arm is refused instead of defaulting to something cheap', () => {
  const plan = planRun(base({ arm: 'fresh' }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'unknown_arm')
})

test('a billable run with no reservation hook is refused, never sent', () => {
  const plan = planRun(base({ budgetHook: undefined }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'no_budget_hook')
})

test('a billable run whose hook refuses is refused with the hook reason intact', () => {
  const plan = planRun(base({ budgetHook: hook(false) }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'budget_refused')
  assert.match(plan.detail, /grant exhausted/)
})

test('a throwing hook refuses rather than falling through to a send', () => {
  const plan = planRun(base({ budgetHook: { reserve: () => { throw new Error('ledger offline') } } }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'budget_refused')
  assert.match(plan.detail, /ledger offline/)
})

test('pricing_unavailable blocks a billable run instead of estimating', () => {
  const plan = planRun(base({ bound: bound(null) }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'budget_refused')
  assert.match(plan.detail, /no named price source/)
})

test('a run must bind a real material digest, not a path or free text', () => {
  for (const bad of ['', '/tmp/case-1', 'not-a-digest', DIGEST.slice(0, 63)]) {
    const plan = planRun(base({ materialDigest: bad }))
    assert.equal(plan.ok, false, `materialDigest ${JSON.stringify(bad)} must be refused`)
    assert.equal(plan.reason, 'material_digest_missing')
  }
})

test('a run cannot proceed while its subject is not frozen', () => {
  const plan = planRun(base({ subjectFrozen: false }))
  assert.equal(plan.ok, false)
  assert.equal(plan.reason, 'subject_not_frozen')
})

test('the author arm is not billable to the review grant', () => {
  const plan = planRun(base({ arm: 'no_review', budgetHook: undefined }))
  assert.equal(plan.ok, true, 'the author arm is not the review grant and needs no review hook')
  assert.equal(plan.billable, false)
})

test('only the operation that can send a native turn is marked billable', () => {
  const plan = planRun(base())
  assert.equal(plan.ok, true)
  const billableOps = plan.operations.filter(op => op.billsNativeTurn).map(op => op.name)
  assert.deepEqual(billableOps, ['startRun'], 'inspect/reconcile/cancel/report must never bill')
})

test('a report bound to a different subject is rejected, not accepted', () => {
  const subject = subjectDigestOf(DIGEST, 'b'.repeat(64))
  const verdict = classifyReport(
    { protocol: 'review-report/1', subjectDigest: 'c'.repeat(64), disposition: 'no_findings', findings: [] },
    { subjectDigest: subject },
  )
  assert.equal(verdict.disposition, 'rejected')
  assert.match(verdict.reason, /different subject/)
})

test('malformed and non-object reports are inconclusive, never PASS', () => {
  const subject = subjectDigestOf(DIGEST, 'b'.repeat(64))
  for (const bad of [null, 'no_findings', 42, [], undefined]) {
    const verdict = classifyReport(bad, { subjectDigest: subject })
    assert.equal(verdict.disposition, 'inconclusive', `${JSON.stringify(bad)} must be inconclusive`)
  }
})

test('a report whose findings contradict its disposition is inconclusive', () => {
  const subject = subjectDigestOf(DIGEST, 'b'.repeat(64))
  const claimed = classifyReport(
    { protocol: 'review-report/1', subjectDigest: subject, disposition: 'findings', findings: [] },
    { subjectDigest: subject },
  )
  assert.equal(claimed.disposition, 'inconclusive')
  const clean = classifyReport(
    { protocol: 'review-report/1', subjectDigest: subject, disposition: 'no_findings', findings: [{ path: 'a.ts' }] },
    { subjectDigest: subject },
  )
  assert.equal(clean.disposition, 'inconclusive')
})

test('a well-formed report on the right subject is accepted', () => {
  const subject = subjectDigestOf(DIGEST, 'b'.repeat(64))
  const verdict = classifyReport(
    {
      protocol: 'review-report/1', subjectDigest: subject, disposition: 'findings',
      findings: [{ path: 'src/a.ts', severity: 'high', claim: 'off by one' }],
    },
    { subjectDigest: subject },
  )
  assert.equal(verdict.disposition, 'accepted', 'the accepting path must work or the guard proves nothing')
  assert.equal(verdict.findings, 1)
})

test('all three protocol arms are representable', () => {
  assert.deepEqual([...ARMS], ['no_review', 'author_continue', 'fresh_session'])
})
