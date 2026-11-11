/**
 * Wave-07 A2/A4: recovery intent facts are synchronous, idempotent and joined to the caller receipt/
 * event transaction. They never become execution authorization and never consume queues.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { RecoveryPlan } from '@personal-agent/contracts'
import { applyMigrations, MIGRATIONS, PRODUCT_SCHEMA_VERSION, ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowConflict } from '../src/index.ts'

const at = '2026-11-11T00:00:00.000Z'
const fingerprint = 'f'.repeat(64)
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const actor = { userId: 'user-1', authorityRef: 'authority-1' }
const plan = (overrides: Partial<RecoveryPlan> = {}): RecoveryPlan => ({
  protocol: 'recovery-plan/1', planId: 'recovery-plan-1', inspectionFingerprint: fingerprint,
  createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
  bindings: [{ sourceProjectId: 'source-project', proposedProjectId: 'proposed-project', path: '/tmp/project',
    headCommit: 'a'.repeat(40), configurationDigest: 'b'.repeat(64), scopeDigest: 'c'.repeat(64) }],
  executor: { profileId: 'codex', revision: 1, version: '0.164.0', executableDigest: 'd'.repeat(64) },
  artifactsChecked: 0, artifactScanTruncated: false,
  blockers: [{ code: 'authorization_not_implemented', owner: 'main', detail: 'commit not connected' }],
  authorization: 'not_granted', commitAvailable: false, ...overrides,
})
const input = (overrides: Record<string, unknown> = {}) => ({
  commandId: 'recovery-command-1', actor, plan: plan(), expectedInspectionFingerprint: fingerprint,
  sourceFingerprint: fingerprint, confirmedAt: at, ...overrides,
})
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

test('recovery intent is one stable fact with receipt/event in the caller transaction', () => {
  const dir = tmp('recovery-intent-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    const recorded = store.uow.atomic(() => {
      const result = ports.recoveryIntents.record(input())
      store.events.append({ topic: 'recovery.intent.recorded', entityRef: result.record.planId,
        payload: { planId: result.record.planId, commandId: result.record.commandId } })
      store.commands.record('recovery-command-1', canonicalDigest({ planId: 'recovery-plan-1' }), () => ({ status: 'recorded' }))
      return result
    })
    assert.equal(recorded.replayed, false)
    assert.deepEqual(recorded.record.plan, plan(), 'the read-back record returns the plan, never the stored envelope')
    assert.equal(recorded.record.plan.protocol, 'recovery-plan/1')
    assert.equal(recorded.record.plan.bindings[0]!.proposedProjectId, 'proposed-project')
    assert.equal(recorded.record.plan.executor!.executableDigest, 'd'.repeat(64))
    assert.equal(recorded.record.planDigest, canonicalDigest(JSON.parse(JSON.stringify(plan()))))
    assert.equal(recorded.record.createdAt, at)
    assert.equal(recorded.record.expiresAt, plan().expiresAt)
    assert.equal(recorded.record.actorRef, actor.authorityRef)
    assert.equal(recorded.record.authorization, 'not_granted')
    assert.equal(recorded.record.activationAvailable, false)
    assert.equal(recorded.record.planDigest.length, 64)
    assert.ok(store.commands.get('recovery-command-1'))
    assert.equal(store.events.after(0, 10).filter(event => event.topic === 'recovery.intent.recorded').length, 1)

    const replay = ports.recoveryIntents.record(input())
    assert.equal(replay.replayed, true)
    assert.equal(replay.record.planId, 'recovery-plan-1')
    assert.deepEqual(replay.record.plan, plan())
    assert.deepEqual(ports.recoveryIntents.getByCommand('recovery-command-1')!.plan, plan())
    assert.deepEqual(ports.recoveryIntents.list().records[0]!.plan, plan())
    assert.equal(ports.recoveryIntents.list().records.length, 1)

    // A second command for the same plan/body is the same stable intent, not a second authorization.
    const samePlan = ports.recoveryIntents.record(input({ commandId: 'recovery-command-2' }))
    assert.equal(samePlan.replayed, true)
    assert.equal(samePlan.record.commandId, 'recovery-command-1')
    assert.equal(ports.recoveryIntents.list().records.length, 1)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('changed plan, drifted source, expired plan and a different actor are refused without a second fact', () => {
  const dir = tmp('recovery-conflict-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const port = createWorkflowPorts(store).recoveryIntents
    port.record(input())
    assert.throws(() => port.record(input({ plan: plan({ planId: 'recovery-plan-1', artifactsChecked: 3 }) })), WorkflowConflict)
    assert.throws(() => port.record(input({ plan: plan({ planId: 'recovery-plan-drift' }), sourceFingerprint: 'e'.repeat(64) })), WorkflowConflict)
    assert.throws(() => port.record(input({ plan: plan({ planId: 'recovery-plan-expired', expiresAt: '2026-11-11T00:00:00.000Z' }) })), WorkflowConflict)
    assert.throws(() => port.record(input({ plan: plan({ planId: 'recovery-plan-granted', authorization: 'not_granted' }), actor: { userId: 'other', authorityRef: 'authority-1' } })), WorkflowConflict)
    assert.equal(port.list().records.length, 1)
    assert.equal(port.getByPlan('recovery-plan-drift'), undefined)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a receipt failure rolls the intent back; reopen replays the committed fact and queues are untouched', () => {
  const dir = tmp('recovery-rollback-')
  const path = join(dir, 'state.sqlite')
  let store = new ProductStore({ path })
  try {
    const ports = createWorkflowPorts(store)
    store.queue.enqueue('application.execute', 'old-queue-row', '{"legacy":true}', 1, 0, at)
    store.db.exec(`CREATE TRIGGER reject_recovery_receipt BEFORE INSERT ON command_receipts
      WHEN NEW.command_id = 'recovery-command-fail' BEGIN SELECT RAISE(ABORT, 'injected recovery receipt failure'); END`)
    assert.throws(() => store.uow.atomic(() => {
      ports.recoveryIntents.record(input({ commandId: 'recovery-command-fail' }))
      store.events.append({ topic: 'recovery.intent.recorded', entityRef: 'recovery-plan-1', payload: { planId: 'recovery-plan-1' } })
      store.commands.record('recovery-command-fail', canonicalDigest({ planId: 'recovery-plan-1' }), () => ({ status: 'recorded' }))
    }), /injected recovery receipt failure/)
    assert.equal(ports.recoveryIntents.getByPlan('recovery-plan-1'), undefined)
    assert.equal(store.events.after(0, 10).length, 0)
    store.db.exec('DROP TRIGGER reject_recovery_receipt')

    const committed = store.uow.atomic(() => {
      const result = ports.recoveryIntents.record(input())
      store.commands.record('recovery-command-1', canonicalDigest({ planId: 'recovery-plan-1' }), () => ({ status: 'recorded' }))
      return result
    })
    assert.equal(committed.replayed, false)
    const queuedBefore = store.queue.oldestRow('application.execute')!
    store.close()

    store = new ProductStore({ path })
    try {
      const reopened = createWorkflowPorts(store)
      const readBack = reopened.recoveryIntents.getByPlan('recovery-plan-1')!
      assert.equal(readBack.authorization, 'not_granted')
      assert.deepEqual(readBack.plan, plan(), 'a reopened intent returns the complete plan')
      assert.equal(readBack.planDigest, canonicalDigest(JSON.parse(JSON.stringify(plan()))))
      assert.equal(reopened.recoveryIntents.record(input()).replayed, true)
      assert.equal(reopened.recoveryIntents.list({ sourceFingerprint: fingerprint }).records.length, 1)
      const queuedAfter = store.queue.oldestRow('application.execute')!
      assert.deepEqual(queuedAfter, queuedBefore, 'recording an intent never consumes or rewrites old queues')
      assert.equal(store.bindings.current('any-ticket'), undefined)
    } finally { store.close() }
  } finally {
    if (store.database.productSchema) store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed target preparation leaves the original intent queryable and does not create another authorization', () => {
  const dir = tmp('recovery-target-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const port = createWorkflowPorts(store).recoveryIntents
    const first = port.record(input())
    // D/main's target preparation is outside this port; a failure there must not mutate the source
    // fact, and the caller can re-query it by plan or command identity.
    assert.equal(port.getByPlan(first.record.planId)!.planDigest, first.record.planDigest)
    assert.equal(port.getByCommand('recovery-command-1')!.planId, first.record.planId)
    assert.equal(port.list({ sourceFingerprint: fingerprint }).records.length, 1)
    // A genuinely new plan is a new explicit user decision, never an automatic retry of the failed one.
    const secondPlan = { ...plan(), planId: 'recovery-plan-2' }
    const second = port.record(input({ commandId: 'recovery-command-2', plan: secondPlan }))
    assert.equal(second.replayed, false)
    assert.equal(port.list().records.length, 2)
    assert.equal(port.getByPlan('recovery-plan-1')!.authorization, 'not_granted')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a v13 database upgrades to the current schema with existing rows intact and no intent rows', async () => {
  const dir = tmp('recovery-v13-')
  const path = join(dir, 'state.sqlite')
  try {
    const Database = (await import('better-sqlite3')).default
    const legacy = new Database(path)
    applyMigrations(legacy, { registry: MIGRATIONS.slice(0, 13) })
    legacy.prepare('INSERT INTO works (id, project_id, conversation_id, value, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('work-legacy', 'project-1', 'conversation-1', JSON.stringify({ id: 'work-legacy', projectId: 'project-1', conversationId: 'conversation-1', title: 'Legacy', createdAt: at }), at)
    legacy.prepare(`INSERT INTO user_decision_versions
      (id, version, project_id, content, authority_ref, supersedes, revoked_at, value, digest, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
      .run('decision-legacy', 1, 'project-1', 'legacy content', 'authority-1',
        JSON.stringify({ id: 'decision-legacy', version: 1, content: 'legacy content', scope, authorityRef: 'authority-1' }), 'd'.repeat(64), at)
    legacy.prepare(`INSERT INTO assistant_decision_versions
      (id, version, project_id, source_message_id, source_text_digest, conversation_id, actor_ref, recorded_at, revoked_by, value_digest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
      .run('decision-legacy', 1, 'project-1', 'message-1', 'e'.repeat(64), 'conversation-1', 'actor-1', at, 'd'.repeat(64))
    legacy.close()

    const store = new ProductStore({ path })
    try {
      assert.equal(store.database.productSchema, PRODUCT_SCHEMA_VERSION)
      assert.equal(store.workflows.assistant.decisions.get('decision-legacy')!.decision.content, 'legacy content')
      assert.equal(store.product.works.get('work-legacy')!.title, 'Legacy')
      assert.equal(store.workflows.recoveryIntents.list().records.length, 0)
      assert.equal(store.workflows.recoveryIntents.record(input()).replayed, false)
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test('a hand-edited payload or indexed column is refused instead of returned as a plan', () => {
  const dir = tmp('recovery-inconsistent-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const port = createWorkflowPorts(store).recoveryIntents
    port.record(input())
    store.db.prepare("UPDATE recovery_intents SET plan_digest = ? WHERE plan_id = 'recovery-plan-1'").run('0'.repeat(64))
    assert.throws(() => port.getByPlan('recovery-plan-1'), WorkflowConflict)
    store.db.prepare("UPDATE recovery_intents SET plan_digest = ? WHERE plan_id = 'recovery-plan-1'")
      .run(canonicalDigest(JSON.parse(JSON.stringify(plan()))))
    const payload = JSON.parse(String((store.db.prepare("SELECT payload FROM recovery_intents WHERE plan_id = 'recovery-plan-1'").get() as { payload: string }).payload))
    store.db.prepare("UPDATE recovery_intents SET payload = ? WHERE plan_id = 'recovery-plan-1'")
      .run(JSON.stringify({ ...payload, plan: { ...payload.plan, planId: 'another-plan' } }))
    assert.throws(() => port.getByPlan('recovery-plan-1'), WorkflowConflict)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
