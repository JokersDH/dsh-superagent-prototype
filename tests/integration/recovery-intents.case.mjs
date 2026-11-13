import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalDigest } from '../../packages/storage/src/index.ts'
import { ApplicationFault } from '../../packages/application/src/index.ts'
import { RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'
import { fixture, actor } from '../../packages/application/test/helpers.ts'

const intent = () => ({ protocol: 'recovery-activation-intent/1', activationId: 'activation-one', commandId: 'recovery-confirm', planId: 'plan-one',
  planDigest: 'a'.repeat(64), source: { stateId: 'history-one', stateRoot: '/tmp/history', markerDigest: 'b'.repeat(64), inspectionFingerprint: 'c'.repeat(64) },
  target: { generationId: 'new-one', stateRoot: '/tmp/new-state', configurationDigest: 'd'.repeat(64) },
  principal: { userId: actor.userId, authorityRef: actor.authorityRef }, machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
  createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' })

// Test port uses existing real SQLite receipts, not a production migration or A's future adapter.
const facts = store => ({
  get: id => store.commands.get(`fixture-activation:${id}`)?.result,
  forCommand: id => store.commands.get(`fixture-command:${id}`)?.result,
  put: value => {
    assert.ok(store.uow.nesting > 0)
    const hash = canonicalDigest(value)
    const result = store.commands.record(`fixture-activation:${value.activationId}`, hash, () => value)
    store.commands.record(`fixture-command:${value.commandId}`, hash, () => value)
    return { intent: result.result, replayed: result.replayed }
  },
})

test('source fact, event and receipt commit once; replay after expiry/reopen creates no authority', t => {
  const h = fixture(t)
  let guards = 0, at = '2026-11-11T00:01:00.000Z'
  const make = () => new RecoveryIntentCommitter(h.store, facts(h.store), actor, () => { guards++ }, () => at)
  let service = make()
  const value = intent(), queue = h.store.workflows.index.stateFacts().queue
  const committed = service.commit(value, actor)
  assert.equal(guards, 1)
  assert.deepEqual(h.store.workflows.index.stateFacts().queue, queue)
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.events.after(0, 100).filter(e => e.topic === 'application.recovery.intent').length, 1)
  h.reopen(); service = make(); at = '2026-11-12T00:00:00.000Z'
  assert.deepEqual(service.commit(value, actor), committed)
  assert.equal(guards, 1, 'Receipt replay does not reauthorize or start anything')
  assert.throws(() => service.commit({ ...value, target: { ...value.target, generationId: 'another-target' } }, actor), e => e.error.code === 'conflict')
})

test('receipt failure rolls back source facts and event; identical intent can be confirmed later', t => {
  const h = fixture(t), value = intent(), port = facts(h.store)
  const service = new RecoveryIntentCommitter(h.store, port, actor, () => {}, () => '2026-11-11T00:01:00.000Z')
  h.store.db.exec("CREATE TRIGGER fail_recovery_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id = 'recovery-confirm' BEGIN SELECT RAISE(ABORT, 'receipt failure'); END")
  assert.throws(() => service.commit(value, actor), /receipt failure/)
  assert.equal(port.get(value.activationId), undefined)
  assert.equal(port.forCommand(value.commandId), undefined)
  assert.equal(h.store.events.cursor(), 0)
  h.store.db.exec('DROP TRIGGER fail_recovery_receipt')
  assert.equal(service.commit(value, actor).intent.activationId, value.activationId)
})

test('stale source/resource guard, foreign actor and expired intents fail without persistence', t => {
  const h = fixture(t), value = intent(), port = facts(h.store)
  const service = new RecoveryIntentCommitter(h.store, port, actor,
    () => { throw new ApplicationFault('writer_indeterminate', 'Current writer proof is missing') }, () => '2026-11-11T00:01:00.000Z')
  assert.throws(() => service.commit(value, actor), e => e.error.code === 'writer_indeterminate')
  assert.throws(() => service.commit(value, { ...actor, userId: 'foreign' }), e => e.error.code === 'forbidden')
  const expired = new RecoveryIntentCommitter(h.store, port, actor, () => {}, () => '2026-11-11T00:06:00.000Z')
  assert.throws(() => expired.commit(value, actor), e => e.error.code === 'stale_contract')
  assert.equal(h.store.events.cursor(), 0)
})

test('async guards are refused before invocation; inconsistent stored facts cannot replay', t => {
  const h = fixture(t), value = intent(), port = facts(h.store)
  let calls = 0
  assert.throws(() => new RecoveryIntentCommitter(h.store, port, actor, async () => { calls++ }), /synchronous/)
  assert.equal(calls, 0)
  const service = new RecoveryIntentCommitter(h.store, port, actor, () => {}, () => '2026-11-11T00:01:00.000Z')
  service.commit(value, actor)
  const broken = new RecoveryIntentCommitter(h.store, { ...port, get: () => undefined }, actor, () => {})
  assert.throws(() => broken.commit(value, actor), e => e.error.code === 'storage_unavailable')
})

test('a post-confirmation guard returning a thenable cannot commit source facts or a receipt', t => {
  const h = fixture(t), value = intent(), port = facts(h.store)
  const service = new RecoveryIntentCommitter(h.store, port, actor, () => {}, () => '2026-11-11T00:01:00.000Z',
    () => Promise.reject(new Error('Post-confirmation rejection')))
  assert.throws(() => service.commit(value, actor))
  assert.equal(port.get(value.activationId), undefined)
  assert.equal(h.store.commands.get(value.commandId), undefined)
  assert.equal(h.store.events.cursor(), 0)
})
