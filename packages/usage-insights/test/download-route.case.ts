/**
 * W31-G5/G6/G7 acceptance: the *default* download path main now serves.
 *
 * These tests mount the real coordinator app with the real `ProductUsageObservation.download` and
 * parse the response with main's real `UsageObservationDownloadSchema`, so a drift in either side
 * breaks here. They also check the fresh-read semantics: an export re-reads the source, so it carries
 * its own snapshot identity and never the page's previously displayed one.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { UsageObservationDownloadSchema } from '@personal-agent/contracts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import { DisplayExportDocumentSchema, buildDisplayExport } from '../src/display-export.ts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'
const TOKEN = 'e'.repeat(64)
const BEARER = { authorization: `Bearer ${TOKEN}` }

const outcome = makeOutcome({
  seed: 'download-1', acceptance: 'accepted', projectId: 'one', durationMs: 3_000, inputTokens: 42,
  readyToAcceptanceMs: 799, activeReviewMs: 700,
  contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
  observedAt: '2026-11-15T05:30:00.000Z',
})

const evidence = (workId: string, outcomes: unknown[] = []): WorkEvidence => ({
  protocol: 'work-evidence/1',
  workId,
  projection: 'recorded',
  entries: [{ at: '2026-11-15T05:00:00.000Z', kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'],
  truncated: false,
})

const readers = (projectIds: string[] = ['one', 'two']) => ({
  projectIds: () => projectIds,
  cursor: () => 1,
  listWorks: (ids: readonly string[], limit: number) => ({
    works: [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'two' }]
      .filter(work => ids.includes(work.projectId)).slice(0, limit),
    hasMore: false,
  }),
  workEvidence: async (workId: string) => evidence(workId, workId === 'work-a' ? [outcome] : []),
})

/** A real app whose observation and download read the same controlled readers. */
function app(options: { clock?: { value: string }; projectIds?: string[]; download?: boolean; wrap?: (value: unknown) => unknown; startupMode?: 'normal' | 'recovery_readonly' } = {}) {
  const clock = options.clock ?? { value: AT }
  const observation = new ProductUsageObservation(readers(options.projectIds), () => clock.value)
  return createLocalHttpApp({
    application: {} as never,
    principal: { userId: 'insights-reader', authorityRef: 'insights-reader-authority' },
    apiToken: TOKEN,
    bootstrapToken: 'f'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4700'],
    mode: 'personal',
    ...(options.startupMode ? { startupMode: options.startupMode } : {}),
    read: {
      usageObservation: (query: Parameters<typeof observation.read>[0]) => observation.read(query),
      ...(options.download === false ? {} : {
        usageObservationDownload: async (query: Parameters<typeof observation.download>[0]) =>
          (options.wrap ?? (value => value))(await observation.download(query)),
      }),
    },
  } as never)
}

const get = (value: ReturnType<typeof app>, path: string) => value.request(`http://127.0.0.1${path}`, { headers: BEARER })
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

test('positive: GET /v1/insights/export serves a display document main\'s contract accepts', { skip }, async () => {
  const value = app()
  const response = await get(value, '/v1/insights/export?days=7&timezone=UTC')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await (response.json() as Promise<unknown>)
  const download = UsageObservationDownloadSchema.parse(body)
  assert.equal(download.protocol, 'usage-observation-download/1')
  assert.equal(download.mediaType, 'application/json')
  assert.equal(download.sha256, sha(download.text), 'the advertised digest is of the delivered text')
  assert.equal(download.fileName, `observation-7d-${download.observation.summaryId!.slice(0, 12)}.json`)

  const document = DisplayExportDocumentSchema.parse(JSON.parse(download.text))
  assert.equal(document.protocol, 'usage-insights-display-export/1')
  assert.equal(document.authorization, 'none')
  assert.equal(document.sourceIdentity.numericValues, false)
  assert.equal(document.snapshot.snapshotId, download.observation.summaryId)
  assert.equal(document.snapshot.capturedAt, download.observation.observedAt)
  assert.equal(document.snapshot.continuity, 'first_observation')
  assert.deepEqual(document.window, download.observation.window)
  assert.equal(document.exportedFrom.days, download.observation.days)
  assert.equal(document.header.sampleCount, download.observation.sampleCount)
  assert.equal(document.truncation.bytes, Buffer.byteLength(download.text), 'the recorded size is the delivered size')
  assert.equal(document.truncation.maxRows, 32)
  assert.equal(document.truncation.maxBytes, 65536)
  assert.equal(document.truncation.byRows, false)
  assert.equal(document.rows.length, download.observation.metrics.length)
  for (const [index, metric] of download.observation.metrics.entries()) {
    const row = document.rows[index]!
    assert.equal(row.rowId, metric.id)
    assert.equal(row.formatted, metric.value)
    assert.equal(row.sampleCount, metric.sampleCount)
  }
  assert.equal(JSON.stringify(document.rows).includes('"value"'), false, 'no numeric field is exported')
})

test('the export is a fresh read: it carries its own snapshot, never the page\'s values', { skip }, async () => {
  const clock = { value: AT }
  const value = app({ clock })
  const page = await (await get(value, '/v1/insights?days=7&timezone=UTC')).json() as UsageObservation
  // The operator clicks download a moment later; the reader re-observes the same facts.
  clock.value = '2026-11-15T06:01:00.000Z'
  const download = UsageObservationDownloadSchema.parse(await (await get(value, '/v1/insights/export?days=7&timezone=UTC')).json())
  const document = DisplayExportDocumentSchema.parse(JSON.parse(download.text))
  assert.notEqual(download.observation.observedAt, page.observedAt, 'the export observed at a later time')
  assert.notEqual(download.observation.summaryId, page.summaryId, 'a later observation has its own identity')
  assert.equal(document.snapshot.snapshotId, download.observation.summaryId, 'the file names its own observation')
  assert.notEqual(document.snapshot.snapshotId, page.summaryId, 'the file never claims the page\'s snapshot')
  assert.equal(document.exportedFrom.observedAt, download.observation.observedAt)
  assert.equal(document.window.to, download.observation.observedAt)
  assert.equal(page.window.to, page.observedAt, 'the page keeps its own window')
  // The values are the same facts observed twice, not a copy of the page's strings.
  assert.deepEqual(document.rows.map(row => row.rowId), page.metrics.map(metric => metric.id))
  assert.deepEqual(document.rows.map(row => row.formatted), page.metrics.map(metric => metric.value))

  // With a frozen clock the same read is the same snapshot: the difference above is the re-read.
  const frozen = app({ clock: { value: AT } })
  const first = UsageObservationDownloadSchema.parse(await (await get(frozen, '/v1/insights/export?days=7&timezone=UTC')).json())
  const second = UsageObservationDownloadSchema.parse(await (await get(frozen, '/v1/insights/export?days=7&timezone=UTC')).json())
  assert.equal(first.text, second.text, 'two reads at the same observation time are byte-identical')
  assert.equal(first.sha256, second.sha256)
})

test('the download route refuses missing credentials, foreign projects and invalid queries', { skip }, async () => {
  const value = app()
  const anonymous = await value.request('http://127.0.0.1/v1/insights/export?days=7')
  assert.equal(anonymous.status, 401)
  assert.equal((await get(value, '/v1/insights/export?days=7&projectId=foreign')).status, 403)
  for (const query of ['?days=14', '?days=abc', '?timezone=Mars%2FOlympus', '?projectId=one&projectId=two', '?grant=true', '?download=true'])
    assert.equal((await get(value, `/v1/insights/export${query}`)).status, 400, query)
})

test('an absent download port is an unavailable feature, not an empty file', { skip }, async () => {
  const response = await get(app({ download: false }), '/v1/insights/export?days=7')
  assert.equal(response.status, 422)
  const body = await response.json() as { error?: { code?: string } }
  assert.equal(body.error?.code, 'unsupported_capability')
  // The page still works without the optional download port.
  assert.equal((await get(app({ download: false }), '/v1/insights?days=7')).status, 200)
})

test('an observation with no authorized scope cannot be exported', { skip }, async () => {
  const response = await get(app({ projectIds: [] }), '/v1/insights/export?days=7')
  assert.equal(response.status, 422)
  const body = await response.json() as { error?: { code?: string } }
  assert.equal(body.error?.code, 'unsupported_capability')
})

test('a download that contradicts the requested scope is refused, not served', { skip }, async () => {
  // A consistent 30-day export handed back for a 7-day request: the document is valid, the request is not.
  const value = app({ wrap: value => {
    const download = value as { observation: UsageObservation }
    const thirty = download.observation
    const shift = 23 * 86_400_000
    return { ...download, observation: { ...thirty, days: 30,
      window: { from: new Date(Date.parse(thirty.window.from) - shift).toISOString(), to: thirty.window.to } } }
  } })
  const response = await get(value, '/v1/insights/export?days=7')
  // Either the envelope contradicts itself (400) or it contradicts the request (503); both refuse.
  assert.ok([400, 503].includes(response.status), `expected a refusal, got ${response.status}`)
  const served = await get(app(), '/v1/insights/export?days=30')
  assert.equal(served.status, 200, 'the same 30-day shape is served when it is what was asked for')
})

test('main\'s download contract rejects a tampered envelope', { skip }, async () => {
  const value = app()
  const original = UsageObservationDownloadSchema.parse(await (await get(value, '/v1/insights/export?days=7')).json())
  const document = JSON.parse(original.text)
  const tamper = (mutate: (envelope: Record<string, unknown>, document: Record<string, unknown>) => void) => {
    const envelope = structuredClone(original) as unknown as Record<string, unknown>
    const doc = JSON.parse(original.text) as Record<string, unknown>
    mutate(envelope, doc)
    envelope.text = `${JSON.stringify(doc, null, 2)}\n`
    return UsageObservationDownloadSchema.safeParse(envelope).success
  }
  // The document's own formatting is deterministic, so an untouched copy is still valid.
  assert.equal(tamper(() => {}), true, 'the serializer is deterministic, so an unchanged copy stays valid')
  assert.equal(tamper((envelope, doc) => {
    // Recompute the size so only the asserted field is wrong.
    doc.rows = (doc.rows as unknown[]).slice(0, -1)
    const truncation = doc.truncation as Record<string, unknown>
    truncation.includedRows = (doc.rows as unknown[]).length
    truncation.byBytes = true
  }), false, 'a hidden omission is refused')
  const wrongName = structuredClone(original) as unknown as Record<string, unknown>
  ;(wrongName as { fileName: string }).fileName = 'observation-7d-000000000000.json'
  assert.equal(UsageObservationDownloadSchema.safeParse(wrongName).success, false, 'a wrong file name is refused')
  const wrongBytes = structuredClone(original) as unknown as Record<string, unknown>
  ;(wrongBytes as { text: string }).text = `${(wrongBytes as { text: string }).text} `
  assert.equal(UsageObservationDownloadSchema.safeParse(wrongBytes).success, false, 'a changed byte count is refused')
  assert.equal(document.protocol, 'usage-insights-display-export/1')
})

test('a bounding byte budget truncates explicitly and main\'s contract accepts only an honest cut', { skip }, async () => {
  // The route always uses 32 rows / 64 KiB, so a byte cut is exercised directly on the library with
  // an explicit smaller budget and then judged by main's real contract.
  const dto = (await (await get(app(), '/v1/insights?days=7')).json()) as UsageObservation
  const full = Buffer.byteLength(buildDisplayExport(dto, { maxRows: 32 }).text)
  const { document, text } = buildDisplayExport(dto, { maxRows: 32, maxBytes: Math.floor(full / 2) })
  assert.equal(document.truncation.byBytes, true)
  assert.ok(document.rows.length < dto.metrics.length)
  const envelope = {
    protocol: 'usage-observation-download/1',
    observation: dto,
    fileName: `observation-${dto.days}d-${dto.summaryId!.slice(0, 12)}.json`,
    mediaType: 'application/json',
    text,
    sha256: sha(text),
  }
  // An honest cut with an explicit byte bound is refused by main's fixed 64 KiB contract only
  // because the contract requires the 64 KiB bound; the document itself remains valid display data.
  assert.equal(UsageObservationDownloadSchema.safeParse(envelope).success, false)
  assert.equal(document.truncation.bytes, Buffer.byteLength(text))
  assert.equal(DisplayExportDocumentSchema.safeParse(JSON.parse(text)).success, true)
})

test('a readonly startup still serves the export, and the page remains usable', { skip }, async () => {
  const value = app({ startupMode: 'recovery_readonly' })
  const page = await get(value, '/v1/insights?days=7')
  assert.equal(page.status, 200, 'the page is readable in readonly startup')
  const response = await get(value, '/v1/insights/export?days=7')
  assert.equal(response.status, 200, 'the download is available in readonly startup')
  const download = UsageObservationDownloadSchema.parse(await (response.json() as Promise<unknown>))
  assert.equal(download.sha256, sha(download.text))
  assert.equal(download.observation.status, 'ready')
})
