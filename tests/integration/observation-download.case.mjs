import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../apps/coordinator/product/usage-observation.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { UsageObservationDownloadSchema } from '../../packages/contracts/dist/index.js'
const at = '2026-11-15T08:00:00.000Z', token = 'a'.repeat(64)
const evidence = id => ({ protocol: 'work-evidence/1', workId: id, projection: 'not_accepted', truncated: false, outcomes: [],
  entries: [{ at: '2026-11-15T07:00:00.000Z', kind: 'question.opened', sourceRef: id, detail: { raw: 'source-secret-canary' } }] })
const reader = () => new ProductUsageObservation({ projectIds: () => ['one', 'two'], cursor: () => 1,
  listWorks: projects => ({ works: projects.map(id => ({ id: `work-${id}`, projectId: id })), hasMore: false }),
  workEvidence: async id => evidence(id) }, () => at)
const http = read => createLocalHttpApp({ application: {}, principal: { userId: 'export-user', authorityRef: 'export-authority' },
  apiToken: token, bootstrapToken: 'b'.repeat(64), mode: 'personal', allowedOrigins: ['http://127.0.0.1:4100'],
  read: { usageObservationDownload: read ?? (query => reader().download(query)) } })
const get = (app, query = '', headers = { authorization: `Bearer ${token}` }) => app.request(`http://127.0.0.1/v1/insights/export${query}`, { headers })
test('actual authenticated export preserves one fresh authorized display snapshot and hashes exact JSON bytes', async () => {
  const response = await get(http(), '?projectId=one&days=30&timezone=Asia%2FShanghai')
  const payload = UsageObservationDownloadSchema.parse(await response.json()), document = JSON.parse(payload.text)
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(document.scope.projectIds, ['one']); assert.equal(document.exportedFrom.days, 30)
  assert.equal(document.exportedFrom.timezone, 'Asia/Shanghai'); assert.equal(document.snapshot.snapshotId, payload.observation.summaryId)
  assert.equal(document.exportedFrom.observedAt, at); assert.equal(document.sourceIdentity.numericValues, false)
  assert.equal(document.rows.find(row => row.rowId.startsWith('interventions.questions@')).formatted, '1')
  assert.ok(document.rows.every(row => !Object.hasOwn(row, 'value')))
  assert.equal(payload.sha256, createHash('sha256').update(payload.text).digest('hex'))
  assert.equal(document.truncation.bytes, Buffer.byteLength(payload.text)); assert.ok(Buffer.byteLength(payload.text) <= 65536)
  assert.doesNotMatch(payload.text, /source-secret-canary|sourceRef|work-one|export-authority/)
})
test('export authenticates and rejects injected or ambiguous query scope before returning any file', async () => {
  assert.equal((await get(http(), '', {})).status, 401)
  assert.equal((await get(http(), '', { authorization: `Bearer ${token}`, origin: 'https://foreign.invalid' })).status, 403)
  for (const query of ['?projectId=foreign', '?days=14', '?projectId=one&projectId=two', '?timezone=invalid-zone', '?file=/private', '?grant=true'])
    assert.ok((await get(http(), query)).status >= 400, query)
  const wrong = http(() => reader().download({ projectId: 'two' }))
  assert.equal((await get(wrong, '?projectId=one')).status, 503)
})
test('missing observations cannot be exported as a fabricated empty snapshot and malformed documents refuse', async () => {
  const missing = new ProductUsageObservation({ projectIds: () => [], cursor: () => 0,
    listWorks: () => { throw new Error('Must not list') }, workEvidence: async () => { throw new Error('Must not read') } })
  await assert.rejects(missing.download({}), error => error.error.code === 'unsupported_capability')
  const correct = await reader().download({ projectId: 'one' })
  for (const text of ['null', '[]', '{broken', JSON.stringify({ ...JSON.parse(correct.text), authorization: 'granted' }),
    JSON.stringify({ ...JSON.parse(correct.text), rows: [null] })])
    assert.equal(UsageObservationDownloadSchema.safeParse({ ...correct, text }).success, false)
})
test('download refuses injected metadata, contradictory rows or coverage and hidden truncation', async () => {
  const correct = await reader().download({ projectId: 'one' })
  assert.equal(UsageObservationDownloadSchema.safeParse(correct).success, true)
  for (const mutate of [
    document => { document.rawSource = 'private-canary' },
    document => { document.rows[0].value = 1 },
    document => { document.rows[0].unit = 'USD' },
    document => { document.rows[0].layer = 'native' },
    document => { document.rows[0].sampleCount = 999 },
    document => { document.rows[0].detail = 'different source' },
    document => { document.header.coverage = 'complete' },
    document => { document.snapshot.capturedAt = '2099-01-01T00:00:00.000Z' },
    document => { document.rows = [] },
    document => { document.rows = []; document.truncation.includedRows = 0; document.truncation.byBytes = true },
  ]) {
    const document = JSON.parse(correct.text); mutate(document)
    let text
    for (let attempt = 0; attempt < 5; attempt++) {
      text = JSON.stringify(document, null, 2) + '\n'
      const bytes = Buffer.byteLength(text)
      if (bytes === document.truncation.bytes) break
      document.truncation.bytes = bytes
    }
    assert.equal(UsageObservationDownloadSchema.safeParse({ ...correct, text, sha256: createHash('sha256').update(text).digest('hex') }).success, false)
  }
  const wrongBytes = JSON.parse(correct.text); wrongBytes.truncation.bytes = 1
  assert.equal(UsageObservationDownloadSchema.safeParse({ ...correct, text: JSON.stringify(wrongBytes) }).success, false)
  assert.equal(UsageObservationDownloadSchema.safeParse({ ...correct, fileName: `observation-30d-${'f'.repeat(12)}.json` }).success, false)
})
