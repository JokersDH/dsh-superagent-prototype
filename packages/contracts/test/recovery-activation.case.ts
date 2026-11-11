import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RecoveryActivationCommitSchema, RecoveryActivationIntentSchema } from '../src/index.ts'

const intent = { protocol: 'recovery-activation-intent/1', activationId: 'activation-one', commandId: 'confirm-recovery', planId: 'plan-one',
  planDigest: 'a'.repeat(64), source: { stateId: 'history-one', stateRoot: '/tmp/history', markerDigest: 'b'.repeat(64), inspectionFingerprint: 'c'.repeat(64) },
  target: { generationId: 'new-one', stateRoot: '/tmp/new-state', configurationDigest: 'd'.repeat(64) }, principal: { userId: 'local', authorityRef: 'authority' },
  machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64), createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' }

test('activation facts bind separate states, confirming identity and current resource policy', () => {
  assert.equal(RecoveryActivationIntentSchema.safeParse(intent).success, true)
  for (const change of [{ target: { ...intent.target, stateRoot: intent.source.stateRoot } },
    { target: { ...intent.target, generationId: intent.source.stateId } }, { resourcePolicyDigest: undefined },
    { expiresAt: intent.createdAt }, { expiresAt: '2026-11-11T00:06:00.000Z' },
    { target: { ...intent.target, stateRoot: 'relative/path' } }, { source: { ...intent.source, stateRoot: '/tmp/bad\0path' } },
    { force: true }, { authorized: true }, { oldQueueMayRun: true }])
    assert.equal(RecoveryActivationIntentSchema.safeParse({ ...intent, ...change }).success, false)
})
test('source receipt is exact evidence identity, not a target-start permission', () => {
  const value = { protocol: 'recovery-activation-commit/1', intent, sourceReceipt: { commandId: intent.commandId, seq: 1 } }
  assert.equal(RecoveryActivationCommitSchema.safeParse(value).success, true)
  assert.equal(RecoveryActivationCommitSchema.safeParse({ ...value, sourceReceipt: { commandId: 'other-command', seq: 1 } }).success, false)
  assert.equal(RecoveryActivationCommitSchema.safeParse({ ...value, mayStart: true }).success, false)
})
