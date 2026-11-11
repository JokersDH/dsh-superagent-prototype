/**
 * Wave-06 A4: real A/C SQLite integration. C's decision domain (AssistantDecisionStore +
 * DecisionTransactionService, the source main composes) runs on A's ProductStore/AssistantStatePort
 * and real source-message index. No fake store, no SQL writer outside A.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { Scope } from '@personal-agent/contracts'
import { ProductStore } from '@personal-agent/storage'
import {
  AssistantDecisionStore, DecisionConflict, DecisionError, DecisionTransactionService,
} from '@personal-agent/knowledge'
import type { DecisionActor, DecisionSource, DecisionSourceSyncPort } from '@personal-agent/knowledge'
import { createWorkflowPorts } from '../src/index.ts'
import type { WorkflowPorts } from '../src/index.ts'

const NOW = '2026-11-11T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const actor: DecisionActor = { actorRef: 'actor-1', projectId: scope.projectId, grantScope: scope }

function sourcePort(ports: WorkflowPorts): DecisionSourceSyncPort {
  return {
    getMessage(messageId: string): DecisionSource | undefined {
      const value = ports.index.sourceMessage(messageId, [scope.projectId])
      if (!value) return undefined
      return {
        messageId: value.id, conversationId: value.conversationId,
        projectId: value.projectId ?? scope.projectId,
        role: value.role, provenance: value.provenance as DecisionSource['provenance'],
        createdAt: value.createdAt, textDigest: value.textDigest,
      }
    },
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pa-a-c-decision-'))
  const file = join(root, 'state.sqlite')
  let store = new ProductStore({ path: file })
  let ports = createWorkflowPorts(store)
  store.product.messages.append({
    id: 'message-1', conversationId: 'conversation-1', projectId: scope.projectId, role: 'user',
    provenance: 'trusted_user', text: '记住：小步提交。', sourceRefs: [], createdAt: NOW,
  })
  let tick = 0
  return {
    get store() { return store },
    get ports() { return ports },
    advance(ms: number) { tick += ms },
    reopen() {
      store.close()
      store = new ProductStore({ path: file })
      ports = createWorkflowPorts(store)
    },
    service: () => new DecisionTransactionService(new AssistantDecisionStore(ports.assistant), sourcePort(ports), {
      now: () => new Date(Date.parse(NOW) + tick),
    }),
    cleanup() {
      store.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  decisionId: 'decision-a-c', content: '小步提交，并保留真实测试。', scope, sourceMessageId: 'message-1', ...overrides,
})

test('real SQLite: A port + C prepare/commit, same-body replay and changed-body conflict', (t) => {
  const fixtureA = fixture()
  t.after(fixtureA.cleanup)
  const service = fixtureA.service()
  const prepared = service.prepare(input(), actor)
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c'), undefined, 'prepare writes nothing')
  assert.equal(fixtureA.store.events.after(0, 10).length, 0, 'prepare appends no event')

  const committed = fixtureA.store.uow.atomic(() => {
    const result = service.commit(prepared, actor)
    fixtureA.store.events.append({ topic: 'application.decision.changed', entityRef: 'decision-a-c',
      payload: { decisionId: 'decision-a-c', projectId: scope.projectId } })
    fixtureA.store.commands.record('decision-command-1', canonicalDigest({ kind: 'record_decision' }), () => ({ status: 'recorded' }))
    return result
  })
  assert.equal(committed.record.status, 'active')
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c')!.sourceTextDigest.length, 64)
  assert.ok(fixtureA.store.commands.get('decision-command-1'))
  assert.equal(fixtureA.store.events.after(0, 10).filter(event => event.topic === 'application.decision.changed').length, 1)

  // Same version/body at a later clock time is idempotent across the C service and A port.
  fixtureA.advance(30_000)
  const later = service.prepare(input(), actor)
  const replay = fixtureA.store.uow.atomic(() => service.commit(later, actor))
  assert.equal(replay.idempotent, true)
  assert.equal(fixtureA.ports.assistant.decisions.history('decision-a-c').length, 1)

  const changed = service.prepare(input({ content: '改成另一条决定。' }), actor)
  assert.throws(() => fixtureA.store.uow.atomic(() => service.commit(changed, actor)), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'payload_mismatch')
  assert.equal(fixtureA.ports.assistant.decisions.history('decision-a-c').length, 1, 'a changed body is never persisted')

  fixtureA.reopen()
  const reopened = fixtureA.service()
  assert.equal(reopened.sourceState('decision-a-c'), 'current')
  assert.equal(fixtureA.store.uow.atomic(() => reopened.commit(prepared, actor)).idempotent, true)
  assert.equal(fixtureA.ports.assistant.decisions.list({ projectId: scope.projectId }).records.length, 1)
})

test('real SQLite: revoke appends a version, stale revoke conflicts and old commit does not resurrect', (t) => {
  const fixtureA = fixture()
  t.after(fixtureA.cleanup)
  const service = fixtureA.service()
  const prepared = service.prepare(input(), actor)
  fixtureA.store.uow.atomic(() => service.commit(prepared, actor))

  const plan = service.prepareRevocation('decision-a-c', 1, actor)
  const revoked = fixtureA.store.uow.atomic(() => service.commitRevocation(plan, actor))
  assert.equal(revoked.record.status, 'revoked')
  assert.equal(revoked.record.decision.version, 2)
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c')!.revokedBy, actor.actorRef)
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c')!.decision.revokedAt !== undefined, true)

  assert.throws(() => service.revoke('decision-a-c', 1, actor), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'stale_version')
  const oldReplay = fixtureA.store.uow.atomic(() => service.commit(prepared, actor))
  assert.equal(oldReplay.record.status, 'revoked')
  assert.equal(oldReplay.record.decision.version, 2)
  assert.equal(fixtureA.ports.assistant.decisions.history('decision-a-c').length, 2)

  // A revoked decision cannot be a supersession base; the read-only prepare already refuses.
  assert.throws(() => service.prepare(input({ decisionId: 'decision-next', supersedes: 'decision-a-c' }), actor),
    (error: unknown) => error instanceof DecisionError && error.code === 'supersede_inactive')
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-next'), undefined)
})

test('real SQLite: source deletion/change blocks commit and reports missing/stale without fabricated data', (t) => {
  const fixtureA = fixture()
  t.after(fixtureA.cleanup)
  const service = fixtureA.service()
  const prepared = service.prepare(input(), actor)
  fixtureA.store.uow.atomic(() => service.commit(prepared, actor))
  assert.equal(service.sourceState('decision-a-c'), 'current')

  const changedText = fixtureA.store.product.messages.page('conversation-1').messages[0]!
  fixtureA.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?')
    .run(JSON.stringify({ ...changedText, text: 'source text changed outside the decision' }), 'message-1')
  assert.equal(service.sourceState('decision-a-c'), 'stale')
  const second = service.prepare(input({ decisionId: 'decision-second' }), actor)
  fixtureA.store.db.prepare("DELETE FROM conversation_messages WHERE id = 'message-1'").run()
  assert.equal(service.sourceState('decision-a-c'), 'missing')
  assert.throws(() => fixtureA.store.uow.atomic(() => service.commit(second, actor)), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_stale')
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-second'), undefined)
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c')!.decision.version, 1, 'existing record stays auditable')
})

test('real SQLite: a receipt failure rolls back C decision rows, event and receipt together', (t) => {
  const fixtureA = fixture()
  t.after(fixtureA.cleanup)
  const service = fixtureA.service()
  const prepared = service.prepare(input(), actor)
  fixtureA.store.db.exec(`CREATE TRIGGER reject_decision_receipt BEFORE INSERT ON command_receipts
    WHEN NEW.command_id = 'decision-command-fail' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`)
  assert.throws(() => fixtureA.store.uow.atomic(() => {
    service.commit(prepared, actor)
    fixtureA.store.events.append({ topic: 'application.decision.changed', entityRef: 'decision-a-c', payload: { decisionId: 'decision-a-c' } })
    fixtureA.store.commands.record('decision-command-fail', canonicalDigest({ kind: 'record_decision' }), () => ({ status: 'recorded' }))
  }), /injected receipt failure/)
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c'), undefined)
  assert.equal(fixtureA.store.events.after(0, 10).length, 0)
  assert.equal(fixtureA.store.commands.get('decision-command-fail'), undefined)
  fixtureA.store.db.exec('DROP TRIGGER reject_decision_receipt')
  assert.equal(service.prepare(input(), actor).decision.version, 1)
  fixtureA.store.uow.atomic(() => service.commit(prepared, actor))
  assert.equal(fixtureA.ports.assistant.decisions.get('decision-a-c')!.decision.version, 1)
})
