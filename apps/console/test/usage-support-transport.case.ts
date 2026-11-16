import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport } from '../src/transport.ts'
import { ProductUsageObservation } from '../../coordinator/product/usage-observation.ts'

test('support transport validates scope, strict metadata and digest, and keeps optional absence compatible', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const reader = new ProductUsageObservation({ projectIds: () => ['one'], cursor: () => 0,
    listWorks: () => ({ works: [], hasMore: false }), workEvidence: async () => { throw new Error('No work') } }, () => '2026-11-16T00:00:00.000Z')
  const value = await reader.support({ projectId: 'one' })
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/v1/insights/support?projectId=one&days=7&timezone=UTC')
    assert.ok(options?.signal); return new Response(JSON.stringify(value))
  }
  assert.deepEqual(await new HttpTransport().downloadUsageSupport({ projectId: 'one' }), value)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...value, sha256: '0'.repeat(64) }))
  await assert.rejects(new HttpTransport().downloadUsageSupport({ projectId: 'one' }))
  globalThis.fetch = async () => new Response(JSON.stringify(value))
  await assert.rejects(new HttpTransport().downloadUsageSupport({ projectId: 'foreign' }))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 404 })
  assert.equal(await new HttpTransport().downloadUsageSupport({}), undefined)
})
