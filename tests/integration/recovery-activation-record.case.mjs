import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { readRecoveryActivationRecord, RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'
import { actor, fixture } from '../../packages/application/test/helpers.ts'

const value = () => ({ protocol: 'recovery-activation-intent/1', activationId: 'activation-one', commandId: 'recovery-confirm', planId: 'plan-one',
  planDigest: 'a'.repeat(64), source: { stateId: 'history-one', stateRoot: '/tmp/history', markerDigest: 'b'.repeat(64), inspectionFingerprint: 'c'.repeat(64) },
  target: { generationId: 'new-one', stateRoot: '/tmp/new-state', configurationDigest: 'd'.repeat(64) },
  principal: { userId: actor.userId, authorityRef: actor.authorityRef }, machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
  createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' })
const commit = h => new RecoveryIntentCommitter(h.store, h.store.workflows.recoveryActivations, actor, () => {}, () => '2026-11-11T00:01:00.000Z').commit(value(), actor)

test('production fact and original receipt are a stable readonly audit after reopen, never startup authority', t => {
  const h = fixture(t), committed = commit(h), before = h.store.events.cursor()
  const record = readRecoveryActivationRecord(h.store, 'activation-one', actor)
  assert.deepEqual(record.committed, committed)
  assert.equal(record.authorization, 'not_granted')
  assert.equal(record.startupAvailable, false)
  assert.equal(h.store.events.cursor(), before)
  h.reopen()
  assert.deepEqual(readRecoveryActivationRecord(h.store, 'activation-one', actor), record)
  assert.equal(h.store.events.cursor(), before)
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 0)
})

test('an unconfirmed fact, foreign principal or unrelated business receipt cannot be returned as a committed intent', t => {
  const h = fixture(t), intent = value()
  h.store.workflows.recoveryActivations.put(intent)
  assert.throws(() => readRecoveryActivationRecord(h.store, intent.activationId, actor), e => e.error.code === 'storage_unavailable')
  assert.throws(() => readRecoveryActivationRecord(h.store, intent.activationId, { ...actor, userId: 'foreign' }), e => e.error.code === 'forbidden')
  h.store.commands.record(intent.commandId, 'a'.repeat(64), () => ({ status: 'recorded' }))
  assert.throws(() => readRecoveryActivationRecord(h.store, intent.activationId, actor), e => e.error.code === 'storage_unavailable')
  assert.equal(readRecoveryActivationRecord(h.store, 'missing-activation', actor), undefined)
})

test('a receipt body or digest drift cannot manufacture a matching audit record', t => {
  const h = fixture(t)
  commit(h)
  h.store.db.prepare('UPDATE command_receipts SET payload_digest = ? WHERE command_id = ?').run('0'.repeat(64), value().commandId)
  assert.throws(() => readRecoveryActivationRecord(h.store, value().activationId, actor), e => e.error.code === 'storage_unavailable')
})

test('authenticated HTTP reads work in restored readonly mode, while commit/start remain unavailable', async t => {
  const h = fixture(t)
  commit(h)
  const before = h.store.events.cursor()
  const api = createLocalHttpApp({ application: h.app, principal: actor, bootstrapToken: 'a'.repeat(64), apiToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', startupMode: 'recovery_readonly',
    read: { recoveryActivation: async id => readRecoveryActivationRecord(h.store, id, actor) } })
  const path = '/v1/recovery/activations/activation-one', headers = { authorization: `Bearer ${'b'.repeat(64)}` }
  assert.equal((await api.request(path)).status, 401)
  const response = await api.request(path, { headers })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.startupAvailable, false)
  assert.equal(result.authorization, 'not_granted')
  assert.equal((await api.request(`${path}?force=true`, { headers })).status, 400)
  assert.equal((await api.request('/v1/recovery/activations/missing', { headers })).status, 404)
  assert.equal((await api.request('/v1/recovery/commit', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })).status, 422)
  assert.equal(h.store.events.cursor(), before)
})
