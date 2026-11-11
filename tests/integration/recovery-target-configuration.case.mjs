import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { bindRecoveryTargetConfiguration } from '../../apps/coordinator/product/recovery-targets.ts'

const configuration = { protocol: 'recovery-target-configuration/1', projects: [{ sourceProjectId: 'old-project', targetProjectId: 'new-project',
  registration: { path: '/tmp/project', check: 'node_test' } }], executor: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) } }
const source = () => ({ protocol: 'recovery-activation-commit/1', sourceReceipt: { commandId: 'recovery-confirm', seq: 1 }, intent: {
  protocol: 'recovery-activation-intent/1', activationId: 'activation', commandId: 'recovery-confirm', planId: 'plan', planDigest: 'b'.repeat(64),
  source: { stateId: 'history', stateRoot: '/tmp/history', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
  target: { generationId: 'generation', stateRoot: '/tmp/target', configurationDigest: canonicalDigest(configuration) },
  principal: { userId: 'local', authorityRef: 'authority' }, machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
  createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' } })

test('a bound target preparation is inert and snapshots exact configuration', () => {
  const input = structuredClone(configuration), preparation = bindRecoveryTargetConfiguration(source(), input)
  assert.equal(preparation.startupAvailable, false)
  input.projects[0].registration.path = '/tmp/changed'
  assert.equal(preparation.configuration.projects[0].registration.path, '/tmp/project')
})
test('configuration drift is refused before target materialization', () => {
  const changed = { ...configuration, executor: { ...configuration.executor, identityDigest: '0'.repeat(64) } }
  assert.throws(() => bindRecoveryTargetConfiguration(source(), changed), error => error.error.code === 'conflict')
})
