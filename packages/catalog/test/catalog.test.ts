/** WP-06 catalog: readiness states, capability evidence and drift invalidation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentCatalog, buildCatalogEntry, driftBetween, schedulable } from '../src/index.ts'
import type { AgentProfile } from '../../contracts/src/types.ts'

const DIGEST = 'a'.repeat(64)
const profile = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: 'profile-codex',
  revision: 1,
  driverId: 'codex-native',
  driverApiMajor: 1,
  driverRelease: '0.1.0',
  executable: '/usr/local/bin/codex',
  argv: ['--app-server'],
  expectedVersion: '0.164.0',
  nativeConfigRef: 'config-1',
  permissionPolicyRevision: 'policy-1',
  requiredFeatures: [],
  ...overrides,
})

const facts = (overrides: Record<string, unknown> = {}) => ({
  executable: '/usr/local/bin/codex',
  exists: true,
  digest: DIGEST,
  version: '0.164.0',
  configFingerprint: 'b'.repeat(64),
  configStability: 'frozen' as const,
  ...overrides,
})

const build = (f = facts(), p = profile()) => buildCatalogEntry({ profile: p, facts: f as never, checkedAt: '2026-11-08T00:00:00.000Z' })

test('a complete, verified probe reaches inspection_passed with a full identity', () => {
  const entry = build()
  assert.equal(entry.readiness, 'inspection_passed')
  assert.equal(entry.identity?.nativeVersion, '0.164.0')
  assert.equal(entry.identity?.resolvedConfigFingerprint, 'b'.repeat(64))
  assert.equal(schedulable(entry), true)
})

test('a missing executable is missing, never schedulable', () => {
  const entry = build(facts({ exists: false }))
  assert.equal(entry.readiness, 'missing')
  assert.equal(schedulable(entry), false)
  assert.equal(entry.identity, undefined)
})

test('an unreadable config is needs_setup', () => {
  assert.equal(build(facts({ configFingerprint: undefined })).readiness, 'needs_setup')
  assert.equal(build(facts({ configStability: 'unverified' })).readiness, 'needs_setup')
  assert.equal(build(facts({ configFingerprint: 'not-a-digest' })).readiness, 'needs_setup')
})

test('an interactive login requirement is needs_auth, not a failure to retry', () => {
  const entry = build(facts({ requiresAuth: true }))
  assert.equal(entry.readiness, 'needs_auth')
  assert.equal(schedulable(entry), false)
})

test('a pinned version mismatch is incompatible', () => {
  const entry = build(facts({ version: '0.163.0' }))
  assert.equal(entry.readiness, 'incompatible')
  assert.ok(entry.diagnosis.some(line => line.includes('0.163.0')))
})

test('an unread version is incompatible rather than assumed', () => {
  assert.equal(build(facts({ version: undefined })).readiness, 'incompatible')
})

test('a required feature that was not demonstrated blocks the entry', () => {
  const withFeature = profile({ requiredFeatures: ['chat.turn', 'tool.exec'] })
  const entry = build(facts({ observedFeatures: { 'chat.turn': { advertised: {}, observed: {}, policy: 'allowed' } } }), withFeature)
  assert.equal(entry.readiness, 'incompatible')
  assert.ok(entry.diagnosis.some(line => line.includes('tool.exec')))
})

test('all required features observed reaches inspection_passed', () => {
  const withFeature = profile({ requiredFeatures: ['chat.turn'] })
  const entry = build(facts({ observedFeatures: { 'chat.turn': { advertised: {}, observed: {}, policy: 'allowed' } } }), withFeature)
  assert.equal(entry.readiness, 'inspection_passed')
  assert.equal(entry.capabilities[0]?.test, 'PASS')
})

test('an executable that differs from the profile pin is refused', () => {
  const entry = build(facts({ executable: '/tmp/other-codex' }))
  assert.ok(entry.diagnosis.some(line => line.includes('executable mismatch')))
})

test('drift compares every identity field', () => {
  const first = build()
  const second = build(facts({ configFingerprint: 'c'.repeat(64) }))
  const drift = driftBetween(first, second)
  assert.equal(drift.drifted, true)
  assert.ok(drift.reasons.includes('resolvedConfigFingerprint changed'))
})

test('the catalog keeps newest entries and lists only schedulable profiles', () => {
  const catalog = new AgentCatalog()
  catalog.record(build())
  catalog.record(build(facts({ exists: false }), profile({ id: 'profile-broken' })))
  assert.equal(catalog.list().length, 2)
  assert.deepEqual(catalog.schedulableProfiles().map(entry => entry.profileId), ['profile-codex'])
})

test('a re-probe that drifts reports it on record', () => {
  const catalog = new AgentCatalog()
  catalog.record(build())
  // A config fingerprint change keeps the entry inspectable but must be reported as drift.
  const result = catalog.record(build(facts({ configFingerprint: 'c'.repeat(64) })))
  assert.equal(result.drifted, true)
  assert.ok(result.reasons.some(reason => reason.includes('resolvedConfigFingerprint')))
})

test('a version change that invalidates the entry still reports drift', () => {
  const catalog = new AgentCatalog()
  catalog.record(build())
  const result = catalog.record(build(facts({ version: '0.163.0' })))
  // An incompatible entry loses its identity, so readiness drift is what can be reported.
  assert.equal(result.entry.readiness, 'incompatible')
  assert.equal(result.drifted, true)
})
