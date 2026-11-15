/**
 * W30-G1/G2 acceptance: the served page, the report and the numeric export describe one observation.
 *
 * The comparison parses the served strings *for verification only*. Nothing here produces a value:
 * the display export has no numeric field, and the numeric export is built from the summary.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { analyzeUsageInsights } from '../src/analyze.ts'
import { renderMarkdown } from '../src/report.ts'
import {
  CROSS_CHECK_ABSOLUTE_TOLERANCE, CrossCheckFault, crossCheckAnalysisWithDisplay, expectedDisplayId,
} from '../src/crosscheck.ts'
import { buildInsightExport } from '../src/export.ts'
import type { UsageInsightsInput } from '../src/protocol.ts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'
const FROM = '2026-11-08T06:00:00.000Z'
const OBSERVED = '2026-11-15T05:30:00.000Z'

const outcome = makeOutcome({
  seed: 'cross-1', acceptance: 'accepted', projectId: 'one', durationMs: 3_000, inputTokens: 42,
  readyToAcceptanceMs: 799, activeReviewMs: 700,
  contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
  observedAt: OBSERVED,
})

const evidence = (workId: string, outcomes: unknown[] = []): WorkEvidence => ({
  protocol: 'work-evidence/1',
  workId,
  projection: 'recorded',
  entries: [{ at: '2026-11-15T05:00:00.000Z', kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'],
  truncated: false,
})

const works = [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'two' }]

/** The same evidence through main's reader and through G's analyzer. */
async function pair(): Promise<{ dto: UsageObservation; analysis: ReturnType<typeof analyzeUsageInsights> }> {
  const dto = await new ProductUsageObservation({
    projectIds: () => ['one', 'two'],
    cursor: () => 1,
    listWorks: (projectIds, limit) => ({ works: works.filter(work => projectIds.includes(work.projectId)).slice(0, limit), hasMore: false }),
    workEvidence: async workId => evidence(workId, workId === 'work-a' ? [outcome] : []),
  }, () => AT).read({ days: 7, timezone: 'UTC' })
  const input: UsageInsightsInput = {
    protocol: 'usage-insights-input/1',
    inputId: 'cross-check-source',
    capturedAt: AT,
    timezone: 'UTC',
    window: { from: FROM, to: AT },
    projects: [{ projectId: 'one' }, { projectId: 'two' }],
    source: { kind: 'authorized_read', descriptor: 'test readers', digest: null, capturedAt: AT, layerAssertion: 'recorded_by_producer' },
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'not_collected' },
    workIndex: works.map(work => ({ workId: work.id, projectId: work.projectId })),
    outcomes: [],
    workEvidence: [evidence('work-a', [outcome]), evidence('work-b')],
    attentionPages: [],
    limits: { maxRecords: 10_000, maxWorks: 50, maxPages: 1 },
  } as UsageInsightsInput
  return { dto, analysis: analyzeUsageInsights(input) }
}

test('positive: page and analysis agree row by row for the same window and scope', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  const result = crossCheckAnalysisWithDisplay({ dto, summary })
  assert.equal(result.comparable, true)
  assert.deepEqual(result.disagreements, [], `unexpected disagreements: ${JSON.stringify(result.disagreements)}`)
  assert.ok(result.checked >= summary.metrics.length, 'every analysed row is compared against the served page')
  assert.equal(result.agreements, result.checked, 'every comparable row agrees')
  assert.equal(result.tolerance.absolute, CROSS_CHECK_ABSOLUTE_TOLERANCE)
  // Both documents carry an observation identity; they need not be equal (different readers).
  assert.equal(result.snapshot.analysis, summary.summaryId)
  assert.equal(result.snapshot.display, dto.summaryId)
})

test('the report and the numeric export carry the same values as the served page', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  const { document } = buildInsightExport(summary)
  const report = renderMarkdown(analysis)
  const rounded = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000))
  for (const row of document.rows) {
    // The report prints the same number the export records, under the same metric, layer and unit.
    assert.ok(report.includes(`| ${row.metricId} | ${row.layer ?? 'product record'} | ${row.unit} | `),
      `the report has no row for ${row.rowId}`)
    if (row.value === null) continue
    assert.ok(report.includes(`| ${rounded(row.value)} | `), `the report does not print ${row.value} for ${row.rowId}`)
    // And the served page agrees with that same number.
    const servedRow = dto.metrics.find(metric => metric.id === expectedDisplayId(summary.metrics.find(metric =>
      metric.metricId === row.metricId && metric.layer === row.layer && metric.currency === row.currency)!))
    const servedNumber = Number(String(servedRow?.value).replace(/[\s,]/g, ''))
    assert.ok(Math.abs(row.value - servedNumber) <= CROSS_CHECK_ABSOLUTE_TOLERANCE,
      `${row.rowId}: export ${row.value} vs served ${servedNumber}`)
  }
})

test('negative: a different window is refused instead of compared', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  const thirty = await new ProductUsageObservation({
    projectIds: () => ['one', 'two'],
    cursor: () => 1,
    listWorks: () => ({ works, hasMore: false }),
    workEvidence: async workId => evidence(workId, workId === 'work-a' ? [outcome] : []),
  }, () => AT).read({ days: 30, timezone: 'UTC' })
  const result = crossCheckAnalysisWithDisplay({ dto: thirty, summary })
  assert.equal(result.comparable, false)
  assert.equal(result.checked, 0)
  assert.deepEqual(result.disagreements.map(entry => entry.kind).sort(), ['days_mismatch', 'window_mismatch'])
  assert.equal(dto.days, 7)
})

test('negative: a missing, foreign or altered row is reported, never reconciled', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  const first = dto.metrics[0]!
  const missing = { ...dto, metrics: dto.metrics.slice(1) }
  assert.ok(crossCheckAnalysisWithDisplay({ dto: missing, summary }).disagreements
    .some(entry => entry.kind === 'metric_missing_in_display'))

  const foreign = { ...dto, metrics: [...dto.metrics, { ...first, id: 'foreign.metric@observed@' }] }
  assert.ok(crossCheckAnalysisWithDisplay({ dto: foreign, summary }).disagreements
    .some(entry => entry.kind === 'metric_missing_in_summary'))

  const altered = {
    ...dto,
    metrics: dto.metrics.map(metric => metric.id === first.id ? { ...metric, value: '999' } : metric),
  }
  assert.ok(crossCheckAnalysisWithDisplay({ dto: altered, summary }).disagreements
    .some(entry => entry.kind === 'value_mismatch'))

  const wrongSample = { ...dto, metrics: dto.metrics.map(metric => metric.id === first.id ? { ...metric, sampleCount: 7 } : metric) }
  const sample = crossCheckAnalysisWithDisplay({ dto: wrongSample, summary })
  assert.ok(sample.disagreements.some(entry => entry.kind === 'sample_mismatch'))
  assert.ok(sample.agreements < sample.checked, 'a row with a wrong sample count does not count as agreement')
})

test('negative: a bounded header must not carry a complete sample count', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  const bounded = { ...dto, sampleCount: 99 }
  const result = crossCheckAnalysisWithDisplay({ dto: bounded, summary })
  assert.ok(result.disagreements.some(entry => entry.kind === 'header_sample_mismatch'))
})

test('the tolerance is the display rounding, not a licence to accept a different number', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  const target = dto.metrics.find(metric => metric.value !== null)!
  const numeric = summary.metrics.find(metric => expectedDisplayId(metric) === target.id)!
  const within = { ...dto, metrics: dto.metrics.map(metric => metric.id === target.id
    ? { ...metric, value: String(Number(numeric.value) + CROSS_CHECK_ABSOLUTE_TOLERANCE - 0.001) } : metric) }
  assert.equal(crossCheckAnalysisWithDisplay({ dto: within, summary }).disagreements.length, 0)
  const outside = { ...dto, metrics: dto.metrics.map(metric => metric.id === target.id
    ? { ...metric, value: String(Number(numeric.value) + 0.5) } : metric) }
  assert.ok(crossCheckAnalysisWithDisplay({ dto: outside, summary }).disagreements
    .some(entry => entry.kind === 'value_mismatch'))
})

test('invalid inputs are refused with the schema, not coerced', { skip }, async () => {
  const { dto, analysis } = await pair()
  const summary = analysis.summary
  assert.throws(() => crossCheckAnalysisWithDisplay({ dto: { protocol: 'usage-observation/1' } as never, summary }),
    (error: unknown) => error instanceof CrossCheckFault && error.code === 'invalid_display_dto')
  assert.throws(() => crossCheckAnalysisWithDisplay({ dto, summary: { protocol: 'usage-insights/1' } as never }),
    (error: unknown) => error instanceof CrossCheckFault && error.code === 'invalid_summary')
})
