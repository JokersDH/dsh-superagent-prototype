import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import { reviewReplyCandidates, reviewVerifiedReplyCandidates } from '../src/index.ts'

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

  // Per-item current-binding drift inside a matching envelope is refused item by item.
  const drift = reviewReplyCandidates(
    body([
      { kind: 'propose_revision', expected: { ...contract, revision: 3 }, rationale: 'Old contract', sourceMessageId },
      {
        kind: 'propose_decision',
        content: 'Widening scope',
        // Valid path atoms, but `docs` is outside the trusted grant scope.
        scope: { ...scope, allowedPaths: [...scope.allowedPaths, 'docs'] },
        sourceMessageId,
      },
    ]),
    bindings,
  )
  assert.equal(drift.status, 'no_candidates')
  assert.deepEqual(drift.rejected.map((entry) => entry.reason), ['contract_stale', 'scope_escalation'])
  assert.equal(drift.reply, 'Here is what I suggest.')
})

test('a whole reply body bound to another conversation/project is invalid before any suggestion', () => {
  const cases = [
    {
      envelope: { conversationId: 'foreign-conversation' },
      suggestion: { kind: 'propose_decision', scope, content: 'Envelope candidate', sourceMessageId },
    },
    {
      envelope: { projectId: 'foreign-project' },
      suggestion: { kind: 'propose_work', goal: 'Foreign envelope work', projectId: 'foreign-project', sourceMessageId },
    },
    {
      envelope: { sourceMessageId: 'other-source' },
      suggestion: { kind: 'propose_work', goal: 'Other source work', projectId, sourceMessageId: 'other-source' },
    },
  ]
  for (const { envelope, suggestion } of cases) {
    const review = reviewReplyCandidates(body([suggestion], envelope), bindings)
    assert.equal(review.status, 'invalid_body')
    assert.equal(review.candidates.length, 0)
    assert.equal(review.reply, '')
    assert.deepEqual(review.rejected.map((entry) => entry.reason), ['body_binding_mismatch'])
  }
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

test('an expired-or-wider candidate scope and a foreign revision are refused item by item', () => {
  const expiringGrant = {
    ...bindings,
    grantScope: { ...scope, expiresAt: '2026-11-12T10:00:00.000Z' },
  }
  const review = reviewReplyCandidates(
    body([
      {
        kind: 'propose_decision',
        content: 'Decision outliving the grant',
        scope: { ...scope, expiresAt: '2026-11-12T12:00:00.000Z' },
        sourceMessageId,
      },
      { kind: 'propose_revision', expected: { ...contract, revision: 9 }, rationale: 'Foreign revision', sourceMessageId },
    ]),
    expiringGrant,
  )
  assert.equal(review.status, 'no_candidates')
  assert.deepEqual(review.rejected.map((entry) => entry.reason), ['scope_escalation', 'contract_stale'])
  assert.equal(review.hasExecutableCandidates, false)
  assert.equal(review.modelCallPerformed, false)
})

test('only a main-verified completed reply reaches the candidate reviewer', () => {
  const bodyValue = body([
    { kind: 'propose_decision', content: 'Verified candidate', scope, sourceMessageId },
  ])
  const identity = {
    requestId: 'assistant-request:message-1',
    replyMessageId: 'reply-1',
    sourceMessageId,
    projectId,
    conversationId,
    model: 'test-model',
    principal: { userId: 'user-1', authorityRef: 'authority-1' },
  }
  const verified = { ...bindings, principal: identity.principal }

  const accepted = reviewVerifiedReplyCandidates({ verifiedBy: 'main-completed-reply', body: bodyValue, identity }, verified)
  assert.equal(accepted.status, 'candidates')
  assert.equal(accepted.verifiedBy, 'main-completed-reply')
  assert.equal(accepted.candidates.length, 1)
  assert.equal(accepted.candidates[0]!.executable, false)

  // A raw body, an unknown marker or a hand-written string is refused.
  assert.deepEqual(reviewVerifiedReplyCandidates(bodyValue, verified).rejected.map((entry) => entry.reason), ['unverified_reply'])
  assert.deepEqual(
    reviewVerifiedReplyCandidates({ verifiedBy: 'trusted', body: bodyValue, identity }, verified).rejected.map((entry) => entry.reason),
    ['unverified_reply'],
  )

  // Identity drift between body, verified request and current bindings is refused.
  const foreignModel = { ...verified, principal: identity.principal }
  assert.deepEqual(
    reviewVerifiedReplyCandidates({ verifiedBy: 'main-completed-reply', body: { ...bodyValue, model: 'other-model' }, identity }, foreignModel)
      .rejected.map((entry) => entry.reason),
    ['reply_identity_mismatch'],
  )
  assert.deepEqual(
    reviewVerifiedReplyCandidates(
      { verifiedBy: 'main-completed-reply', body: bodyValue, identity: { ...identity, sourceMessageId: 'other-source' } },
      foreignModel,
    ).rejected.map((entry) => entry.reason),
    ['reply_identity_mismatch'],
  )
  assert.deepEqual(
    reviewVerifiedReplyCandidates(
      { verifiedBy: 'main-completed-reply', body: bodyValue, identity: { ...identity, principal: { userId: 'other', authorityRef: 'other' } } },
      verified,
    ).rejected.map((entry) => entry.reason),
    ['principal_unverified'],
  )
  assert.deepEqual(
    reviewVerifiedReplyCandidates({ verifiedBy: 'main-completed-reply', body: bodyValue, identity }, bindings)
      .rejected.map((entry) => entry.reason),
    ['principal_unverified'],
  )
})

test('unknown verified-wrapper input is refused before any dereference', () => {
  const bodyValue = body([{ kind: 'reply', text: 'Plain answer', sourceRefs: [] }])
  const identity = {
    requestId: 'assistant-request:message-1',
    replyMessageId: 'reply-1',
    sourceMessageId,
    projectId,
    conversationId,
    model: 'test-model',
    principal: { userId: 'user-1', authorityRef: 'authority-1' },
  }
  const verifiedBindings = { ...bindings, principal: identity.principal }

  // Null body, null identity, missing principal and non-object input never throw.
  for (const input of [
    null,
    undefined,
    42,
    'verified',
    [],
    { verifiedBy: 'main-completed-reply', body: null, identity },
    { verifiedBy: 'main-completed-reply', body: bodyValue, identity: null },
    {
      verifiedBy: 'main-completed-reply',
      body: bodyValue,
      identity: {
        requestId: identity.requestId,
        replyMessageId: identity.replyMessageId,
        sourceMessageId,
        projectId,
        conversationId,
        model: identity.model,
      },
    },
  ]) {
    const review = reviewVerifiedReplyCandidates(input, verifiedBindings)
    assert.equal(review.status, 'invalid_body')
    assert.equal(review.candidates.length, 0)
    assert.equal(review.modelCallPerformed, false)
  }

  // A null field inside an otherwise-shaped wrapper is also an incomplete identity, not a throw.
  const partial = reviewVerifiedReplyCandidates(
    { verifiedBy: 'main-completed-reply', body: { ...bodyValue, model: null }, identity },
    verifiedBindings,
  )
  assert.equal(partial.status, 'invalid_body')
  assert.deepEqual(partial.rejected.map((entry) => entry.reason), ['incomplete_identity'])

  // The valid typed positive still reaches the candidate reviewer.
  const positive = reviewVerifiedReplyCandidates({ verifiedBy: 'main-completed-reply', body: bodyValue, identity }, verifiedBindings)
  assert.equal(positive.status, 'candidates')
  assert.equal(positive.candidates.length, 1)
  assert.equal(positive.verifiedBy, 'main-completed-reply')
})

test('public unknown candidate input fails closed for getters, hostile arrays and oversized data', () => {
  const throwing = {
    get protocol() {
      throw new Error('getter exploded')
    },
    text: 'hello',
    suggestions: [],
  }
  assert.equal(reviewReplyCandidates(throwing, bindings).status, 'invalid_body')

  const getterSuggestions = {
    protocol: 'assistant-reply-body/1',
    projectId,
    conversationId,
    sourceMessageId,
    replyMessageId: 'reply-1',
    model: 'test-model',
    text: 'hello',
    get suggestions(): never {
      throw new Error('suggestions getter exploded')
    },
  }
  assert.equal(reviewReplyCandidates(getterSuggestions, bindings).status, 'invalid_body')

  // Oversized suggestion lists, holes and symbol keys stay bounded failures, not partial acceptance.
  const oversized = body(Array.from({ length: 10_000 }, () => ({ kind: 'reply', text: 'x', sourceRefs: [] })))
  assert.equal(reviewReplyCandidates(oversized, bindings).status, 'invalid_body')
  const sparse = body([, ,]) as unknown as Record<string, unknown>
  assert.equal(reviewReplyCandidates(sparse, bindings).status, 'invalid_body')
  const symbolKeyed = { ...body([{ kind: 'reply', text: 'x', sourceRefs: [] }]), [Symbol('extra')]: true }
  assert.equal(reviewReplyCandidates(symbolKeyed, bindings).status, 'invalid_body')

  // A verified wrapper whose property read throws is refused without dereference or throw.
  const verifiedInput = {
    get verifiedBy(): never {
      throw new Error('wrapper getter exploded')
    },
  }
  assert.equal(reviewVerifiedReplyCandidates(verifiedInput, { ...bindings, principal: { userId: 'user-1', authorityRef: 'authority-1' } }).status, 'invalid_body')
})
