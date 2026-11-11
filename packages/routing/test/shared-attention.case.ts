import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AttentionItem } from '@personal-agent/contracts'
import { AttentionRankError, rankSharedAttention, sharedAttentionRanker } from '../src/index.ts'

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
const question = (id: string, overrides: Record<string, unknown> = {}): AttentionItem =>
  ({
    ...base(overrides),
    id,
    kind: 'question',
    questionId: `q-${id}`,
    questionVersion: 1,
    questionKind: 'clarification',
    ...overrides,
  }) as AttentionItem
const candidate = (id: string, overrides: Record<string, unknown> = {}): AttentionItem =>
  ({
    ...base(overrides),
    id,
    kind: 'candidate',
    candidate: { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract: contract(), candidateGeneration: 1 },
    verificationId: 'verification-1',
    ...overrides,
  }) as AttentionItem
const blocked = (id: string, code: 'verification_blocked' | 'machine_failed' | 'writer_indeterminate' | 'dispatch_paused'): AttentionItem =>
  ({ ...base(), id, kind: 'blocked', code }) as AttentionItem

test('returns a complete duplicate-free permutation with at least one shared reason', () => {
  const items = [question('q1'), question('q2'), candidate('c1'), blocked('b1', 'machine_failed')]
  const ranks = rankSharedAttention({ items, now: NOW })
  assert.equal(ranks.length, items.length)
  assert.deepEqual([...ranks.map((rank) => rank.id)].sort(), ['b1', 'c1', 'q1', 'q2'])
  assert.equal(new Set(ranks.map((rank) => rank.id)).size, ranks.length)
  for (const rank of ranks) assert.ok(rank.reasons.length >= 1)
})

test('same items and now produce the same order regardless of input order', () => {
  const items = [question('q1'), question('q2'), candidate('c1')]
  const first = rankSharedAttention({ items, now: NOW }).map((rank) => rank.id)
  const second = rankSharedAttention({ items: [...items].reverse(), now: NOW }).map((rank) => rank.id)
  assert.deepEqual(first, second)
  assert.deepEqual(sharedAttentionRanker({ items, now: NOW }).map((rank) => rank.id), first)
})

test('sinceAt null is unknown waiting, never a fabricated age', () => {
  const older = question('older', { sinceAt: at(-10) })
  const newer = question('newer', { sinceAt: at(-1) })
  const unknown = question('unknown', { sinceAt: null })
  const ranks = rankSharedAttention({ items: [unknown, newer, older], now: NOW })
  assert.deepEqual(ranks.map((rank) => rank.id), ['older', 'newer', 'unknown'])
  assert.deepEqual(ranks[0]?.reasons, ['waiting_age'])
  assert.deepEqual(ranks[2]?.reasons, ['unknown_wait'])
  assert.equal(ranks[2]?.reasons.includes('waiting_age'), false)
})

test('deadlineAt is the only business deadline; expiresAt never becomes one', () => {
  const overdue = question('overdue', { deadlineAt: at(-2) })
  const near = question('near', { deadlineAt: at(4) })
  const far = question('far', { deadlineAt: at(24 * 7) })
  const ranks = rankSharedAttention({ items: [far, near, overdue], now: NOW })
  assert.deepEqual(ranks.map((rank) => rank.id), ['overdue', 'near', 'far'])
  assert.ok(ranks[0]?.reasons.includes('deadline_overdue'))
  assert.ok(ranks[1]?.reasons.includes('deadline_near'))
  assert.equal(ranks[2]?.reasons.includes('deadline_near'), false)
  assert.equal(ranks[2]?.reasons.includes('deadline_overdue'), false)

  const expiryOnly = rankSharedAttention({
    items: [question('expiry-only', { expiresAt: at(-1), sinceAt: null })],
    now: NOW,
  })[0]
  assert.deepEqual(expiryOnly?.reasons, ['unknown_wait'])
  assert.equal(expiryOnly?.reasons.includes('deadline_overdue'), false)
})

test('blockedWorkIds is outgoing; being listed as blocked does not make an item a blocker', () => {
  const blocker = question('blocker', { blockedWorkIds: ['work-2'] })
  const target = question('target', { contract: contract('work-2') })
  const ranks = rankSharedAttention({ items: [target, blocker], now: NOW })
  const blockerRank = ranks.find((rank) => rank.id === 'blocker')
  const targetRank = ranks.find((rank) => rank.id === 'target')
  assert.ok(blockerRank?.reasons.includes('blocks_other_work'))
  assert.equal(targetRank?.reasons.includes('blocks_other_work'), false)
  assert.equal(ranks[0]?.id, 'blocker')
})

test('kind and state reasons use the shared enum', () => {
  const ranks = rankSharedAttention({
    items: [
      question('permission', { questionKind: 'permission' }),
      question('authentication', { questionKind: 'authentication' }),
      candidate('candidate'),
      blocked('verification', 'verification_blocked'),
      blocked('writer', 'writer_indeterminate'),
    ],
    now: NOW,
  })
  const reasons = new Map(ranks.map((rank) => [rank.id, rank.reasons]))
  assert.ok(reasons.get('permission')?.includes('permission_pending'))
  assert.ok(reasons.get('authentication')?.includes('authentication_pending'))
  assert.ok(reasons.get('candidate')?.includes('candidate_ready'))
  assert.ok(reasons.get('verification')?.includes('verification_blocked'))
  assert.ok(reasons.get('writer')?.includes('writer_indeterminate'))
})

test('an explicit now changes deadline classification reproducibly', () => {
  const item = question('deadline', { deadlineAt: at(4) })
  const later = new Date(Date.parse(NOW) + 48 * 3_600_000).toISOString()
  assert.ok(rankSharedAttention({ items: [item], now: NOW })[0]?.reasons.includes('deadline_near'))
  assert.ok(rankSharedAttention({ items: [item], now: later })[0]?.reasons.includes('deadline_overdue'))
})

test('duplicate ids are refused instead of corrupting the public page', () => {
  assert.throws(() => rankSharedAttention({ items: [question('same'), question('same')], now: NOW }), AttentionRankError)
})
