/**
 * Wave-11 A1/A2: logical recovery-source snapshots over real SQLite. Only one exact committed
 * confirmation may be excluded; every other receipt/business/resource change must be visible.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecoveryActivationIntent, TrustedActor } from '@personal-agent/contracts'
import { ProductStore, WorkflowConflict } from '@personal-agent/storage'
import { RecoveryIntentCommitter } from '../../../apps/coordinator/product/recovery-intents.ts'

const at = '2026-11-12T00:00:00.000Z'
const principal = { userId: 'user-1', authorityRef: 'authority-1' }
const actor: TrustedActor = { ...principal, source: 'local_ui' }
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))
const intent = (overrides: Partial<RecoveryActivationIntent> = {}): RecoveryActivationIntent => ({
  protocol: 'recovery-activation-intent/1', activationId: 'activation-1', commandId: 'recovery-command-1',
  planId: 'plan-1', planDigest: 'b'.repeat(64),
  source: { stateId: 'source-state', stateRoot: '/tmp/source', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
  target: { generationId: 'generation-1', stateRoot: '/tmp/target', configurationDigest: 'e'.repeat(64) },
  principal, machineDigest: 'f'.repeat(64), resourcePolicyDigest: 'a'.repeat(64),
  createdAt: at, expiresAt: '2026-11-12T00:05:00.000Z', ...overrides,
})

function fixture() {
  const root = tmp('recovery-source-')
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  return { root, store, path: join(root, 'state.sqlite') }
}
const commit = (store: ProductStore, value = intent()) => new RecoveryIntentCommitter(
  store, store.workflows.recoveryActivations, principal, () => {}, () => at,
).commit(value, actor)
const commitAt = (store: ProductStore, index: number) => commit(store, intent({ activationId: `activation-${index}`,
  commandId: `recovery-command-${index}`, planId: `plan-${index}` }))

test('an empty current source is complete and exposes no startup authority', () => {
  const f = fixture()
  try {
    const snapshot = f.store.workflows.recoverySource.inspect()
    assert.equal(snapshot.coverage, 'complete')
    assert.equal(snapshot.productSchema, 18)
    assert.equal(snapshot.sourceFingerprint?.length, 64)
    assert.equal(snapshot.startupAvailable, false)
    assert.equal(snapshot.ignoredConfirmation, null)
    assert.deepEqual(snapshot.volatileFieldsIgnored, ['coordinator_instances.heartbeat_at'])
    assert.equal(snapshot.families.some(family => family.name === 'assistant_reply_results'), true)
    assert.equal(snapshot.families.some(family => family.name === 'event_log'), true)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('the exact committed confirmation can be excluded while the observed cursor still advances', () => {
  const f = fixture()
  try {
    const baseline = f.store.workflows.recoverySource.inspect()
    const committed = commit(f.store)
    const raw = f.store.workflows.recoverySource.inspect()
    assert.notEqual(raw.sourceFingerprint, baseline.sourceFingerprint)
    const ignored = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
    assert.equal(ignored.sourceFingerprint, baseline.sourceFingerprint)
    assert.equal(ignored.observedEventCursor, raw.observedEventCursor)
    assert.ok(ignored.observedEventCursor > baseline.observedEventCursor)
    assert.deepEqual(ignored.ignoredConfirmation, { activationId: 'activation-1', commandId: 'recovery-command-1', receiptSeq: committed.sourceReceipt.seq })
    assert.equal(ignored.coverage, 'complete')
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('another confirmation, business row, resource row or writer identity remains visible', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    const baseline = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint
    const second = commit(f.store, intent({ activationId: 'activation-2', commandId: 'recovery-command-2', planId: 'plan-2' }))
    assert.notEqual(f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint, baseline)
    assert.notEqual(f.store.workflows.recoverySource.inspect({ ignoreCommitted: second }).sourceFingerprint, baseline)

    f.store.product.works.insert({ id: 'work-1', projectId: 'project-1', conversationId: 'conversation-1', title: 'Changed business', createdAt: at })
    const afterWork = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint
    assert.notEqual(afterWork, baseline)

    f.store.db.prepare("INSERT INTO coordinator_instances (nonce, pid, started_at, heartbeat_at) VALUES ('n2', 222, ?, ?)").run(at, at)
    const afterWriter = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint
    assert.notEqual(afterWriter, afterWork)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('only the fixed heartbeat column is volatile; pid/nonce/start stay in the digest', () => {
  const f = fixture()
  try {
    f.store.db.prepare("INSERT INTO coordinator_instances (nonce, pid, started_at, heartbeat_at) VALUES ('n1', 111, ?, ?)").run(at, at)
    const before = f.store.workflows.recoverySource.inspect().sourceFingerprint
    f.store.db.prepare("UPDATE coordinator_instances SET heartbeat_at = '2026-11-12T00:00:09.000Z' WHERE nonce = 'n1'").run()
    assert.equal(f.store.workflows.recoverySource.inspect().sourceFingerprint, before)
    f.store.db.prepare("UPDATE coordinator_instances SET pid = 112 WHERE nonce = 'n1'").run()
    assert.notEqual(f.store.workflows.recoverySource.inspect().sourceFingerprint, before)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a forged or mismatched confirmation exclusion is refused', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    assert.throws(() => f.store.workflows.recoverySource.inspect({ ignoreCommitted: {
      ...committed, sourceReceipt: { ...committed.sourceReceipt, seq: committed.sourceReceipt.seq + 1 } } }), WorkflowConflict)
    assert.throws(() => f.store.workflows.recoverySource.inspect({ ignoreCommitted: {
      ...committed, intent: { ...committed.intent, target: { ...committed.intent.target, stateRoot: '/tmp/other' } } } }), WorkflowConflict)
    const ghost = { ...committed, intent: { ...committed.intent, activationId: 'ghost', commandId: 'ghost-command' },
      sourceReceipt: { commandId: 'ghost-command', seq: 1 } }
    assert.throws(() => f.store.workflows.recoverySource.inspect({ ignoreCommitted: ghost }), WorkflowConflict)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a rolled-back confirmation writes nothing and leaves the baseline fingerprint unchanged', () => {
  const f = fixture()
  try {
    const before = f.store.workflows.recoverySource.inspect().sourceFingerprint
    const failing = new RecoveryIntentCommitter(f.store, f.store.workflows.recoveryActivations, principal,
      () => { throw new Error('revalidation failed') }, () => at)
    assert.throws(() => failing.commit(intent(), actor), /revalidation failed/)
    assert.equal(f.store.workflows.recoverySource.inspect().sourceFingerprint, before)
    assert.equal(f.store.workflows.recoveryActivations.get('activation-1'), undefined)
    assert.equal(f.store.commands.get('recovery-command-1'), undefined)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('the fingerprint survives a real close/reopen and bounded scans are never complete', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    const before = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint
    f.store.close()
    const reopened = new ProductStore({ path: f.path })
    try {
      assert.equal(reopened.workflows.recoverySource.inspect({ ignoreCommitted: committed }).sourceFingerprint, before)
      const bounded = reopened.workflows.recoverySource.inspect({ maxRows: 1, maxRowsPerFamily: 1 })
      assert.equal(bounded.coverage, 'bounded')
      assert.equal(bounded.sourceFingerprint, null)
      assert.equal(bounded.issues.includes('scan_bounded'), true)
    } finally { reopened.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('unknown, missing and future schema states are unsupported, never an empty complete source', () => {
  const f = fixture()
  try {
    f.store.db.exec('CREATE TABLE mystery_source_rows (id TEXT PRIMARY KEY)')
    assert.equal(f.store.workflows.recoverySource.inspect().coverage, 'unsupported')
    f.store.db.exec('DROP TABLE mystery_source_rows')
    f.store.db.exec('DROP TABLE assistant_reply_results')
    const missing = f.store.workflows.recoverySource.inspect()
    assert.equal(missing.coverage, 'unsupported')
    assert.equal(missing.issues.includes('missing_table'), true)
    const noEvents = fixture()
    try {
      noEvents.store.db.exec('DROP TABLE event_log')
      const snapshot = noEvents.store.workflows.recoverySource.inspect()
      assert.equal(snapshot.coverage, 'unsupported')
      assert.equal(snapshot.issues.includes('missing_table'), true)
      assert.equal(snapshot.observedEventCursor, 0)
      assert.equal(snapshot.sourceFingerprint, null)
    } finally { noEvents.store.close(); rmSync(noEvents.root, { recursive: true, force: true }) }
    const noSchema = fixture()
    try {
      noSchema.store.db.exec('DROP TABLE schema_meta')
      const snapshot = noSchema.store.workflows.recoverySource.inspect()
      assert.equal(snapshot.coverage, 'unsupported')
      assert.equal(snapshot.productSchema, null)
      assert.equal(snapshot.sourceFingerprint, null)
    } finally { noSchema.store.close(); rmSync(noSchema.root, { recursive: true, force: true }) }
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }

  const g = fixture()
  try {
    g.store.db.prepare("UPDATE schema_meta SET value = '99' WHERE key = 'product_schema'").run()
    const future = g.store.workflows.recoverySource.inspect()
    assert.equal(future.coverage, 'unsupported')
    assert.equal(future.productSchema, 99)
    assert.equal(future.sourceFingerprint, null)
  } finally { g.store.close(); rmSync(g.root, { recursive: true, force: true }) }
})


test('an excluded activation at the head, middle or tail does not consume the family lookahead', () => {
  const f = fixture()
  try {
    const before = commitAt(f.store, 0)
    for (let index = 1; index <= 5; index += 1) commitAt(f.store, index)
    const tail = f.store.workflows.recoverySource.inspect({ ignoreCommitted: before, maxRowsPerFamily: 5 })
    const tailFamily = tail.families.find(family => family.name === 'recovery_activations')
    assert.equal(tailFamily?.rows, 5)
    assert.equal(tailFamily?.truncated, false, 'the excluded head does not consume the activation lookahead')

    const head = commitAt(f.store, 6)
    const headPage = f.store.workflows.recoverySource.inspect({ ignoreCommitted: head, maxRowsPerFamily: 5 })
    assert.equal(headPage.coverage, 'bounded', 'six non-excluded activations exceed a five-row cap')
    assert.equal(headPage.families.find(family => family.name === 'recovery_activations')?.truncated, true)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }

  const g = fixture()
  try {
    commitAt(g.store, 1); commitAt(g.store, 2)
    const middle = commitAt(g.store, 3)
    commitAt(g.store, 4); commitAt(g.store, 5); commitAt(g.store, 6)
    const page = g.store.workflows.recoverySource.inspect({ ignoreCommitted: middle, maxRowsPerFamily: 5 })
    const family = page.families.find(value => value.name === 'recovery_activations')
    assert.equal(family?.rows, 5)
    assert.equal(family?.truncated, false, 'an excluded middle row is skipped without losing the tail')
  } finally { g.store.close(); rmSync(g.root, { recursive: true, force: true }) }
})

test('total and per-family boundaries are bounded, never complete with a dropped tail', () => {
  const f = fixture()
  try {
    for (let index = 0; index < 6; index += 1) commitAt(f.store, index)
    const perFamily = f.store.workflows.recoverySource.inspect({ maxRowsPerFamily: 5, maxRows: 1000 })
    assert.equal(perFamily.coverage, 'bounded')
    assert.equal(perFamily.sourceFingerprint, null)
    const total = f.store.workflows.recoverySource.inspect({ maxRows: 5, maxRowsPerFamily: 1000 })
    assert.equal(total.coverage, 'bounded')
    assert.equal(total.sourceFingerprint, null)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a later identical intent event is a new change and cannot be excluded', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    const before = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
    f.store.events.append({ topic: 'application.recovery.intent', entityRef: committed.intent.activationId, payload: committed.intent })
    const after = f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
    assert.equal(after.coverage, 'complete')
    assert.notEqual(after.sourceFingerprint, before.sourceFingerprint)
    assert.ok(after.observedEventCursor > before.observedEventCursor)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a commit from a second real connection is visible to the next snapshot', () => {
  const f = fixture()
  try {
    const before = f.store.workflows.recoverySource.inspect().sourceFingerprint
    const other = new ProductStore({ path: f.path })
    try {
      other.product.works.insert({ id: 'other-connection', projectId: 'project-1', conversationId: 'conversation-1', title: 'Second connection', createdAt: at })
    } finally { other.close() }
    assert.notEqual(f.store.workflows.recoverySource.inspect().sourceFingerprint, before)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a negative-rowid logical row is read and its content change is visible', () => {
  const f = fixture()
  try {
    f.store.product.works.insert({ id: 'negative-work', projectId: 'project-1', conversationId: 'conversation-1', title: 'Original negative row', createdAt: at })
    f.store.db.prepare('UPDATE works SET rowid = -2 WHERE id = ?').run('negative-work')
    const before = f.store.workflows.recoverySource.inspect()
    assert.equal(before.coverage, 'complete')
    assert.equal(before.families.find(family => family.name === 'works')?.rows, 1)
    f.store.db.prepare('UPDATE works SET value = ? WHERE id = ?')
      .run(JSON.stringify({ ...f.store.product.works.get('negative-work'), title: 'Changed negative row' }), 'negative-work')
    const after = f.store.workflows.recoverySource.inspect()
    assert.notEqual(after.sourceFingerprint, before.sourceFingerprint)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a corrupted activation index/mirror column is not accepted as an ignorable fact', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    f.store.db.prepare('UPDATE recovery_activations SET target_json = ? WHERE activation_id = ?')
      .run(JSON.stringify({ ...committed.intent.target, stateRoot: '/tmp/unconfirmed-target' }), committed.intent.activationId)
    assert.throws(() => f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }), WorkflowConflict)
    assert.throws(() => f.store.workflows.recoveryActivations.get(committed.intent.activationId), WorkflowConflict)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('the original command event must retain its recorded payload to be excluded', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    f.store.db.prepare('UPDATE event_log SET payload = ? WHERE seq = ?')
      .run(JSON.stringify({ status: 'rejected' }), committed.sourceReceipt.seq)
    assert.throws(() => f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }), WorkflowConflict)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('a non-empty source covers work, queue, runtime binding and context data without mixing connections', () => {
  const f = fixture()
  try {
    const contract = { workId: 'work-source', revision: 1, digest: 'a'.repeat(64) }
    f.store.product.works.insert({ id: 'work-source', projectId: 'project-1', conversationId: 'conversation-1', title: 'Source work', createdAt: at })
    f.store.queue.enqueue('application.execute', 'queue-1', '{}', 1, 0, at)
    f.store.bindings.record({ attemptId: 'attempt-1', ticketId: 'ticket-1', assignmentId: 'assignment-1', fenceEpoch: 2,
      contract, state: 'active', runnerIdentityRef: 'runner-1', source: 'test',
      resources: [{ ref: 'process-1', ownership: 'spawned_process' }] })
    f.store.bindings.setCurrent('ticket-1', 'attempt-1')
    const artifact = f.store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
    f.store.artifacts.insert(artifact)
    f.store.commands.record('source-command', 'a'.repeat(64), () => ({ ok: true }))
    f.store.workflows.assistant.contextBindings.put({ protocol: 'assistant-context-binding/1', commandId: 'context-command',
      messageId: 'context-message', requestId: 'context-request', projectId: 'project-1', conversationId: 'conversation-1',
      userTextDigest: 'a'.repeat(64), principal, purpose: 'conversation_discussion',
      scope: { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      selections: ['conversation'], bundleRef: artifact.id, bundleDigest: artifact.digest,
      sources: [{ sourceId: 'source-1', kind: 'conversation_message', sourceDigest: 'b'.repeat(64), previewDigest: 'c'.repeat(64), truncated: false }],
      confirmedAt: at, expiresAt: '2026-11-12T00:04:00.000Z' })
    const snapshot = f.store.workflows.recoverySource.inspect()
    assert.equal(snapshot.coverage, 'complete')
    for (const name of ['works', 'effect', 'runtime_bindings', 'runtime_current', 'assistant_context_bindings', 'command_receipts'])
      assert.ok((snapshot.families.find(family => family.name === name)?.rows ?? 0) > 0, name)
    assert.equal(f.store.bindings.current<{ fenceEpoch: number }>('ticket-1')?.fenceEpoch, 2)
    f.store.close()
    const reopened = new ProductStore({ path: f.path })
    try {
      assert.equal(reopened.bindings.current<{ fenceEpoch: number }>('ticket-1')?.fenceEpoch, 2)
      assert.equal(reopened.bindings.binding<{ attemptId: string }>('attempt-1')?.attemptId, 'attempt-1')
      assert.equal(reopened.commands.get('source-command')?.payloadDigest, 'a'.repeat(64))
      assert.equal(reopened.workflows.recoverySource.inspect().coverage, 'complete')
    } finally { reopened.close() }
    const again = new ProductStore({ path: f.path }).bindings.current<{ fenceEpoch: number }>('ticket-1')?.fenceEpoch
    assert.equal(again, 2)

    const before = snapshot.sourceFingerprint
    const other = new ProductStore({ path: f.path })
    try { other.bindings.record({ attemptId: 'attempt-2', ticketId: 'ticket-2', assignmentId: 'assignment-2', fenceEpoch: 1,
      contract: { workId: 'work-2', revision: 1, digest: 'd'.repeat(64) }, state: 'active', runnerIdentityRef: 'runner-2', source: 'test',
      resources: [] }) } finally { other.close() }
    const finalStore = new ProductStore({ path: f.path })
    try { assert.notEqual(finalStore.workflows.recoverySource.inspect().sourceFingerprint, before) } finally { finalStore.close() }
  } finally { try { f.store.close() } catch { /* already closed above */ } rmSync(f.root, { recursive: true, force: true }) }
})

test('a rowid beyond Number.MAX_SAFE_INTEGER is scanned exactly and its change is visible', () => {
  const f = fixture()
  try {
    f.store.product.works.insert({ id: 'huge-work', projectId: 'project-1', conversationId: 'conversation-1', title: 'Huge rowid', createdAt: at })
    f.store.db.prepare('UPDATE works SET rowid = ? WHERE id = ?').run(9007199254740993n, 'huge-work')
    const before = f.store.workflows.recoverySource.inspect()
    assert.equal(before.coverage, 'complete')
    assert.equal(before.families.find(family => family.name === 'works')?.rows, 1)
    f.store.db.prepare('UPDATE works SET value = ? WHERE id = ?')
      .run(JSON.stringify({ ...f.store.product.works.get('huge-work'), title: 'Changed huge rowid' }), 'huge-work')
    assert.notEqual(f.store.workflows.recoverySource.inspect().sourceFingerprint, before.sourceFingerprint)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('the ignored events must retain inline payload and a null payload_ref', () => {
  const f = fixture()
  try {
    const committed = commit(f.store)
    f.store.db.prepare('UPDATE event_log SET payload_ref = ? WHERE seq = ?').run('foreign-payload-ref', committed.sourceReceipt.seq)
    assert.throws(() => f.store.workflows.recoverySource.inspect({ ignoreCommitted: committed }), WorkflowConflict)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('the total scan budget stops reading further families instead of only truncating output', () => {
  const f = fixture()
  try {
    for (let index = 0; index < 20; index += 1) commitAt(f.store, index)
    const bounded = f.store.workflows.recoverySource.inspect({ maxRows: 1 })
    assert.equal(bounded.coverage, 'bounded')
    assert.equal(bounded.sourceFingerprint, null)
    assert.ok(bounded.families.length < 47, `stopped after ${bounded.families.length} families`)
    assert.equal(bounded.families.reduce((sum, family) => sum + family.rows, 0), 1)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})

test('the reported schema always comes from the shared migration version', async () => {
  const f = fixture()
  try {
    const snapshot = f.store.workflows.recoverySource.inspect()
    assert.equal(snapshot.productSchema, (await import('@personal-agent/storage')).PRODUCT_SCHEMA_VERSION)
  } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }) }
})
