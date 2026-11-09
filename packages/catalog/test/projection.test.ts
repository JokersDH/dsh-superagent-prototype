/** Catalog -> main-owned configuration view: safe fields only, honest readiness, no auto-dispatch. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExecutionProfileViewSchema } from '../../contracts/src/configuration.ts'
import { projectProfiles, safeDisplayName, type CatalogProfileInput } from '../src/projection.ts'

const base = (overrides: Partial<CatalogProfileInput> = {}): CatalogProfileInput => ({
  id: 'profile-codex',
  revision: 1,
  displayName: 'Codex',
  driverId: 'codex-native',
  kind: 'native',
  readiness: 'not_tested',
  admitted: false,
  ...overrides,
})

test('every projected view satisfies the frozen ExecutionProfileView schema', () => {
  const cases: CatalogProfileInput[] = [
    base({ id: 'p-none' }),
    base({ id: 'p-missing', readiness: 'missing' }),
    base({ id: 'p-setup', readiness: 'needs_setup' }),
    base({ id: 'p-auth', readiness: 'needs_auth' }),
    base({ id: 'p-incompatible', readiness: 'incompatible' }),
    base({ id: 'p-inspect', readiness: 'inspection_passed' }),
    base({ id: 'p-native-ok', readiness: 'native_test_passed', admitted: true }),
    base({ id: 'p-fixture', kind: 'controlled_fixture', readiness: 'fixture_ready', admitted: true }),
  ]
  const { profiles } = projectProfiles(cases)
  assert.equal(profiles.length, cases.length)
  for (const view of profiles) {
    assert.equal(ExecutionProfileViewSchema.safeParse(view).success, true, JSON.stringify(view))
  }
})

test('no executable, argv, native config or evidence reaches the projection', () => {
  const { profiles } = projectProfiles([base({ readiness: 'inspection_passed' })])
  const serialized = JSON.stringify(profiles[0])
  for (const forbidden of ['executable', 'argv', 'nativeConfigRef', 'permissionPolicyRevision', 'digest', 'evidence']) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
})

test('a fixture profile is fixture_ready and never a tested vendor', () => {
  const { profiles } = projectProfiles([base({ kind: 'controlled_fixture', readiness: 'native_test_passed', admitted: true })])
  assert.equal(profiles[0]!.kind, 'controlled_fixture')
  assert.equal(profiles[0]!.readiness, 'fixture_ready')
})

test('a fixture_ready native profile is reported as not_tested', () => {
  const { profiles } = projectProfiles([base({ readiness: 'fixture_ready' })])
  assert.equal(profiles[0]!.readiness, 'not_tested')
})

test('inspection alone never grants native dispatch', () => {
  const { profiles } = projectProfiles([base({ readiness: 'inspection_passed', admitted: true })])
  assert.equal(profiles[0]!.dispatchAllowed, false)
  assert.equal(profiles[0]!.blockedReason, 'policy_unprepared')
})

test('a tested and admitted native profile may dispatch', () => {
  const { profiles } = projectProfiles([base({ readiness: 'native_test_passed', admitted: true })])
  assert.equal(profiles[0]!.dispatchAllowed, true)
  assert.equal(profiles[0]!.blockedReason, undefined)
})

test('readiness maps to frozen AppErrorCode reasons', () => {
  const expected: Array<[CatalogProfileInput['readiness'], string]> = [
    ['missing', 'unsupported_capability'],
    ['needs_setup', 'policy_unprepared'],
    ['needs_auth', 'auth_required'],
    ['incompatible', 'schema_mismatch'],
  ]
  for (const [readiness, reason] of expected) {
    const { profiles } = projectProfiles([base({ readiness, admitted: true })])
    assert.equal(profiles[0]!.blockedReason, reason, readiness)
  }
})

test('an unadmitted profile is blocked even when readiness is good', () => {
  const { profiles } = projectProfiles([base({ readiness: 'native_test_passed', admitted: false })])
  assert.equal(profiles[0]!.dispatchAllowed, false)
  assert.equal(profiles[0]!.blockedReason, 'unsupported_capability')
})

test('duplicate ids are never emitted twice, and the bound truncates explicitly', () => {
  const duplicate = projectProfiles([base(), base()])
  assert.equal(duplicate.profiles.length, 1)
  assert.deepEqual(duplicate.dropped, ['profile-codex'])

  const many = projectProfiles(Array.from({ length: 5 }, (_, index) => base({ id: `p-${index}` })), { maxProfiles: 2 })
  assert.equal(many.profiles.length, 2)
  assert.equal(many.dropped.length, 3)
})

test('display names never leak a path', () => {
  assert.equal(safeDisplayName('p1', '/usr/local/bin/codex'), 'p1')
  assert.equal(safeDisplayName('p1', 'C:\\bin\\codex'), 'p1')
  assert.equal(safeDisplayName('p1', 'Codex CLI'), 'Codex CLI')
})
