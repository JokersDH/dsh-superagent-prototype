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
  EXPORT_DEFAULT_MAX_BYTES, ExportDocumentSchema, ExportFault, buildInsightExport, exportDigest, previousSnapshotOf,
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
  assert.equal(document.protocol, 'usage-insights-export/2')
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
  // The document belongs to exactly one observation.
  assert.equal(document.snapshot.snapshotId, summary.summaryId)
  assert.equal(document.snapshot.capturedAt, summary.capturedAt)
  assert.equal(document.snapshot.continuity, 'first_observation')
  assert.equal(document.snapshot.previous, null)
  assert.equal(document.snapshot.note, null)
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

test('the default row bound truncates a many-currency observation explicitly', () => {
  // Valid ISO-shaped codes are three uppercase letters; 26*26 gives more than the row bound.
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const codes = Array.from({ length: 210 }, (_, index) =>
    `${letters[Math.floor(index / 26) % 26]}${letters[index % 26]}X`)
  const outcomes = codes.map((currency, index) => makeOutcome({
    seed: `export-currency-${index}`, acceptance: 'unknown', cost: { currency, amount: index + 1 },
  }))
  const summary = summaryOf(bundle(outcomes))
  assert.ok(summary.metrics.length > 200, `the fixture must exceed the default row bound, got ${summary.metrics.length}`)
  const { document } = buildInsightExport(summary)
  assert.equal(document.truncation.byRows, true)
  assert.equal(document.truncation.includedRows, 200)
  assert.ok(document.truncation.totalRows > 200)
  assert.equal(document.rows.length, 200)
  assert.ok(document.truncation.bytes <= document.truncation.maxBytes)
  // Ordering is stable, so the same bound keeps the same rows.
  const again = buildInsightExport(summary)
  assert.deepEqual(again.document.rows.map(row => row.rowId), document.rows.map(row => row.rowId))
})

test('a declared previous export is either the same snapshot or explicitly a new one', () => {
  const summary = summaryOf(completeBundle())
  const first = buildInsightExport(summary)
  // The same observation declared again is continuous, and its note stays empty.
  const continued = buildInsightExport(summary, {
    previous: { snapshotId: summary.summaryId, capturedAt: summary.capturedAt },
  })
  assert.equal(continued.document.snapshot.continuity, 'same_snapshot')
  assert.equal(continued.document.snapshot.note, null)
  assert.deepEqual(continued.document.snapshot.previous,
    { snapshotId: summary.summaryId, capturedAt: summary.capturedAt })
  assert.deepEqual(continued.document.rows, first.document.rows, 'continuity never changes a value')

  // A different observation replaces the earlier one: the document says so and never reuses its values.
  const later = summaryOf({ ...completeBundle(), capturedAt: '2026-11-15T08:00:00.000Z' } as UsageInsightsInput)
  assert.notEqual(later.summaryId, summary.summaryId, 'a later observation has its own identity')
  const replaced = buildInsightExport(later, { previous: { snapshotId: summary.summaryId, capturedAt: summary.capturedAt } })
  assert.equal(replaced.document.snapshot.continuity, 'new_snapshot')
  assert.match(replaced.document.snapshot.note ?? '', /not reused/)
  assert.deepEqual(replaced.document.snapshot.previous,
    { snapshotId: summary.summaryId, capturedAt: summary.capturedAt })
  assert.equal(replaced.document.limitations[0], replaced.document.snapshot.note,
    'the discontinuity is stated in the limitations too')
  assert.equal(JSON.stringify(replaced.document.rows).includes(summary.summaryId), false,
    'the previous snapshot contributes an identity, never a value')

  // A declared previous without an identity cannot be continued, so it is reported as replaced.
  const unidentified = buildInsightExport(summary, { previous: { snapshotId: null, capturedAt: 'then' } })
  assert.equal(unidentified.document.snapshot.continuity, 'new_snapshot')
  assert.throws(() => buildInsightExport(summary, { previous: { snapshotId: summary.summaryId, capturedAt: summary.capturedAt }, maxBytes: 200 }),
    (error: unknown) => error instanceof ExportFault && error.code === 'export_too_large')
})

test('a previous export is read only for its snapshot identity', () => {
  const summary = summaryOf(completeBundle())
  const current = buildInsightExport(summary).document
  assert.deepEqual(previousSnapshotOf(current), { snapshotId: summary.summaryId, capturedAt: summary.capturedAt })
  // Documents written before the snapshot block carried the summary id in `exportedFrom`.
  assert.deepEqual(previousSnapshotOf({
    protocol: 'usage-insights-export/1',
    exportedFrom: { summaryId: 'a'.repeat(64), capturedAt: '2026-11-14T00:00:00.000Z' },
  }), { snapshotId: 'a'.repeat(64), capturedAt: '2026-11-14T00:00:00.000Z' })
  // A document without either identity is not silently treated as continuous.
  assert.deepEqual(previousSnapshotOf({ exportedFrom: { capturedAt: '2026-11-14T00:00:00.000Z' } }),
    { snapshotId: null, capturedAt: '2026-11-14T00:00:00.000Z' })
  assert.equal(previousSnapshotOf({ protocol: 'usage-insights-input/1' }), null)
  assert.equal(previousSnapshotOf(null), null)
})
