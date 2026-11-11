import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scope } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'
import {
  AssistantDecisionStore,
  DecisionConflict,
  DecisionError,
  DecisionTransactionService,
} from '../src/index.ts'
import type { DecisionActor, DecisionSource, DecisionSourceSyncPort } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const actor: DecisionActor = { actorRef: 'user-1', projectId: scope.projectId, grantScope: scope }

function sourcePort(ports: ReturnType<typeof createWorkflowPorts>): DecisionSourceSyncPort {
  return {
    getMessage(messageId: string): DecisionSource | undefined {
      const value = ports.index.sourceMessage(messageId, [scope.projectId])
      if (!value) return undefined
      return {
        messageId: value.id,
        conversationId: value.conversationId,
        projectId: value.projectId ?? scope.projectId,
        role: value.role,
        provenance: value.provenance as DecisionSource['provenance'],
        createdAt: value.createdAt,
        textDigest: value.textDigest,
      }
    },
  }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pa-c-real-decision-'))
  const file = join(root, 'state.sqlite')
  let store = new ProductStore({ path: file })
  let ports = createWorkflowPorts(store)
  store.product.messages.append({
    id: 'message-1',
    conversationId: 'conversation-1',
    projectId: scope.projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'Explicitly retain this decision',
    sourceRefs: [],
    createdAt: NOW,
  })
  let tick = 0
  const clock = () => new Date(Date.parse(NOW) + tick)
  return {
    get store() {
      return store
    },
    get ports() {
      return ports
    },
    reopen() {
      store.close()
      store = new ProductStore({ path: file })
      ports = createWorkflowPorts(store)
    },
    advance(ms: number) {
      tick += ms
    },
    service() {
      return new DecisionTransactionService(new AssistantDecisionStore(ports.assistant), sourcePort(ports), { now: clock })
    },
    cleanup() {
      store.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  decisionId: 'decision-1',
  content: 'Explicit reusable decision',
  scope,
  sourceMessageId: 'message-1',
  ...overrides,
})

test('real SQLite: prepare is read-only, commit is atomic and replay is stable at two times', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const service = fixture.service()
  const prepared = service.prepare(input(), actor)
  assert.equal(fixture.ports.assistant.decisions.get('decision-1'), undefined)

  const created = fixture.store.uow.atomic(() => {
    const result = service.commit(prepared, actor)
    fixture.store.commands.record('decision-command-1', canonicalDigest({ decisionId: 'decision-1' }), () => ({ status: 'recorded' }))
    return result
  })
  assert.equal(created.record.status, 'active')
  assert.equal(fixture.ports.assistant.decisions.get('decision-1')?.decision.version, 1)
  assert.ok(fixture.store.commands.get('decision-command-1'))

  fixture.advance(60_000)
  const later = service.prepare(input(), actor)
  assert.notEqual(later.recordedAt, prepared.recordedAt)
  const replay = fixture.store.uow.atomic(() => service.commit(later, actor))
  assert.equal(replay.idempotent, true)
  assert.equal(fixture.ports.assistant.decisions.history('decision-1').length, 1)

  fixture.reopen()
  const reopened = fixture.service()
  assert.equal(reopened.sourceState('decision-1'), 'current')
  const oldReplay = fixture.store.uow.atomic(() => reopened.commit(prepared, actor))
  assert.equal(oldReplay.idempotent, true)
  assert.equal(fixture.ports.assistant.decisions.history('decision-1').length, 1)
})

test('real SQLite: revoke persists a revision and old replay does not resurrect it', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const service = fixture.service()
  const prepared = service.prepare(input(), actor)
  fixture.store.uow.atomic(() => service.commit(prepared, actor))
  fixture.store.uow.atomic(() => service.revoke('decision-1', 1, actor))
  fixture.reopen()

  const reopened = fixture.service()
  assert.equal(reopened.sourceState('decision-1'), 'current')
  assert.equal(new AssistantDecisionStore(fixture.ports.assistant).getSync('decision-1')?.status, 'revoked')
  const oldReplay = fixture.store.uow.atomic(() => reopened.commit(prepared, actor))
  assert.equal(oldReplay.record.status, 'revoked')
  assert.equal(oldReplay.record.decision.version, 2)
  assert.equal(fixture.ports.assistant.decisions.history('decision-1').length, 2)
  assert.throws(() => reopened.revoke('decision-1', 1, actor), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'stale_version')
})

test('real SQLite: receipt failure rolls back the decision and source invalidation blocks commit', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const service = fixture.service()
  const prepared = service.prepare(input(), actor)
  fixture.store.db.exec(`CREATE TRIGGER reject_decision_receipt BEFORE INSERT ON command_receipts
    WHEN NEW.command_id = 'decision-command-fail' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`)
  assert.throws(() =>
    fixture.store.uow.atomic(() => {
      service.commit(prepared, actor)
      fixture.store.commands.record('decision-command-fail', canonicalDigest({ decisionId: 'decision-1' }), () => ({ status: 'recorded' }))
    }),
  )
  assert.equal(fixture.ports.assistant.decisions.get('decision-1'), undefined)
  assert.equal(fixture.store.commands.get('decision-command-fail'), undefined)
  fixture.store.db.exec('DROP TRIGGER reject_decision_receipt')

  const preparedTwo = service.prepare(input({ decisionId: 'decision-2', content: 'Second decision' }), actor)
  const missingSource = new DecisionTransactionService(
    new AssistantDecisionStore(fixture.ports.assistant),
    { getMessage: () => undefined },
    { now: () => new Date(NOW) },
  )
  assert.throws(() => missingSource.commit(preparedTwo, actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_stale')
  assert.equal(fixture.ports.assistant.decisions.get('decision-2'), undefined)

  fixture.store.uow.atomic(() => service.commit(prepared, actor))
  const changed = service.prepare(input({ content: 'Changed body' }), actor)
  assert.throws(() => service.commit(changed, actor), (error: unknown) =>
    error instanceof DecisionConflict && error.code === 'payload_mismatch')
})
