/**
 * Wave-11 A5/A6: completed reply data over the existing before-send receipt and artifact registry.
 * Real SQLite; the port never sends, and a request receipt alone stays unknown.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { AssistantInferenceRecord, AssistantReplyBody, AssistantReplyResult } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProductStore, WorkflowConflict } from '@personal-agent/storage'
import { key } from '../../../packages/orchestrator-core/src/core/ids.ts'
import { CompletedAssistantReplies } from '../../../apps/coordinator/product/assistant-reply-results.ts'

const digest = (seed: string): string => seed.repeat(64).slice(0, 64)
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const at = '2026-11-12T00:00:00.000Z'
const principal = { userId: 'user-1', authorityRef: 'authority-1' }
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

function fixture() {
  const root = tmp('reply-results-')
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  return { root, store, path: join(root, 'state.sqlite') }
}

function infer(store: ProductStore, messageId = 'message-1', projectId = 'project-1', conversationId = 'conversation-1') {
  const record: AssistantInferenceRecord = { kind: 'assistant-inference/1', input: { messageId, projectId, conversationId }, model: 'mock-model' }
  const requestId = key('assistant-request', messageId)
  const receipt = store.commands.record(requestId, digest('a'), () => record)
  return { requestId, record, receipt, payloadDigest: store.commands.get(requestId)!.payloadDigest }
}

function result(store: ProductStore, input: ReturnType<typeof infer>, overrides: Partial<AssistantReplyResult> = {}) {
  const body: AssistantReplyBody = { protocol: 'assistant-reply-body/1', projectId: input.record.input.projectId,
    conversationId: input.record.input.conversationId, sourceMessageId: input.record.input.messageId,
    replyMessageId: key('assistant-reply', input.record.input.messageId), model: 'mock-model', text: 'Completed reply.', suggestions: [] }
  const artifact = store.artifacts.write(Buffer.from(JSON.stringify(body)))
  store.artifacts.insert(artifact)
  return { body, artifact, value: { protocol: 'assistant-reply-result/1', requestId: input.requestId,
    requestDigest: input.payloadDigest, sourceMessageId: body.sourceMessageId, replyMessageId: body.replyMessageId,
    projectId: body.projectId, conversationId: body.conversationId, principal, model: body.model,
    artifactRef: artifact.id, artifactDigest: artifact.digest, textDigest: sha(body.text), recordedAt: at,
    ...overrides } as AssistantReplyResult }
}

test('a completed result is readable by both identities and replays once', () => {
  const f = fixture()
  try {
    const input = infer(f.store), data = result(f.store, input)
    const put = f.store.workflows.assistant.replyResults.put(data.value)
    assert.equal(put.replayed, false)
    assert.deepEqual(f.store.workflows.assistant.replyResults.forRequest(input.requestId), data.value)
    assert.deepEqual(f.store.workflows.assistant.replyResults.forReply(data.body.replyMessageId), data.value)
    assert.deepEqual(f.store.workflows.assistant.replyResults.put(data.value), { result: data.value, replayed: true })
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a request receipt alone is unknown; missing or changed artifacts and inference mismatches are refused', () => {
  const f = fixture()
  try {
    const input = infer(f.store)
    assert.equal(f.store.workflows.assistant.replyResults.forRequest(input.requestId), undefined)
    const data = result(f.store, input)
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, artifactRef: 'missing', artifactDigest: digest('9') }), WorkflowConflict)
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, sourceMessageId: 'other-message' }), WorkflowConflict)
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, projectId: 'other-project' }), WorkflowConflict)
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, requestDigest: digest('8') }), WorkflowConflict)
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, model: 'other-model' }), WorkflowConflict)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('two requests cannot claim one reply and a different body conflicts at either identity', () => {
  const f = fixture()
  try {
    const first = infer(f.store), data = result(f.store, first)
    f.store.workflows.assistant.replyResults.put(data.value)
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, textDigest: digest('7') }), WorkflowConflict)
    const second = infer(f.store, 'message-2')
    assert.throws(() => f.store.workflows.assistant.replyResults.put({ ...data.value, requestId: second.requestId, requestDigest: second.payloadDigest }), WorkflowConflict)
    const secondData = result(f.store, second)
    f.store.workflows.assistant.replyResults.put(secondData.value)
    assert.equal(f.store.workflows.assistant.replyResults.forReply(secondData.body.replyMessageId)?.requestId, second.requestId)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('an outer receipt failure rolls back the result and its artifact row together', () => {
  const f = fixture()
  try {
    const input = infer(f.store), data = result(f.store, input)
    // Remove the artifact row inserted by the helper so the outer transaction inserts it.
    f.store.db.prepare('DELETE FROM artifacts WHERE id = ?').run(data.artifact.id)
    assert.throws(() => f.store.commands.record('reply-command', digest('b'), () => {
      f.store.artifacts.insert(data.artifact)
      f.store.workflows.assistant.replyResults.put(data.value)
      throw new Error('reply message failed after the result write')
    }), /reply message failed/)
    assert.equal(f.store.workflows.assistant.replyResults.forRequest(input.requestId), undefined)
    assert.equal(f.store.db.prepare('SELECT 1 FROM artifacts WHERE id = ?').get(data.artifact.id), undefined)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a result committed before a later reply failure is recoverable after reopen and never resends', () => {
  const f = fixture()
  try {
    const input = infer(f.store), data = result(f.store, input)
    f.store.workflows.assistant.replyResults.put(data.value)
    // A separate reply transaction fails after the already-committed result; the result stays.
    assert.throws(() => f.store.commands.record('reply-command', digest('b'), () => { throw new Error('reply event failed') }), /reply event failed/)
    f.store.close()
    const reopened = new ProductStore({ path: f.path })
    try {
      assert.deepEqual(reopened.workflows.assistant.replyResults.forRequest(input.requestId), data.value)
      assert.equal(reopened.workflows.assistant.replyResults.forReply(data.body.replyMessageId)?.textDigest, sha(data.body.text))
    } finally { reopened.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('a tampered result row is refused instead of returned', () => {
  const f = fixture()
  try {
    const input = infer(f.store), data = result(f.store, input)
    f.store.workflows.assistant.replyResults.put(data.value)
    f.store.db.prepare("UPDATE assistant_reply_results SET artifact_digest = ? WHERE request_id = ?").run(digest('6'), input.requestId)
    assert.throws(() => f.store.workflows.assistant.replyResults.forRequest(input.requestId), WorkflowConflict)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('main CompletedAssistantReplies consumes the real A port and recovers across reopen', () => {
  const f = fixture()
  try {
    const messageId = 'message-real'
    f.store.product.messages.append({ id: messageId, conversationId: 'conversation-1', projectId: 'project-1', role: 'user',
      provenance: 'trusted_user', text: 'Explain.', sourceRefs: [], createdAt: at })
    const record: AssistantInferenceRecord = { kind: 'assistant-inference/1', input: { messageId, projectId: 'project-1', conversationId: 'conversation-1' }, model: 'mock-model' }
    const requestId = key('assistant-request', messageId)
    f.store.commands.record(requestId, digest('a'), () => record)
    const consumer = new CompletedAssistantReplies(f.store, f.store.workflows.assistant.replyResults, principal, () => ['project-1'])
    const body = consumer.save(requestId, { text: 'Durable completed reply.', model: 'mock-model' })
    assert.equal(body.replyMessageId, key('assistant-reply', messageId))
    assert.equal(consumer.read(requestId)?.text, 'Durable completed reply.')
    f.store.close()
    const reopened = new ProductStore({ path: f.path })
    try {
      const recovered = new CompletedAssistantReplies(reopened, reopened.workflows.assistant.replyResults, principal, () => ['project-1'])
      assert.equal(recovered.read(requestId)?.text, 'Durable completed reply.')
      assert.equal(reopened.workflows.assistant.replyResults.forRequest(requestId)?.requestDigest, reopened.commands.get(requestId)?.payloadDigest)
    } finally { reopened.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
