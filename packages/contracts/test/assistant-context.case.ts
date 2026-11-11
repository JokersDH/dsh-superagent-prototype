import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AssistantContextBindingSchema } from '../src/assistant-context.ts'

const record = { protocol: 'assistant-context-binding/1', commandId: 'chat-one', messageId: 'user-one', requestId: 'context-one',
  projectId: 'project', conversationId: 'conversation', userTextDigest: 'a'.repeat(64),
  principal: { userId: 'local-user', authorityRef: 'local-authority' }, purpose: 'conversation_discussion',
  scope: { projectId: 'project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, selections: ['conversation'],
  bundleRef: 'bundle', bundleDigest: 'b'.repeat(64), sources: [{ sourceId: 'source', kind: 'conversation_message',
    sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: true }],
  confirmedAt: '2026-11-11T12:00:00.000Z', expiresAt: '2026-11-11T12:05:00.000Z' }

test('context binding is bounded discussion audit without execution or resend authority', () => {
  assert.equal(AssistantContextBindingSchema.safeParse(record).success, true)
  for (const extra of [{ execute: true }, { token: 'permission' }, { startupAvailable: true }, { status: 'approved' }])
    assert.equal(AssistantContextBindingSchema.safeParse({ ...record, ...extra }).success, false)
  assert.equal(AssistantContextBindingSchema.safeParse({ ...record, sources: [{ ...record.sources[0], kind: 'decision' }] }).success, false)
  assert.equal(AssistantContextBindingSchema.safeParse({ ...record, sources: [...record.sources, ...record.sources] }).success, false)
  assert.equal(AssistantContextBindingSchema.safeParse({ ...record, scope: { ...record.scope, projectId: 'other' } }).success, false)
})

test('expired, extended or workless bindings cannot be recorded as fresh selected context', () => {
  for (const expiresAt of ['2026-11-11T11:59:00.000Z', '2026-11-11T12:05:01.000Z'])
    assert.equal(AssistantContextBindingSchema.safeParse({ ...record, expiresAt }).success, false)
  assert.equal(AssistantContextBindingSchema.safeParse({ ...record, scope: { ...record.scope, expiresAt: '2026-11-11T12:04:00.000Z' } }).success, false)
  assert.equal(AssistantContextBindingSchema.safeParse({ ...record, selections: ['artifacts'] }).success, false)
})
