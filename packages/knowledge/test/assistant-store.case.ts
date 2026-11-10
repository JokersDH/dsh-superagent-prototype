import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PersistedDecisionSchema } from '@personal-agent/contracts'
import { InMemoryAssistantState } from '@personal-agent/proposals'
import {
  AssistantDecisionStore,
  DecisionConflict,
  DecisionGovernance,
  StaticDecisionSourcePort,
} from '../src/index.ts'
import type { DecisionActor, DecisionSource } from '../src/index.ts'
import type { Scope } from '@personal-agent/contracts'

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

function fixture(messages: readonly DecisionSource[] = [message()], now: () => Date = () => new Date(NOW)) {
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port)
  const sources = new StaticDecisionSourcePort(messages)
  const governance = new DecisionGovernance(store, sources, { now })
  return { port, store, sources, governance }
}

const record = (
  governance: DecisionGovernance,
  overrides: Partial<{ decisionId: string; content: string; scope: Scope; sourceMessageId: string; supersedes: string }> = {},
) =>
  governance.record(
    {
      decisionId: 'decision-1',
      content: 'Use Chinese UI copy',
      scope,
      sourceMessageId: 'msg-1',
      ...overrides,
    },
    actor,
  )

test('the persisted decision adapter writes source identity and history through the shared port', async () => {
  const { port, governance } = fixture()
  await record(governance)
  const persisted = port.decisions.get('decision-1')
  assert.ok(persisted)
  assert.deepEqual(PersistedDecisionSchema.parse(persisted), persisted)
  assert.equal(persisted?.sourceMessageId, 'msg-1')
  assert.equal(persisted?.conversationId, 'conv-1')
  assert.equal(persisted?.sourceTextDigest, 'a'.repeat(64))
  assert.equal(persisted?.decision.version, 1)

  const page = await governance.page('project-1')
  assert.deepEqual(page.decisions.map((decision) => decision.id), ['decision-1'])
  assert.equal((await governance.listEffective('project-1')).length, 1)
})

test('revocation appends a persisted revision and removes effective knowledge', async () => {
  const { port, governance } = fixture()
  await record(governance)
  const revoked = await governance.revoke('decision-1', 1, actor)
  assert.equal(revoked.record.status, 'revoked')
  assert.equal(port.decisions.history('decision-1').length, 2)
  assert.equal(port.decisions.get('decision-1')?.decision.revokedAt, NOW)
  assert.equal(await governance.isEffective('decision-1'), false)
  assert.deepEqual((await governance.page('project-1')).decisions, [])
  await assert.rejects(governance.revoke('decision-1', 1, actor), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'stale_version')
})

test('a new governance/store over the same port sees the decision after state reload', async () => {
  const { port, governance } = fixture()
  await record(governance)
  const restarted = new DecisionGovernance(
    new AssistantDecisionStore(port),
    new StaticDecisionSourcePort([message()]),
    { now: () => new Date(NOW) },
  )
  assert.equal(await restarted.isEffective('decision-1'), true)
  assert.equal((await restarted.page('project-1')).decisions.length, 1)
})

test('missing or stale sources invalidate persisted decisions while history remains', async () => {
  const { port, governance, sources } = fixture()
  await record(governance)
  sources.markMissing('msg-1')
  assert.equal(await governance.isEffective('decision-1'), false)
  assert.equal(await governance.decisionSourceState('decision-1'), 'missing')
  assert.equal((await governance.listEffective('project-1')).length, 0)
  assert.ok(port.decisions.history('decision-1').length > 0)

  const changed = fixture()
  await record(changed.governance)
  changed.sources.replace(message({ textDigest: 'b'.repeat(64) }))
  assert.equal(await changed.governance.decisionSourceState('decision-1'), 'stale')
})

test('supersession and project-scoped pagination work over the persisted adapter', async () => {
  const messages = Array.from({ length: 3 }, (_, index) =>
    message({ messageId: `msg-${index + 1}`, title: `Decision ${index + 1}` }),
  )
  const { governance, port } = fixture(messages)
  for (let index = 0; index < 3; index += 1) {
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
  const ids = [...first.decisions, ...second.decisions].map((decision) => decision.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.length, 3)

  await record(governance, {
    decisionId: 'decision-4',
    content: 'Replacement rule',
    sourceMessageId: 'msg-1',
    supersedes: 'decision-1',
  })
  assert.equal(port.decisions.get('decision-1')?.decision.supersedes, undefined)
  assert.equal((await governance.page('project-1')).decisions.some((decision) => decision.id === 'decision-1'), false)
})

test('the persisted adapter rejects stale versions and changed bodies', async () => {
  const { store, port } = fixture()
  const recorded = await record(
    new DecisionGovernance(store, new StaticDecisionSourcePort([message()]), { now: () => new Date(NOW) }),
  )
  assert.equal(recorded.record.decision.version, 1)
  await assert.rejects(
    store.append({
      decision: { ...recorded.record.decision, content: 'Different' },
      sourceMessageId: 'msg-1',
      sourceConversationId: 'conv-1',
      sourceTextDigest: 'a'.repeat(64),
      actorRef: 'user-1',
      recordedAt: NOW,
    }),
    (error: unknown) => error instanceof DecisionConflict && error.code === 'payload_mismatch',
  )
  assert.equal(port.decisions.history('decision-1').length, 1)
})
