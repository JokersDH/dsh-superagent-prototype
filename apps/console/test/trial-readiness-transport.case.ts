import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport, TransportError } from '../src/transport.ts'

const view = { protocol: 'trial-readiness/1', observedAt: '2026-11-14T04:00:00.000Z', configurationRevision: 'a'.repeat(64),
  mode: 'personal', startupMode: 'normal', discussion: 'unknown', execution: { state: 'unknown' }, development: 'unknown',
  projects: { development: 0, discussion: 1, dispatchable: 0 }, profiles: { native: 0, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false }, authorization: 'none' }
test('readiness transport performs one bounded readonly GET with no execution or scope query', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(String(url), '/v1/readiness'); assert.equal(options?.method, undefined); assert.ok(options?.signal)
    return new Response(JSON.stringify(view))
  }
  assert.deepEqual(await new HttpTransport().readiness(), view); assert.equal(calls, 1)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...view, authorization: 'granted' }))
  await assert.rejects(new HttpTransport().readiness())
})
test('unavailable readiness is optional, while authentication and integrity errors remain visible', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const status of [404, 422]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: status === 404 ? 'invalid_request' : 'unsupported_capability' } }), { status })
    assert.equal(await new HttpTransport().readiness(), undefined)
  }
  for (const [status, code] of [[401, 'auth_required'], [503, 'storage_unavailable']] as const) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code } }), { status })
    await assert.rejects(new HttpTransport().readiness(), error => error instanceof TransportError && error.code === code)
  }
})
