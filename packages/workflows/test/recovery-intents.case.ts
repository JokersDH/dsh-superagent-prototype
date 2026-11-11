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
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowConflict } from '../src/index.ts'

const at = '2026-11-11T00:00:00.000Z'
const fingerprint = 'f'.repeat(64)
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
    assert.equal(recorded.record.authorization, 'not_granted')
    assert.equal(recorded.record.activationAvailable, false)
    assert.equal(recorded.record.planDigest.length, 64)
    assert.ok(store.commands.get('recovery-command-1'))
    assert.equal(store.events.after(0, 10).filter(event => event.topic === 'recovery.intent.recorded').length, 1)

    const replay = ports.recoveryIntents.record(input())
    assert.equal(replay.replayed, true)
    assert.equal(replay.record.planId, 'recovery-plan-1')
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
      assert.equal(reopened.recoveryIntents.getByPlan('recovery-plan-1')!.authorization, 'not_granted')
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
