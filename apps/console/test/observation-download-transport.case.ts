import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { HttpTransport } from '../src/transport.ts'
import { buildDisplayExport } from '../../../packages/usage-insights/src/display-export.ts'
const observation = { protocol: 'usage-observation/1', observedAt: '2026-11-15T00:00:00.000Z',
  window: { from: '2026-11-08T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }, days: 7, timezone: 'UTC',
  windowLabel: '近7天', status: 'ready', summaryId: 'a'.repeat(64), coverage: '完整', coverageState: 'complete',
  scope: { projectIds: ['one'], aggregation: 'single_project', label: '当前项目' }, sampleCount: 1, unknownCount: null,
  metrics: [{ id: 'count', label: '记录', value: '1', detail: '完整', unit: '', layer: 'observed', sampleCount: 1 }], limitations: [], authorization: 'none' }
test('download transport verifies current selection, bounded JSON and exact digest, with optional legacy fallback', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const { text } = buildDisplayExport(observation, { maxRows: 32, maxBytes: 65536 }), body = { protocol: 'usage-observation-download/1', observation,
    fileName: `observation-7d-${'a'.repeat(12)}.json`, mediaType: 'application/json', text,
    sha256: createHash('sha256').update(text).digest('hex') }
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/v1/insights/export?projectId=one&days=7&timezone=UTC'); assert.equal(options?.method, undefined)
    assert.ok(options?.signal); return new Response(JSON.stringify(body))
  }
  assert.deepEqual(await new HttpTransport().downloadUsageObservation({ projectId: 'one' }), body)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...body, sha256: '0'.repeat(64) }))
  await assert.rejects(new HttpTransport().downloadUsageObservation({ projectId: 'one' }))
  globalThis.fetch = async () => new Response(JSON.stringify(body))
  await assert.rejects(new HttpTransport().downloadUsageObservation({ projectId: 'foreign' }))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 404 })
  assert.equal(await new HttpTransport().downloadUsageObservation({}), undefined)
})
