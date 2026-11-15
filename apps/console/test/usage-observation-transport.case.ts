import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport, TransportError } from '../src/transport.ts'

const view = { protocol: 'usage-observation/1', observedAt: '2026-11-14T04:00:00.000Z',
  window: { from: '2026-11-07T04:00:00.000Z', to: '2026-11-14T04:00:00.000Z' }, days: 7, timezone: 'UTC',
  windowLabel: '最近7天', status: 'ready', summaryId: 'a'.repeat(64), coverage: '部分覆盖', coverageState: 'partial',
  scope: { projectIds: ['one'], aggregation: 'single_project', label: '当前项目' }, sampleCount: 1, unknownCount: null,
  metrics: [{ id: 'usage', label: '输入', value: null, detail: '未知1', unit: 'tokens', layer: 'controlled', sampleCount: 0 }],
  limitations: [], authorization: 'none' }
test('usage transport uses one bounded abortable GET and binds response scope and window', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/v1/insights?projectId=one&days=7&timezone=UTC')
    assert.equal(options?.method, undefined); assert.ok(options?.signal)
    return new Response(JSON.stringify(view))
  }
  assert.deepEqual(await new HttpTransport().usageObservation({ projectId: 'one' }, controller.signal), view)
  for (const update of [{ scope: { ...view.scope, projectIds: ['two'] } }, { authorization: 'granted' }, { days: 30 }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...view, ...update }))
    await assert.rejects(new HttpTransport().usageObservation({ projectId: 'one' }))
  }
})
test('legacy absence stays optional while authentication and server errors are preserved', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  for (const status of [404, 422]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: status === 404 ? 'invalid_request' : 'unsupported_capability' } }), { status })
    assert.equal(await new HttpTransport().usageObservation({}), undefined)
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'auth_required' } }), { status: 401 })
  await assert.rejects(new HttpTransport().usageObservation({}), error => error instanceof TransportError && error.code === 'auth_required')
})
