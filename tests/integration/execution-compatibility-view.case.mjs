import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { classifyCompatibility } from '../../packages/catalog/src/compatibility.ts'
import { executionProfileView } from '../../apps/coordinator/product/execution-profile-view.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { ProductStore } from '../../packages/storage/dist/index.js'

const profile = { id: 'profile-compatibility', revision: 1, driverId: 'codex-native', driverApiMajor: 1, driverRelease: 'test-release',
  executable: '/private/fixture-agent', argv: [], expectedVersion: '1.2.3', nativeConfigRef: 'private-fixture-settings',
  permissionPolicyRevision: 'policy-1', requiredFeatures: [] }
const identity = { profileId: profile.id, profileRevision: 1, driverApiMajor: 1, driverRelease: profile.driverRelease,
  executableDigest: 'a'.repeat(64), nativeVersion: '1.2.4', wireVersion: 'fixture-protocol', schemaDigest: 'b'.repeat(64),
  resolvedConfigFingerprint: 'c'.repeat(64), permissionPolicyRevision: 'policy-1', configStability: 'frozen',
  platform: process.platform, architecture: process.arch, runtimeVersion: process.version }
const probe = { identity, capabilities: [], readiness: 'inspection_passed', checkedAt: '2026-11-26T00:00:00.000Z', evidenceRefs: [] }
const surface = { wireVersion: identity.wireVersion, schemaDigest: identity.schemaDigest, methods: ['begin'],
  requestFields: {}, enums: {}, notifications: [], serverRequests: [], requestIdTypes: ['integer', 'string'] }
const required = { methods: ['begin'], requestFields: {}, enums: {}, notifications: [] }
const classify = observation => classifyCompatibility({ profile, probe, surface: observation, required })
const verdict = () => classify({ status: 'observed', surface, evidenceRefs: [] })
const operations = [{ operation: 'begin', supported: true, validation: 'controlled', enabled: true },
  { operation: 'steer', supported: false, validation: 'protocol', enabled: false }]
const trial = () => ({ mode: 'explicit_trial', identityDigest: canonicalDigest(identity), policyDigest: 'd'.repeat(64), confirmationCommandId: 'original-consent-command' })

test('main consumes B classification without turning a diagnostic recommendation into permission', () => {
  const view = executionProfileView({ profile, displayName: 'Unverified agent', verdict: verdict(), operations })
  assert.equal(view.compatibility.classification, 'compatible_unverified')
  assert.equal(view.readiness, 'inspection_passed'); assert.equal(view.dispatchAllowed, false)
  assert.equal(view.compatibility.operations.some(item => item.enabled), false)
  const text = JSON.stringify(view)
  for (const privateValue of [profile.executable, profile.nativeConfigRef]) assert.equal(text.includes(privateValue), false)
})

test('trusted explicit trial binds the exact observed identity and a checked begin consumer', () => {
  const view = executionProfileView({ profile, displayName: 'Trial agent', verdict: verdict(), operations, admission: trial() })
  assert.equal(view.dispatchAllowed, true); assert.equal(view.readiness, 'inspection_passed')
  assert.equal(view.compatibility.operations.find(item => item.operation === 'steer').enabled, false)
  assert.throws(() => executionProfileView({ profile, displayName: 'Wrong identity', verdict: verdict(), operations,
    admission: { ...trial(), identityDigest: 'e'.repeat(64) } }))
  assert.throws(() => executionProfileView({ profile, displayName: 'No actual begin consumer', verdict: verdict(),
    operations: [{ operation: 'begin', supported: true, validation: 'protocol', enabled: true }], admission: trial() }))
  assert.throws(() => executionProfileView({ profile, displayName: 'Fake verified', verdict: verdict(), operations, admission: { mode: 'verified' } }))
})

test('missing and incompatible observations remain blocked, not guessed as trial compatible', () => {
  for (const observation of [{ status: 'timeout', reason: 'fixture-timeout', evidenceRefs: [] },
    { status: 'observed', surface: { ...surface, methods: [] }, evidenceRefs: [] }]) {
    const view = executionProfileView({ profile, displayName: 'Blocked agent', verdict: classify(observation), operations })
    assert.equal(view.dispatchAllowed, false)
    assert.equal(view.compatibility.operations.some(item => item.enabled), false)
    assert.throws(() => executionProfileView({ profile, displayName: 'Wrong trial', verdict: classify(observation), operations, admission: trial() }))
  }
})

test('the original runtime/configuration HTTP consumer publishes trial facts without a native task or fixture fallback', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-compatibility-view-')), state = join(root, 'state')
  mkdirSync(state, { mode: 0o700 })
  const store = new ProductStore({ path: join(state, 'state.sqlite') })
  const view = executionProfileView({ profile, displayName: 'Explicit trial agent', verdict: verdict(), operations, admission: trial() })
  const principal = { userId: 'compatibility-user', authorityRef: 'compatibility-authority' }
  const product = createProductRuntime({ store, principal, stateRoot: state, scratchProject: root, projects: [], actionSecret: Buffer.alloc(32, 51),
    native: { profile, profileView: view, approvalPolicy: 'on-request', projects: [] } })
  t.after(async () => { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4499'], mode: 'personal', read: product.read, operations: product.operations })
  const response = await api.request('/v1/configuration', { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.profiles, [view]); assert.equal(body.profiles.length, 1)
  assert.equal(body.profiles[0].readiness, 'inspection_passed')
  const readonlyApi = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4499'], mode: 'personal', startupMode: 'recovery_readonly', read: product.read, operations: product.operations })
  const readonlyResponse = await readonlyApi.request('/v1/configuration', { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })
  assert.equal(readonlyResponse.status, 200)
  const readonlyView = await readonlyResponse.json()
  assert.equal(readonlyView.profiles[0].dispatchAllowed, false)
  assert.equal(readonlyView.profiles[0].compatibility.operations.some(item => item.enabled), false)
  assert.equal(store.domain.tickets.list().length, 0)
  assert.equal(store.events.cursor(), 0)
})
