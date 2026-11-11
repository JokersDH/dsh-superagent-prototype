import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import { InMemoryAssistantState } from '@personal-agent/proposals'
import {
  AssistantDecisionStore,
  DecisionConflict,
  DecisionError,
  DecisionTransactionService,
} from '../src/index.ts'
import type { DecisionActor, DecisionSource } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const actor: DecisionActor = { actorRef: 'user-1', projectId: 'project-1', grantScope: scope }
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

function fixture(messages: readonly DecisionSource[] = [message()]) {
  let tick = 0
  const clock = () => new Date(Date.parse(NOW) + tick)
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port)
  const map = new Map(messages.map((item) => [item.messageId, item]))
  const sources = {
    getMessage: (id: string) => map.get(id),
    replace: (item: DecisionSource) => map.set(item.messageId, item),
    remove: (id: string) => map.delete(id),
  }
  const service = new DecisionTransactionService(store, sources, { now: clock })
  return { port, store, sources, service, advance: (ms: number) => (tick += ms) }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  decisionId: 'decision-1',
  content: 'Use Chinese UI copy',
  scope,
  sourceMessageId: 'msg-1',
  ...overrides,
})

test('prepare is read-only and commit/replay are synchronous and stable across time', () => {
  const { port, service, advance } = fixture()
  const prepared = service.prepare(input(), actor)
  assert.equal(port.decisions.get('decision-1'), undefined)
  assert.equal(prepared.recordedAt, NOW)

  const created = service.commit(prepared, actor)
  assert.equal(created.record.status, 'active')
  assert.equal(created.record.decision.version, 1)
  assert.equal(created.idempotent, false)
  assert.equal(port.decisions.history('decision-1').length, 1)

  advance(60_000)
  const retried = service.prepare(input(), actor)
  assert.equal(retried.recordedAt, '2026-11-10T00:01:00.000Z')
  const replay = service.commit(retried, actor)
  assert.equal(replay.idempotent, true)
  assert.equal(port.decisions.history('decision-1').length, 1)
  assert.equal(replay.record.recordedAt, NOW)
  assert.equal(service.sourceState('decision-1'), 'current')
})

test('commit re-checks actor, grant, source digest/conversation and barrier', () => {
  const { service, sources } = fixture()
  const prepared = service.prepare(input(), actor)
  assert.throws(() => service.commit(prepared, { ...actor, actorRef: 'other' }), (error: unknown) =>
    error instanceof DecisionError && error.code === 'actor_mismatch')
  assert.throws(
    () => service.commit(prepared, { ...actor, grantScope: { ...scope, allowedPaths: [] } as Scope }),
    (error: unknown) => error instanceof DecisionError && error.code === 'scope_escalation',
  )
  sources.replace(message({ textDigest: 'b'.repeat(64) }))
  assert.throws(() => service.commit(prepared, actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_stale')
  sources.replace(message())
  sources.replace(message({ conversationId: 'conv-2' }))
  assert.throws(() => service.commit(prepared, actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_stale')
  sources.replace(message())
  assert.throws(
    () => service.commit(prepared, actor, { barrier: () => ({ ok: false, detail: 'writer_active' }) }),
    (error: unknown) => error instanceof DecisionError && error.code === 'barrier_blocked',
  )
})

test('prepare refuses non-explicit, cross-project, escalated, expired and inactive supersession inputs', () => {
  const assistant = fixture([message({ role: 'assistant' })])
  assert.throws(() => assistant.service.prepare(input(), actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'not_explicit_user_confirmation')

  const permission = fixture([message({ questionKind: 'permission' })])
  assert.throws(() => permission.service.prepare(input(), actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'authorization_not_shareable')

  const cross = fixture()
  assert.throws(() => cross.service.prepare(input({ scope: { ...scope, projectId: 'project-2' } }), actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'cross_project')
  assert.throws(
    () => cross.service.prepare(input({ scope: { ...scope, allowedPaths: ['/'] } }), actor),
    (error: unknown) => error instanceof DecisionError && error.code === 'scope_escalation',
  )
  assert.throws(
    () => cross.service.prepare(input({ scope: { ...scope, expiresAt: '2026-11-09T00:00:00.000Z' } }), actor),
    (error: unknown) => error instanceof DecisionError && error.code === 'invalid_scope',
  )

  const missingSupersede = fixture()
  assert.throws(() => missingSupersede.service.prepare(input({ supersedes: 'missing' }), actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'supersede_missing')

  const inactive = fixture()
  const prepared = inactive.service.prepare(input(), actor)
  inactive.service.commit(prepared, actor)
  inactive.service.revoke('decision-1', 1, actor)
  assert.throws(
    () => inactive.service.prepare(input({ decisionId: 'decision-2', supersedes: 'decision-1' }), actor),
    (error: unknown) => error instanceof DecisionError && error.code === 'supersede_inactive',
  )
})

test('revocation and old replays never resurrect a revoked decision', () => {
  const { port, service, advance } = fixture()
  const prepared = service.prepare(input(), actor)
  service.commit(prepared, actor)
  const revoked = service.revoke('decision-1', 1, actor)
  assert.equal(revoked.record.status, 'revoked')
  assert.equal(revoked.record.decision.version, 2)
  assert.equal(port.decisions.history('decision-1').length, 2)

  advance(60_000)
  const oldReplay = service.commit(prepared, actor)
  assert.equal(oldReplay.idempotent, true)
  assert.equal(oldReplay.record.status, 'revoked')
  assert.equal(oldReplay.record.decision.version, 2)
  assert.equal(port.decisions.history('decision-1').length, 2)
  assert.equal(service.sourceState('decision-1'), 'current')

  const again = service.revoke('decision-1', 2, actor)
  assert.equal(again.idempotent, true)
  assert.throws(() => service.revoke('decision-1', 1, actor), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'stale_version')
})

test('same id with changed body, source or actor conflicts instead of overwriting', () => {
  const { port, service } = fixture()
  const prepared = service.prepare(input(), actor)
  service.commit(prepared, actor)

  const changed = service.prepare(input({ content: 'Different content' }), actor)
  assert.throws(() => service.commit(changed, actor), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'payload_mismatch')

  const changedSource = service.prepare(input({ sourceMessageId: 'msg-1' }), actor)
  // Same prepared body but a different source digest is only possible through a forged candidate.
  const forged = { ...changedSource, sourceTextDigest: 'c'.repeat(64) }
  assert.throws(() => service.commit(forged, actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_stale')

  assert.equal(port.decisions.history('decision-1').length, 1)
})

test('supersession is recorded and the old decision becomes ineffective', () => {
  const { service, store, port } = fixture()
  const first = service.prepare(input(), actor)
  service.commit(first, actor)
  const replacement = service.prepare(
    input({ decisionId: 'decision-2', content: 'Use English UI copy', supersedes: 'decision-1' }),
    actor,
  )
  service.commit(replacement, actor)
  assert.equal(store.getSync('decision-1')?.status, 'superseded')
  assert.equal(port.decisions.get('decision-1')?.decision.version, 1)
  assert.equal(store.getSync('decision-2')?.status, 'active')
})
