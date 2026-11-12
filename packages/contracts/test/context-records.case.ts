import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContextHistoryQuerySchema, ContextHistorySchema, ContextSourcesSchema } from '../src/context-records.ts'

const at = '2026-11-12T00:00:00.000Z'
test('public history scopes and continuation cannot be widened or misrepresented', () => {
  const query = { projectId: 'project', conversationId: 'conversation', workId: 'work', limit: 20 }
  assert.ok(ContextHistoryQuerySchema.safeParse(query).success)
  for (const extra of [{ projectIds: ['foreign'] }, { principal: 'foreign' }, { actor: 'model' }, { limit: 51 }])
    assert.equal(ContextHistoryQuerySchema.safeParse({ ...query, ...extra }).success, false)
  const entry = { messageId: 'message', projectId: 'project', conversationId: 'conversation', confirmedAt: at,
    expiresAt: '2026-11-12T00:05:00.000Z', selections: ['conversation'], sourceCount: 1,
    message: { state: 'available', text: 'Original message', truncated: false } }
  const page = { protocol: 'context-history/1', projectId: 'project', conversationId: 'conversation', observedAt: at,
    entries: [entry], hasMore: false }
  assert.ok(ContextHistorySchema.safeParse(page).success)
  assert.equal(ContextHistorySchema.safeParse({ ...page, entries: [{ ...entry, projectId: 'foreign' }] }).success, false)
  assert.equal(ContextHistorySchema.safeParse({ ...page, workId: 'another-work' }).success, false)
  assert.equal(ContextHistorySchema.safeParse({ ...page, hasMore: true }).success, false)
  assert.equal(ContextHistorySchema.safeParse({ ...page, entries: [entry, entry] }).success, false)
})
test('historical source content requires the exact frozen source binding and grants no new authority', () => {
  const source = { sourceId: 'source', kind: 'conversation_message', title: 'Original message', path: 'conversation/source',
    content: 'Original content', sourceDigest: 'a'.repeat(64), previewDigest: 'b'.repeat(64), bytes: 16, estimatedTokens: 4, truncated: false }
  const binding = { protocol: 'assistant-context-binding/1', messageId: 'message', commandId: 'command', requestId: 'request',
    projectId: 'project', conversationId: 'conversation', userTextDigest: 'c'.repeat(64),
    principal: { userId: 'user', authorityRef: 'authority' }, scope: { projectId: 'project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    purpose: 'conversation_discussion', selections: ['conversation'], bundleRef: 'bundle', bundleDigest: 'd'.repeat(64),
    sources: [{ sourceId: source.sourceId, kind: source.kind, sourceDigest: source.sourceDigest, previewDigest: source.previewDigest, truncated: false }],
    confirmedAt: at, expiresAt: '2026-11-12T00:05:00.000Z' }
  const view = { protocol: 'context-sources/1', observedAt: at, binding, state: 'verified', sources: [source], omitted: [], injectionFlags: [] }
  assert.ok(ContextSourcesSchema.safeParse(view).success)
  assert.equal(ContextSourcesSchema.safeParse({ ...view, token: 'new-send' }).success, false)
  assert.equal(ContextSourcesSchema.safeParse({ ...view, state: 'missing' }).success, false)
  assert.equal(ContextSourcesSchema.safeParse({ ...view, sources: [{ ...source, sourceId: 'foreign' }] }).success, false)
  assert.ok(ContextSourcesSchema.safeParse({ ...view, state: 'scope_changed', sources: [] }).success)
})
