import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttentionItemSchema, AttentionPageSchema, AttentionQuerySchema } from '../src/index.ts'
const at = '2026-11-10T00:00:00.000Z'
const contract = { workId: 'work-one', revision: 1, digest: 'a'.repeat(64) }
const item = { id: 'attention-one', projectId: 'project-one', conversationId: 'conversation-one', contract,
  workTitle: 'A real work', summary: 'Pending answer', sinceAt: at, deadlineAt: null, expiresAt: at, blockedWorkIds: [],
  kind: 'question', questionId: 'question-one', questionVersion: 1, questionKind: 'clarification' }
test('attention preserves unknown business deadlines and cannot carry execution authority', () => {
  assert.equal(AttentionItemSchema.parse(item).deadlineAt, null)
  assert.equal(AttentionItemSchema.safeParse({ ...item, actor: 'forged' }).success, false)
  const { questionId, questionVersion, questionKind, ...base } = item
  assert.equal(AttentionItemSchema.safeParse({ ...base, kind: 'candidate', verificationId: 'verification-one',
    candidate: { ticketId: 'ticket-one', assignmentId: 'assignment-one', candidateGeneration: 1, contract: { ...contract, revision: 2 } } }).success, false)
})
test('rank output must be an exact page permutation and continuation is explicit', () => {
  const page = { protocol: 'attention-inbox/1', observedAt: at, items: [item], ranks: [{ id: item.id, reasons: ['waiting_age'] }],
    ranking: 'waiting_order', scannedWorks: 1, questionCoverage: 'complete', hasMore: false }
  assert.equal(AttentionPageSchema.safeParse(page).success, true)
  for (const change of [{ ranks: [] }, { ranks: [...page.ranks, ...page.ranks] }, { ranks: [{ id: 'other', reasons: ['waiting_age'] }] }, { hasMore: true }])
    assert.equal(AttentionPageSchema.safeParse({ ...page, ...change }).success, false)
  assert.equal(AttentionQuerySchema.safeParse({ limit: 21 }).success, false)
  assert.equal(AttentionQuerySchema.safeParse({ projectId: 'project-one', actor: 'other' }).success, false)
})
