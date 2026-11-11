import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport, TransportError } from '../src/transport.ts'

test('evidence reads encode work identity, bound queries and reject another work', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const page = { protocol: 'work-evidence-history/1', workId: 'work:one', contract: { workId: 'work:one', revision: 1, digest: 'a'.repeat(64) },
    observedAt: '2026-11-11T00:00:00.000Z', entries: [], hasMore: false, window: 'complete', sourcesCapped: [] }
  let requested = ''
  globalThis.fetch = async input => { requested = String(input); return new Response(JSON.stringify(page)) }
  assert.deepEqual(await new HttpTransport().workEvidenceHistory('work:one', { limit: 20 }), page)
  assert.equal(requested, '/v1/works/work%3Aone/evidence/history?limit=20')
  await assert.rejects(new HttpTransport().workEvidenceHistory('work:other', {}), error => error instanceof TransportError && error.code === 'schema_mismatch')
  await assert.rejects(new HttpTransport().workEvidenceHistory('work:one', { limit: 101 }))
  globalThis.fetch = async () => new Response(JSON.stringify({ protocol: 'work-evidence/1', workId: 'foreign-work', projection: 'not_accepted', entries: [], outcomes: [], truncated: false }))
  await assert.rejects(new HttpTransport().workEvidence('work:one'), error => error instanceof TransportError && error.code === 'schema_mismatch')
})

test('missing optional history degrades without swallowing auth or malformed evidence', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response('Not found', { status: 404 })
  assert.equal(await new HttpTransport().workEvidenceHistory('work-one', {}), undefined)
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'unsupported_capability', message: 'Missing', retry: 'none' } }), { status: 422 })
  assert.equal(await new HttpTransport().workEvidence('work-one'), undefined)
  globalThis.fetch = async () => new Response('{}')
  await assert.rejects(new HttpTransport().workEvidence('work-one'))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Sign in', retry: 'user_action' } }), { status: 401 })
  await assert.rejects(new HttpTransport().workEvidenceHistory('work-one', {}), error => error instanceof TransportError && error.code === 'auth_required')
})
