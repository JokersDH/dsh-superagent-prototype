import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReviewActivitySchema, ReviewTimingSchema } from '../src/index.ts'

test('waiting delay and partial review activity are distinct, and missing activity stays null', () => {
  const value = { candidateReadyAt: '2026-11-10T00:00:00.000Z', acceptedAt: '2026-11-10T00:00:20.000Z',
    readyToAcceptanceMs: 20000, activeReviewMs: null, activeReviewSource: 'unknown', activeReviewCompleteness: 'unknown', evidenceRefs: [] }
  assert.equal(ReviewTimingSchema.safeParse(value).success, true)
  for (const change of [{ readyToAcceptanceMs: 100 }, { activeReviewMs: 0 }, { activeReviewSource: 'ui_visibility_proxy' },
    { activeReviewMs: 21000, activeReviewSource: 'ui_visibility_proxy', activeReviewCompleteness: 'partial' }])
    assert.equal(ReviewTimingSchema.safeParse({ ...value, ...change }).success, false)
})
test('review activity is bounded and cannot carry business authority', () => {
  const activity = { protocol: 'review-activity/1', commandId: 'sample-one', sessionId: 'session-one',
    candidate: { ticketId: 'ticket-one', assignmentId: 'assignment-one', contract: { workId: 'work-one', revision: 1, digest: 'a'.repeat(64) }, candidateGeneration: 1 },
    startedAt: '2026-11-10T00:00:00.000Z', endedAt: '2026-11-10T00:00:05.000Z', source: 'ui_visibility_proxy' }
  assert.equal(ReviewActivitySchema.safeParse(activity).success, true)
  for (const change of [{ endedAt: activity.startedAt }, { endedAt: '2026-11-10T00:00:16.000Z' }, { actor: 'forged' }, { source: 'measured_human_time' }])
    assert.equal(ReviewActivitySchema.safeParse({ ...activity, ...change }).success, false)
})
