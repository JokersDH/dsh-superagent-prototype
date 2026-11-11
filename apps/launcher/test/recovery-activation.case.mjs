/**
 * Recovery activation is main-owned. These cases prove the D-side gate refuses every threat the
 * packet lists, and that even a locally-ready target stays `not_granted` until main commits a source
 * intent + receipt. No test invents an authorization document or starts a business instance.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ACTIVATION_CONSUMPTION_REQUIREMENTS, evaluateActivation } from '../lib/recovery-activation.mjs'

const DIGEST = 'a'.repeat(64)

const makeRoots = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-activation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source-state')
  const target = join(root, 'target-state')
  for (const path of [source, target]) {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    chmodSync(path, 0o700)
  }
  return { root, source, target }
}

const intentFor = (source, target, overrides = {}) => ({
  protocol: 'recovery-activation-intent/1',
  activationId: 'activation-1',
  commandId: 'command-1',
  planId: 'plan-1',
  planDigest: DIGEST,
  source: { stateId: 'state-old', stateRoot: source, markerDigest: DIGEST, inspectionFingerprint: 'b'.repeat(64) },
  target: { generationId: 'generation-new', stateRoot: target, configurationDigest: 'c'.repeat(64) },
  principal: { userId: 'local-user', authorityRef: 'authority-1' },
  machineDigest: 'd'.repeat(64),
  resourcePolicyDigest: 'e'.repeat(64),
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  ...overrides,
})

const emptyFacts = (intent, overrides = {}) => ({
  markerDigest: intent.source.markerDigest,
  inspectionFingerprint: intent.source.inspectionFingerprint,
  sourceStartupMode: 'recovery_readonly',
  sourceHeldQueueUnchanged: true,
  machineDigest: intent.machineDigest,
  resourcePolicyDigest: intent.resourcePolicyDigest,
  targetBusinessCounts: { projects: 0, works: 0, decisions: 0, artifacts: 0, acceptedEvents: 0 },
  targetInstanceRecord: false,
  targetCredentialFiles: 0,
  targetNativeSessions: 0,
  targetActivationRecords: 0,
  targetConfigurationDigest: intent.target.configurationDigest,
  previousActivations: [],
  committedSourceIntent: true,
  ...overrides,
})

test('a fully matching intent with a committed source fact is only READY_FOR_MAIN_COMMIT, never a grant', (t) => {
  const { source, target } = makeRoots(t)
  const intent = intentFor(source, target)
  const result = evaluateActivation({ intent, facts: emptyFacts(intent) })
  assert.equal(result.status, 'READY_FOR_MAIN_COMMIT')
  assert.equal(result.authorization, 'not_granted')
  assert.equal(result.commitAvailable, false)
  assert.equal(result.started, false)
  assert.match(result.nextStep, /main/)
})

test('without main committed source intent the gate is BLOCKED even when every local condition holds', (t) => {
  const { source, target } = makeRoots(t)
  const intent = intentFor(source, target)
  const result = evaluateActivation({ intent, facts: emptyFacts(intent, { committedSourceIntent: false }) })
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.code, 'main_source_intent_committed')
  assert.equal(result.authorization, 'not_granted')
})

test('expired or over-long confirmation windows are refused', (t) => {
  const { source, target } = makeRoots(t)
  const expired = intentFor(source, target, {
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    expiresAt: new Date(Date.now() - 300_000).toISOString(),
  })
  assert.equal(evaluateActivation({ intent: expired, facts: emptyFacts(expired) }).code, 'not_expired')
  const long = intentFor(source, target, {
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  })
  assert.equal(evaluateActivation({ intent: long, facts: emptyFacts(long) }).code, 'window_bounded')
})

test('digest drift between the intent and the observed machine is refused', (t) => {
  const { source, target } = makeRoots(t)
  const intent = intentFor(source, target)
  assert.equal(evaluateActivation({ intent, facts: emptyFacts(intent, { markerDigest: 'f'.repeat(64) }) }).code, 'marker_matches')
  assert.equal(evaluateActivation({ intent, facts: emptyFacts(intent, { inspectionFingerprint: 'f'.repeat(64) }) }).code, 'fingerprint_current')
  assert.equal(evaluateActivation({ intent, facts: emptyFacts(intent, { machineDigest: 'f'.repeat(64) }) }).code, 'machine_matches')
  assert.equal(evaluateActivation({ intent, facts: emptyFacts(intent, { resourcePolicyDigest: 'f'.repeat(64) }) }).code, 'resource_policy_matches')
})

test('source and target must be distinct, private, non-symlinked roots', (t) => {
  const { root, source, target } = makeRoots(t)
  const same = intentFor(source, source, { target: { generationId: 'generation-new', stateRoot: source, configurationDigest: 'c'.repeat(64) } })
  assert.equal(evaluateActivation({ intent: same, facts: emptyFacts(same) }).code, 'roots_distinct')

  const nested = intentFor(source, join(source, 'child'))
  mkdirSync(join(source, 'child'), { mode: 0o700 })
  chmodSync(join(source, 'child'), 0o700)
  assert.equal(evaluateActivation({ intent: nested, facts: emptyFacts(nested, { targetBusinessCounts: { projects: 0 } }) }).code, 'roots_distinct')

  const loose = intentFor(source, target)
  chmodSync(target, 0o755)
  assert.equal(evaluateActivation({ intent: loose, facts: emptyFacts(loose) }).code, 'target_root')
  chmodSync(target, 0o700)

  const symlinkPath = join(root, 'linked-target')
  // A symlink to a private directory must still be refused.
  symlinkSync(target, symlinkPath)
  const linked = intentFor(source, symlinkPath)
  assert.equal(evaluateActivation({ intent: linked, facts: emptyFacts(linked) }).code, 'target_root')
})

test('a half-prepared target (business rows, instance record, credentials, activation history) is refused', (t) => {
  const { source, target } = makeRoots(t)
  const intent = intentFor(source, target)
  const cases = [
    [{ targetBusinessCounts: { projects: 1, works: 0, decisions: 0, artifacts: 0, acceptedEvents: 0 } }, 'target_empty'],
    [{ targetBusinessCounts: { projects: 0, works: 0, decisions: 0, artifacts: 0, acceptedEvents: 2 } }, 'target_empty'],
    [{ targetInstanceRecord: true }, 'target_no_instance'],
    [{ targetCredentialFiles: 1 }, 'target_no_credentials'],
    [{ targetNativeSessions: 1 }, 'target_no_native_session'],
    [{ targetActivationRecords: 1 }, 'target_no_activation'],
    [{ targetConfigurationDigest: 'f'.repeat(64) }, 'target_configuration'],
    [{ sourceStartupMode: 'normal' }, 'source_still_readonly'],
    [{ sourceHeldQueueUnchanged: false }, 'old_queue_not_consumed'],
  ]
  for (const [overrides, expected] of cases) {
    const result = evaluateActivation({ intent, facts: emptyFacts(intent, overrides) })
    assert.equal(result.status, 'BLOCKED', JSON.stringify(overrides))
    assert.equal(result.code, expected, JSON.stringify(overrides))
  }
})

test('duplicate activation identity or a different body for the same activation is refused', (t) => {
  const { source, target } = makeRoots(t)
  const intent = intentFor(source, target)
  const duplicated = evaluateActivation({ intent, facts: emptyFacts(intent, { previousActivations: [{ activationId: 'activation-1', commandId: 'command-1' }] }) })
  assert.equal(duplicated.code, 'activation_not_replayed')
  const commandReplay = evaluateActivation({ intent, facts: emptyFacts(intent, { previousActivations: [{ activationId: 'other', commandId: 'command-1' }] }) })
  assert.equal(commandReplay.code, 'activation_not_replayed')
})

test('a backup/restore cannot inherit executable activation: the consumption requirements say so', () => {
  assert.equal(ACTIVATION_CONSUMPTION_REQUIREMENTS.status, 'BLOCKED')
  assert.equal(ACTIVATION_CONSUMPTION_REQUIREMENTS.owner, 'main')
  assert.ok(ACTIVATION_CONSUMPTION_REQUIREMENTS.notPublished.some((entry) => /commit route/i.test(entry)))
  assert.ok(ACTIVATION_CONSUMPTION_REQUIREMENTS.forbidden.some((entry) => /inspect\/prepare success as authorization/.test(entry)))
  assert.ok(ACTIVATION_CONSUMPTION_REQUIREMENTS.forbidden.some((entry) => /second auth\/key store/.test(entry)))
})
