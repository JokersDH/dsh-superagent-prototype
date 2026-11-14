/**
 * G3 acceptance: declared record/works/pages bounds are applied *before* parsing, an exact fit is not
 * truncation, and a truncated observation can never report complete coverage.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import type { UsageInsightsInput } from '../src/protocol.ts'
import { CONTRACT_ATLAS, makeHistory, makeOutcome, makeWorkEvidence } from './fixtures.ts'

const window = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }

function bundle(overrides: Partial<UsageInsightsInput> = {}): UsageInsightsInput {
  return {
    protocol: 'usage-insights-input/1',
    inputId: 'limits-bundle',
    capturedAt: '2026-11-13T12:00:00.000Z',
    timezone: 'UTC',
    window,
    projects: [{ projectId: 'project-atlas' }],
    source: { kind: 'operator_file', descriptor: 'limits bundle', digest: null, layerAssertion: 'operator_declared', capturedAt: '2026-11-13T12:00:00.000Z' },
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete' },
    outcomes: [],
    attentionPages: [],
    workEvidence: [],
    ...overrides,
  } as UsageInsightsInput
}

const firstMetric = (analysis: ReturnType<typeof analyzeUsageInsights>, metricId: string) =>
  analysis.summary.metrics.find(row => row.metricId === metricId)

const twoOutcomes = () => [
  makeOutcome({ seed: 'limit-a', durationMs: 1_000, acceptance: 'unknown' }),
  makeOutcome({ seed: 'limit-b', durationMs: 2_000, acceptance: 'unknown' }),
]

test('positive: an exact record bound enumerates everything and truncates nothing', () => {
  const analysis = analyzeUsageInsights(bundle({ outcomes: twoOutcomes(), limits: { maxRecords: 2 } }))
  const limits = analysis.summary.limits
  assert.equal(limits.recordsSeen, 2)
  assert.equal(limits.recordsAccepted, 2)
  assert.equal(limits.recordsNotParsed, 0)
  assert.equal(limits.stoppedBy, 'none')
  assert.equal(analysis.summary.coverage.outcomes, 'complete')
  assert.equal(firstMetric(analysis, 'outcomes.count')?.value, 2)
})

test('negative: maxRecords 1 accepts one record and reports the rest as not parsed', () => {
  const analysis = analyzeUsageInsights(bundle({ outcomes: twoOutcomes(), limits: { maxRecords: 1 } }))
  const limits = analysis.summary.limits
  assert.equal(limits.recordsSeen, 2)
  assert.equal(limits.recordsAccepted, 1, 'two outcomes must never be accepted under a bound of one')
  assert.equal(limits.recordsNotParsed, 1)
  assert.equal(limits.stoppedBy, 'records')
  assert.equal(analysis.summary.coverage.outcomes, 'partial')
  assert.equal(firstMetric(analysis, 'outcomes.count')?.value, 1)
  assert.ok(analysis.notes.some(note => note.includes('not parsed')))
})

test('the bound is applied before parsing: a record past the budget is never validated', () => {
  const analysis = analyzeUsageInsights(bundle({
    outcomes: [makeOutcome({ seed: 'limit-valid', acceptance: 'unknown' }), { protocol: 'execution-outcome/1', id: 'broken' }],
    limits: { maxRecords: 1 },
  }))
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'invalid_record'), undefined,
    'the malformed record was never parsed, so it is not quarantined')
  assert.equal(analysis.summary.limits.recordsNotParsed, 1)
  assert.equal(analysis.summary.limits.stoppedBy, 'records')

  const withoutBound = analyzeUsageInsights(bundle({
    outcomes: [makeOutcome({ seed: 'limit-valid', acceptance: 'unknown' }), { protocol: 'execution-outcome/1', id: 'broken' }],
  }))
  assert.equal(withoutBound.summary.quarantine.byCode.find(entry => entry.code === 'invalid_record')?.records, 1)
})

test('negative: maxPages bounds history pages and marks the work source partial', () => {
  const analysis = analyzeUsageInsights(bundle({
    workIndex: [{ workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' }],
    workHistories: [
      makeHistory(CONTRACT_ATLAS.workId, CONTRACT_ATLAS, [{ kind: 'question.opened', sourceRef: 'history-question-1' }]),
      makeHistory(CONTRACT_ATLAS.workId, CONTRACT_ATLAS, [{ kind: 'question.opened', sourceRef: 'history-question-2' }]),
    ],
    limits: { maxPages: 1 },
  }))
  assert.equal(analysis.summary.limits.pagesSeen, 2)
  assert.equal(analysis.summary.limits.pagesNotParsed, 1)
  assert.equal(analysis.summary.limits.stoppedBy, 'pages')
  assert.equal(analysis.summary.coverage.workEvidence, 'partial')
  assert.equal(firstMetric(analysis, 'interventions.questions')?.value, 1, 'only the parsed page contributes')
  assert.equal(firstMetric(analysis, 'interventions.questions')?.coverage, 'partial')
})

test('negative: maxWorks leaves the remaining works unknown instead of dropping them silently', () => {
  const atlasOutcome = makeOutcome({ seed: 'w-atlas', projectId: 'project-atlas', acceptance: 'unknown' })
  const secondWork = 'work-atlas-2'
  const analysis = analyzeUsageInsights(bundle({
    outcomes: [atlasOutcome],
    workIndex: [
      { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
      { workId: secondWork, projectId: 'project-atlas' },
    ],
    workEvidence: [
      makeWorkEvidence(CONTRACT_ATLAS.workId, [{ kind: 'question.opened', sourceRef: 'question-a' }], { outcomes: [atlasOutcome] }),
      makeWorkEvidence(secondWork, [{ kind: 'question.opened', sourceRef: 'question-b' }]),
    ],
    limits: { maxWorks: 1 },
  }))
  const limits = analysis.summary.limits
  assert.equal(limits.worksSeen, 2)
  assert.equal(limits.worksNotProcessed, 1)
  assert.equal(limits.stoppedBy, 'works')
  const questions = firstMetric(analysis, 'interventions.questions')
  assert.equal(questions?.value, 1, 'only the processed work contributes')
  assert.equal(questions?.unknownCount, 1, 'the unprocessed work is unknown, not zero')
  assert.equal(questions?.coverage, 'partial')
})

test('a source the collector already bounded is distinguished from an analysis bound', () => {
  const analysis = analyzeUsageInsights(bundle({
    outcomes: twoOutcomes(),
    declaredCoverage: { outcomes: 'caller_limit', workEvidence: 'complete', attention: 'complete' },
    limits: { maxRecords: 100 },
  }))
  assert.equal(analysis.summary.limits.recordsNotParsed, 0)
  assert.equal(analysis.summary.limits.stoppedBy, 'source', 'the collector bounded the source, not this analysis')
  assert.equal(analysis.summary.coverage.outcomes, 'partial')
})

test('invalid limit values are refused by the envelope', () => {
  for (const limits of [{ maxRecords: 0 }, { maxWorks: -1 }, { maxPages: 1.5 }, { maxBytes: 0 }]) {
    assert.throws(() => analyzeUsageInsights(bundle({ limits } as Partial<UsageInsightsInput>)),
      error => (error as { name?: string }).name === 'UsageInsightsFault', JSON.stringify(limits))
  }
})
