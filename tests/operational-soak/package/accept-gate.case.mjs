import test from 'node:test'
import assert from 'node:assert/strict'
import { waitForAcceptableCandidate } from '../../../tools/trial-kit/lib/accept-gate.mjs'

const work = (available, phase = 'needs_user', candidate = true) => ({
  works: [{ work: { id: 'work-1' }, phase, actions: { available, ...(candidate ? { currentCandidate: { ticketId: 't', assignmentId: 'a', contract: { workId: 'work-1', revision: 1, digest: 'd' }, candidateGeneration: 1 } } : {}) } }],
  questions: [],
})

test('accept gate waits through candidate-with-empty-available until the action appears', async () => {
  const sequence = [work([]), work(['stop_work']), work(['accept_candidate'])]
  let index = 0
  const result = await waitForAcceptableCandidate({ workId: 'work-1', readSnapshot: async () => sequence[Math.min(index++, sequence.length - 1)], timeoutMs: 5000, pollMs: 1 })
  assert.equal(result.status, 'ready')
  assert.equal(result.candidateSeen, true)
  assert.equal(result.gateObserved, true)
  assert.deepEqual(result.observations.map((entry) => entry.available), [[], ['stop_work'], ['accept_candidate']])
})

test('accept gate continues through verifying and does not accept by currentCandidate alone', async () => {
  const sequence = [work([], 'verifying'), work(['pause_dispatch'], 'verifying'), work(['accept_candidate'], 'needs_user')]
  let index = 0
  const result = await waitForAcceptableCandidate({ workId: 'work-1', readSnapshot: async () => sequence[Math.min(index++, sequence.length - 1)], timeoutMs: 5000, pollMs: 1 })
  assert.equal(result.status, 'ready')
  assert.equal(result.observations.some((entry) => entry.stage === 'observed' && entry.phase === 'verifying'), true)
})

test('accept gate returns not_ready on timeout with no accept action and no synthetic candidate', async () => {
  let calls = 0
  const result = await waitForAcceptableCandidate({ workId: 'work-1', readSnapshot: async () => { calls += 1; return work([]) }, timeoutMs: 5, pollMs: 1 })
  assert.equal(result.status, 'not_ready')
  assert.equal(result.gateObserved, false)
  assert.ok(calls >= 1)
  assert.equal(result.reason, 'timeout_before_accept_action')
})

test('accept gate blocks failed work and refuses a foreign candidate', async () => {
  const failed = await waitForAcceptableCandidate({ workId: 'work-1', readSnapshot: async () => work(['accept_candidate'], 'failed'), timeoutMs: 100, pollMs: 1 })
  assert.equal(failed.status, 'blocked')
  const foreign = await waitForAcceptableCandidate({ workId: 'work-1', readSnapshot: async () => ({ works: [{ work: { id: 'work-1' }, phase: 'needs_user', actions: { available: ['accept_candidate'], currentCandidate: { contract: { workId: 'foreign' } } } }] }), timeoutMs: 100, pollMs: 1 })
  assert.equal(foreign.status, 'refused')
  assert.equal(foreign.reason, 'candidate_foreign_work')
})
