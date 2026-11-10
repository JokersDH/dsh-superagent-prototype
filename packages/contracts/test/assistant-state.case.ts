import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PersistedDecisionSchema, PersistedProposalSchema } from '../src/index.ts'

const scope = { projectId: 'project-one', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
test('assistant persistence keeps source evidence and never accepts executable or actor injection fields', () => {
  const record = { decision: { id: 'decision-one', version: 1, content: 'Explicit decision', scope, authorityRef: 'authority-one' },
    sourceMessageId: 'message-one', sourceTextDigest: 'a'.repeat(64), conversationId: 'conversation-one', actorRef: 'actor-one', recordedAt: '2026-11-10T00:00:00.000Z' }
  assert.equal(PersistedDecisionSchema.safeParse(record).success, true)
  for (const change of [{ sourceMessageId: undefined }, { sourceTextDigest: 'unverified' }, { command: '/bin/sh' }, { revokedBy: 'actor-one' }])
    assert.equal(PersistedDecisionSchema.safeParse({ ...record, ...change }).success, false)
})
test('proposal persisted confirmation requires one application command and matching source/project', () => {
  const record = { proposalId: 'proposal-one', version: 1, state: 'pending', projectId: 'project-one', conversationId: 'conversation-one',
    sourceMessageId: 'message-one', sourceTextDigest: 'a'.repeat(64), actorRef: 'actor-one', grantId: 'grant-one', grantScope: scope,
    payload: { kind: 'propose_work', projectId: 'project-one', sourceMessageId: 'message-one', goal: 'Implement' }, payloadDigest: 'b'.repeat(64),
    createdAt: '2026-11-10T00:00:00.000Z', expiresAt: '2026-11-10T01:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' }
  assert.equal(PersistedProposalSchema.safeParse(record).success, true)
  assert.equal(PersistedProposalSchema.safeParse({ ...record, state: 'confirmed' }).success, false)
  assert.equal(PersistedProposalSchema.safeParse({ ...record, state: 'confirmed', effectCommandId: 'command-one' }).success, true)
  for (const change of [{ projectId: 'project-other' }, { sourceMessageId: 'message-other' }, { state: 'superseded' }, { effectCommandId: 'command-one' }])
    assert.equal(PersistedProposalSchema.safeParse({ ...record, ...change }).success, false)
})
