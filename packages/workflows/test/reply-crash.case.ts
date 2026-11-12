/**
 * Wave-11 A8: real subordinate processes are SIGKILLed before/after completed-result and reply
 * commits. The parent reopens SQLite and proves durable state plus a single recovery append.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '@personal-agent/storage'
import { key } from '../../../packages/orchestrator-core/src/core/ids.ts'
import { CompletedAssistantReplies } from '../../../apps/coordinator/product/assistant-reply-results.ts'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reply-crash.mjs')
const messageId = 'crash-source', replyId = key('assistant-reply', messageId), requestId = key('assistant-request', messageId)

function crash(mode: string) {
  const root = mkdtempSync(join(tmpdir(), `reply-crash-${mode}-`)), path = join(root, 'state.sqlite')
  const child = spawnSync(process.execPath, [fixture, path, mode], { encoding: 'utf8', timeout: 20000 })
  assert.equal(child.signal, 'SIGKILL', `${mode}: ${child.stderr}`)
  return { root, path }
}

function recover(path: string) {
  const store = new ProductStore({ path })
  const result = store.workflows.assistant.replyResults.forRequest(requestId)
  let appended = 0
  // The real consumer reads the original bounded body from the registered artifact; recovery never
  // fabricates replacement text and never calls the provider when a result exists.
  const consumer = new CompletedAssistantReplies(store, store.workflows.assistant.replyResults,
    { userId: 'user-1', authorityRef: 'authority-1' }, () => ['project-1'])
  const recovered = result ? consumer.read(requestId) : undefined
  if (recovered && !store.product.messages.getById(replyId)) {
    store.product.messages.append({ id: replyId, conversationId: 'conversation-1', projectId: 'project-1', role: 'assistant',
      provenance: 'reasoner_reply', text: recovered.text, sourceRefs: [messageId], createdAt: '2026-11-12T00:00:01.000Z' })
    appended += 1
  }
  return { store, result, recovered, appended }
}

test('SIGKILL after the before-send receipt but before the result leaves only an unknown request', () => {
  const { root, path } = crash('before-result')
  try {
    const { store, result } = recover(path)
    try {
      assert.equal(store.commands.get(requestId)?.status, 'recorded')
      assert.equal(result, undefined)
      assert.equal(store.product.messages.getById(replyId), undefined)
    } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SIGKILL after the result commit recovers once without another model send', () => {
  const { root, path } = crash('after-result')
  try {
    const { store, result, recovered, appended } = recover(path)
    try {
      assert.equal(result?.replyMessageId, replyId)
      assert.equal(recovered?.text, 'Completed before the crash.')
      assert.equal(appended, 1)
      assert.equal(store.product.messages.page('conversation-1').messages.filter(message => message.id === replyId).length, 1)
      assert.equal(store.workflows.assistant.replyResults.forRequest(requestId)?.artifactRef, result?.artifactRef)
    } finally { store.close() }
    const reopened = recover(path)
    try {
      assert.equal(reopened.result?.replyMessageId, replyId)
      assert.equal(reopened.appended, 0, 'a replay never appends a second reply')
      assert.equal(reopened.store.product.messages.page('conversation-1').messages.filter(message => message.id === replyId).length, 1)
    } finally { reopened.store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SIGKILL after the reply message commit keeps one result and one reply across reopen', () => {
  const { root, path } = crash('after-message')
  try {
    const { store, result, appended } = recover(path)
    try {
      assert.equal(result?.replyMessageId, replyId)
      assert.equal(appended, 0)
      assert.equal(store.product.messages.page('conversation-1').messages.filter(message => message.id === replyId).length, 1)
    } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SIGKILL before a source confirmation leaves no fact/receipt and no fake complete ignore', () => {
  const { root, path } = crash('source-before')
  try {
    const store = new ProductStore({ path })
    try {
      assert.equal(store.workflows.recoveryActivations.get('crash-activation'), undefined)
      assert.equal(store.commands.get('crash-command'), undefined)
      const snapshot = store.workflows.recoverySource.inspect()
      assert.equal(snapshot.coverage, 'complete')
      assert.equal(snapshot.ignoredConfirmation, null)
      assert.equal(snapshot.families.find(family => family.name === 'works')?.rows, 1)
    } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SIGKILL after the source confirmation keeps exactly one fact/receipt and only that row is excludable', () => {
  const { root, path } = crash('source-after')
  try {
    const store = new ProductStore({ path })
    try {
      const intent = store.workflows.recoveryActivations.get('crash-activation')
      assert.ok(intent)
      const receipt = store.commands.get('crash-command')
      assert.ok(receipt)
      const committed = { protocol: 'recovery-activation-commit/1' as const, intent, sourceReceipt: { commandId: 'crash-command', seq: receipt.seq } }
      const ignored = store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
      assert.equal(ignored.coverage, 'complete')
      assert.deepEqual(ignored.ignoredConfirmation, { activationId: 'crash-activation', commandId: 'crash-command', receiptSeq: receipt.seq })
      const raw = store.workflows.recoverySource.inspect()
      assert.notEqual(raw.sourceFingerprint, ignored.sourceFingerprint)
      store.product.works.insert({ id: 'crash-work-2', projectId: 'project-1', conversationId: 'conversation-1', title: 'Later', createdAt: '2026-11-12T00:00:01.000Z' })
      assert.notEqual(store.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint, ignored.sourceFingerprint)
    } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
