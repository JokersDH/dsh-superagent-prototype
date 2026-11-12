import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AssistantContextHistoryPageSchema, AssistantContextHistoryQuerySchema, AssistantReplyBodySchema, AssistantReplyResultSchema } from '../src/assistant-records.ts'
import { RecoverySourceCheckpointSchema } from '../src/recovery-source.ts'

test('stored reply suggestions retain the original source and project and cannot carry executable authority', () => {
  const body = { protocol: 'assistant-reply-body/1', projectId: 'project', conversationId: 'conversation',
    sourceMessageId: 'user-message', replyMessageId: 'reply', model: 'fixture', text: 'A bounded reply.', suggestions: [] }
  assert.equal(AssistantReplyBodySchema.safeParse(body).success, true)
  const suggestion = { kind: 'propose_work', goal: 'Implement parser tests', projectId: 'project', sourceMessageId: 'user-message' }
  assert.equal(AssistantReplyBodySchema.safeParse({ ...body, suggestions: [suggestion] }).success, true)
  for (const change of [{ projectId: 'foreign' }, { sourceMessageId: 'other' }, { actor: 'model' }, { commandId: 'execute' }])
    assert.equal(AssistantReplyBodySchema.safeParse({ ...body, suggestions: [{ ...suggestion, ...change }] }).success, false)
  const result = { protocol: 'assistant-reply-result/1', requestId: 'request', requestDigest: 'a'.repeat(64),
    sourceMessageId: 'user-message', replyMessageId: 'reply', projectId: 'project', conversationId: 'conversation',
    principal: { userId: 'local', authorityRef: 'authority' }, model: 'fixture', artifactRef: 'artifact',
    artifactDigest: 'b'.repeat(64), textDigest: 'c'.repeat(64), recordedAt: '2026-11-11T12:00:00.000Z' }
  assert.equal(AssistantReplyResultSchema.safeParse(result).success, true)
  assert.equal(AssistantReplyResultSchema.safeParse({ ...result, resendAllowed: true }).success, false)
})

test('history is scope-bounded and a complete source checkpoint cannot hide omissions or grant startup', () => {
  assert.equal(AssistantContextHistoryQuerySchema.safeParse({ projectIds: ['project'], limit: 20 }).success, true)
  assert.equal(AssistantContextHistoryQuerySchema.safeParse({ projectIds: [] }).success, false)
  assert.equal(AssistantContextHistoryPageSchema.safeParse({ protocol: 'assistant-context-history/1', observedAt: '2026-11-11T12:00:00.000Z', records: [], hasMore: true }).success, false)
  const source = { protocol: 'recovery-source-checkpoint/1', observedAt: '2026-11-11T12:00:00.000Z', productSchema: 16,
    observedEventCursor: 0, coverage: 'complete', sourceFingerprint: 'a'.repeat(64),
    families: [{ name: 'works', rows: 0, digest: 'b'.repeat(64), truncated: false }], ignoredConfirmation: null,
    volatileFieldsIgnored: [], issues: [], startupAvailable: false }
  assert.equal(RecoverySourceCheckpointSchema.safeParse(source).success, true)
  assert.equal(RecoverySourceCheckpointSchema.safeParse({ ...source, issues: ['missing_table'] }).success, false)
  assert.equal(RecoverySourceCheckpointSchema.safeParse({ ...source, sourceFingerprint: null }).success, false)
  assert.equal(RecoverySourceCheckpointSchema.safeParse({ ...source, startupAvailable: true }).success, false)
})
