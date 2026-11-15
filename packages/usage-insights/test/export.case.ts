/**
 * G15/G16 acceptance: the bounded sanitized export.
 *
 * The export carries the same numbers as the summary, a stable row identity per metric/layer/currency,
 * and an explicit truncation block. A cut export is never presented as complete.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import {
  EXPORT_DEFAULT_MAX_BYTES, ExportDocumentSchema, ExportFault, buildInsightExport, exportDigest,
} from '../src/export.ts'
import { metricRowKey, toInsightConsumerView } from '../src/facing.ts'
import type { UsageInsightsInput } from '../src/protocol.ts'
import { completeBundle, makeOutcome } from './fixtures.ts'

const bundle = (outcomes: unknown[] = []) => ({ ...completeBundle(), outcomes, workEvidence: [] }) as UsageInsightsInput
const summaryOf = (input: UsageInsightsInput) => analyzeUsageInsights(input).summary

test('the export is deterministic and carries the source identity', () => {
  const summary = summaryOf(completeBundle())
  const first = buildInsightExport(summary)
  const second = buildInsightExport(summary)
  assert.equal(first.text, second.text, 'the same summary serializes identically')
  assert.equal(exportDigest(first.document), exportDigest(second.document))
  const document = ExportDocumentSchema.parse(first.document)
  assert.equal(document.protocol, 'usage-insights-export/1')
  assert.equal(document.authorization, 'none')
  assert.equal(document.exportedFrom.summaryId, summary.summaryId)
  assert.equal(document.exportedFrom.inputDigest, summary.inputDigest)
  assert.equal(document.exportedFrom.sourceKind, summary.sourceKind)
  assert.deepEqual(document.window, summary.window)
  assert.equal(document.timezone, summary.timezone)
  assert.deepEqual(document.scope.projectIds, summary.projects.map(project => project.projectId))
  assert.deepEqual(document.sourceCoverage, summary.coverage)
  assert.equal(document.truncation.byRows, false)
  assert.equal(document.truncation.byBytes, false)
  assert.equal(document.truncation.includedRows, summary.metrics.length)
  assert.equal(document.truncation.bytes, Buffer.byteLength(first.text),
    'the recorded byte count is exactly the written document size')
})

test('each row keeps its identity, unit, layer, currency and unknown counts', () => {
  const summary = summaryOf(bundle([
    makeOutcome({ seed: 'exp-usd', acceptance: 'unknown', layer: 'controlled', cost: { currency: 'USD', amount: 1 }, inputTokens: 10 }),
    makeOutcome({ seed: 'exp-eur', acceptance: 'unknown', layer: 'actual_native', cost: { currency: 'EUR', amount: 2 }, inputTokens: 20 }),
  ]))
  const { document } = buildInsightExport(summary)
  const rows = document.rows
  assert.equal(new Set(rows.map(row => row.rowId)).size, rows.length, 'row identities are unique')
  for (const row of rows) assert.equal(row.rowId, metricRowKey(summary.metrics.find(metric =>
    metric.metricId === row.metricId && metric.layer === row.layer && metric.currency === row.currency)!))
  const currencies = rows.filter(row => row.metricId === 'usage.cost').map(row => row.currency).sort()
  assert.deepEqual(currencies, ['EUR', 'USD'], 'one row per currency')
  const layers = rows.filter(row => row.metricId === 'usage.inputTokens').map(row => row.layer).sort()
  assert.deepEqual(layers, ['actual_native', 'controlled'], 'one row per layer')
  const unknown = rows.find(row => row.metricId === 'queue.waitMs')!
  assert.equal(unknown.value, null)
  assert.equal(unknown.formatted, null)
  assert.equal(unknown.nullReason, 'endpoint_missing')
  assert.ok(unknown.unknownCount >= 1)
})

test('the export exposes the same values as the display projection', () => {
  const summary = summaryOf(completeBundle())
  const view = toInsightConsumerView(summary)
  const { document } = buildInsightExport(summary)
  for (const metric of view.metrics) {
    const row = document.rows.find(candidate => candidate.rowId === metric.id)
    assert.ok(row, `the export contains ${metric.id}`)
    assert.equal(row.formatted, metric.value, 'the formatted value matches the projection')
    assert.equal(row.layer === null ? 'observed' : row.layer === 'actual_native' ? 'native' : row.layer === 'operator_note' ? 'operator' : row.layer, metric.layer)
    assert.equal(row.unit, metric.unit)
    // The projection nulls the sample count of an unavailable row so a UI cannot read "0 samples";
    // the export keeps the raw count, so they only have to agree where a value exists.
    if (metric.value !== null) assert.equal(row.sampleCount, metric.sampleCount)
  }
})

test('a row bound truncates explicitly and never claims to be complete', () => {
  const summary = summaryOf(completeBundle())
  const { document } = buildInsightExport(summary, { maxRows: 2 })
  assert.equal(document.truncation.byRows, true)
  assert.equal(document.truncation.includedRows, 2)
  assert.equal(document.truncation.totalRows, summary.metrics.length)
  assert.equal(document.rows.length, 2)
  assert.deepEqual(document.rows.map(row => row.rowId), summary.metrics.slice(0, 2).map(metricRowKey), 'the first rows keep their stable order')
})

test('a byte bound truncates explicitly, and an impossible budget is refused', () => {
  const summary = summaryOf(completeBundle())
  const generous = buildInsightExport(summary, { maxBytes: 100_000 })
  assert.equal(generous.document.truncation.byBytes, false)
  const tiny = buildInsightExport(summary, { maxBytes: 2_500 })
  assert.equal(tiny.document.truncation.byBytes, true)
  assert.ok(tiny.document.truncation.includedRows < tiny.document.truncation.totalRows)
  assert.ok(tiny.document.truncation.bytes <= 2_500)
  assert.throws(() => buildInsightExport(summary, { maxBytes: 200 }), (error: unknown) =>
    error instanceof ExportFault && error.code === 'export_too_large')
  assert.equal(EXPORT_DEFAULT_MAX_BYTES, 1_048_576)
})

test('the export contains no raw evidence, path or prompt text', () => {
  const input = completeBundle()
  const hostile = {
    ...input,
    workEvidence: (input.workEvidence as unknown as { entries: { at: string; kind: string; sourceRef: string }[] }[]).map(work => ({
      protocol: 'work-evidence/1', workId: 'work-atlas-1', projection: 'recorded', outcomes: [], truncated: false,
      entries: work.entries.map(entry => ({ ...entry, detail: { title: 'CANARY-EXPORT-1', path: '/Users/private/secret' } })),
    })),
  } as UsageInsightsInput
  const { text } = buildInsightExport(summaryOf(hostile))
  assert.equal(text.includes('CANARY-EXPORT-1'), false)
  assert.equal(text.includes('/Users/private'), false)
  assert.equal(text.includes('title'), false)
})
