import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupAttention, rankAttention } from '../src/index.ts'
import type { AttentionItem } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const at = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString()

const item = (overrides: Partial<AttentionItem> & { id: string }): AttentionItem => ({
  kind: 'question',
  category: 'clarification',
  projectId: 'project-1',
  sourceRef: `work-${overrides.id}`,
  createdAt: NOW,
  waitingSince: NOW,
  actionable: true,
  version: 1,
  ...overrides,
})

test('blocking dependencies rank above business deadlines and blocked items', () => {
  const ranked = rankAttention(
    [
      item({ id: 'blocker', blockedBy: [] }),
      item({ id: 'blocked', blockedBy: ['blocker'] }),
      item({ id: 'deadline', businessDeadline: { at: at(-2), sourceRef: 'contract-1' } }),
    ],
    { now: new Date(NOW) },
  )
  assert.deepEqual(ranked.map((entry) => entry.id), ['blocker', 'deadline', 'blocked'])
  assert.equal(ranked[0]?.bucket, 'blocking')
  assert.ok(ranked[0]?.reasons.some((reason) => reason.code === 'blocking_dependency'))
  assert.equal(ranked[2]?.bucket, 'waiting')
  assert.ok(ranked[2]?.reasons.some((reason) => reason.code === 'waiting_on_dependency'))
})

test('overdue business deadlines rank above upcoming and unknown deadlines', () => {
  const ranked = rankAttention(
    [
      item({ id: 'unknown' }),
      item({ id: 'soon', businessDeadline: { at: at(4), sourceRef: 'contract-1' } }),
      item({ id: 'overdue', businessDeadline: { at: at(-24), sourceRef: 'contract-1' } }),
    ],
    { now: new Date(NOW) },
  )
  assert.deepEqual(ranked.map((entry) => entry.id), ['overdue', 'soon', 'unknown'])
  assert.equal(ranked[2]?.deadlineState, 'unknown')
  assert.ok(ranked[0]?.reasons.some((reason) => reason.code === 'business_deadline_overdue'))
  assert.ok(ranked[1]?.reasons.some((reason) => reason.code === 'business_deadline_due'))
})

test('question expiry is not a business deadline and expired items are not actionable', () => {
  const futureExpiry = rankAttention([item({ id: 'expires-later', expiresAt: at(12) })], { now: new Date(NOW) })[0]
  assert.equal(futureExpiry?.deadlineState, 'unknown')
  assert.equal(futureExpiry?.expired, false)
  assert.equal(futureExpiry?.actionable, true)

  const expired = rankAttention([item({ id: 'expired', expiresAt: at(-1) })], { now: new Date(NOW) })[0]
  assert.equal(expired?.expired, true)
  assert.equal(expired?.actionable, false)
  assert.equal(expired?.bucket, 'expired')
  assert.equal(expired?.deadlineState, 'unknown')
  assert.ok(expired?.reasons.some((reason) => reason.code === 'question_expired_no_action'))
})

test('permission and authentication rank above clarification at equal deadline and age', () => {
  const ranked = rankAttention(
    [
      item({ id: 'clarify', category: 'clarification' }),
      item({ id: 'permission', category: 'permission' }),
      item({ id: 'auth', category: 'authentication' }),
      item({ id: 'candidate', kind: 'candidate_acceptance', category: 'candidate' }),
    ],
    { now: new Date(NOW) },
  )
  assert.deepEqual(ranked.map((entry) => entry.id).slice(0, 3), ['auth', 'permission', 'candidate'])
  assert.ok(ranked.find((entry) => entry.id === 'permission')?.reasons.some((reason) => reason.code === 'per_target_approval'))
})

test('ties are deterministic and independent of input order', () => {
  const left = item({ id: 'b', projectId: 'project-2' })
  const right = item({ id: 'a', projectId: 'project-1' })
  const first = rankAttention([left, right], { now: new Date(NOW) }).map((entry) => entry.id)
  const second = rankAttention([right, left], { now: new Date(NOW) }).map((entry) => entry.id)
  assert.deepEqual(first, second)
  assert.deepEqual(first, ['a', 'b'])
})

test('groups keep every item and require per-target approval without merging actors', () => {
  const ranked = rankAttention(
    [
      item({ id: 'q1', category: 'permission', actorRef: 'user-1' }),
      item({ id: 'q2', category: 'permission', actorRef: 'user-2' }),
      item({ id: 'c1', kind: 'candidate_acceptance', category: 'candidate', projectId: 'project-2' }),
    ],
    { now: new Date(NOW) },
  )
  const groups = groupAttention(ranked)
  assert.equal(groups.length, 2)
  assert.equal(groups.reduce((total, group) => total + group.items.length, 0), 3)
  const projectOne = groups.find((group) => group.projectId === 'project-1' && group.kind === 'question')
  assert.equal(projectOne?.requiresPerTargetApproval, true)
  assert.deepEqual(projectOne?.items.map((entry) => entry.actorRef), ['user-1', 'user-2'])
  const candidate = groups.find((group) => group.kind === 'candidate_acceptance')
  assert.equal(candidate?.requiresPerTargetApproval, true)
})
