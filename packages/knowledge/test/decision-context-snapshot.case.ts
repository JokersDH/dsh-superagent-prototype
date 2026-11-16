import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import { InMemoryAssistantState } from '@personal-agent/proposals'
import { AssistantDecisionStore, DecisionError, DecisionGovernance, captureDecisionSnapshot, revalidateDecisionSnapshot } from '../src/index.ts'
import type { DecisionActor, DecisionSource } from '../src/index.ts'

const NOW = '2026-11-16T00:00:00.000Z'
const scope = (projectId = 'project-1'): Scope => ({ projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] })
const actor = (projectId = 'project-1'): DecisionActor => ({ actorRef: 'user-1', projectId, grantScope: scope(projectId) })
const message = (id: string, projectId = 'project-1', textDigest = 'a'.repeat(64)): DecisionSource => ({
  messageId: id, conversationId: `conv-${projectId}`, projectId, role: 'user', provenance: 'trusted_user',
  createdAt: NOW, textDigest, title: 'explicit decision',
})

function fixture() {
  let tick = 0
  const clock = () => new Date(Date.parse(NOW) + tick)
  const store = new AssistantDecisionStore(new InMemoryAssistantState())
  const messages = new Map<string, DecisionSource>()
  const sources = { getMessage: async (id: string) => messages.get(id) }
  const governance = new DecisionGovernance(store, sources, { now: clock })
  return { governance, messages, advance: (ms: number) => (tick += ms) }
}

void test('a current decision snapshot is bounded, project-scoped and revalidated against live governance', async () => {
  const { governance, messages, advance } = fixture()
  messages.set('msg-1', message('msg-1'))
  messages.set('msg-2', message('msg-2', 'project-1', 'b'.repeat(64)))
  messages.set('msg-3', message('msg-3'))
  messages.set('msg-x', message('msg-x', 'project-2'))
  await governance.record({ decisionId: 'd1', content: '保留错误码', scope: scope(), sourceMessageId: 'msg-1' }, actor())
  await governance.record({ decisionId: 'd2', content: '结构化错误对象', scope: scope(), sourceMessageId: 'msg-2' }, actor())
  await governance.record({ decisionId: 'dx', content: '另一个项目', scope: scope('project-2'), sourceMessageId: 'msg-x' }, actor('project-2'))

  const snapshot = await captureDecisionSnapshot(governance, { projectId: 'project-1', max: 10, now: new Date(NOW) })
  assert.equal(snapshot.protocol, 'decision-context-snapshot/1')
  assert.equal(snapshot.authorization, 'none')
  assert.equal(snapshot.projectId, 'project-1')
  assert.equal(snapshot.coverage.scan, 'complete')
  assert.equal(snapshot.coverage.callerTruncated, false)
  assert.deepEqual(snapshot.decisions.map((decision) => decision.decisionId).sort(), ['d1', 'd2'])
  for (const decision of snapshot.decisions) {
    assert.equal(decision.version, 1)
    assert.match(decision.contentDigest, /^[a-f0-9]{64}$/)
    assert.equal(decision.scope.projectId, 'project-1')
    assert.match(decision.sourceTextDigest, /^[a-f0-9]{64}$/)
  }
  const fresh = await revalidateDecisionSnapshot(governance, snapshot, { projectId: 'project-1', now: new Date(NOW) })
  assert.equal(fresh.valid, true)
  assert.equal(fresh.decisions.every((decision) => decision.valid), true)

  // Project isolation, caller cap and explicit selection.
  const capped = await captureDecisionSnapshot(governance, { projectId: 'project-1', max: 1, now: new Date(NOW) })
  assert.equal(capped.coverage.callerTruncated, true)
  assert.equal(capped.decisions.length, 1)
  const selected = await captureDecisionSnapshot(governance, { projectId: 'project-1', selectedDecisionIds: ['d2'], now: new Date(NOW) })
  assert.deepEqual(selected.decisions.map((decision) => decision.decisionId), ['d2'])
  await assert.rejects(() => captureDecisionSnapshot(governance, { projectId: 'project-1', selectedDecisionIds: ['missing'], now: new Date(NOW) }),
    (error: unknown) => error instanceof DecisionError && error.code === 'not_found')
  const mismatch = await revalidateDecisionSnapshot(governance, snapshot, { projectId: 'project-2', now: new Date(NOW) })
  assert.equal(mismatch.valid, false)
  assert.equal(mismatch.code, 'project_mismatch')

  // Revocation and supersession invalidate the old snapshot without rewriting history.
  await governance.revoke('d1', 1, actor())
  const revoked = await revalidateDecisionSnapshot(governance, snapshot, { projectId: 'project-1', now: new Date(NOW) })
  assert.equal(revoked.valid, false)
  assert.equal(revoked.code, 'inactive')
  const d2Snapshot = await captureDecisionSnapshot(governance, { projectId: 'project-1', selectedDecisionIds: ['d2'], now: new Date(NOW) })
  await governance.record({ decisionId: 'd3', content: '替代版', scope: scope(), sourceMessageId: 'msg-3', supersedes: 'd2' }, actor())
  const superseded = await revalidateDecisionSnapshot(governance, d2Snapshot, { projectId: 'project-1', now: new Date(NOW) })
  assert.equal(superseded.valid, false)

  // A live source change and an elapsed scope expiry are separate invalidation reasons.
  const d3Snapshot = await captureDecisionSnapshot(governance, { projectId: 'project-1', selectedDecisionIds: ['d3'], now: new Date(NOW) })
  messages.set('msg-3', message('msg-3', 'project-1', 'c'.repeat(64)))
  const stale = await revalidateDecisionSnapshot(governance, d3Snapshot, { projectId: 'project-1', now: new Date(NOW) })
  assert.equal(stale.valid, false)
  assert.equal(stale.code, 'source_stale')

  const expiring = '2026-11-16T01:00:00.000Z'
  await governance.record({ decisionId: 'd4', content: '短期决定', scope: { ...scope(), expiresAt: expiring }, sourceMessageId: 'msg-1' }, actor())
  const expiringSnapshot = await captureDecisionSnapshot(governance, { projectId: 'project-1', selectedDecisionIds: ['d4'], now: new Date(NOW) })
  const expired = await revalidateDecisionSnapshot(governance, expiringSnapshot, { projectId: 'project-1', now: new Date('2026-11-16T02:00:00.000Z') })
  assert.equal(expired.valid, false)
  assert.equal(expired.code, 'expired')

  // A tampered version is refused, not silently trusted.
  const tampered = { ...d2Snapshot, decisions: d2Snapshot.decisions.map((decision) => ({ ...decision, version: 99 })) }
  const tamperResult = await revalidateDecisionSnapshot(governance, tampered, { projectId: 'project-1', now: new Date(NOW) })
  assert.equal(tamperResult.valid, false)
  assert.equal(tamperResult.code !== undefined, true)
  advance(1000)
})

void test('an incomplete governance scan refuses snapshot creation instead of returning a smaller complete set', async () => {
  const store = new AssistantDecisionStore(new InMemoryAssistantState())
  const broken = Object.create(store) as AssistantDecisionStore
  broken.list = async () => { throw new DecisionError('scan_incomplete', 'scan exceeded its bound') }
  const governance = new DecisionGovernance(broken, { getMessage: async () => undefined })
  await assert.rejects(() => captureDecisionSnapshot(governance, { projectId: 'project-1' }),
    (error: unknown) => error instanceof DecisionError && error.code === 'scan_incomplete')
})
