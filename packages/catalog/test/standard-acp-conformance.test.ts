import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACP_V1_STANDARD_SCHEMA, classifyCompatibility, classifyStandardAcpConformance, toProbeReport,
  type AcpConformanceDeclaration } from '../src/compatibility.ts'
import type { AgentProfile, ProbeReport } from '../../contracts/src/types.ts'

const profile: AgentProfile = { id: 'profile-standard-acp', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0',
  executable: '/trusted/native', argv: ['acp'], expectedVersion: '1.0.0', nativeConfigRef: 'private-native-config', permissionPolicyRevision: 'policy-1', requiredFeatures: ['chat.turn'] }
const probe: ProbeReport = { readiness: 'inspection_passed', checkedAt: '2026-11-27T00:00:00Z', evidenceRefs: ['original-probe'],
  identity: { profileId: profile.id, profileRevision: 1, executableDigest: 'a'.repeat(64), nativeVersion: '1.0.0', driverRelease: '0.1.0', driverApiMajor: 1,
    ...ACP_V1_STANDARD_SCHEMA, wireVersion: 'acp-v1', resolvedConfigFingerprint: 'b'.repeat(64), permissionPolicyRevision: 'policy-1', configStability: 'frozen',
    platform: process.platform, architecture: process.arch, runtimeVersion: process.version },
  capabilities: [{ feature: 'chat.turn', advertised: { protocol: 1 }, observed: { initialize: true }, test: 'NOT_TESTED', policy: 'requires_review', evidenceRefs: ['init-evidence'] }] }
const declaration: AcpConformanceDeclaration = { origin: 'protocol_declaration', protocol: 'agent-client-protocol', protocolVersion: 1,
  ...ACP_V1_STANDARD_SCHEMA, declaredBaseMethods: ['session/new', 'session/prompt', 'session/cancel', 'session/update'],
  observed: { initialize: true, protocolVersion: 1, evidenceRefs: ['init-evidence'] }, nativeOperationsVerified: false, grantsExecution: false }
const input = () => structuredClone({ profile, probe, declaration })

test('explicit standard path is compatible_unverified while keeping operations untested and legacy partial unknown', () => {
  const value = input(), result = classifyStandardAcpConformance(value)
  assert.equal(result.class, 'compatible_unverified'); assert.equal(result.origin, 'protocol_declaration')
  assert.equal(result.nativeTestPassed, false); assert.equal(result.admission, 'trial')
  assert.ok(result.capabilities.every(item => item.test === 'NOT_TESTED'))
  assert.ok(result.evidenceRefs.includes('original-probe')); assert.ok(result.evidenceRefs.includes('init-evidence'))
  assert.equal(toProbeReport(result).readiness, 'inspection_passed')
  const surface = { wireVersion: 'acp-v1', schemaDigest: declaration.schemaDigest, methods: ['initialize'], requestFields: {}, enums: {}, notifications: [], serverRequests: [], requestIdTypes: ['integer'] }
  const legacy = classifyCompatibility({ profile, probe, surface: { status: 'partial', surface, reason: 'initialize_only', evidenceRefs: ['original-partial'] },
    required: { methods: ['session/prompt'], requestFields: {}, enums: {}, notifications: [] } })
  assert.equal(legacy.class, 'unknown'); assert.deepEqual(surface.methods, ['initialize'])
  assert.equal(value.probe.capabilities[0].test, 'NOT_TESTED')
})

test('missing installation/configuration/negotiation/official schema cannot enter trial compatibility', () => {
  const cases: Array<(value: ReturnType<typeof input>) => void> = [
    value => { delete value.probe.identity },
    value => { value.probe.identity!.resolvedConfigFingerprint = '' },
    value => { value.probe.identity!.configStability = 'unverified' },
    value => { value.probe.readiness = 'needs_auth' },
    value => { value.probe.readiness = 'needs_setup' },
    value => { value.declaration.observed.initialize = false },
    value => { value.declaration.observed.evidenceRefs = [] },
    value => { value.declaration.schemaDigest = 'c'.repeat(64) },
    value => { value.declaration.sdkEntrypoint = '@agentclientprotocol/sdk/unstable' },
    value => { value.declaration.declaredBaseMethods = ['initialize'] },
    value => { value.declaration.nativeOperationsVerified = true },
    value => { value.declaration.grantsExecution = true },
  ]
  for (const mutate of cases) { const value = input(); mutate(value); const result = classifyStandardAcpConformance(value)
    assert.notEqual(result.class, 'compatible_unverified'); assert.equal(result.nativeTestPassed, false); assert.equal(result.admission, 'disabled') }
  assert.equal(classifyStandardAcpConformance({ profile, probe }).class, 'unknown')
})

test('concrete version, identity, required capability and driver mismatches stay incompatible', () => {
  for (const mutate of [
    (value: ReturnType<typeof input>) => { value.declaration.protocolVersion = 2 },
    (value: ReturnType<typeof input>) => { value.probe.identity!.profileRevision = 2 },
    (value: ReturnType<typeof input>) => { value.probe.identity!.schemaDigest = 'c'.repeat(64) },
    (value: ReturnType<typeof input>) => { value.probe.capabilities[0].policy = 'blocked' },
    (value: ReturnType<typeof input>) => { value.probe.capabilities[0].test = 'FAIL' },
    (value: ReturnType<typeof input>) => { value.profile.driverId = 'codex-native' },
  ]) { const value = input(); mutate(value); assert.equal(classifyStandardAcpConformance(value).class, 'incompatible') }
})

test('a declaration never promotes a supplied native PASS or original probe readiness to verified', () => {
  const value = input(); value.probe.readiness = 'native_test_passed'; value.probe.capabilities[0].test = 'PASS'
  const result = classifyStandardAcpConformance(value)
  assert.equal(result.class, 'compatible_unverified'); assert.equal(result.nativeTestPassed, false)
  assert.equal(result.capabilities[0].test, 'NOT_TESTED'); assert.equal(value.probe.capabilities[0].test, 'PASS')
})
