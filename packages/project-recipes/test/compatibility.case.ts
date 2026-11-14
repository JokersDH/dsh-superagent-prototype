/**
 * J13/J15: controlled-fixture and native configurations stay distinguishable; an explicit user
 * choice is honoured instead of silently replaced; optional facts may be absent without inventing
 * execution readiness. Nothing here claims native admission — a draft never carries one.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchRecipe } from '../src/index.ts'
import { NOW, alphaFacts, alphaCriteria, configuration, withFacts } from './fixtures.ts'

const scope = { projectId: 'project-alpha', allowedPaths: ['src'], excludedPaths: [], externalActions: [] } as const

const fixtureProfile = {
  id: 'profile-fixture',
  revision: 1,
  displayName: 'Controlled fixture',
  driverId: 'fixture-driver',
  kind: 'controlled_fixture' as const,
  readiness: 'fixture_ready' as const,
  dispatchAllowed: true,
}

const nativeProfile = configuration.profiles[0]!

const configWith = (profiles: readonly (typeof fixtureProfile | typeof nativeProfile)[], defaultProfileId: string, availability: { state: 'available'; kind: 'controlled_fixture' | 'native' } | { state: 'unavailable'; reason: 'not_installed' }) => ({
  ...configuration,
  executionAvailability: availability,
  profiles: [...profiles],
  projects: [{ ...configuration.projects[0]!, profileIds: profiles.map((profile) => profile.id), defaultProfileId }],
})

const match = (overrides: Partial<Parameters<typeof matchRecipe>[0]> = {}) =>
  matchRecipe({ facts: alphaFacts, configuration, kind: 'regression_fix', selection: { paths: ['src/a.ts'] }, now: NOW, ...overrides })

test('a controlled-fixture configuration yields a fixture draft, never a native claim', () => {
  const fixtureOnly = configWith([fixtureProfile], 'profile-fixture', { state: 'available', kind: 'controlled_fixture' })
  const draft = match({ configuration: fixtureOnly })
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  assert.equal(draft.profileId, 'profile-fixture')
  const text = JSON.stringify(draft)
  assert.equal(text.includes('native_test_passed'), false)
  assert.equal(text.includes('"kind": "native"'), false)
  assert.equal(text.includes('fixture_ready'), false)
  assert.equal(draft.authorization, 'none')
})

test('a native configuration does not inherit fixture readiness wording', () => {
  const draft = match({ configuration: configWith([nativeProfile], 'profile-native', { state: 'available', kind: 'native' }) })
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  assert.equal(draft.profileId, 'profile-native')
  const text = JSON.stringify(draft)
  assert.equal(text.includes('"fixture_ready"'), false)
  assert.equal(text.includes('"controlled_fixture"'), false)
})

test('an explicit profile choice is honoured and never replaced by another profile', () => {
  const both = configWith([nativeProfile, fixtureProfile], 'profile-native', { state: 'available', kind: 'native' })
  const chosen = match({ configuration: both, selection: { paths: ['src/a.ts'], profileId: 'profile-fixture' } })
  assert.equal(chosen.status, 'draft')
  if (chosen.status !== 'draft') return
  assert.equal(chosen.profileId, 'profile-fixture')

  const unknown = match({ configuration: both, selection: { paths: ['src/a.ts'], profileId: 'profile-absent' } })
  assert.equal(unknown.status, 'needs_input')
  if (unknown.status !== 'needs_input') return
  assert.deepEqual(unknown.needsInput.map((item) => item.code), ['profile_not_enabled'])
})

test('missing optional facts (scripts, engines) do not block, and are not invented', () => {
  const draft = match({ facts: withFacts({ scripts: [], missing: ['scripts', 'enginesNode'], stack: { kind: 'node' } }) })
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  // The suggestion references only configured criteria; nothing derived from scripts appears.
  assert.deepEqual(draft.criteria.map((criterion) => criterion.id), alphaCriteria.map((criterion) => criterion.id))
  assert.equal(JSON.stringify(draft).includes('engines'), false)
})

test('an unavailable execution state is never shown as a fixture fallback', () => {
  const unavailable = {
    ...configuration,
    executionAvailability: { state: 'unavailable' as const, reason: 'not_installed' as const },
    profiles: [{ ...nativeProfile, dispatchAllowed: false, readiness: 'not_tested' as const, blockedReason: 'unsupported_capability' as const }],
    projects: [{ ...configuration.projects[0]!, dispatchAllowed: false, blockedReason: 'unsupported_capability' as const, profileIds: [], defaultProfileId: undefined }],
  }
  const draft = match({ configuration: unavailable })
  assert.equal(draft.status, 'needs_input')
  if (draft.status !== 'needs_input') return
  const codes = draft.needsInput.map((item) => item.code)
  assert.ok(codes.includes('execution_unavailable'))
  assert.ok(codes.includes('project_dispatch_blocked'))
  assert.equal(JSON.stringify(draft).includes('"fixture_ready"'), false)
  assert.equal(draft.authorization, 'none')
})

test('the draft scope never carries external actions or an expiry copied from nowhere', () => {
  const mined = match()
  assert.equal(mined.status, 'draft')
  if (mined.status !== 'draft') return
  assert.deepEqual(mined.scope.externalActions, [])
  assert.equal(mined.scope.expiresAt, undefined)
  assert.deepEqual(mined.scope.allowedPaths, ['src/a.ts'])
  void scope
})

test('two projects sharing a display name but not an identity never share a suggestion', () => {
  const alpha = configuration.projects[0]!
  const twin = {
    ...alpha,
    id: 'project-twin',
    scope: { projectId: 'project-twin', allowedPaths: ['src'], excludedPaths: [], externalActions: [] },
    defaultCriteria: [{ id: 'twin-tests', description: 'Twin tests pass.', kind: 'machine' as const, required: true as const, checkDefinitionRef: 'check-node-test' }],
  }
  const both = { ...configuration, projects: [alpha, twin] }
  const alphaDraft = match({ configuration: both })
  const twinDraft = match({ configuration: both, facts: withFacts({ projectId: 'project-twin' }) })
  assert.equal(alphaDraft.status, 'draft')
  assert.equal(twinDraft.status, 'draft')
  if (alphaDraft.status !== 'draft' || twinDraft.status !== 'draft') return
  assert.equal(alphaDraft.provenance.configuration.projectId, 'project-alpha')
  assert.equal(twinDraft.provenance.configuration.projectId, 'project-twin')
  assert.deepEqual(alphaDraft.scope.allowedPaths, ['src/a.ts'])
  assert.deepEqual(twinDraft.scope.allowedPaths, ['src/a.ts'])
  assert.notEqual(alphaDraft.projectId, twinDraft.projectId)
  assert.notEqual(alphaDraft.criteria[0]!.id, twinDraft.criteria[0]!.id)
  assert.notEqual(alphaDraft.revision, twinDraft.revision)
  // Same display name may produce the same goal sentence; identity still differs.
  assert.equal(alphaDraft.goal, twinDraft.goal)
})
