/**
 * Wave-08 A2/A3: production RecoveryActivationFacts consumed by main's RecoveryIntentCommitter.
 * Real SQLite, real source UnitOfWork, no mock committer.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecoveryActivationIntent, TrustedActor } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProductStore, PRODUCT_SCHEMA_VERSION } from '@personal-agent/storage'
import { RecoveryIntentCommitter } from '../../../apps/coordinator/product/recovery-intents.ts'
const faultCode = (error: unknown): string | undefined => (error as { error?: { code?: string } } | null)?.error?.code
import { createWorkflowPorts, WorkflowConflict } from '../src/index.ts'

const at = '2026-11-11T00:00:00.000Z'
const actor: TrustedActor = { userId: 'user-1', authorityRef: 'authority-1', source: 'local_ui' }
const intent = (overrides: Partial<RecoveryActivationIntent> = {}): RecoveryActivationIntent => ({
  protocol: 'recovery-activation-intent/1', activationId: 'activation-1', commandId: 'recovery-command-1',
  planId: 'recovery-plan-1', planDigest: 'a'.repeat(64),
  source: { stateId: 'state-source', stateRoot: '/tmp/source-state', markerDigest: 'b'.repeat(64), inspectionFingerprint: 'c'.repeat(64) },
  target: { generationId: 'generation-1', stateRoot: '/tmp/target-state', configurationDigest: 'd'.repeat(64) },
  principal: { userId: 'user-1', authorityRef: 'authority-1' },
  machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
  createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z', ...overrides,
})
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

test('shared facts put/get/forCommand are immutable, unique and conflict on any identity change', () => {
  const dir = tmp('recovery-activation-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const facts = createWorkflowPorts(store).recoveryActivations
    const created = facts.put(intent())
    assert.equal(created.replayed, false)
    assert.deepEqual(created.intent, intent())
    assert.deepEqual(facts.get('activation-1'), intent())
    assert.deepEqual(facts.forCommand('recovery-command-1'), intent())
    assert.equal(facts.put(intent()).replayed, true)
    assert.throws(() => facts.put(intent({ target: { generationId: 'generation-1', stateRoot: '/tmp/other', configurationDigest: 'd'.repeat(64) } })), WorkflowConflict)
    assert.throws(() => facts.put(intent({ resourcePolicyDigest: '0'.repeat(64) })), WorkflowConflict)
    assert.throws(() => facts.put(intent({ principal: { userId: 'user-2', authorityRef: 'authority-1' } })), WorkflowConflict)
    assert.throws(() => facts.put(intent({ planId: 'another-plan' })), WorkflowConflict)
    // A second activation for the same plan is the same intent or a conflict, never a second grant.
    assert.throws(() => facts.put(intent({ activationId: 'activation-2' })), WorkflowConflict)
    assert.deepEqual(facts.get('activation-1'), intent())
    assert.throws(() => facts.put(intent({ source: { ...intent().source, stateRoot: intent().target.stateRoot } })), WorkflowConflict)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function harness(revalidate?: (intent: RecoveryActivationIntent) => void) {
  const dir = tmp('recovery-committer-')
  const path = join(dir, 'state.sqlite')
  let store = new ProductStore({ path })
  const ports = createWorkflowPorts(store)
  let checked = 0
  const committer = new RecoveryIntentCommitter(store, ports.recoveryActivations,
    { userId: actor.userId, authorityRef: actor.authorityRef },
    value => { checked += 1; revalidate?.(value) }, () => at)
  return {
    get store() { return store },
    get facts() { return ports.recoveryActivations },
    get checked() { return checked },
    committer,
    reopen() { store.close(); store = new ProductStore({ path }) },
    cleanup() { store.close(); rmSync(dir, { recursive: true, force: true }); },
  }
}

test('main RecoveryIntentCommitter writes fact, receipt and event in one source transaction and replays it', () => {
  const h = harness()
  try {
    const committed = h.committer.commit(intent(), actor)
    assert.equal(committed.sourceReceipt.commandId, 'recovery-command-1')
    assert.ok(committed.sourceReceipt.seq > 0)
    assert.deepEqual(h.facts.get('activation-1'), intent())
    assert.equal(h.store.commands.get('recovery-command-1')!.status, 'recorded')
    assert.equal(h.store.events.after(0, 20).filter(event => event.topic === 'application.recovery.intent').length, 1)
    assert.equal(h.checked, 1, 'current machine/resource revalidation runs once before the fact')

    const replay = h.committer.commit(intent(), actor)
    assert.equal(replay.sourceReceipt.seq, committed.sourceReceipt.seq)
    assert.equal(h.store.events.after(0, 20).filter(event => event.topic === 'application.recovery.intent').length, 1)
    assert.throws(() => h.committer.commit(intent(), { ...actor, userId: 'other' }), (error: unknown) =>
      faultCode(error) === 'forbidden')
    assert.throws(() => h.committer.commit(intent({ resourcePolicyDigest: '0'.repeat(64) }), actor), (error: unknown) =>
      faultCode(error) === 'conflict')

    h.reopen()
    const reopened = createWorkflowPorts(h.store)
    assert.deepEqual(reopened.recoveryActivations.get('activation-1'), intent())
    const replayAfter = new RecoveryIntentCommitter(h.store, reopened.recoveryActivations,
      { userId: actor.userId, authorityRef: actor.authorityRef }, () => undefined, () => at).commit(intent(), actor)
    assert.equal(replayAfter.sourceReceipt.seq, committed.sourceReceipt.seq, 'a lost response replays the original receipt')
  } finally { h.cleanup() }
})

test('a failed receipt or target revalidation leaves no activation fact, receipt or event', () => {
  const failing = harness()
  try {
    failing.store.db.exec(`CREATE TRIGGER reject_activation_receipt BEFORE INSERT ON command_receipts
      WHEN NEW.command_id = 'recovery-command-1' BEGIN SELECT RAISE(ABORT, 'injected activation receipt failure'); END`)
    assert.throws(() => failing.committer.commit(intent(), actor), /injected activation receipt failure/)
    assert.equal(failing.facts.get('activation-1'), undefined)
    assert.equal(failing.store.commands.get('recovery-command-1'), undefined)
    assert.equal(failing.store.events.after(0, 20).length, 0)
  } finally { failing.cleanup() }

  const blocked = harness(() => { throw Object.assign(new Error('Target preparation is unavailable'), { name: 'ApplicationFault', error: { code: 'verification_failed' } }) })
  try {
    assert.throws(() => blocked.committer.commit(intent(), actor), (error: unknown) =>
      faultCode(error) === 'verification_failed')
    assert.equal(blocked.facts.get('activation-1'), undefined)
    assert.equal(blocked.store.commands.get('recovery-command-1'), undefined)
    assert.equal(blocked.store.events.after(0, 20).length, 0)
  } finally { blocked.cleanup() }
})

test('legacy v14 plan intents stay audit-only and are never returned as activation facts', () => {
  const dir = tmp('recovery-legacy-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    ports.recoveryIntents.record({
      commandId: 'legacy-command', actor: { userId: 'user-1', authorityRef: 'authority-1' },
      plan: { protocol: 'recovery-plan/1', planId: 'legacy-plan', inspectionFingerprint: 'f'.repeat(64),
        createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
        bindings: [{ sourceProjectId: 'project-1', proposedProjectId: 'project-1', path: '/tmp/project',
          headCommit: 'f'.repeat(40), configurationDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }],
        executor: null, artifactsChecked: 0, artifactScanTruncated: false,
        blockers: [{ code: 'authorization_not_implemented', owner: 'main', detail: 'legacy' }],
        authorization: 'not_granted', commitAvailable: false },
      expectedInspectionFingerprint: 'f'.repeat(64), sourceFingerprint: 'f'.repeat(64), confirmedAt: at,
    })
    assert.equal(ports.recoveryIntents.getByPlan('legacy-plan')!.plan.planId, 'legacy-plan')
    assert.equal(ports.recoveryActivations.get('legacy-plan'), undefined)
    assert.equal(ports.recoveryActivations.forCommand('legacy-command'), undefined)
    assert.equal(ports.recoveryActivations.get('activation-1'), undefined)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a v14 database with a legacy plan intent upgrades to v15 without rewriting or promoting it', async () => {
  const dir = tmp('recovery-v14-')
  const path = join(dir, 'state.sqlite')
  const legacyPlan = {
    protocol: 'recovery-plan/1', planId: 'legacy-plan', inspectionFingerprint: 'f'.repeat(64),
    createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
    bindings: [{ sourceProjectId: 'project-1', proposedProjectId: 'project-1', path: '/tmp/project',
      headCommit: 'f'.repeat(40), configurationDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }],
    executor: null, artifactsChecked: 0, artifactScanTruncated: false,
    blockers: [{ code: 'authorization_not_implemented', owner: 'main', detail: 'legacy' }],
    authorization: 'not_granted', commitAvailable: false,
  }
  const envelope = { protocol: 'recovery-intent/1', plan: legacyPlan, userId: 'user-1', actorRef: 'authority-1',
    inspectionFingerprint: 'f'.repeat(64), sourceFingerprint: 'f'.repeat(64), confirmedAt: at }
  const envelopeDigest = canonicalDigest(JSON.parse(JSON.stringify(envelope)))
  try {
    const Database = (await import('better-sqlite3')).default
    const legacy = new Database(path)
    const { applyMigrations, MIGRATIONS } = await import('@personal-agent/storage')
    applyMigrations(legacy, { registry: MIGRATIONS.slice(0, 14) })
    legacy.prepare(`INSERT INTO recovery_intents
      (command_id, plan_id, plan_digest, inspection_fingerprint, source_fingerprint, user_id, actor_ref,
       payload, digest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'legacy-command', 'legacy-plan', canonicalDigest(JSON.parse(JSON.stringify(legacyPlan))), 'f'.repeat(64), 'f'.repeat(64),
      'user-1', 'authority-1', JSON.stringify(envelope), envelopeDigest, at, legacyPlan.expiresAt,
    )
    legacy.close()

    const store = new ProductStore({ path })
    try {
      assert.equal(store.database.productSchema, PRODUCT_SCHEMA_VERSION)
      const legacyRead = store.workflows.recoveryIntents.getByPlan('legacy-plan')!
      assert.deepEqual(legacyRead.plan, legacyPlan, 'the legacy row is still readable as audit evidence')
      assert.equal(legacyRead.authorization, 'not_granted')
      assert.equal(store.workflows.recoveryActivations.get('legacy-plan'), undefined)
      assert.equal(store.workflows.recoveryActivations.forCommand('legacy-command'), undefined)
      // A new activation uses the shared schema and never silently inherits the legacy row.
      store.workflows.recoveryActivations.put(intent({ planId: 'legacy-plan' }))
      assert.equal(store.workflows.recoveryActivations.get('activation-1')!.planId, 'legacy-plan')
      assert.equal(store.workflows.recoveryIntents.getByPlan('legacy-plan')!.plan.planId, 'legacy-plan')
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
