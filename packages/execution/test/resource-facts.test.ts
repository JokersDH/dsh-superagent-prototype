import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INVALID_INFERENCES,
  RESOURCE_VERDICTS,
  classifyResource,
  describeResourceFacts,
  resourceFactsDigest,
} from '../src/resource-facts.ts'

/** A fully well-formed observation: everything a caller could supply correctly. */
function goodObservation(overrides = {}) {
  return {
    runnerIdentityRef: 'runner-1',
    attempt: { attemptId: 'attempt-1', fenceEpoch: 3 },
    source: 'source-1',
    state: 'serving',
    admission: 'closed',
    coverage: 'complete_owned_resources',
    observedAt: '2026-11-11T08:00:00.000Z',
    machineId: 'machine-a',
    observedMachineId: 'machine-a',
    resources: [
      { ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: ['process exited with code 0'] },
    ],
    ...overrides,
  }
}

test('only complete, current, on-machine quiescence verifies a writer stopped', () => {
  const facts = describeResourceFacts([goodObservation()])
  assert.equal(facts.verdict, 'all_verified_quiescent')
  assert.equal(facts.releaseBarrierSatisfied, true)
  assert.equal(facts.resources[0].verdict, 'verified_quiescent')
  assert.deepEqual(facts.resources[0].reasons, [])
})

test('an old attempt reported ended does not verify a stop', () => {
  // The endpoint answered about a past attempt; that says nothing about the writer process now.
  const facts = describeResourceFacts([
    goodObservation({ state: 'terminated', resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: ['attempt ended'] }] }),
  ])
  assert.equal(facts.verdict, 'unknown')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.match(facts.resources[0].reasons.join(' '), /terminated/)
})

test('a missing pid does not verify a stop', () => {
  const observation = goodObservation({
    resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'indeterminate', evidence: ['pid not found'] }],
  })
  const facts = describeResourceFacts([observation])
  assert.equal(facts.verdict, 'unknown')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.match(facts.resources[0].reasons.join(' '), /indeterminate, which is not a stop/)
})

test('a signature from another machine does not verify a stop here', () => {
  const facts = describeResourceFacts([goodObservation({ observedMachineId: 'machine-b' })])
  assert.equal(facts.verdict, 'unknown')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.ok(facts.resources[0].reasons.includes(INVALID_INFERENCES.other_machine))
  assert.ok(facts.invalidInferencesDetected.includes('other_machine'))
})

test('an observation with no machine binding cannot be attributed to this host', () => {
  const facts = describeResourceFacts([goodObservation({ observedMachineId: null })])
  assert.equal(facts.verdict, 'unknown')
  assert.match(facts.resources[0].reasons.join(' '), /not bound to a machine identity/)
})

test('wrong scope is not a release', () => {
  // Coverage only describes what this endpoint owns. A resource outside that scope stays unknown.
  const facts = describeResourceFacts([
    goodObservation({ coverage: 'partial' }),
  ])
  assert.equal(facts.verdict, 'unknown')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.match(facts.resources[0].reasons.join(' '), /partial coverage/)
})

test('lost contact neither verifies nor fabricates a writer', () => {
  const facts = describeResourceFacts([goodObservation({ state: 'unknown', coverage: 'unknown' })])
  assert.equal(facts.verdict, 'unknown')
  assert.equal(facts.releaseBarrierSatisfied, false)
  // With unknown coverage there is nothing to enumerate, so the honest answer is no observation.
  assert.equal(facts.verdict !== 'all_verified_quiescent', true)
})

test('an active writer blocks the barrier even when everything else is clean', () => {
  const facts = describeResourceFacts([
    goodObservation({
      resources: [
        { ref: 'proc-1', ownership: 'spawned_process', writer: 'active', evidence: ['still running'] },
        { ref: 'proc-2', ownership: 'spawned_process', writer: 'quiescent', evidence: ['exited'] },
      ],
    }),
  ])
  assert.equal(facts.verdict, 'possibly_active')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.equal(facts.counts.possiblyActive, 1)
})

test('open business admission keeps a quiescent writer unresolved', () => {
  const facts = describeResourceFacts([goodObservation({ admission: 'open' })])
  assert.equal(facts.verdict, 'unknown')
  assert.match(facts.resources[0].reasons.join(' '), /admission is still open/)
})

test('stale proof does not describe the current writer', () => {
  const facts = describeResourceFacts([
    goodObservation({ proofRecordedAt: '2026-11-11T07:00:00.000Z', observedAt: '2026-11-11T08:00:00.000Z' }),
  ])
  assert.equal(facts.verdict, 'unknown')
  assert.ok(facts.resources[0].reasons.includes(INVALID_INFERENCES.stale_proof))
})

test('a quiescent report without evidence cannot be audited', () => {
  const facts = describeResourceFacts([
    goodObservation({ resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: [] }] }),
  ])
  assert.equal(facts.verdict, 'unknown')
  assert.match(facts.resources[0].reasons.join(' '), /no evidence/)
})

test('one unknown writer keeps the whole set unresolved', () => {
  // Starting new execution while a single writer is unresolved is the exact hazard this guards.
  const facts = describeResourceFacts([
    goodObservation(),
    goodObservation({ runnerIdentityRef: 'runner-2', resources: [{ ref: 'proc-9', ownership: 'spawned_process', writer: 'indeterminate', evidence: [] }] }),
  ])
  assert.notEqual(facts.verdict, 'all_verified_quiescent')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.equal(facts.counts.unknown, 1)
})

test('no observations never satisfies the barrier', () => {
  const facts = describeResourceFacts([])
  assert.equal(facts.verdict, 'no_resources_observed')
  assert.equal(facts.releaseBarrierSatisfied, false)
})

test('a new execution state is not treated as a release', () => {
  const facts = describeResourceFacts([goodObservation({ coverage: 'partial', state: 'serving' })])
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.match(facts.notClaimed.join(' '), /new execution state released/)
})

test('every verdict is a declared value and every resource explains itself', () => {
  const facts = describeResourceFacts([
    goodObservation(),
    goodObservation({ observedMachineId: 'machine-b' }),
  ])
  for (const resource of facts.resources) {
    assert.ok(RESOURCE_VERDICTS.includes(resource.verdict), `unexpected verdict ${resource.verdict}`)
    if (resource.verdict !== 'verified_quiescent') {
      assert.ok(resource.reasons.length > 0, `${resource.ref} has no reason for ${resource.verdict}`)
    }
  }
})

test('the digest changes when the resource picture changes', () => {
  const clean = describeResourceFacts([goodObservation()])
  const active = describeResourceFacts([
    goodObservation({ resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'active', evidence: ['running'] }] }),
  ])
  assert.notEqual(resourceFactsDigest(clean), resourceFactsDigest(active))
  assert.equal(resourceFactsDigest(clean), resourceFactsDigest(describeResourceFacts([goodObservation()])))
})

test('classifyResource is usable on its own and agrees with the aggregate', () => {
  const observation = goodObservation()
  const single = classifyResource(observation.resources[0], observation)
  const aggregate = describeResourceFacts([observation])
  assert.equal(single.verdict, aggregate.resources[0].verdict)
})

test('a resource without identity concludes nothing', () => {
  const result = classifyResource({}, goodObservation())
  assert.equal(result.verdict, 'unknown')
  assert.match(result.reasons.join(' '), /no identity/)
})
