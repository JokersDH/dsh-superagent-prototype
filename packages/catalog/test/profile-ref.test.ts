/**
 * Negative-case guard for the stable consumption interface (wave-05 B1).
 *
 * The consumer-facing promise is narrow and must fail closed:
 *   a ref resolves ONLY to the exact admitted revision it names, or it refuses with a reason.
 *
 * Each test below pins one way that promise can be broken. They are written so that reintroducing
 * the bug makes exactly one of them fail - resolving by bare profile id, substituting the newest
 * revision, inheriting approval across identity drift, or promoting fixture evidence to native.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AgentCatalog,
  capabilityClassOf,
  identityDigestOf,
  refFor,
  resolveProfileRef,
  type CatalogEntry,
} from '../src/index.ts'
import type { CapabilityObservation, CompatibilityIdentity } from '../../contracts/src/types.ts'

const identity = (overrides: Partial<CompatibilityIdentity> = {}): CompatibilityIdentity => ({
  executableDigest: 'a'.repeat(64),
  nativeVersion: '0.164.0',
  driverRelease: 'codex-native/1',
  wireVersion: '1',
  schemaDigest: 'b'.repeat(64),
  resolvedConfigFingerprint: 'c'.repeat(64),
  permissionPolicyRevision: 'policy-1',
  configStability: 'stable',
  platform: 'darwin',
  architecture: 'arm64',
  ...overrides,
} as CompatibilityIdentity)

const capability = (feature: string, evidenceRefs: string[], policy: CapabilityObservation['policy'] = 'allowed'): CapabilityObservation =>
  ({ feature, advertised: true, observed: true, test: 'PASS', policy, evidenceRefs } as unknown as CapabilityObservation)

const entry = (overrides: Partial<CatalogEntry> = {}): CatalogEntry => ({
  profileId: 'profile-codex-native',
  profileRevision: 1,
  readiness: 'native_test_passed',
  identity: identity(),
  capabilities: [capability('questions', ['actual_native-stop-probe'])],
  diagnosis: [],
  evidenceRefs: ['probe-1'],
  checkedAt: '2026-11-10T00:00:00.000Z',
  ...overrides,
})

test('a ref resolves to the exact revision it names', () => {
  const first = entry({ profileRevision: 1 })
  const admission = refFor(first)
  assert.ok(admission, 'an admitted entry must produce a ref')
  const resolution = resolveProfileRef([first], admission)
  assert.equal(resolution.ok, true)
  if (!resolution.ok) return
  assert.equal(resolution.entry.profileRevision, 1)
})

test('a ref never silently upgrades to a newer revision with the same profile id', () => {
  const first = entry({ profileRevision: 1 })
  const admission = refFor(first)!
  // The newest revision passes admission too - the tempting "just use current" shortcut.
  const newer = entry({ profileRevision: 2, identity: identity({ executableDigest: 'f'.repeat(64) }) })
  const resolution = resolveProfileRef([first, newer], admission)
  assert.equal(resolution.ok, false)
  if (resolution.ok) return
  // Revision 2 installed new bytes, so revision 1 approval must not be reused.
  assert.equal(resolution.reason, 'identity_drift')
  assert.equal(resolution.current?.revision, 2, 'the refusal should say what is actually available')
})

test('a ref whose revision no longer exists refuses instead of substituting', () => {
  const newer = entry({ profileRevision: 3 })
  const stale = { profileId: 'profile-codex-native', revision: 1, identityDigest: identityDigestOf(entry())! }
  const resolution = resolveProfileRef([newer], stale)
  assert.equal(resolution.ok, false)
  if (resolution.ok) return
  assert.equal(resolution.reason, 'revision_mismatch')
  assert.equal(resolution.current?.revision, 3)
})

test('an identity change invalidates the old ref (drift cannot inherit approval)', () => {
  const before = entry()
  const admission = refFor(before)!
  const after = entry({ identity: identity({ executableDigest: 'd'.repeat(64) }) })
  const resolution = resolveProfileRef([after], admission)
  assert.equal(resolution.ok, false)
  if (resolution.ok) return
  assert.equal(resolution.reason, 'identity_drift')
  assert.notEqual(identityDigestOf(after), admission.identityDigest, 'the digest must cover executable bytes')
})

test('a malformed ref is refused rather than treated as a profile name', () => {
  for (const bad of [
    { profileId: 'profile-codex-native', revision: 0, identityDigest: 'a'.repeat(64) },
    { profileId: 'profile-codex-native', revision: 1.5, identityDigest: 'a'.repeat(64) },
    { profileId: 'profile-codex-native', revision: 1, identityDigest: 'not-a-digest' },
    { profileId: '', revision: 1, identityDigest: 'a'.repeat(64) },
  ]) {
    const resolution = resolveProfileRef([entry()], bad as never)
    assert.equal(resolution.ok, false, `malformed ref ${JSON.stringify(bad)} must be refused`)
  }
})

test('an unadmitted revision resolves to not_admitted, never to ok', () => {
  const pending = entry({ readiness: 'needs_auth' })
  const resolution = resolveProfileRef([pending], refFor(pending)!)
  assert.equal(resolution.ok, false)
  if (resolution.ok) return
  assert.equal(resolution.reason, 'not_admitted')
})

test('a passing capability with no class marker is only inspection evidence', () => {
  // This is what the production probe emits: `capability-<feature>` with no class marker.
  const inspected = entry({ capabilities: [capability('questions', ['capability-questions'])] })
  assert.equal(capabilityClassOf(inspected), 'schema')
  const resolution = resolveProfileRef([inspected], refFor(inspected)!)
  assert.equal(resolution.ok, false, 'an inspection-level fact must not satisfy a native requirement')
  if (!resolution.ok) assert.equal(resolution.reason, 'insufficient_evidence')
})

test('a failed observation is never promoted by a class-looking ref', () => {
  const lying = entry({
    capabilities: [{ ...capability('questions', ['actual_native-probe']), test: 'FAIL' as never } as CapabilityObservation],
  })
  assert.equal(capabilityClassOf(lying), 'schema', 'a non-PASS observation observed nothing')
})

test('fixture evidence is not native evidence unless the caller explicitly accepts it', () => {
  const fixtureBacked = entry({ capabilities: [capability('questions', ['fixture-question-replay'])] })
  const admission = refFor(fixtureBacked)!

  const strict = resolveProfileRef([fixtureBacked], admission)
  assert.equal(strict.ok, false, 'fixture evidence must not satisfy the default native requirement')
  if (!strict.ok) assert.equal(strict.reason, 'insufficient_evidence')

  const lenient = resolveProfileRef([fixtureBacked], admission, { minimumCapabilityClass: 'protocol_fixture' })
  assert.equal(lenient.ok, true, 'an explicit lower requirement may still consume fixture evidence')
  if (lenient.ok) assert.equal(lenient.capabilityClass, 'protocol_fixture')
})

test('the weakest capability observation decides the class, so a native claim cannot hide', () => {
  const mixed = entry({
    capabilities: [
      capability('questions', ['actual_native-stop-probe']),
      capability('approval', ['fixture-approval-replay']),
    ],
  })
  assert.equal(capabilityClassOf(mixed), 'protocol_fixture')
  const resolution = resolveProfileRef([mixed], refFor(mixed)!)
  assert.equal(resolution.ok, false)
  if (!resolution.ok) assert.equal(resolution.reason, 'insufficient_evidence')
})

test('a required feature that was never allowed refuses the resolution', () => {
  const blocked = entry({ capabilities: [capability('questions', ['actual_native-stop-probe'], 'blocked')] })
  const resolution = resolveProfileRef([blocked], refFor(blocked)!, { requireFeatures: ['questions'] })
  assert.equal(resolution.ok, false)
  if (!resolution.ok) assert.equal(resolution.reason, 'capability_missing')
})

test('an entry with no identity cannot be referenced at all', () => {
  const anonymous = entry({ readiness: 'needs_setup', identity: undefined })
  assert.equal(refFor(anonymous), undefined, 'without identity there is nothing to pin')
  const invented = { profileId: anonymous.profileId, revision: 1, identityDigest: 'e'.repeat(64) }
  const resolution = resolveProfileRef([anonymous], invented)
  assert.equal(resolution.ok, false)
  if (!resolution.ok) assert.equal(resolution.reason, 'identity_drift')
})

test('the catalog retains history so a pinned older revision is still resolvable', () => {
  const catalog = new AgentCatalog()
  const v1 = entry({ profileRevision: 1 })
  catalog.record(v1)
  const admission = refFor(v1)!
  // Revision 2 arrives with identical identity (a re-probe, not a drift).
  catalog.record(entry({ profileRevision: 2 }))

  assert.equal(catalog.get('profile-codex-native')?.profileRevision, 2, 'newest still wins for get()')
  assert.deepEqual(catalog.revisions('profile-codex-native').map(item => item.profileRevision), [1, 2])

  const resolution = catalog.resolveRef(admission)
  assert.equal(resolution.ok, true, 'a re-probe that did not drift must not invalidate the pinned ref')
  if (resolution.ok) assert.equal(resolution.entry.profileRevision, 1)
})

test('recording the same revision twice does not duplicate history', () => {
  const catalog = new AgentCatalog()
  catalog.record(entry({ profileRevision: 1 }))
  catalog.record(entry({ profileRevision: 1 }))
  assert.equal(catalog.revisions('profile-codex-native').length, 1)
})
