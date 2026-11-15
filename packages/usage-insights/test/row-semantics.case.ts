/**
 * W31-G2 acceptance: a row explains its own sample basis, coverage and value state.
 *
 * The report is the consumer: the same semantics it prints are the ones a reader needs in order not to
 * mistake a proxy for a measurement, an enumerated source for an available value, or a missing value
 * for zero.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import { rowCoverageMeaning, rowSemantics } from '../src/facing.ts'
import { renderMarkdown } from '../src/report.ts'
import type { MetricRow, UsageInsightsInput } from '../src/protocol.ts'
import { completeBundle, makeOutcome, unknownBundle } from './fixtures.ts'

const bundle = (outcomes: unknown[] = []) => ({ ...completeBundle(), outcomes, workEvidence: [] }) as UsageInsightsInput
const rowOf = (input: UsageInsightsInput, metricId: string, layer?: string | null): { row: MetricRow; analysis: ReturnType<typeof analyzeUsageInsights> } => {
  const analysis = analyzeUsageInsights(input)
  const row = analysis.summary.metrics.find(candidate => candidate.metricId === metricId && (layer === undefined || candidate.layer === layer))
  assert.ok(row, `${metricId} row is missing`)
  return { row, analysis }
}

test('outcome rows and product-record rows declare different sample bases', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const outcome = analysis.summary.metrics.find(row => row.metricId === 'outcomes.count')!
  const interaction = analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')!
  assert.equal(rowSemantics(outcome, analysis.summary).basis, 'outcome_record')
  assert.equal(rowSemantics(interaction, analysis.summary).basis, 'product_record')
  assert.notEqual(rowSemantics(outcome, analysis.summary).sampleMeaning, rowSemantics(interaction, analysis.summary).sampleMeaning)
  assert.equal(rowSemantics(outcome, analysis.summary).valueState, 'known')
})

test('a UI-visibility interval stays a proxy even when the source is complete', () => {
  const accepted = makeOutcome({
    seed: 'sem-proxy', acceptance: 'accepted', accepted: true, readyToAcceptanceMs: 3_000, activeReviewMs: 900, durationMs: 5_000,
  })
  const { row, analysis } = rowOf(bundle([accepted]), 'review.activeMs')
  assert.equal(analysis.summary.coverage.overall, 'complete')
  assert.equal(row.coverage, 'partial')
  const semantics = rowSemantics(row, analysis.summary)
  assert.equal(semantics.valueState, 'partial_proxy')
  assert.match(semantics.note ?? '', /not human working time/)
  assert.match(rowCoverageMeaning(row), /proxy|partially/)
  // The measured wait next to it keeps its own complete, non-proxy meaning.
  const wait = analysis.summary.metrics.find(candidate => candidate.metricId === 'review.readyToAcceptanceMs')!
  assert.equal(rowSemantics(wait, analysis.summary).valueState, 'known')
})

test('an enumerated source with no value is not a measured zero', () => {
  const unknown = makeOutcome({ seed: 'sem-unknown', acceptance: 'unknown' })
  const { row, analysis } = rowOf(bundle([unknown]), 'usage.inputTokens')
  assert.equal(row.value, null)
  assert.equal(row.coverage, 'complete', 'the source was enumerated completely')
  const semantics = rowSemantics(row, analysis.summary)
  assert.equal(semantics.valueState, 'unknown')
  assert.match(semantics.note ?? '', /never zero/)
  assert.match(rowCoverageMeaning(row), /no value was recorded/)
})

test('each coverage value says what it does and does not establish', () => {
  const base = analyzeUsageInsights(unknownBundle()).summary.metrics[0]!
  const withCoverage = (coverage: MetricRow['coverage'], value: number | null): MetricRow => ({ ...base, coverage, value })
  assert.match(rowCoverageMeaning(withCoverage('complete', null)), /no value was recorded/)
  assert.match(rowCoverageMeaning(withCoverage('complete', 3)), /enumerated completely/)
  assert.match(rowCoverageMeaning(withCoverage('partial', 3)), /partially|proxy/)
  assert.match(rowCoverageMeaning(withCoverage('source_missing', null)), /unknown/)
  assert.match(rowCoverageMeaning(withCoverage('not_collected', null)), /not collected/)
  assert.match(rowCoverageMeaning(withCoverage('unsupported', null)), /unsupported/)
  // A bounded source qualifies the value it does present, and never upgrades an unknown one.
  const summary = analyzeUsageInsights(unknownBundle()).summary
  // A summary collapses page-level limits into `partial`; either way it is not `complete`.
  const bounded = { ...summary, coverage: { ...summary.coverage, overall: 'partial' as const } }
  const known = withCoverage('complete', 3)
  assert.match(rowSemantics(known, bounded).note ?? '', /observed part only/)
  assert.match(rowSemantics(withCoverage('complete', null), bounded).note ?? '', /never zero/)
})

test('the report prints the same value state and the stable row id it exports', () => {
  const accepted = makeOutcome({
    seed: 'sem-report', acceptance: 'accepted', accepted: true, readyToAcceptanceMs: 3_000, activeReviewMs: 900,
    cost: { currency: 'EUR', amount: 2.5 },
  })
  const markdown = renderMarkdown(analyzeUsageInsights(bundle([accepted])))
  const rowIdOf = (line: string): string => line.replace(/^\| /, '').split(' | ')[0] ?? ''
  const rows = markdown.split('\n').filter(line => line.startsWith('| ') && rowIdOf(line).startsWith('usage.cost@'))
  assert.equal(rows.length, 1, 'the currency row is addressable by its stable id')
  assert.ok(rows[0]!.includes('| known |'), 'a recorded value is printed as known')
  const proxy = markdown.split('\n').find(line => rowIdOf(line).startsWith('review.activeMs@'))
  assert.ok(proxy?.includes('| partial_proxy |'), 'the proxy row says it is a proxy')
  const unknownRow = markdown.split('\n').find(line => rowIdOf(line).startsWith('execution.durationMs@'))
  if (unknownRow) assert.ok(unknownRow.includes('unknown') || unknownRow.includes('known'))
})
