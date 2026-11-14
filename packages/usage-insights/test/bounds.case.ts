import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import type { UsageInsightsInput } from '../src/protocol.ts'
import { makeOutcome, makeWorkEvidence } from './fixtures.ts'

const window = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }

function bundle(overrides: Partial<UsageInsightsInput>): UsageInsightsInput {
  return {
    protocol: 'usage-insights-input/1',
    inputId: 'bounds-bundle',
    capturedAt: '2026-11-13T12:00:00.000Z',
    timezone: 'UTC',
    window,
    projects: [{ projectId: 'project-atlas' }],
    source: { kind: 'synthetic_fixture', descriptor: 'bounds fixture', digest: null, layerAssertion: 'recorded_by_producer', capturedAt: '2026-11-13T12:00:00.000Z' },
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete' },
    outcomes: [],
    attentionPages: [],
    workEvidence: [],
    ...overrides,
  } as UsageInsightsInput
}

test('a large multi-layer input stays linear, exact and bounded', () => {
  const layers = ['controlled', 'protocol_fixture', 'schema'] as const
  const perLayer = 1_500
  const outcomes = []
  for (let index = 0; index < perLayer; index++) {
    for (const layer of layers) {
      outcomes.push(makeOutcome({
        seed: `bulk-${layer}-${index}`,
        layer,
        durationMs: 1_000 + index,
        acceptance: 'unknown',
      }))
    }
  }
  const started = Date.now()
  const analysis = analyzeUsageInsights(bundle({ outcomes }))
  const elapsed = Date.now() - started
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count' && row.layer === 'controlled')?.value, perLayer)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count' && row.layer === 'schema')?.value, perLayer)
  assert.equal(analysis.summary.limits.recordsAccepted, perLayer * layers.length)
  assert.equal(analysis.summary.quarantine.total, 0)
  assert.ok(elapsed < 5_000, `analysis of ${perLayer * layers.length} outcomes took ${elapsed}ms`)
})

test('a flood of malformed records is counted in full but sampled in the diagnostics', () => {
  const broken = Array.from({ length: 1_000 }, (_, index) => ({ protocol: 'execution-outcome/1', id: `broken-${index}` }))
  const valid = makeOutcome({ seed: 'bulk-valid', durationMs: 500, acceptance: 'unknown' })
  const analysis = analyzeUsageInsights(bundle({ outcomes: [...broken, valid] }))
  assert.equal(analysis.summary.quarantine.total, 1_000)
  assert.equal(analysis.quarantine.length, 500, 'the diagnostics list is capped')
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count')?.value, 1)
  assert.equal(analysis.summary.coverage.outcomes, 'partial')
})

test('many conflicting identities are all excluded without inflating counts', () => {
  const conflicts = []
  for (let index = 0; index < 300; index++) {
    const base = makeOutcome({ seed: `conflict-${index}`, durationMs: 1_000, acceptance: 'unknown' })
    conflicts.push(base, { ...base, durationMs: 2_000 })
  }
  const analysis = analyzeUsageInsights(bundle({ outcomes: conflicts }))
  assert.equal(analysis.summary.quarantine.total, 300)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count'), undefined)
  assert.equal(analysis.summary.limits.recordsSeen, 600)
  assert.equal(analysis.summary.limits.recordsAccepted, 0)
})

test('thirty currencies stay thirty separate rows', () => {
  const outcomes = Array.from({ length: 30 }, (_, index) => makeOutcome({
    seed: `currency-${index}`,
    acceptance: 'unknown',
    cost: { currency: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'ISK', 'TRY', 'ILS', 'INR', 'CNY', 'HKD', 'SGD', 'KRW', 'TWD', 'THB', 'MYR', 'IDR', 'PHP', 'VND'][index] ?? 'USD', amount: index + 1 },
  }))
  const analysis = analyzeUsageInsights(bundle({ outcomes }))
  const rows = analysis.summary.metrics.filter(row => row.metricId === 'usage.cost')
  assert.equal(rows.length, 30)
  assert.equal(new Set(rows.map(row => row.currency)).size, 30)
})

test('the declared input caps are enforced rather than silently truncated', () => {
  const oversized = Array.from({ length: 50_001 }, () => ({}))
  assert.throws(() => analyzeUsageInsights(bundle({ outcomes: oversized })), error => (error as { name?: string }).name === 'UsageInsightsFault')
  assert.throws(() => analyzeUsageInsights(bundle({
    source: { kind: 'synthetic_fixture', descriptor: 'x'.repeat(400), digest: null, layerAssertion: 'recorded_by_producer', capturedAt: '2026-11-13T12:00:00.000Z' },
  })), error => (error as { name?: string }).name === 'UsageInsightsFault')
})

test('work evidence with many entries per work stays bounded per metric', () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({ kind: 'question.opened', sourceRef: `question-${index}` }))
  const work = makeWorkEvidence('work-atlas-1', entries)
  // A work with no outcome needs the collector's index; without it the work is unmapped and its
  // interaction total is unknown rather than a measured 500.
  const unmapped = analyzeUsageInsights(bundle({ workEvidence: [work] }))
  const unknownQuestions = unmapped.summary.metrics.find(row => row.metricId === 'interventions.questions')
  assert.equal(unknownQuestions?.value, null)
  assert.equal(unknownQuestions?.nullReason, 'unmapped_work')
  assert.equal(unmapped.summary.losses.workEvidence.unmapped, 1)

  const mapped = analyzeUsageInsights(bundle({
    workEvidence: [work],
    workIndex: [{ workId: 'work-atlas-1', projectId: 'project-atlas' }],
  }))
  const questions = mapped.summary.metrics.find(row => row.metricId === 'interventions.questions')
  assert.equal(questions?.value, 500)
  assert.ok((questions?.provenanceRefs.length ?? 0) <= 256, 'provenance references are capped')
})

test('many works are bounded by maxWorks and the remainder stays unknown', () => {
  const works = []
  const index = []
  for (let number = 0; number < 200; number++) {
    const workId = `work-bulk-${number}`
    index.push({ workId, projectId: 'project-atlas' })
    works.push(makeWorkEvidence(workId, [{ kind: 'question.opened', sourceRef: `question-${number}` }]))
  }
  const analysis = analyzeUsageInsights(bundle({
    workEvidence: works,
    workIndex: index,
    limits: { maxWorks: 50 },
  }))
  const questions = analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')
  assert.equal(questions?.value, 50)
  assert.equal(questions?.unknownCount, 150)
  assert.equal(questions?.coverage, 'partial')
  assert.equal(analysis.summary.limits.worksSeen, 200)
  assert.equal(analysis.summary.limits.worksNotProcessed, 150)
  assert.equal(analysis.summary.limits.stoppedBy, 'works')
  assert.equal(analysis.summary.coverage.workEvidence, 'partial')
})

test('many attention pages are bounded and never read as complete', () => {
  const pages = Array.from({ length: 40 }, (_, pageIndex) => ({
    protocol: 'attention-inbox/1',
    observedAt: '2026-11-13T11:00:00.000Z',
    items: [],
    ranks: [],
    ranking: 'waiting_order',
    scannedWorks: 0,
    questionCoverage: 'complete',
    hasMore: pageIndex < 39,
    ...(pageIndex < 39 ? { nextCursor: `cursor-${pageIndex}` } : {}),
  }))
  const analysis = analyzeUsageInsights(bundle({ attentionPages: pages, limits: { maxPages: 10 } }))
  assert.equal(analysis.summary.limits.pagesSeen, 40)
  assert.equal(analysis.summary.limits.pagesNotParsed, 30)
  assert.equal(analysis.summary.limits.stoppedBy, 'pages')
  assert.notEqual(analysis.summary.attention.coverage, 'complete')
})

test('nested caps and the mapping tombstone interact without regressing either rule', () => {
  const works = []
  const index = [
    { workId: 'work-tomb', projectId: 'project-atlas' },
    { workId: 'work-tomb', projectId: 'project-orbit' },
    { workId: 'work-tomb', projectId: 'project-atlas' },
  ]
  for (let number = 0; number < 20; number++) {
    const workId = `work-mix-${number}`
    index.push({ workId, projectId: 'project-atlas' })
    works.push(makeWorkEvidence(workId, [{ kind: 'question.opened', sourceRef: `q-${number}` }], {
      outcomes: Array.from({ length: 3 }, (_, inner) => makeOutcome({
        seed: `mix-${number}-${inner}`, acceptance: 'unknown',
        contract: { workId, revision: 1, digest: 'a'.repeat(64) },
      })),
    }))
  }
  works.push(makeWorkEvidence('work-tomb', [{ kind: 'question.opened', sourceRef: 'q-tomb' }], {
    outcomes: [makeOutcome({ seed: 'tomb-1', acceptance: 'unknown', contract: { workId: 'work-tomb', revision: 1, digest: 'e'.repeat(64) } })],
  }))
  const analysis = analyzeUsageInsights(bundle({ workEvidence: works, workIndex: index, limits: { maxRecords: 45 } }))
  // Each mixed container costs 1 + 1 entry + 3 outcomes = 5 units; 45 units admit nine of them.
  assert.equal(analysis.summary.limits.stoppedBy === 'records' || analysis.summary.limits.stoppedBy === 'none', true)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'identity_conflict')?.records, 1)
  assert.ok((analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')?.unknownCount ?? 0) > 0)
  // No metric may claim a complete source while the bound and the tombstone both removed records.
  assert.notEqual(analysis.summary.coverage.workEvidence, 'complete')
  assert.equal(analysis.summary.metrics.every(row => row.value === null || Number.isFinite(row.value)), true)
})

test('a large nested input stays bounded and exact at the cap boundary', () => {
  const works = Array.from({ length: 100 }, (_, number) => {
    const workId = `work-scale-${number}`
    return makeWorkEvidence(workId, [{ kind: 'question.opened', sourceRef: `q-${number}` }], {
      outcomes: [makeOutcome({ seed: `scale-${number}`, acceptance: 'unknown', contract: { workId, revision: 1, digest: 'a'.repeat(64) } })],
    })
  })
  const index = works.map((_, number) => ({ workId: `work-scale-${number}`, projectId: 'project-atlas' }))
  // Each container costs three units, so 300 units is an exact fit for all 100.
  const started = Date.now()
  const exact = analyzeUsageInsights(bundle({ workEvidence: works, workIndex: index, limits: { maxRecords: 300 } }))
  const elapsed = Date.now() - started
  assert.equal(exact.summary.limits.recordsSeen, 300)
  assert.equal(exact.summary.limits.recordsAdmitted, 300)
  assert.equal(exact.summary.limits.recordsNotParsed, 0)
  assert.equal(exact.summary.metrics.find(row => row.metricId === 'outcomes.count')?.value, 100)
  assert.ok(elapsed < 5_000, `analysis of 300 units took ${elapsed}ms`)

  const short = analyzeUsageInsights(bundle({ workEvidence: works, workIndex: index, limits: { maxRecords: 299 } }))
  assert.equal(short.summary.limits.recordsNotParsed, 3, 'the last container does not fit and is skipped whole')
  assert.equal(short.summary.metrics.find(row => row.metricId === 'outcomes.count')?.value, 99)
})
