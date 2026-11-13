import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssistantCandidatePrepare } from '@personal-agent/contracts'
import { HttpTransport, TransportError } from '../src/transport.ts'

const input = { messageId: 'candidate-message', index: 0, payloadDigest: 'a'.repeat(64) }
const scope = { projectId: 'candidate-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const preview = { protocol: 'proposal-preview/1', record: { proposalId: 'proposal', version: 1, state: 'pending',
  projectId: scope.projectId, conversationId: 'candidate-conversation', sourceMessageId: input.messageId,
  sourceTextDigest: 'b'.repeat(64), actorRef: 'authority', grantId: 'grant', grantScope: scope,
  payload: { kind: 'propose_decision', content: 'Keep the original error code', scope, sourceMessageId: input.messageId },
  payloadDigest: input.payloadDigest, createdAt: '2026-11-13T00:00:00.000Z', updatedAt: '2026-11-13T00:00:00.000Z', expiresAt: '2026-11-13T00:05:00.000Z' },
  requiredInputs: [], expiresAt: '2026-11-13T00:05:00.000Z', token: 'signedpreview.signature' }
test('candidate transport reads the selected source and refuses identity or authority substitutions', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const view = { protocol: 'assistant-candidates/1', messageId: input.messageId, replyMessageId: 'reply', projectId: scope.projectId,
    conversationId: 'candidate-conversation', status: 'none', candidates: [], rejected: [], trust: 'untrusted_data', authorization: 'none', executable: false }
  globalThis.fetch = async url => { assert.equal(String(url), '/v1/messages/candidate-message/candidates'); return new Response(JSON.stringify(view)) }
  assert.deepEqual(await new HttpTransport().replyCandidates(input.messageId), view)
  for (const change of [{ messageId: 'foreign' }, { executable: true }, { authorization: 'granted' }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...view, ...change }))
    await assert.rejects(new HttpTransport().replyCandidates(input.messageId))
  }
})
test('candidate preparation posts only the original pointer and binds its returned payload/source', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(String(url), '/v1/assistant/candidates/prepare'); assert.deepEqual(JSON.parse(String(options?.body)), input)
    return new Response(JSON.stringify(preview))
  }
  assert.deepEqual(await new HttpTransport().prepareReplyCandidate(input), preview)
  await assert.rejects(new HttpTransport().prepareReplyCandidate({ ...input, actor: 'model' } as unknown as AssistantCandidatePrepare))
  assert.equal(calls, 1)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...preview, record: { ...preview.record, payloadDigest: 'f'.repeat(64) } }))
  await assert.rejects(new HttpTransport().prepareReplyCandidate(input), error => error instanceof TransportError && error.code === 'schema_mismatch')
})
test('suggestion preference uses a boolean and rejects an unconfirmed status value', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const status = { protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1', model: 'fixture',
    models: ['fixture'], state: 'configured', secureTransport: true, suggestionsEnabled: true }
  globalThis.fetch = async (url, options) => { assert.equal(String(url), '/v1/assistant/suggestions'); assert.deepEqual(JSON.parse(String(options?.body)), { enabled: true }); return new Response(JSON.stringify(status)) }
  assert.deepEqual(await new HttpTransport().setAssistantSuggestions(true), status)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...status, suggestionsEnabled: false }))
  await assert.rejects(new HttpTransport().setAssistantSuggestions(true), error => error instanceof TransportError && error.code === 'schema_mismatch')
})
