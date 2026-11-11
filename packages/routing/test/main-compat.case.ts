import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttentionPageSchema } from '@personal-agent/contracts'
import type { AttentionItem } from '@personal-agent/contracts'
import { rankSharedAttention, sharedAttentionRanker } from '../src/index.ts'

const NOW = '2026-11-11T00:00:00.000Z'
const at = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString()
const contract = (workId = 'work-1') => ({ workId, revision: 1, digest: 'a'.repeat(64) })
const base = (overrides: Record<string, unknown> = {}) => ({
  projectId: 'project-1',
  conversationId: 'conversation-1',
  contract: contract(),
  workTitle: 'Work',
  summary: 'Summary',
  sinceAt: NOW,
  deadlineAt: null,
  expiresAt: null,
  blockedWorkIds: [] as readonly string[],
  ...overrides,
})

/** Mirrors the shape ProductAttention builds: question/candidate/blocked items in one page. */
const pageItems = (): AttentionItem[] => [
  {
    ...base({ id: 'question-permission', deadlineAt: at(4), expiresAt: at(1), sinceAt: at(-2) }),
    kind: 'question',
    questionId: 'question-1',
    questionVersion: 1,
    questionKind: 'permission',
  } as AttentionItem,
  {
    ...base({ id: 'question-old', sinceAt: at(-72), contract: contract('work-2') }),
    kind: 'question',
    questionId: 'question-2',
    questionVersion: 1,
    questionKind: 'clarification',
  } as AttentionItem,
  {
    ...base({ id: 'candidate-1', sinceAt: null, contract: contract('work-3') }),
    kind: 'candidate',
    candidate: { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract: contract('work-3'), candidateGeneration: 1 },
    verificationId: 'verification-1',
  } as AttentionItem,
  {
    ...base({ id: 'blocked-1', sinceAt: null, contract: contract('work-4') }),
    kind: 'blocked',
    code: 'machine_failed',
  } as AttentionItem,
  {
    ...base({ id: 'question-blocks', sinceAt: at(-1), blockedWorkIds: ['work-5'] }),
    kind: 'question',
    questionId: 'question-3',
    questionVersion: 1,
    questionKind: 'clarification',
  } as AttentionItem,
]

test('main can pass shared items to the ranker and validate the resulting page', () => {
  const items = pageItems()
  const ranks = sharedAttentionRanker({ items, now: NOW })
  const page = AttentionPageSchema.parse({
    protocol: 'attention-inbox/1',
    observedAt: NOW,
    items,
    ranks,
    ranking: 'deterministic_priority',
    scannedWorks: 1,
    questionCoverage: 'complete',
    hasMore: false,
  })
  assert.equal(page.ranks.length, items.length)
  assert.deepEqual([...page.ranks.map((rank) => rank.id)].sort(), items.map((item) => item.id).sort())
  assert.equal(new Set(page.ranks.map((rank) => rank.id)).size, items.length)

  const reasons = new Map(page.ranks.map((rank) => [rank.id, rank.reasons]))
  assert.ok(reasons.get('question-permission')?.includes('permission_pending'))
  assert.ok(reasons.get('question-permission')?.includes('deadline_near'))
  assert.ok(reasons.get('candidate-1')?.includes('candidate_ready'))
  assert.ok(reasons.get('candidate-1')?.includes('unknown_wait'))
  assert.ok(reasons.get('blocked-1')?.includes('machine_failed'))
  assert.ok(reasons.get('blocked-1')?.includes('unknown_wait'))
  assert.ok(reasons.get('question-blocks')?.includes('blocks_other_work'))
})

test('the same page and now produce the same ranks for main and C', () => {
  const items = pageItems()
  const first = rankSharedAttention({ items: structuredClone(items), now: NOW })
  const second = rankSharedAttention({ items: structuredClone(items), now: NOW })
  assert.deepEqual(first, second)
  assert.deepEqual(rankSharedAttention({ items: [...items].reverse(), now: NOW }), first)
})

test('unknown waiting and strict deadlines survive the shared page projection', () => {
  const items = pageItems()
  const ranks = rankSharedAttention({ items, now: NOW })
  const byId = new Map(ranks.map((rank) => [rank.id, rank.reasons]))
  assert.equal(byId.get('blocked-1')?.includes('waiting_age'), false)
  assert.equal(byId.get('candidate-1')?.includes('waiting_age'), false)
  const old = byId.get('question-old')
  assert.ok(old?.includes('waiting_age'))
  assert.equal(old?.includes('deadline_near'), false)
  assert.equal(old?.includes('deadline_overdue'), false)
})
