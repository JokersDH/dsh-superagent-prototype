import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport, TransportError } from '../src/transport.ts'

const at = '2026-11-12T00:00:00.000Z'
const binding = { protocol: 'assistant-context-binding/1', messageId: 'message', commandId: 'command', requestId: 'request',
  projectId: 'project', conversationId: 'conversation', userTextDigest: 'a'.repeat(64),
  principal: { userId: 'user', authorityRef: 'authority' }, purpose: 'conversation_discussion',
  scope: { projectId: 'project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, selections: ['conversation'],
  bundleRef: 'bundle', bundleDigest: 'b'.repeat(64), sources: [{ sourceId: 'source', kind: 'conversation_message',
    sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: false }], confirmedAt: at, expiresAt: '2026-11-12T00:05:00.000Z' }
test('history transport binds project, conversation, work, count and opaque continuation without sending a command', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const input = { projectId: 'project', conversationId: 'conversation', workId: 'work', limit: 1, cursor: 'opaque.signed' }
  const page = { protocol: 'context-history/1', projectId: 'project', conversationId: 'conversation', workId: 'work',
    observedAt: at, entries: [], hasMore: false }
  let requested = ''
  globalThis.fetch = async (url, options) => {
    requested = String(url); assert.equal(options?.method, undefined)
    return new Response(JSON.stringify(page))
  }
  assert.deepEqual(await new HttpTransport().contextHistory(input), page)
  const query = new URL(requested, 'http://127.0.0.1').searchParams
  assert.equal(query.get('projectId'), 'project'); assert.equal(query.get('cursor'), input.cursor); assert.equal(query.get('limit'), '1')
  for (const change of [{ projectId: 'foreign' }, { conversationId: 'foreign' }, { workId: 'foreign' }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...page, ...change }))
    await assert.rejects(new HttpTransport().contextHistory(input), error => error instanceof TransportError && error.code === 'schema_mismatch')
  }
})
test('source transport refuses mismatched identities and content presented as unverified', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const view = { protocol: 'context-sources/1', observedAt: at, binding, state: 'missing', sources: [], omitted: [], injectionFlags: [] }
  globalThis.fetch = async () => new Response(JSON.stringify(view))
  assert.deepEqual(await new HttpTransport().contextSources('message'), view)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...view, binding: { ...binding, messageId: 'foreign' } }))
  await assert.rejects(new HttpTransport().contextSources('message'), error => error instanceof TransportError && error.code === 'schema_mismatch')
  globalThis.fetch = async () => new Response(JSON.stringify({ ...view, sources: [{ content: 'unverified' }] }))
  await assert.rejects(new HttpTransport().contextSources('message'))
})
test('source transport preserves optional absence but never hides authentication or server integrity errors', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 404 })
  assert.equal(await new HttpTransport().contextSources('message'), undefined)
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'unsupported_capability' } }), { status: 422 })
  assert.equal(await new HttpTransport().contextSources('message'), undefined)
  for (const code of ['auth_required', 'storage_unavailable']) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code } }), { status: code === 'auth_required' ? 401 : 503 })
    await assert.rejects(new HttpTransport().contextSources('message'), error => error instanceof TransportError && error.code === code)
  }
})
test('source diagnostics require explicit opt-in and retain the authoritative source schema', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const plain = { protocol: 'context-sources/1', observedAt: at, binding, state: 'scope_changed', sources: [], omitted: [], injectionFlags: [] }
  const scopeReview = { protocol: 'context-scope-review/1', reasons: ['selection_narrowed'], partial: true, withheldSourceCount: 1, authorization: 'none' }
  const requests: string[] = []
  globalThis.fetch = async (url, options) => {
    requests.push(String(url)); assert.equal(options?.method, undefined); assert.ok(options?.signal)
    return new Response(JSON.stringify(String(url).includes('?') ? { ...plain, scopeReview } : plain))
  }
  const client = new HttpTransport()
  assert.deepEqual(await client.contextSources('message'), plain)
  assert.equal(new URL(requests[0]!, 'http://127.0.0.1').search, '')
  assert.deepEqual((await client.contextSources('message', { scopeReview: true }))?.scopeReview, scopeReview)
  assert.equal(new URL(requests[1]!, 'http://127.0.0.1').search, '?scopeReview=1')
  for (const changed of [{ withheldSourceCount: -1 }, { withheldSourceCount: 0 }, { authorization: 'granted' }, { reasons: ['unknown'] }, { partial: false }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...plain, scopeReview: { ...scopeReview, ...changed } }))
    await assert.rejects(client.contextSources('message', { scopeReview: true }))
  }
})
