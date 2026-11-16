/**
 * W34 acceptance: the observation facts a support reader has to be able to explain.
 *
 * The first block drives main's real `ProductUsageObservation` with awkward records (replays,
 * conflicts, out-of-window facts, bounded sources, empty data) and checks the served DTO. The second
 * block checks the waiting/review facts: a recorded zero is a zero, a missing interval is unknown, a
 * visibility proxy is not human effort, and no baseline means no benefit number.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { analyzeUsageInsights } from '../src/analyze.ts'
import { METRIC_DEFINITIONS } from '../src/protocol.ts'
import type { UsageInsightsInput } from '../src/protocol.ts'
import { completeBundle, makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'
const evidence = (workId: string, outcomes: unknown[] = []): WorkEvidence => ({
  protocol: 'work-evidence/1', workId, projection: 'recorded',
  entries: [{ at: '2026-11-15T05:00:00.000Z', kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'], truncated: false,
})

const read = (options: { works?: { id: string; projectId: string }[]; evidenceFor?: (workId: string) => WorkEvidence; hasMore?: boolean } = {}) =>
  new ProductUsageObservation({
    projectIds: () => ['one', 'two'],
    cursor: () => 1,
    listWorks: (ids, limit) => ({
      works: (options.works ?? [{ id: 'work-a', projectId: 'one' }]).filter(work => ids.includes(work.projectId)).slice(0, limit),
      hasMore: options.hasMore ?? false,
    }),
    workEvidence: async workId => options.evidenceFor?.(workId) ?? evidence(workId),
  }, () => AT).read({ days: 7, timezone: 'UTC' })

const row = (dto: UsageObservation, metricId: string) => dto.metrics.find(metric => metric.id.startsWith(`${metricId}@`))

test('a replayed receipt is counted once and a contradictory one is quarantined, through the real reader', { skip }, async () => {
  const once = makeOutcome({ seed: 'obs-dup', acceptance: 'accepted', projectId: 'one', durationMs: 3_000,
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) }, observedAt: '2026-11-15T05:30:00.000Z' })
  const replayed = await read({ evidenceFor: workId => evidence(workId, [once, once]) })
  assert.equal(row(replayed, 'outcomes.count')?.value, '1', 'the same receipt observed twice is one outcome')
  assert.equal(row(replayed, 'outcomes.accepted')?.value, '1')

  const conflicting = await read({ evidenceFor: workId => evidence(workId, [once, { ...once, durationMs: 9_999 }]) })
  // A conflicted identity cannot be counted, so no count row exists at all; an unavailable summary is
  // the honest answer, not a zero.
  assert.equal(conflicting.status, 'unavailable')
  assert.ok(conflicting.limitations.length > 0)
})

test('facts outside the window are excluded and never turned into a fabricated zero row', { skip }, async () => {
  const older = makeOutcome({ seed: 'obs-old', acceptance: 'accepted', projectId: 'one',
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) }, observedAt: '2026-10-01T05:30:00.000Z' })
  const dto = await read({ evidenceFor: workId => evidence(workId, [older]) })
  // The reader narrows the evidence to the window before analysis, so there is no outcome layer at
  // all: the served document carries no outcome row (and no invented "0" row either).
  assert.equal(row(dto, 'outcomes.count'), undefined)
  assert.equal(dto.status, 'ready')
  assert.equal(dto.sampleCount, 1, 'the work itself was still enumerated')
  assert.equal(dto.coverageState, 'complete')
  // The question entry of that same work is inside the window, so the interaction fact is counted
  // (1) while the out-of-window outcome contributes no row at all: the two sources are filtered
  // independently and neither is padded with a zero.
  assert.equal(row(dto, 'interventions.questions')?.value, '1')
})

test('an empty but complete scope is a measured zero with no invented values', { skip }, async () => {
  const dto = await read({ works: [], hasMore: false })
  assert.equal(dto.sampleCount, 0, 'the header counts the enumerated works')
  assert.equal(dto.coverageState, 'complete')
  assert.equal(row(dto, 'usage.inputTokens'), undefined, 'no usage row is invented without records')
})

test('a bounded source is partial with no header sample count', { skip }, async () => {
  const dto = await read({ hasMore: true })
  assert.equal(dto.sampleCount, null, 'a bounded header count would claim a total it does not have')
  assert.equal(dto.coverageState, 'partial')
})

test('header works and row samples are different bases', { skip }, async () => {
  const outcome = makeOutcome({ seed: 'obs-basis', acceptance: 'unknown', projectId: 'one', durationMs: 4_000,
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) }, observedAt: '2026-11-15T05:30:00.000Z' })
  const dto = await read({
    works: [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'one' }],
    evidenceFor: workId => evidence(workId, workId === 'work-a' ? [outcome] : []),
  })
  assert.equal(dto.sampleCount, 2, 'header = enumerated works')
  assert.equal(row(dto, 'outcomes.count')?.sampleCount, 1, 'row = records carrying that metric')
  assert.equal(row(dto, 'interventions.questions')?.sampleCount, 2, 'interaction rows count works')
})

test('a recorded zero wait stays a zero and a missing interval stays unknown', () => {
  const zero = makeOutcome({ seed: 'facts-zero', acceptance: 'accepted', accepted: true, readyToAcceptanceMs: 0, activeReviewMs: 0 })
  const zeroAnalysis = analyzeUsageInsights({ ...completeBundle(), outcomes: [zero], workEvidence: [] } as UsageInsightsInput)
  const zeroWait = zeroAnalysis.summary.metrics.find(metric => metric.metricId === 'review.readyToAcceptanceMs')!
  assert.equal(zeroWait.value, 0)
  assert.equal(zeroWait.sampleCount, 1)
  assert.equal(zeroWait.nullReason, null, 'zero is a value, not a missing reason')

  const noTiming = makeOutcome({ seed: 'facts-missing', acceptance: 'accepted', accepted: true })
  const missingAnalysis = analyzeUsageInsights({ ...completeBundle(), outcomes: [noTiming], workEvidence: [] } as UsageInsightsInput)
  const missingWait = missingAnalysis.summary.metrics.find(metric => metric.metricId === 'review.readyToAcceptanceMs')!
  assert.equal(missingWait.value, null, 'no recorded interval is unknown')
  assert.equal(missingWait.nullReason, 'timing_missing')
})

test('a review visibility proxy is never presented as human effort', () => {
  const accepted = makeOutcome({ seed: 'facts-proxy', acceptance: 'accepted', accepted: true, readyToAcceptanceMs: 60_000, activeReviewMs: 15_000 })
  const analysis = analyzeUsageInsights({ ...completeBundle(), outcomes: [accepted], workEvidence: [] } as UsageInsightsInput)
  const wait = analysis.summary.metrics.find(metric => metric.metricId === 'review.readyToAcceptanceMs')!
  const proxy = analysis.summary.metrics.find(metric => metric.metricId === 'review.activeMs')!
  assert.equal(wait.coverage, 'complete', 'the wait between recorded timestamps is a measurement')
  assert.equal(proxy.coverage, 'partial', 'the UI-visibility span is a proxy')
  assert.notEqual(proxy.value, undefined)
  const definitions: readonly string[] = analysis.summary.metrics.map(metric => metric.metricId)
  assert.equal(definitions.includes('human.effortMs'), false, 'no human-effort metric is invented')
  assert.equal(Object.keys(METRIC_DEFINITIONS).some(name => /human|effort|benefit/.test(name)), false,
    'the catalogue defines no human-effort or benefit metric')
})

test('without a comparable baseline the summary says so and produces no benefit number', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  assert.equal(analysis.summary.baseline.status, 'not_requested')
  assert.equal(analysis.summary.baseline.ratio, null)
  assert.equal(analysis.summary.baseline.delta, null)
  assert.equal(analysis.summary.baseline.measuredValue, null)
  assert.equal(analysis.summary.baseline.observation, 'observational_only')
})
