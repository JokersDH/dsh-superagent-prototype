import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UserDecisionSchema } from '@personal-agent/contracts'
import type { Interpretation, InterventionRecord, Scope } from '@personal-agent/contracts'
import {
  DecisionConflict,
  DecisionError,
  DecisionGovernance,
  InMemoryDecisionStore,
  StaticDecisionSourcePort,
} from '../src/index.ts'
import type { DecisionActor, DecisionSource } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'

const scope = (overrides: Partial<Scope> = {}): Scope => ({
  projectId: 'project-1',
  allowedPaths: ['src'],
  excludedPaths: [],
  externalActions: [],
  ...overrides,
})

const actor = (overrides: Partial<DecisionActor> = {}): DecisionActor => ({
  actorRef: 'user-1',
  projectId: 'project-1',
  grantScope: scope(),
  ...overrides,
})

const message = (overrides: Partial<DecisionSource> = {}): DecisionSource => ({
  messageId: 'msg-1',
  conversationId: 'conv-1',
  projectId: 'project-1',
  role: 'user',
  provenance: 'trusted_user',
  createdAt: NOW,
  textDigest: 'a'.repeat(64),
  title: 'Use Chinese UI copy',
  ...overrides,
})

function fixture(messages: readonly DecisionSource[] = [message()], now: () => Date = () => new Date(NOW)) {
  const store = new InMemoryDecisionStore()
  const sources = new StaticDecisionSourcePort(messages)
  const governance = new DecisionGovernance(store, sources, { now })
  return { store, sources, governance }
}

const record = (governance: DecisionGovernance, overrides: Partial<{ decisionId: string; content: string; scope: Scope; sourceMessageId: string; supersedes: string }> = {}) =>
  governance.record(
    {
      decisionId: 'decision-1',
      content: 'Use Chinese UI copy',
      scope: scope(),
      sourceMessageId: 'msg-1',
      ...overrides,
    },
    actor(),
  )

test('records an explicit user decision with source provenance and a queryable page', async () => {
  const { governance } = fixture()
  const result = await record(governance)
  assert.equal(result.record.status, 'active')
  assert.equal(result.record.recordedAt, NOW)
  assert.equal(result.record.sourceMessageId, 'msg-1')
  assert.deepEqual(UserDecisionSchema.parse(result.record.decision), result.record.decision)

  const page = await governance.page('project-1')
  assert.deepEqual(page.decisions.map((decision) => decision.id), ['decision-1'])
  assert.equal(page.sources.length, 1)
  assert.equal(page.sources[0]?.id, 'msg-1')
  assert.equal(page.sources[0]?.validity, 'current')
  assert.match(page.sources[0]?.locationRef ?? '', /^src-[a-f0-9]{32}$/)
})

test('only an explicit trusted user message can become reusable knowledge', async () => {
  const cases: readonly { readonly source: DecisionSource; readonly code: string }[] = [
    { source: message({ role: 'assistant' }), code: 'not_explicit_user_confirmation' },
    { source: message({ provenance: 'reasoner_reply' }), code: 'not_explicit_user_confirmation' },
    { source: message({ questionKind: 'permission' }), code: 'authorization_not_shareable' },
    { source: message({ questionKind: 'authentication' }), code: 'authorization_not_shareable' },
    { source: message({ projectId: 'project-2' }), code: 'source_project_mismatch' },
  ]
  for (const item of cases) {
    const { governance } = fixture([item.source])
    await assert.rejects(record(governance), (error: unknown) =>
      error instanceof DecisionError && error.code === item.code, `expected ${item.code}`)
  }
  const { governance } = fixture([])
  await assert.rejects(record(governance), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_missing')
})

test('cross-project and scope-escalating decisions are refused', async () => {
  const { governance } = fixture()
  await assert.rejects(
    record(governance, { scope: scope({ projectId: 'project-2' }) }),
    (error: unknown) => error instanceof DecisionError && error.code === 'cross_project',
  )
  const limited = fixture()
  await assert.rejects(
    limited.governance.record(
      { decisionId: 'decision-2', content: 'x', scope: scope({ allowedPaths: ['everything'] }), sourceMessageId: 'msg-1' },
      actor({ grantScope: scope({ allowedPaths: ['src'] }) }),
    ),
    (error: unknown) => error instanceof DecisionError && error.code === 'scope_escalation',
  )
})

test('revocation is versioned, idempotent and removes the decision from new knowledge', async () => {
  const { governance } = fixture()
  await record(governance)
  const revoked = await governance.revoke('decision-1', 1, actor())
  assert.equal(revoked.record.status, 'revoked')
  assert.equal(revoked.record.decision.version, 2)
  assert.equal(await governance.isEffective('decision-1'), false)
  assert.deepEqual((await governance.page('project-1')).decisions, [])

  const again = await governance.revoke('decision-1', 2, actor())
  assert.equal(again.idempotent, true)
  await assert.rejects(governance.revoke('decision-1', 1, actor()), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'stale_version')
  await assert.rejects(governance.revoke('decision-1', 2, actor({ projectId: 'project-2' })), (error: unknown) =>
    error instanceof DecisionError && error.code === 'cross_project')
})

test('a new decision supersedes an older one in the same project only', async () => {
  const { governance } = fixture()
  await record(governance)
  await record(governance, { decisionId: 'decision-2', content: 'Use English UI copy', supersedes: 'decision-1' })
  const page = await governance.page('project-1')
  assert.deepEqual(page.decisions.map((decision) => decision.id), ['decision-2'])
  assert.equal((await governance.isEffective('decision-1')), false)

  await assert.rejects(
    record(governance, { decisionId: 'decision-3', content: 'x', supersedes: 'decision-1' }),
    (error: unknown) => error instanceof DecisionError && error.code === 'supersede_inactive',
  )

  const wider = fixture()
  await wider.governance.record(
    { decisionId: 'old', content: 'old', scope: scope({ allowedPaths: ['src', 'docs'] }), sourceMessageId: 'msg-1' },
    actor({ grantScope: scope({ allowedPaths: ['src', 'docs'] }) }),
  )
  await assert.rejects(
    wider.governance.record(
      { decisionId: 'new', content: 'new', scope: scope({ allowedPaths: ['src'] }), sourceMessageId: 'msg-1', supersedes: 'old' },
      actor({ grantScope: scope({ allowedPaths: ['src', 'docs'] }) }),
    ),
    (error: unknown) => error instanceof DecisionError && error.code === 'scope_escalation',
  )
})

test('expired decisions never enter new knowledge and cannot be recorded already-expired', async () => {
  let now = Date.parse(NOW)
  const { governance } = fixture([message()], () => new Date(now))
  const expiring = scope({ expiresAt: new Date(now + 60_000).toISOString() })
  await governance.record(
    { decisionId: 'decision-1', content: 'Temporary rule', scope: expiring, sourceMessageId: 'msg-1' },
    actor({ grantScope: expiring }),
  )
  assert.equal((await governance.page('project-1')).decisions.length, 1)
  now += 120_000
  assert.equal((await governance.page('project-1')).decisions.length, 0)
  assert.equal(await governance.isEffective('decision-1'), false)
  await assert.rejects(
    governance.record(
      { decisionId: 'decision-2', content: 'x', scope: expiring, sourceMessageId: 'msg-1' },
      actor({ grantScope: expiring }),
    ),
    (error: unknown) => error instanceof DecisionError && error.code === 'invalid_scope',
  )
})

test('a disappeared source is shown as missing while the audit record remains', async () => {
  const { governance, sources } = fixture()
  await record(governance)
  sources.markMissing('msg-1')
  const page = await governance.page('project-1')
  assert.equal(page.decisions.length, 1)
  assert.equal(page.sources[0]?.validity, 'missing')
})

test('keyset pagination is bounded and does not duplicate decisions', async () => {
  const messages = Array.from({ length: 5 }, (_, index) =>
    message({ messageId: `msg-${index + 1}`, title: `Decision ${index + 1}` }),
  )
  const { governance } = fixture(messages)
  for (let index = 0; index < 5; index += 1) {
    await record(governance, {
      decisionId: `decision-${index + 1}`,
      content: `Rule ${index + 1}`,
      sourceMessageId: `msg-${index + 1}`,
    })
  }
  const first = await governance.page('project-1', { limit: 2 })
  assert.equal(first.decisions.length, 2)
  assert.ok(first.nextCursor)
  const second = await governance.page('project-1', {
    limit: 2,
    ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
  })
  const third = await governance.page('project-1', {
    limit: 2,
    ...(second.nextCursor === undefined ? {} : { cursor: second.nextCursor }),
  })
  const ids = [...first.decisions, ...second.decisions, ...third.decisions].map((decision) => decision.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.length, 5)
})

test('old-version replay is idempotent and a changed payload or stale version conflicts', async () => {
  const store = new InMemoryDecisionStore()
  const decision = {
    id: 'decision-1',
    version: 1,
    content: 'Use Chinese UI copy',
    scope: scope(),
    authorityRef: 'user-1',
  }
  const input = { decision, sourceMessageId: 'msg-1', actorRef: 'user-1', recordedAt: NOW }
  const first = await store.append(input)
  const replay = await store.append(input)
  assert.equal(first.idempotent, false)
  assert.equal(replay.idempotent, true)
  await assert.rejects(
    store.append({ ...input, decision: { ...decision, content: 'Different content' } }),
    (error: unknown) => error instanceof DecisionConflict && error.code === 'payload_mismatch',
  )
  await assert.rejects(
    store.append({ ...input, decision: { ...decision, version: 3 } }),
    (error: unknown) => error instanceof DecisionConflict && error.code === 'stale_version',
  )
})

test('automatic promotion stays closed and classifies one-off corrections', () => {
  const { governance } = fixture()
  const intervention = { id: 'i1', projectId: 'project-1', ticketRefs: [], assignmentRefs: [], actorRef: 'user-1', source: 'direct_message', environmentRef: 'env-1', rawFeedbackRef: 'raw-1', occurredAt: NOW } as unknown as InterventionRecord
  const interpretation = (labels: readonly string[]) =>
    ({ id: 'i1', interventionId: 'i1', revision: 1, labels, evidenceRefs: [], hypothesisRef: 'h1' }) as unknown as Interpretation
  assert.deepEqual(governance.evaluateAutomaticPromotion({ intervention, interpretation: interpretation(['execution_violation']) }), {
    eligible: false,
    reason: 'automatic_promotion_out_of_scope',
    classification: 'agent_deviation',
  })
  assert.equal(
    governance.evaluateAutomaticPromotion({ intervention, interpretation: interpretation(['temporary_environment']) }).classification,
    'temporary_environment',
  )
  assert.equal(
    governance.evaluateAutomaticPromotion({ intervention, interpretation: interpretation(['explicit_preference']) }).classification,
    'requires_explicit_decision',
  )
})

test('knowledge is project-scoped and revoked content is not returned to another project', async () => {
  const { governance } = fixture()
  await record(governance)
  assert.equal((await governance.page('project-2')).decisions.length, 0)
  const effective = await governance.listEffective('project-1')
  assert.equal(effective.length, 1)
  assert.equal((await governance.listEffective('project-2')).length, 0)
})
