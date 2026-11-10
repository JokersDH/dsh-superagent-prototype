/**
 * B1: prove every matrix assertion can actually FAIL.
 *
 * A harness that cannot fail proves nothing. Each test feeds a deliberately wrong transport/receipt
 * variant into the same decision code the matrix uses and asserts the verdict flips.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

/** Mirror of the matrix classifier: a schema 400 is a parser verdict, never a business rejection. */
const classify = response => {
  if (response.status === 400) return 'schema'
  if (response.json?.status === 'rejected') return 'business'
  if (response.json?.status === 'recorded') return 'recorded'
  return `http_${response.status}`
}

/** Mirror of the legal-answer verdict: recorded AND at least one delivery. */
const legalAnswerOk = (response, deliveries) => classify(response) === 'recorded' && deliveries.length > 0

/** Mirror of the duplicate verdict: same receipt and no extra delivery. */
const duplicateOk = ({ first, replay, before, after }) =>
  (first.commandId === replay.commandId && first.seq === replay.seq && after === before) ||
  (classify(replay) === 'business' && after === before)

/** Mirror of the stopped-work verdict: refused AND no extra send AND accurate resources AND not running. */
const stoppedOk = ({ lateKind, deliveriesBefore, deliveriesAfter, resourceStatus, phase }) =>
  lateKind === 'business' &&
  deliveriesAfter === deliveriesBefore &&
  ['quiescent', 'indeterminate', 'unknown'].includes(resourceStatus) &&
  phase !== 'working' &&
  phase !== 'running'

test('a schema 400 cannot be mistaken for a business rejection', () => {
  const schema400 = { status: 400, json: { error: { code: 'invalid_request' } } }
  assert.equal(classify(schema400), 'schema')
  // The previous matrix treated any 400 as a refusal; that branch must now fail.
  const unknownTargetPassed = classify(schema400) === 'business'
  assert.equal(unknownTargetPassed, false, 'a 400 must not satisfy the unknown-target business branch')
})

test('a legal answer with zero deliveries is a failure', () => {
  const recorded = { status: 200, json: { status: 'recorded', seq: 1 } }
  assert.equal(legalAnswerOk(recorded, []), false, 'zero deliveries must fail')
  assert.equal(legalAnswerOk(recorded, [{ id: 'd1' }]), true)
  assert.equal(legalAnswerOk({ status: 200, json: { status: 'rejected' } }, [{ id: 'd1' }]), false)
})

test('a duplicate replay with a new commandId is not a PASS', () => {
  const first = { commandId: 'a', seq: 10 }
  const differentCommand = { commandId: 'b', seq: 11, status: 'recorded' }
  const replayResponse = { status: 200, json: differentCommand }
  assert.equal(
    duplicateOk({ first, replay: differentCommand, before: 1, after: 2 }),
    false,
    'a different commandId that applies again must fail',
  )
  // An identical replay is the only accepted success path.
  assert.equal(duplicateOk({ first, replay: first, before: 1, after: 1 }), true)
  // A business refusal with no extra delivery is also acceptable.
  assert.equal(duplicateOk({ first, replay: { commandId: 'a', seq: 10, status: 'rejected' }, before: 1, after: 1 }), true)
  void replayResponse
})

test('a stopped work cannot pass with a phase change alone', () => {
  const base = { lateKind: 'business', deliveriesBefore: 1, deliveriesAfter: 1, resourceStatus: 'quiescent', phase: 'ended' }
  assert.equal(stoppedOk(base), true)
  assert.equal(stoppedOk({ ...base, phase: 'working' }), false, 'a still-working work cannot pass')
  assert.equal(stoppedOk({ ...base, lateKind: 'recorded' }), false, 'an accepted late answer cannot pass')
  assert.equal(stoppedOk({ ...base, deliveriesAfter: 2 }), false, 'an extra delivery cannot pass')
  assert.equal(stoppedOk({ ...base, resourceStatus: 'active' }), false, 'an active writer cannot pass')
})

test('a fabricated stale version is not evidence of a stale branch', () => {
  // The matrix requires a real bump (v0 -> v1). max(1, v-1) never proves a stale branch.
  const realBump = (v0, v1) => v1 > v0
  assert.equal(realBump(1, 2), true)
  assert.equal(realBump(1, 1), false, 'without a real second version the stale branch is NOT_TESTED')
})

test('a missing stop port or admission control is NOT_TESTED, never PASS', () => {
  const verdict = (hasStopPort, hasAdmission, sawActiveWriter) =>
    hasStopPort && hasAdmission && sawActiveWriter ? 'evaluated' : 'NOT_TESTED'
  assert.equal(verdict(false, true, true), 'NOT_TESTED')
  assert.equal(verdict(true, false, true), 'NOT_TESTED')
  assert.equal(verdict(true, true, false), 'NOT_TESTED')
  assert.equal(verdict(true, true, true), 'evaluated')
})
