import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reviewTiming, ProductReviewTiming } from '../../apps/coordinator/product/review-timing.ts'
import { fixture, actor, createCommand } from '../../packages/application/test/helpers.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const candidate = { ticketId: 'ticket-one', assignmentId: 'assignment-one', contract: { workId: 'work-one', revision: 1, digest: 'a'.repeat(64) }, candidateGeneration: 1 }
const span = (from, to, id = 'sample-one') => ({ protocol: 'review-activity/1', commandId: id, sessionId: 'session-one', candidate,
  startedAt: `2026-11-10T00:00:${from}.000Z`, endedAt: `2026-11-10T00:00:${to}.000Z`, source: 'ui_visibility_proxy' })
test('waiting includes offline time but overlapping tabs only count the union of observed review intervals', () => {
  const result = reviewTiming('2026-11-10T00:00:05.000Z', '2026-11-10T00:00:25.000Z',
    [span('01', '10'), span('08', '15', 'sample-two'), span('20', '29', 'sample-three')], [])
  assert.equal(result.readyToAcceptanceMs, 20000)
  assert.equal(result.activeReviewMs, 15000)
  assert.equal(result.activeReviewCompleteness, 'partial')
})
test('unobserved activity and clock regression are unknown rather than fabricated zeros', () => {
  const unknown = reviewTiming('2026-11-10T00:00:05.000Z', '2026-11-10T00:00:25.000Z', [], [])
  assert.equal(unknown.activeReviewMs, null)
  const regressed = reviewTiming('2026-11-10T00:00:25.000Z', '2026-11-10T00:00:05.000Z', [span('01', '10')], [])
  assert.equal(regressed.readyToAcceptanceMs, null)
  assert.equal(regressed.activeReviewMs, null)
})
test('activity requires a current candidate, a local UI actor, and idempotent scoped receipts', async t => {
  const h = fixture(t), created = await h.app.dispatch(createCommand('activity-work'), actor)
  const work = (await h.app.inspect({ workId: created.workId })).works[0]
  const subject = { ...work.actions.currentAssignment, candidateGeneration: 1 }
  h.app.core.completionCandidate = () => subject
  const metadata = { readyAt: '2026-11-10T00:00:00.000Z', eventCursor: h.store.events.cursor(), verificationId: 'verification-one' }
  const completion = { current: () => ({}), metadata: () => metadata }
  const timing = new ProductReviewTiming(h.store, h.app, completion, actor, () => ['project-atlas'], () => '2026-11-10T00:00:10.000Z')
  const input = { ...span('01', '06'), candidate: subject }
  const first = timing.record(input, actor)
  assert.equal(first.status, 'recorded')
  assert.deepEqual(timing.record(input, actor), first)
  assert.equal(h.store.events.after(metadata.eventCursor, 100).filter(event => event.topic === 'application.review.activity').length, 1)
  assert.throws(() => timing.record({ ...input, endedAt: '2026-11-10T00:00:07.000Z' }, actor), error => error.error.code === 'conflict')
  assert.throws(() => timing.record({ ...input, commandId: 'another-sample' }, { ...actor, source: 'local_cli' }), error => error.error.code === 'forbidden')
  assert.throws(() => timing.record({ ...input, commandId: 'future-sample', startedAt: '2026-11-10T00:00:20.000Z', endedAt: '2026-11-10T00:00:21.000Z' }, actor), error => error.error.code === 'invalid_request')
  h.app.core.completionCandidate = () => ({ ...subject, candidateGeneration: 2 })
  assert.throws(() => timing.record({ ...input, commandId: 'stale-sample' }, actor), error => error.error.code === 'stale_candidate')
  h.app.core.completionCandidate = () => subject
  const http = createLocalHttpApp({ application: h.app, principal: actor, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', localDevelopmentAccess: true,
    operations: { retryVerification: h.app.retryVerification.bind(h.app), reviewActivity: async (value, trusted) => timing.record(value, trusted) } })
  const response = await http.request(`http://127.0.0.1/v1/works/${subject.contract.workId}/review-activity`, { method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, body: JSON.stringify({ ...input, commandId: 'http-sample' }) })
  assert.equal(response.status, 200)
  const wrongPath = await http.request('http://127.0.0.1/v1/works/wrong-work/review-activity', { method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, body: JSON.stringify({ ...input, commandId: 'wrong-path' }) })
  assert.equal(wrongPath.status, 400)
  const forged = await http.request(`http://127.0.0.1/v1/works/${subject.contract.workId}/review-activity`, { method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, body: JSON.stringify({ ...input, commandId: 'forged-sample', actor }) })
  assert.equal(forged.status, 400)
  timing.accepted(subject, actor, '2026-11-10T00:00:10.000Z')
  const accepted = h.store.events.after(metadata.eventCursor, 100).find(event => event.topic === 'application.candidate.accepted')
  assert.equal(accepted.payload.reviewTiming.readyToAcceptanceMs, 10000)
  assert.equal(accepted.payload.reviewTiming.activeReviewMs, 5000)
})
