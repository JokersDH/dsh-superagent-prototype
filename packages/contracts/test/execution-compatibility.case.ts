import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExecutionProfileViewSchema } from '../src/configuration.ts'

const compatibility = {
  classification: 'compatible_unverified', nativeVersion: '1.2.3', protocol: 'example-protocol', schemaDigest: 'a'.repeat(64),
  checkedAt: '2026-11-26T00:00:00.000Z',
  operations: [{ operation: 'begin', supported: true, validation: 'controlled', enabled: true }],
}
const profile = { id: 'unverified-native', revision: 1, displayName: 'Unverified agent', driverId: 'example-driver', kind: 'native',
  readiness: 'inspection_passed', dispatchAllowed: true, compatibility,
  trialAdmission: { mode: 'explicit_trial', identityDigest: 'b'.repeat(64), policyDigest: 'c'.repeat(64), confirmationCommandId: 'explicit-consent-1' } }

test('explicit trial is distinct from native verification and requires identity, policy and consent metadata', () => {
  assert.ok(ExecutionProfileViewSchema.safeParse(profile).success)
  assert.equal(ExecutionProfileViewSchema.parse(profile).readiness, 'inspection_passed')
  for (const trialAdmission of [undefined, { ...profile.trialAdmission, identityDigest: undefined },
    { ...profile.trialAdmission, policyDigest: undefined }, { ...profile.trialAdmission, confirmationCommandId: undefined }])
    assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, trialAdmission }).success, false)
  assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, readiness: 'native_test_passed' }).success, false)
})

test('a schema or initialize observation alone cannot enable a trial operation', () => {
  for (const operation of [{ operation: 'begin', supported: true, validation: 'protocol', enabled: true },
    { operation: 'begin', supported: null, validation: 'unobserved', enabled: true },
    { operation: 'begin', supported: false, validation: 'controlled', enabled: true },
    { operation: 'begin', supported: true, validation: 'controlled', enabled: false }])
    assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, compatibility: { ...compatibility, operations: [operation] } }).success, false)
})

test('unknown, incompatible, fixture and duplicate operation projections cannot smuggle trial dispatch', () => {
  for (const classification of ['unknown', 'incompatible', 'verified'])
    assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, compatibility: { ...compatibility, classification } }).success, false)
  assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, kind: 'controlled_fixture', readiness: 'fixture_ready' }).success, false)
  assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, compatibility: { ...compatibility,
    operations: [compatibility.operations[0], compatibility.operations[0]] } }).success, false)
  assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, compatibility: { ...compatibility, executable: '/private/agent' } }).success, false)
  assert.equal(ExecutionProfileViewSchema.safeParse({ ...profile, trialAdmission: { ...profile.trialAdmission, actor: 'user' } }).success, false)
})
