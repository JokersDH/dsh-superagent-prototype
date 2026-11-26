import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyCompatibility, toProbeReport } from '../src/compatibility.ts'
import type { AgentProfile, CapabilityObservation, CompatibilityIdentity, ProbeReport } from '../../contracts/src/types.ts'

const D = (ch: string) => ch.repeat(64)
const profile: AgentProfile = {
  id: 'profile-codex', revision: 3, driverId: 'codex-native', driverApiMajor: 1, driverRelease: '0.1.0',
  executable: '/opt/codex', argv: [], expectedVersion: '0.164.0', nativeConfigRef: 'config-1',
  permissionPolicyRevision: 'policy-1', requiredFeatures: ['questions'],
}
const identity = (over: Partial<CompatibilityIdentity> = {}): CompatibilityIdentity => ({
  profileId: 'profile-codex', profileRevision: 3, executableDigest: D('a'), nativeVersion: '0.164.0',
  driverRelease: '0.1.0', driverApiMajor: 1, wireVersion: 'codex-app-server-json-schema', schemaDigest: D('b'),
  resolvedConfigFingerprint: D('c'), permissionPolicyRevision: 'policy-1', configStability: 'frozen',
  platform: process.platform, architecture: process.arch, runtimeVersion: process.version, ...over,
})
const cap = (over: Partial<CapabilityObservation> = {}): CapabilityObservation => ({
  feature: 'questions', advertised: { value: true }, observed: { value: true }, test: 'PASS', policy: 'allowed', evidenceRefs: ['cap-q'], ...over,
})
const probe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  identity: identity(), capabilities: [cap()], readiness: 'inspection_passed', checkedAt: '2026-11-24T00:00:00Z', evidenceRefs: ['probe-exec'], ...over,
})
const surface = {
  wireVersion: 'codex-app-server-json-schema', schemaDigest: D('b'),
  methods: ['initialize', 'thread/start', 'turn/start', 'turn/steer', 'turn/interrupt'],
  requestFields: { initialize: ['clientInfo', 'capabilities'], 'thread/start': ['model', 'approvalPolicy', 'sandbox'], 'turn/start': ['threadId', 'input'], 'turn/steer': ['threadId', 'expectedTurnId', 'input'], 'turn/interrupt': ['threadId', 'turnId'] },
  enums: { 'turn/completed': ['failed', 'interrupted', 'completed'] },
  notifications: ['item/started', 'item/updated', 'item/completed', 'turn/completed', 'thread/tokenUsage/updated', 'config/changed'],
  serverRequests: ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'],
  requestIdTypes: ['integer', 'string'],
}
const required = {
  wireVersion: 'codex-app-server-json-schema',
  methods: ['initialize', 'thread/start', 'turn/start', 'turn/steer', 'turn/interrupt'],
  requestFields: surface.requestFields,
  enums: { 'turn/completed': ['failed', 'interrupted', 'completed'] },
  notifications: surface.notifications,
  serverRequestPatterns: ['requestApproval', 'requestUserInput'],
  requestIdTypes: ['integer', 'string'],
}
const observed = { status: 'observed' as const, surface, evidenceRefs: ['schema-digest'] }

test('an exact tuple with original native evidence is verified, but only when evidence is supplied', () => {
  const unverified = classifyCompatibility({ profile, probe: probe(), surface: observed, required })
  assert.equal(unverified.class, 'compatible_unverified')
  assert.equal(unverified.admission, 'trial')
  assert.equal(unverified.nativeTestPassed, false)
  assert.equal(toProbeReport(unverified).readiness, 'inspection_passed')
  assert.ok(toProbeReport(unverified).evidenceRefs.includes('compatibility:compatible_unverified'))

  const verified = classifyCompatibility({ profile, probe: probe(), surface: observed, required, verifiedVersions: [{
    profileId: 'profile-codex', profileRevision: 3, driverId: 'codex-native', nativeVersion: '0.164.0',
    executableDigest: D('a'), driverRelease: '0.1.0', wireVersion: 'codex-app-server-json-schema', schemaDigest: D('b'),
    evidenceRef: 'native-test-run-1',
  }] })
  assert.equal(verified.class, 'verified')
  assert.equal(verified.admission, 'native')
  assert.equal(verified.nativeTestPassed, true)
  assert.ok(verified.evidenceRefs.includes('native-test-run-1'))
  // Even a verified probe report must not claim native_test_passed by itself.
  assert.equal(toProbeReport(verified).readiness, 'inspection_passed')
})

test('an unverified version with a complete observed surface is trial-compatible, never native', () => {
  const verdict = classifyCompatibility({ profile, probe: probe({ identity: identity({ nativeVersion: '0.170.1' }) }), surface: observed, required })
  assert.equal(verdict.class, 'compatible_unverified')
  assert.equal(verdict.admission, 'trial')
  assert.ok(verdict.reasons.includes('unverified_version:0.170.1'))
  assert.ok(!toProbeReport(verdict).evidenceRefs.some(ref => ref === 'native_test_passed'))
})

test('missing methods, actual fields, enums, notifications or request id types are incompatible', () => {
  const broken = {
    ...surface,
    methods: surface.methods.filter(method => method !== 'turn/steer'),
    requestFields: { ...surface.requestFields, 'turn/start': ['threadId'] },
    enums: { 'turn/completed': ['completed'] },
    notifications: surface.notifications.filter(method => method !== 'config/changed'),
    requestIdTypes: ['integer'],
  }
  const verdict = classifyCompatibility({ profile, probe: probe(), surface: { ...observed, surface: broken }, required })
  assert.equal(verdict.class, 'incompatible')
  assert.equal(verdict.admission, 'disabled')
  assert.deepEqual(verdict.missing.methods, ['turn/steer'])
  assert.deepEqual(verdict.missing.requestFields, ['turn/start.input'])
  assert.deepEqual(verdict.missing.enums, ['turn/completed.failed', 'turn/completed.interrupted'])
  assert.deepEqual(verdict.missing.notifications, ['config/changed'])
  assert.deepEqual(verdict.missing.requestIdTypes, ['string'])
})

test('a partial observation (handshake-only) is unknown and never compatible', () => {
  const verdict = classifyCompatibility({ profile, probe: probe(), surface: { status: 'partial', surface, reason: 'initialize_only', evidenceRefs: ['handshake'] }, required })
  assert.equal(verdict.class, 'unknown')
  assert.equal(verdict.admission, 'disabled')
  assert.ok(verdict.reasons.some(reason => reason.includes('probe_partial')))
  assert.equal(toProbeReport(verdict).readiness, 'needs_setup')
})

test('probe missing/timeout/failed, auth/setup, unverified config or identity are unknown and disabled', () => {
  for (const state of ['missing', 'timeout', 'failed'] as const) {
    const verdict = classifyCompatibility({ profile, probe: probe(), surface: { status: state, reason: 'probe_' + state, evidenceRefs: [] }, required })
    assert.equal(verdict.class, 'unknown')
    assert.equal(verdict.admission, 'disabled')
    assert.equal(toProbeReport(verdict).readiness, 'needs_setup')
  }
  for (const readiness of ['missing', 'needs_auth', 'needs_setup'] as const) {
    const verdict = classifyCompatibility({ profile, probe: probe({ readiness }), surface: observed, required })
    assert.equal(verdict.class, 'unknown')
    assert.equal(verdict.admission, 'disabled')
  }
  const unverifiedConfig = classifyCompatibility({ profile, probe: probe(), surface: observed, required,
    // unchanged identity is complete; force the unverified config by projecting a modified probe identity
  })
  assert.equal(unverifiedConfig.class, 'compatible_unverified')
  const badConfig = classifyCompatibility({ profile, probe: probe({ identity: identity({ configStability: 'unverified' }) }), surface: observed, required })
  assert.equal(badConfig.class, 'unknown')
  const noIdentity = classifyCompatibility({ profile, probe: probe({ identity: undefined }), surface: observed, required })
  assert.equal(noIdentity.class, 'unknown')
})

test('identity, environment, schema and capability mismatches are incompatible or unknown, not compatible', () => {
  const wrongProfile = classifyCompatibility({ profile, probe: probe({ identity: identity({ profileRevision: 2 }) }), surface: observed, required })
  assert.equal(wrongProfile.class, 'incompatible')
  const wrongRuntime = classifyCompatibility({ profile, probe: probe(), surface: observed, required,
    environment: { platform: process.platform, architecture: process.arch, runtimeVersion: 'v0.0.0' } })
  assert.equal(wrongRuntime.class, 'incompatible')
  const wrongSchema = classifyCompatibility({ profile, probe: probe(), surface: { ...observed, surface: { ...surface, schemaDigest: D('d') } }, required })
  assert.equal(wrongSchema.class, 'incompatible')
  const missingCap = classifyCompatibility({ profile, probe: probe({ capabilities: [cap({ test: 'NOT_TESTED' })] }), surface: observed, required })
  assert.equal(missingCap.class, 'incompatible')
  const blockedCap = classifyCompatibility({ profile, probe: probe({ capabilities: [cap({ policy: 'blocked' })] }), surface: observed, required })
  assert.equal(blockedCap.class, 'incompatible')
})
