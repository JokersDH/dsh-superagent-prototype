import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AssistantCandidatePrepareSchema, AssistantCandidatesSchema, AssistantSuggestionsSettingSchema } from '../src/index.ts'

test('candidate selection accepts only original message/index/digest and a strict boolean preference', () => {
  const input = { messageId: 'source', index: 0, payloadDigest: 'a'.repeat(64) }
  assert.equal(AssistantCandidatePrepareSchema.safeParse(input).success, true)
  for (const extra of [{ payload: {} }, { actor: 'system' }, { verifiedBy: 'main-completed-reply' }, { index: 8 }, { index: -1 }])
    assert.equal(AssistantCandidatePrepareSchema.safeParse({ ...input, ...extra }).success, false)
  assert.equal(AssistantSuggestionsSettingSchema.safeParse({ enabled: true }).success, true)
  assert.equal(AssistantSuggestionsSettingSchema.safeParse({ enabled: 'true' }).success, false)
  assert.equal(AssistantSuggestionsSettingSchema.safeParse({ enabled: true, apiKey: 'untrusted' }).success, false)
})
test('candidate views cannot claim authority and indices/status must agree', () => {
  const value = { protocol: 'assistant-candidates/1', messageId: 'source', replyMessageId: 'reply', projectId: 'project', conversationId: 'conversation',
    status: 'candidates', candidates: [{ index: 0, kind: 'propose_work', summary: 'A proposed work', payloadDigest: 'a'.repeat(64), requiredInputs: ['work.scope'] }],
    rejected: [], trust: 'untrusted_data', authorization: 'none', executable: false }
  assert.equal(AssistantCandidatesSchema.safeParse(value).success, true)
  for (const extra of [{ executable: true }, { authorization: 'granted' }, { status: 'none' }, { candidates: [...value.candidates, ...value.candidates] }])
    assert.equal(AssistantCandidatesSchema.safeParse({ ...value, ...extra }).success, false)
})
