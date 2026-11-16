import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../apps/coordinator/product/usage-observation.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { UsageSupportDownloadSchema } from '../../packages/contracts/dist/index.js'
import { readSupportFile } from '../../packages/usage-insights/src/support-port.ts'
const at = '2026-11-16T06:00:00.000Z', token = 'a'.repeat(64)
const reader = () => new ProductUsageObservation({ projectIds: () => ['one', 'two'], cursor: () => 1,
  listWorks: ids => ({ works: ids.map(id => ({ id: `work-${id}`, projectId: id })), hasMore: false }),
  workEvidence: async id => ({ protocol: 'work-evidence/1', workId: id, projection: 'not_accepted', truncated: false,
    outcomes: [], entries: [{ at: '2026-11-16T05:00:00.000Z', kind: 'question.opened', sourceRef: id,
      detail: { secret: 'raw-private-canary' } }] }) }, () => at)
const http = (read, startupMode = 'normal') => createLocalHttpApp({ application: {},
  principal: { userId: 'support-user', authorityRef: 'support-authority' }, apiToken: token,
  bootstrapToken: 'b'.repeat(64), mode: 'personal', startupMode, allowedOrigins: ['http://127.0.0.1:4100'],
  read: { usageSupportDownload: read ?? (query => reader().support(query)) } })
const get = (app, query = '', headers = { authorization: `Bearer ${token}` }) => app.request(`http://127.0.0.1/v1/insights/support${query}`, { headers })

test('authenticated support downloads a fresh bounded metadata-only report independently consumed by G', async () => {
  const response = await get(http(), '?projectId=one&days=30&timezone=Asia%2FShanghai')
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const value = UsageSupportDownloadSchema.parse(await response.json()), file = JSON.parse(value.text)
  assert.equal(value.bytes, Buffer.byteLength(value.text)); assert.ok(value.bytes <= 65536)
  assert.equal(value.sha256, createHash('sha256').update(value.text).digest('hex'))
  assert.equal(value.report.days, 30); assert.deepEqual(value.report.scope.projectIds, ['one'])
  assert.equal(value.report.origin, null); assert.equal(value.report.exportCapability, 'unverified')
  assert.equal(value.report.numericValues, false); assert.equal(value.report.authorization, 'none')
  assert.ok(value.report.rows.length > 0)
  assert.deepEqual(readSupportFile(file).report, value.report)
  for (const row of value.report.rows) for (const field of ['value', 'formatted', 'label', 'detail']) assert.equal(field in row, false)
  assert.doesNotMatch(value.text, /raw-private-canary|sourceRef|work-one|support-authority/)
})

test('support authenticates, binds current scope and works under readonly without business writes', async () => {
  assert.equal((await get(http(), '', {})).status, 401)
  assert.equal((await get(http(), '', { authorization: `Bearer ${token}`, origin: 'https://foreign.invalid' })).status, 403)
  for (const query of ['?projectId=foreign', '?projectId=one&projectId=two', '?days=14', '?timezone=invalid', '?manifest=/private', '?origin=claimed'])
    assert.ok((await get(http(), query)).status >= 400, query)
  assert.equal((await get(http(() => reader().support({ projectId: 'two' })), '?projectId=one')).status, 503)
  assert.equal((await get(http(undefined, 'recovery_readonly'), '?projectId=one')).status, 200)
})

test('support normalizes free text, retains unknown values and refuses added output content even with a fresh digest', async () => {
  const product = reader(), read = product.read.bind(product)
  product.read = async input => {
    const dto = await read(input)
    return { ...dto, coverage: 'private-canary-coverage', limitations: ['private-canary-note'],
      scope: { ...dto.scope, label: '/private/canary-path' }, metrics: dto.metrics.map(metric => ({ ...metric,
        label: 'private-canary-label', detail: 'private-canary-detail', value: metric.value === null ? null : 'private-canary-value' })) }
  }
  const correct = await product.support({ projectId: 'one' })
  assert.doesNotMatch(correct.text, /private-canary|canary-path/)
  assert.equal(correct.report.counts.unknown, correct.report.rows.filter(row => !row.hasValue).length)
  for (const mutate of [
    report => { report.rows[0].value = 'private-canary' },
    report => { report.rows[0].label = 'private-canary' },
    report => { report.rawEvidence = 'private-canary' },
    report => { report.counts.withValue += 1 },
    report => { report.authorization = 'granted' },
    report => { report.note = '/private/canary' },
  ]) {
    const report = structuredClone(correct.report); mutate(report)
    const text = JSON.stringify({ protocol: 'usage-insights-support/1', report }, null, 2) + '\n'
    assert.equal(UsageSupportDownloadSchema.safeParse({ ...correct, report, text, bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex') }).success, false)
  }
})

test('a projectless observation exports explicit unavailable metadata instead of a fabricated ready snapshot', async () => {
  const empty = new ProductUsageObservation({ projectIds: () => [], cursor: () => 0,
    listWorks: () => { throw new Error('No collection') }, workEvidence: async () => { throw new Error('No reads') } }, () => at)
  const value = UsageSupportDownloadSchema.parse(await empty.support({}))
  assert.equal(value.report.status, 'unavailable'); assert.equal(value.report.summaryId, null)
  assert.deepEqual(value.report.rows, []); assert.equal(value.report.counts.sampleCount, null)
})
