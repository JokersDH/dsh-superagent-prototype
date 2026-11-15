/**
 * W30-G1 acceptance: the display-only export of the document the coordinator actually serves.
 *
 * The served `usage-observation/1` carries formatted strings. A consumer that only has that document
 * must not present it as numeric analysis, so this export has no numeric value field at all — the
 * tests below assert precisely that, along with verbatim preservation of the served identity,
 * layer, unit and sample count, and the snapshot continuity rules.
 *
 * The DTO comes from main's real `ProductUsageObservation`, not from a hand-written mock.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import {
  DISPLAY_EXPORT_PROTOCOL, DisplayExportDocumentSchema, DisplayExportFault, buildDisplayExport, displayExportDigest,
} from '../src/display-export.ts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'

const evidence = (workId: string, outcomes: unknown[] = []): WorkEvidence => ({
  protocol: 'work-evidence/1',
  workId,
  projection: 'recorded',
  entries: [{ at: '2026-11-15T05:00:00.000Z', kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'],
  truncated: false,
})

/** A real coordinator observation over two controlled projects. */
async function served(): Promise<UsageObservation> {
  const outcome = makeOutcome({
    seed: 'display-1', acceptance: 'accepted', projectId: 'one', durationMs: 3_000, inputTokens: 42,
    readyToAcceptanceMs: 799, activeReviewMs: 700,
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
    observedAt: '2026-11-15T05:30:00.000Z',
  })
  return new ProductUsageObservation({
    projectIds: () => ['one', 'two'],
    cursor: () => 1,
    listWorks: (projectIds, limit) => ({
      works: [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'two' }]
        .filter(work => projectIds.includes(work.projectId)).slice(0, limit),
      hasMore: false,
    }),
    workEvidence: async workId => evidence(workId, workId === 'work-a' ? [outcome] : []),
  }, () => AT).read({ days: 7, timezone: 'UTC' })
}

test('positive: the served document exports display-only with no numeric field', { skip }, async () => {
  const dto = await served()
  const first = buildDisplayExport(dto)
  const second = buildDisplayExport(dto)
  assert.equal(first.text, second.text, 'the same document serializes identically')
  assert.equal(displayExportDigest(first.document), displayExportDigest(second.document))

  const document = DisplayExportDocumentSchema.parse(first.document)
  assert.equal(document.protocol, DISPLAY_EXPORT_PROTOCOL)
  assert.equal(document.authorization, 'none')
  assert.equal(document.exportedFrom.observationProtocol, 'usage-observation/1')
  assert.equal(document.exportedFrom.observedAt, dto.observedAt)
  assert.equal(document.exportedFrom.days, dto.days)
  assert.equal(document.exportedFrom.timezone, dto.timezone)
  assert.deepEqual(document.window, dto.window)
  assert.deepEqual(document.scope.projectIds, [...dto.scope.projectIds])
  assert.equal(document.scope.aggregation, dto.scope.aggregation)
  assert.equal(document.header.status, dto.status)
  assert.equal(document.header.coverageState, dto.coverageState)
  assert.equal(document.header.sampleCount, dto.sampleCount)

  // The rows are the served rows, verbatim: id, label, layer, unit, string, sample count.
  assert.equal(document.rows.length, dto.metrics.length)
  for (const [index, metric] of dto.metrics.entries()) {
    const row = document.rows[index]!
    assert.equal(row.rowId, metric.id)
    assert.equal(row.label, metric.label)
    assert.equal(row.layer, metric.layer)
    assert.equal(row.unit, metric.unit)
    assert.equal(row.formatted, metric.value)
    assert.equal(row.sampleCount, metric.sampleCount)
    assert.equal(row.detail, metric.detail)
  }
  // There is no numeric port anywhere in the document, so nothing can be reverse-parsed.
  assert.equal(JSON.stringify(document.rows).includes('"value"'), false, 'no row carries a numeric value')
  assert.equal(document.sourceIdentity.kind, 'display_dto')
  assert.equal(document.sourceIdentity.numericValues, false)
  assert.equal(document.crossCheck.numericValuesAvailable, false)
  assert.match(document.limitations[0] ?? '', /formatted strings only/)
  assert.equal(/"(value|number|amount)"\s*:\s*-?\d/.test(first.text), false, 'no numeric field in the serialized text')

  // The snapshot is the served observation; it is not the numeric analyzer's summary identity.
  assert.equal(document.snapshot.snapshotId, dto.summaryId)
  assert.equal(document.snapshot.capturedAt, dto.observedAt)
  assert.equal(document.snapshot.continuity, 'first_observation')
  assert.equal(document.truncation.byRows, false)
  assert.equal(document.truncation.bytes, Buffer.byteLength(first.text), 'the recorded size is the written size')
})

test('currencies and layers survive as the served unit and identity', { skip }, async () => {
  const dto = await served()
  const { document } = buildDisplayExport(dto)
  const rows = document.rows
  assert.equal(new Set(rows.map(row => row.rowId)).size, rows.length, 'served ids stay unique')
  for (const row of rows) {
    // The served id is kept exactly as served, including the coordinator's trailing separator.
    assert.match(row.rowId, /^[a-z][A-Za-z.]*@/)
    // A currency row keeps the code in the unit and in the identity; nothing is merged or dropped.
    if (/^[A-Z]{3}$/.test(row.unit)) assert.equal(row.rowId.endsWith(`@${row.unit}`), true)
  }
  const unknown = rows.find(row => row.formatted === null)
  assert.ok(unknown, 'an unknown value is exported as an explicit null string, never zero')
  assert.equal(JSON.stringify(rows).includes('"formatted":0'), false)
})

test('an unavailable observation exports no rows and no identity', { skip }, async () => {
  const dto = await new ProductUsageObservation({
    projectIds: () => [],
    cursor: () => 0,
    listWorks: () => ({ works: [], hasMore: false }),
    workEvidence: async () => evidence('none'),
  }, () => AT).read({ days: 7, timezone: 'UTC' })
  assert.equal(dto.status, 'unavailable')
  const { document } = buildDisplayExport(dto)
  assert.equal(document.header.status, 'unavailable')
  assert.deepEqual(document.rows, [])
  assert.equal(document.snapshot.snapshotId, null)
  assert.equal(document.snapshot.continuity, 'first_observation')
})

test('bounds are explicit and an impossible budget is refused', { skip }, async () => {
  const dto = await served()
  const bounded = buildDisplayExport(dto, { maxRows: 2 })
  assert.equal(bounded.document.truncation.byRows, true)
  assert.equal(bounded.document.rows.length, 2)
  assert.equal(bounded.document.truncation.totalRows, dto.metrics.length)
  const full = Buffer.byteLength(buildDisplayExport(dto).text)
  const tightBytes = buildDisplayExport(dto, { maxBytes: Math.floor(full / 2) })
  assert.equal(tightBytes.document.truncation.byBytes, true)
  assert.ok(tightBytes.document.truncation.bytes <= Math.floor(full / 2))
  assert.throws(() => buildDisplayExport(dto, { maxBytes: 200 }), (error: unknown) =>
    error instanceof DisplayExportFault && error.code === 'display_export_too_large')
  const notADocument = { protocol: 'usage-observation/1', metrics: [] }
  assert.throws(() => buildDisplayExport(notADocument), (error: unknown) =>
    error instanceof DisplayExportFault && error.code === 'invalid_display_dto')
})

test('a re-read is declared as a new snapshot and never reuses earlier values', { skip }, async () => {
  const first = await served()
  const previous = { snapshotId: first.summaryId!, capturedAt: first.observedAt }
  const continued = buildDisplayExport(first, { previous })
  assert.equal(continued.document.snapshot.continuity, 'same_snapshot')
  assert.equal(continued.document.snapshot.note, null)

  // A later observation of the same scope has its own identity.
  const later = await new Promise<UsageObservation>(resolveLater => {
    const outcome = makeOutcome({
      seed: 'display-1', acceptance: 'accepted', projectId: 'one', durationMs: 4_000,
      contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
      observedAt: '2026-11-15T07:30:00.000Z',
    })
    resolveLater(new ProductUsageObservation({
      projectIds: () => ['one', 'two'],
      cursor: () => 2,
      listWorks: () => ({ works: [{ id: 'work-a', projectId: 'one' }], hasMore: false }),
      workEvidence: async workId => evidence(workId, [outcome]),
    }, () => '2026-11-15T08:00:00.000Z').read({ days: 7, timezone: 'UTC' }))
  })
  assert.notEqual(later.summaryId, first.summaryId)
  const replaced = buildDisplayExport(later, { previous })
  assert.equal(replaced.document.snapshot.continuity, 'new_snapshot')
  assert.match(replaced.document.snapshot.note ?? '', /not reused/)
  assert.deepEqual(replaced.document.snapshot.previous, previous)
  assert.equal(replaced.document.rows.some(row => row.formatted === '3000'), false,
    'the earlier observation contributes an identity, never a formatted value')
})

test('the export is a faithful copy: served text stays inert data', { skip }, async () => {
  const dto = await served()
  const label = 'CANARY-DISPLAY-1 <script>alert(1)</script>'
  const detail = '未知 1 · 完整 · controlled'
  const hostile: UsageObservation = {
    ...dto,
    metrics: dto.metrics.map((metric, index) => index === 0 ? { ...metric, label, detail } : metric),
  }
  const { text, document } = buildDisplayExport(hostile)
  // A download reproduces what the user saw; the strings are data, and the document is JSON, so no
  // markup or instruction can execute from it.
  assert.equal(document.rows[0]!.label, label)
  assert.equal(document.rows[0]!.detail, detail)
  assert.doesNotThrow(() => JSON.parse(text), 'the export is a single JSON document')
  assert.equal(JSON.stringify(document).includes('"value"'), false, 'still no numeric field')
  // A strict schema means no extra field (permission, principal, path) can be smuggled in.
  assert.deepEqual(Object.keys(document).sort(), [
    'authorization', 'crossCheck', 'exportedFrom', 'header', 'limitations', 'protocol',
    'rows', 'scope', 'snapshot', 'sourceIdentity', 'truncation', 'window',
  ])
})
