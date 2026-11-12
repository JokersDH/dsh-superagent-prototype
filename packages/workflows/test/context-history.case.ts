/**
 * Wave-11 A3/A4: project/conversation/work keyset history over append-only context bindings.
 * Real SQLite, stable ties, bounded index use, and no silent skipping of inconsistent rows.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AssistantContextBinding } from '@personal-agent/contracts'
import { ProductStore } from '@personal-agent/storage'

const digest = (seed: string): string => seed.repeat(64).slice(0, 64)
const at = (minute: number): string => `2026-11-12T00:${String(minute).padStart(2, '0')}:00.000Z`
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

function binding(input: { messageId: string; commandId?: string; projectId?: string; conversationId?: string; confirmedAt: string; workId?: string; bundleRef: string; bundleDigest: string }): AssistantContextBinding {
  const projectId = input.projectId ?? 'project-1', conversationId = input.conversationId ?? 'conversation-1'
  return {
    protocol: 'assistant-context-binding/1', commandId: input.commandId ?? `command-${input.messageId}`,
    messageId: input.messageId, requestId: `request-${input.messageId}`,
    projectId, conversationId, userTextDigest: digest('a'),
    principal: { userId: 'user-1', authorityRef: 'authority-1' }, purpose: 'conversation_discussion',
    ...(input.workId ? { contract: { workId: input.workId, revision: 1, digest: digest('b') } } : {}),
    scope: { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    selections: input.workId ? ['work'] : ['conversation'],
    bundleRef: input.bundleRef, bundleDigest: input.bundleDigest,
    sources: [{ sourceId: input.workId ?? `source-${input.messageId}`, kind: input.workId ? 'work' : 'conversation_message',
      sourceDigest: digest('c'), previewDigest: digest('d'), truncated: false }],
    confirmedAt: input.confirmedAt, expiresAt: new Date(Date.parse(input.confirmedAt) + 60000).toISOString(),
  }
}

function fixture() {
  const root = tmp('context-history-')
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  const artifact = store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
  store.artifacts.insert(artifact)
  return { root, store, artifact }
}

test('project scope, newest-first order and stable ties page without gaps or duplicates', () => {
  const f = fixture()
  try {
    f.store.uow.atomic(() => {
      for (const messageId of ['msg-a', 'msg-b', 'msg-c'])
        f.store.workflows.assistant.contextBindings.put(binding({ messageId, confirmedAt: at(1), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
      f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'msg-new', confirmedAt: at(2), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
      f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'msg-other', projectId: 'project-2', confirmedAt: at(3), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
    })
    const history = f.store.workflows.assistant.contextHistory
    const first = history.page({ projectIds: ['project-1'], limit: 2 })
    assert.deepEqual(first.records.map(record => record.messageId), ['msg-new', 'msg-c'])
    assert.equal(first.hasMore, true)
    const second = history.page({ projectIds: ['project-1'], limit: 2, cursor: first.nextCursor! })
    assert.deepEqual(second.records.map(record => record.messageId), ['msg-b', 'msg-a'])
    assert.equal(second.hasMore, false)
    assert.equal(second.nextCursor, undefined)
    assert.equal(history.page({ projectIds: ['project-1'] }).records.some(record => record.messageId === 'msg-other'), false)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('conversation and work filters stay inside the authorized project set', () => {
  const f = fixture()
  try {
    f.store.uow.atomic(() => {
      f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'conv-a', confirmedAt: at(4), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
      f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'conv-b', conversationId: 'conversation-2', confirmedAt: at(5), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
      f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'work-a', workId: 'work-1', confirmedAt: at(6), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
      f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'work-other', projectId: 'project-2', workId: 'work-1', confirmedAt: at(7), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
    })
    const history = f.store.workflows.assistant.contextHistory
    assert.deepEqual(history.page({ projectIds: ['project-1'], conversationId: 'conversation-2' }).records.map(record => record.messageId), ['conv-b'])
    assert.deepEqual(history.page({ projectIds: ['project-1'], workId: 'work-1' }).records.map(record => record.messageId), ['work-a'])
    assert.deepEqual(history.page({ projectIds: ['project-2'], workId: 'work-1' }).records.map(record => record.messageId), ['work-other'])
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('history survives reopen, empty windows are explicit, and malformed cursors are refused', () => {
  const f = fixture()
  try {
    f.store.uow.atomic(() => {
      for (let index = 0; index < 3; index += 1)
        f.store.workflows.assistant.contextBindings.put(binding({ messageId: `msg-${index}`, confirmedAt: at(index + 10), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
    })
    f.store.close()
    const reopened = new ProductStore({ path: join(f.root, 'state.sqlite') })
    try {
      const history = reopened.workflows.assistant.contextHistory
      const first = history.page({ projectIds: ['project-1'], limit: 2 })
      assert.deepEqual(first.records.map(record => record.messageId), ['msg-2', 'msg-1'])
      assert.deepEqual(history.page({ projectIds: ['project-1'], limit: 2, cursor: first.nextCursor! }).records.map(record => record.messageId), ['msg-0'])
      const empty = history.page({ projectIds: ['project-1'], conversationId: 'missing-conversation' })
      assert.deepEqual(empty.records, [])
      assert.equal(empty.hasMore, false)
      assert.equal(empty.nextCursor, undefined)
      for (const cursor of ['not-base64!!', Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ confirmedAt: 'not-a-time', messageId: 'm' })).toString('base64url')])
        assert.throws(() => history.page({ projectIds: ['project-1'], cursor }))
    } finally { reopened.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('a bad row fails the page instead of being silently skipped', () => {
  const f = fixture()
  try {
    f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'msg-bad', confirmedAt: at(20), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
    f.store.db.prepare("UPDATE assistant_context_bindings SET digest = ? WHERE message_id = 'msg-bad'").run(digest('9'))
    assert.throws(() => f.store.workflows.assistant.contextHistory.page({ projectIds: ['project-1'] }))
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('bundle status is a registry/digest check and never reads the body', () => {
  const f = fixture()
  try {
    f.store.workflows.assistant.contextBindings.put(binding({ messageId: 'msg-bundle', confirmedAt: at(21), bundleRef: f.artifact.id, bundleDigest: f.artifact.digest }))
    const status = f.store.workflows.assistant.contextHistory.bundleStatus('msg-bundle')
    assert.equal(status.present, true)
    assert.equal(status.digestMatches, true)
    assert.equal(status.bytes, f.artifact.bytes)
    f.store.db.prepare('DELETE FROM artifacts WHERE id = ?').run(f.artifact.id)
    const missing = f.store.workflows.assistant.contextHistory.bundleStatus('msg-bundle')
    assert.equal(missing.present, false)
    assert.equal(missing.digestMatches, false)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('5000 bindings page with a bounded index plan and stable results', () => {
  const f = fixture()
  try {
    const started = performance.now()
    f.store.uow.atomic(() => {
      for (let index = 0; index < 5000; index += 1) {
        const minute = index % 60, hour = Math.floor(index / 60)
        f.store.workflows.assistant.contextBindings.put(binding({
          messageId: `bulk-${String(index).padStart(5, '0')}`, commandId: `bulk-command-${index}`,
          confirmedAt: `2026-11-12T${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
          bundleRef: f.artifact.id, bundleDigest: f.artifact.digest,
        }))
      }
    })
    const writeMs = performance.now() - started
    const history = f.store.workflows.assistant.contextHistory
    const pageStart = performance.now()
    const first = history.page({ projectIds: ['project-1'], limit: 100 })
    const pageMs = performance.now() - pageStart
    assert.equal(first.records.length, 100)
    assert.equal(first.hasMore, true)
    const plan = f.store.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM assistant_context_bindings
      WHERE project_id IN (?) ORDER BY confirmed_at DESC, message_id DESC LIMIT 101`).all('project-1') as { detail: string }[]
    assert.equal(plan.some(row => row.detail.includes('assistant_context_history_scope')), true, JSON.stringify(plan))
    assert.ok(writeMs < 30000, `5000 writes took ${writeMs.toFixed(0)}ms`)
    assert.ok(pageMs < 1000, `first page took ${pageMs.toFixed(0)}ms`)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})
