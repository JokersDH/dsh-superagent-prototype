import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpTransport, TransportError } from '../src/transport.ts'

const input = { commandId: 'context-command', text: 'Original message', context: { projectId: 'project', conversationId: 'conversation',
  selections: ['conversation' as const], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } }
const prepared = { protocol: 'assistant-context-prepared/1', commandId: input.commandId, text: input.text, token: `${'a'.repeat(16)}.${'b'.repeat(16)}`,
  expiresAt: '2026-11-11T12:05:00.000Z', preview: { protocol: 'context-preview/1', requestId: 'context-preview', projectId: 'project', conversationId: 'conversation',
    observedAt: '2026-11-11T12:00:00.000Z', expiresAt: '2026-11-11T12:05:00.000Z', status: 'sufficient', trust: 'untrusted_data', selections: ['conversation'],
    sources: [{ sourceId: 'source', kind: 'conversation_message', title: 'Message', path: 'messages/source.json', content: 'data', sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), bytes: 4, estimatedTokens: 1, truncated: false }],
    groups: [], omitted: [], injectionFlags: [], issues: [], budgetClamped: [], budget: input.context.budget, totals: { files: 1, bytes: 4, tokens: 1 } } }

test('context message prepare preserves exact text and rejects misbound response identities', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let sent: unknown
  globalThis.fetch = async (_url, options) => { sent = JSON.parse(String(options?.body)); return new Response(JSON.stringify(prepared)) }
  assert.deepEqual(await new HttpTransport().prepareAssistantContext(input), prepared)
  assert.deepEqual(sent, input)
  for (const mismatch of [{ commandId: 'foreign' }, { text: 'changed' }, { preview: { ...prepared.preview, conversationId: 'foreign' } },
    { preview: { ...prepared.preview, projectId: 'foreign' } }, { preview: { ...prepared.preview, selections: ['project'], sources: [{ ...prepared.preview.sources[0], kind: 'project_metadata' }] } }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...prepared, ...mismatch }))
    await assert.rejects(new HttpTransport().prepareAssistantContext(input), error => error instanceof TransportError && error.code === 'schema_mismatch')
  }
})

test('a matching rejected receipt settles the original context command while bare errors and foreign receipts do not', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const command = { commandId: input.commandId, token: prepared.token }
  const receipt = { commandId: input.commandId, seq: 2, status: 'rejected', error: { code: 'stale_contract', message: 'Source changed', retry: 'user_action' } }
  let sent: unknown
  globalThis.fetch = async (_url, options) => { sent = JSON.parse(String(options?.body)); return new Response(JSON.stringify(receipt), { status: 409 }) }
  assert.deepEqual(await new HttpTransport().sendAssistantContext(command), receipt)
  assert.deepEqual(sent, command)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...receipt, commandId: 'foreign' }), { status: 409 })
  await assert.rejects(new HttpTransport().sendAssistantContext(command), error => error instanceof TransportError && error.code === 'schema_mismatch')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: receipt.error }), { status: 409 })
  await assert.rejects(new HttpTransport().sendAssistantContext(command), error => error instanceof TransportError && error.code === 'stale_contract')
})

test('context audit has a precise optional404 path without swallowing authentication or malformed data', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let requested = ''
  globalThis.fetch = async url => { requested = String(url); return new Response(JSON.stringify({ error: { code: 'invalid_request' } }), { status: 404 }) }
  assert.equal(await new HttpTransport().assistantContext('message:one'), undefined)
  assert.equal(requested, '/v1/messages/message%3Aone/context')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Login', retry: 'user_action' } }), { status: 401 })
  await assert.rejects(new HttpTransport().assistantContext('message:one'), error => error instanceof TransportError && error.code === 'auth_required')
  globalThis.fetch = async () => new Response('{}')
  await assert.rejects(new HttpTransport().assistantContext('message:one'))
})
