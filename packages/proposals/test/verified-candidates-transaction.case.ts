import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  UserCommandSchema,
} from '@personal-agent/contracts'
import {
  planProposalCommand,
  proposalDigest,
  proposalIntent,
  reviewVerifiedReplyCandidates,
} from '../src/index.ts'

const projectId = 'project-1'
const conversationId = 'conversation-1'
const sourceMessageId = 'message-1'
const principal = { userId: 'user-1', authorityRef: 'authority-1' }
const scope: Scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'criterion-1', description: 'tests pass', kind: 'machine', required: true, checkDefinitionRef: 'check-1' },
] as const

function fixture() {
  const suggestions = [
    { kind: 'reply', text: 'Ordinary answer', sourceRefs: [] },
    { kind: 'propose_work', goal: 'Add retry budget checks', projectId, sourceMessageId },
    { kind: 'propose_decision', content: 'Retries are capped at five minutes.', scope, sourceMessageId },
  ]
  const body = {
    protocol: 'assistant-reply-body/1',
    projectId,
    conversationId,
    sourceMessageId,
    replyMessageId: 'reply-1',
    model: 'mock-model',
    text: 'Answer with suggestions.',
    suggestions,
  }
  const artifactDigest = 'a'.repeat(64)
  const verified = {
    verifiedBy: 'main-completed-reply' as const,
    body,
    identity: {
      requestId: 'assistant-request:message-1',
      replyMessageId: 'reply-1',
      sourceMessageId,
      projectId,
      conversationId,
      model: 'mock-model',
      principal,
      requestDigest: 'b'.repeat(64),
      artifactRef: artifactDigest,
      artifactDigest,
    },
  }
  const bindings = { projectId, conversationId, sourceMessageId, grantId: 'grant-1', grantScope: scope, principal }
  return { body, suggestions, verified, bindings, artifactDigest }
}

test('a non-empty structured reply yields candidates that keep their original index and payload digest', () => {
  const { body, suggestions, verified, bindings, artifactDigest } = fixture()
  const review = reviewVerifiedReplyCandidates(verified, bindings)
  assert.equal(review.status, 'candidates')
  assert.equal(review.verifiedBy, 'main-completed-reply')
  assert.equal(review.reply, body.text)
  assert.deepEqual(review.candidates.map((candidate) => candidate.index), [0, 1, 2])
  for (const candidate of review.candidates) {
    const payload = suggestions[candidate.index]!
    assert.equal(candidate.payloadDigest, proposalDigest(payload as never))
    assert.equal(candidate.executable, false)
    assert.equal(candidate.requiresUserConfirmation, true)
    assert.equal(candidate.trust, 'untrusted_data')
  }
  assert.deepEqual(review.candidates.map((candidate) => candidate.plan.kind), [
    'no_effect',
    'needs_user_input',
    'requires_explicit_confirmation',
  ])
  assert.deepEqual(review.verifiedIdentity, {
    requestId: 'assistant-request:message-1',
    replyMessageId: 'reply-1',
    sourceMessageId,
    projectId,
    conversationId,
    model: 'mock-model',
    principal,
    requestDigest: 'b'.repeat(64),
    artifactRef: artifactDigest,
    artifactDigest,
  })
})

test('the original payload, not the display summary, drives the deterministic command plan', () => {
  const { suggestions } = fixture()
  const workIntent = proposalIntent(suggestions[1] as never)
  const underSpecified = planProposalCommand(workIntent, { commandId: 'command-1', conversationId })
  assert.equal(underSpecified.kind, 'needs_user_input')
  assert.deepEqual(underSpecified.kind === 'needs_user_input' && underSpecified.missing, [
    'work.scope',
    'work.criteria',
    'work.profileId',
  ])

  const decided = planProposalCommand(workIntent, {
    commandId: 'command-1',
    conversationId,
    work: { scope, criteria: criteria as never, profileId: 'codex-native' },
  })
  assert.equal(decided.kind, 'command')
  if (decided.kind !== 'command') throw new Error('unreachable')
  // The goal comes from the original suggestion payload; ids come from the caller.
  assert.equal(decided.command.kind, 'create_work')
  assert.equal(decided.command.commandId, 'command-1')
  assert.equal('goal' in decided.command && decided.command.goal, 'Add retry budget checks')
  assert.deepEqual(UserCommandSchema.parse(decided.command), decided.command)

  const decisionIntent = proposalIntent(suggestions[2] as never)
  const decision = planProposalCommand(decisionIntent, { commandId: 'command-2', conversationId })
  assert.equal(decision.kind, 'command')
  if (decision.kind !== 'command') throw new Error('unreachable')
  assert.equal(decision.command.kind, 'record_decision')
  assert.equal('content' in decision.command && decision.command.content, 'Retries are capped at five minutes.')
  assert.deepEqual('scope' in decision.command ? decision.command.scope : undefined, scope)
})

test('partial or forged artifact tuples are refused before candidate review', () => {
  const { verified, bindings } = fixture()
  const partial = {
    ...verified,
    identity: { ...verified.identity, artifactDigest: undefined },
  }
  assert.equal(reviewVerifiedReplyCandidates(partial, bindings).status, 'invalid_body')
  const forged = { ...verified, identity: { ...verified.identity, artifactDigest: 'c'.repeat(64) } }
  const forgedReview = reviewVerifiedReplyCandidates(forged, bindings)
  assert.equal(forgedReview.status, 'invalid_body')
  assert.deepEqual(forgedReview.rejected.map((entry) => entry.reason), ['artifact_mismatch'])
})
