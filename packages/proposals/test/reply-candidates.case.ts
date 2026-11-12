import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import { reviewReplyCandidates } from '../src/index.ts'

const projectId = 'project-1'
const conversationId = 'conversation-1'
const sourceMessageId = 'message-1'
const digest = (char: string) => char.repeat(64)
const scope: Scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-1', revision: 2, digest: digest('a') }

const bindings = {
  projectId,
  sourceMessageId,
  conversationId,
  grantId: 'grant-1',
  grantScope: scope,
  currentContract: contract,
}

function body(suggestions: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return {
    protocol: 'assistant-reply-body/1',
    projectId,
    conversationId,
    sourceMessageId,
    replyMessageId: 'reply-1',
    model: 'test-model',
    text: 'Here is what I suggest.',
    suggestions,
    ...overrides,
  }
}

test('supported candidates are projected with the exact remaining user inputs and no execution', () => {
  const review = reviewReplyCandidates(
    body([
      { kind: 'reply', text: 'Plain answer', sourceRefs: [] },
      { kind: 'propose_work', goal: 'Add retry budget checks', projectId, sourceMessageId },
      { kind: 'propose_revision', expected: contract, rationale: 'Tighten the criteria', sourceMessageId },
      { kind: 'propose_decision', content: 'Retries are capped at five minutes.', scope, sourceMessageId },
    ]),
    bindings,
  )
  assert.equal(review.protocol, 'reply-candidate-review/1')
  assert.equal(review.status, 'candidates')
  assert.equal(review.reply, 'Here is what I suggest.')
  assert.equal(review.modelCallPerformed, false)
  assert.equal(review.authorization, 'none')
  assert.equal(review.untrusted, true)
  assert.equal(review.candidates.length, 4)
  assert.equal(review.hasExecutableCandidates, true)

  const [reply, work, revision, decision] = review.candidates
  assert.equal(reply!.plan.kind, 'no_effect')
  assert.deepEqual(work!.plan, {
    kind: 'needs_user_input',
    missing: ['work.scope', 'work.criteria', 'work.profileId'],
  })
  assert.deepEqual(revision!.plan, {
    kind: 'needs_user_input',
    missing: ['revision.goal', 'revision.scope', 'revision.criteria'],
  })
  assert.equal(decision!.plan.kind, 'requires_explicit_confirmation')
  assert.equal(decision!.plan.kind === 'requires_explicit_confirmation' && decision!.plan.commandKind, 'record_decision')

  for (const candidate of review.candidates) {
    assert.equal(candidate.executable, false)
    assert.equal(candidate.requiresUserConfirmation, true)
    assert.equal(candidate.trust, 'untrusted_data')
    assert.equal(candidate.payloadDigest.length, 64)
    // Display fields are labels derived from the candidate, not authority.
    assert.equal(Object.hasOwn(candidate, 'actor'), false)
    assert.equal(Object.hasOwn(candidate, 'permissions'), false)
    assert.ok(candidate.fields.every((field) => typeof field.value === 'string'))
  }
  assert.equal(work!.title, 'Proposed work')
  assert.equal(work!.summary, 'Add retry budget checks')
})

test('foreign-project, stale-contract and unbound suggestions are refused with reasons', () => {
  const review = reviewReplyCandidates(
    body([
      { kind: 'propose_work', goal: 'Other project work', projectId: 'project-2', sourceMessageId },
      { kind: 'propose_decision', content: 'Foreign decision', scope: { ...scope, projectId: 'project-2' }, sourceMessageId },
      { kind: 'propose_revision', expected: { ...contract, revision: 3 }, rationale: 'Old contract', sourceMessageId },
      { kind: 'propose_decision', content: 'Widening scope', scope: { ...scope, allowedPaths: ['src', '/etc'] }, sourceMessageId },
    ]),
    bindings,
  )
  // The body schema itself refuses another project's work/decision for this project/source...
  assert.equal(review.status, 'invalid_body')
  assert.equal(review.candidates.length, 0)
  assert.equal(review.hasExecutableCandidates, false)

  // ...and when the port layer only checks the body, the review still refuses current-binding drift.
  const drift = reviewReplyCandidates(
    body(
      [
        { kind: 'propose_work', goal: 'Other project work', projectId: 'project-2', sourceMessageId },
        { kind: 'propose_decision', content: 'Foreign decision', scope: { ...scope, projectId: 'project-2' }, sourceMessageId },
        { kind: 'propose_revision', expected: { ...contract, revision: 3 }, rationale: 'Old contract', sourceMessageId },
      ],
      { projectId: 'project-2' },
    ),
    bindings,
  )
  assert.equal(drift.status, 'no_candidates')
  assert.deepEqual(drift.rejected.map((entry) => entry.reason), ['cross_project', 'cross_project', 'contract_stale'])
  assert.equal(drift.reply, 'Here is what I suggest.')
})

test('a body with no legal candidate keeps the ordinary reply and never invents a candidate', () => {
  const review = reviewReplyCandidates(body([]), bindings)
  assert.equal(review.status, 'no_candidates')
  assert.equal(review.candidates.length, 0)
  assert.equal(review.hasExecutableCandidates, false)
  assert.equal(review.reply, 'Here is what I suggest.')
  assert.equal(review.modelCallPerformed, false)

  const replyOnly = reviewReplyCandidates(
    body([{ kind: 'reply', text: 'Just an answer', sourceRefs: [] }]),
    bindings,
  )
  assert.equal(replyOnly.status, 'candidates')
  assert.equal(replyOnly.hasExecutableCandidates, false)
})

test('an invalid or oversized reply body is reported without retry or partial acceptance', () => {
  const invalid = reviewReplyCandidates({ protocol: 'wrong' }, bindings)
  assert.equal(invalid.status, 'invalid_body')
  assert.equal(invalid.candidates.length, 0)
  assert.equal(invalid.reply, '')
  assert.equal(invalid.modelCallPerformed, false)

  const tooMany = reviewReplyCandidates(
    body(Array.from({ length: 9 }, () => ({ kind: 'reply', text: 'x', sourceRefs: [] }))),
    bindings,
  )
  assert.equal(tooMany.status, 'invalid_body')

  const mismatchedSource = reviewReplyCandidates(
    body([{ kind: 'propose_work', goal: 'Work', projectId, sourceMessageId: 'other-message' }]),
    bindings,
  )
  assert.equal(mismatchedSource.status, 'invalid_body')
})

test('candidate bounds and invalid configuration are enforced explicitly', () => {
  const review = reviewReplyCandidates(
    body(Array.from({ length: 8 }, (_, index) => ({ kind: 'reply', text: `answer ${index}`, sourceRefs: [] }))),
    { ...bindings, maxCandidates: 3 },
  )
  assert.equal(review.candidates.length, 3)
  assert.deepEqual(review.rejected.map((entry) => entry.reason), ['max_candidates', 'max_candidates', 'max_candidates', 'max_candidates', 'max_candidates'])
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(() => reviewReplyCandidates(body([]), { ...bindings, maxCandidates: invalid }), TypeError)
  }
})

test('a revision proposal without a current contract is refused rather than guessed', () => {
  const withoutContract = {
    projectId: bindings.projectId,
    sourceMessageId: bindings.sourceMessageId,
    conversationId: bindings.conversationId,
    grantId: bindings.grantId,
    grantScope: bindings.grantScope,
  }
  const review = reviewReplyCandidates(
    body([{ kind: 'propose_revision', expected: contract, rationale: 'Change', sourceMessageId }]),
    withoutContract,
  )
  assert.equal(review.status, 'no_candidates')
  assert.deepEqual(review.rejected.map((entry) => entry.reason), ['contract_stale'])
})
