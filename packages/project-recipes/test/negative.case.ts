/**
 * Failure and unsupported-input matrix: every case changes one input from a valid baseline, so the
 * reported code identifies the actual cause. Unknown never degrades into a default, and a refusal
 * never loses the honest state of the input.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RecipeInputError, matchRecipe, type RecipeMatchInput } from '../src/index.ts'
import { NOW, alphaFacts, configuration, withConfiguration, withFacts } from './fixtures.ts'

const run = (overrides: Partial<RecipeMatchInput> = {}) => matchRecipe({ facts: alphaFacts, configuration, kind: 'regression_fix', now: NOW, ...overrides })
const codes = (draft: ReturnType<typeof run>) => (draft.status === 'draft' ? [] : draft.status === 'needs_input' ? draft.needsInput.map((item) => item.code) : draft.unsupported.map((item) => item.code))

const nativeProject = configuration.projects[0]!
const nativeProfile = configuration.profiles[0]!

test('a project missing from the current configuration is unsupported', () => {
  const draft = run({ selection: { paths: ['src'] }, facts: withFacts({ projectId: 'project-ghost' }) })
  assert.equal(draft.status, 'unsupported')
  assert.deepEqual(codes(draft), ['project_unknown'])
})

test('a non-Node root is unsupported instead of being defaulted to Node', () => {
  const draft = run({
    selection: { paths: ['src'] },
    facts: withFacts({
      stack: { kind: 'not_node', markers: ['pyproject.toml'] },
      manager: { kind: 'none' },
      locks: [],
      languages: [],
    }),
  })
  assert.equal(draft.status, 'unsupported')
  assert.deepEqual(codes(draft), ['stack_not_node'])
})

test('an unobserved stack is unsupported', () => {
  const draft = run({
    selection: { paths: ['src'] },
    facts: withFacts({ stack: { kind: 'unknown', reason: 'unparsable' }, manager: { kind: 'unknown', reason: 'unobserved' }, locks: [], languages: [] }),
  })
  assert.equal(draft.status, 'unsupported')
  assert.ok(codes(draft).includes('stack_unknown'))
})

test('an unsupported package manager is unsupported; an unobserved one needs input', () => {
  const yarn = run({ selection: { paths: ['src'] }, facts: withFacts({ manager: { kind: 'unsupported', name: 'yarn' }, locks: [{ name: 'yarn.lock' }] }) })
  assert.equal(yarn.status, 'unsupported')
  assert.ok(codes(yarn).includes('manager_unsupported'))

  const unknown = run({ selection: { paths: ['src'] }, facts: withFacts({ manager: { kind: 'unknown', reason: 'unobserved' }, locks: [] }) })
  assert.equal(unknown.status, 'needs_input')
  assert.deepEqual(codes(unknown), ['manager_unknown'])
})

test('conflicting lockfiles need explicit input', () => {
  const both = run({ selection: { paths: ['src'] }, facts: withFacts({ locks: [{ name: 'pnpm-lock.yaml' }, { name: 'package-lock.json' }] }) })
  assert.equal(both.status, 'needs_input')
  assert.deepEqual(codes(both), ['locks_ambiguous'])

  const mismatch = run({ selection: { paths: ['src'] }, facts: withFacts({ manager: { kind: 'pnpm' }, locks: [{ name: 'package-lock.json' }] }) })
  assert.equal(mismatch.status, 'needs_input')
  assert.deepEqual(codes(mismatch), ['locks_ambiguous'])
})

test('stale or future facts need a refresh', () => {
  const stale = run({ selection: { paths: ['src'] }, now: '2026-11-14T20:00:00.000Z' })
  assert.equal(stale.status, 'needs_input')
  assert.deepEqual(codes(stale), ['facts_stale'])

  const future = run({ selection: { paths: ['src'] }, facts: withFacts({ observedAt: '2026-11-15T00:00:00.000Z' }) })
  assert.equal(future.status, 'needs_input')
  assert.deepEqual(codes(future), ['facts_stale'])
})

test('a discussion-only project is explained, never dispatched', () => {
  const draft = run({
    selection: { paths: ['src'] },
    configuration: withConfiguration({
      executionAvailability: { state: 'unavailable', reason: 'recovery_readonly' },
      profiles: [{ ...nativeProfile, dispatchAllowed: false, readiness: 'not_tested', blockedReason: 'unsupported_capability' }],
      projects: [{ ...nativeProject, dispatchAllowed: false, discussionOnly: true, blockedReason: 'unsupported_capability', profileIds: [], defaultProfileId: undefined }],
    }),
  })
  assert.equal(draft.status, 'needs_input')
  assert.ok(codes(draft).includes('project_discussion_only'))
  assert.ok(codes(draft).includes('execution_unavailable'))
})

test('a disabled project reports its block reason', () => {
  const draft = run({
    selection: { paths: ['src'] },
    configuration: withConfiguration({ projects: [{ ...nativeProject, dispatchAllowed: false, blockedReason: 'policy_unprepared' }] }),
  })
  assert.equal(draft.status, 'needs_input')
  assert.ok(codes(draft).includes('project_dispatch_blocked'))
})

test('an unavailable execution state is a needs_input, not an inferred fixture fallback', () => {
  const draft = run({
    selection: { paths: ['src'] },
    configuration: withConfiguration({
      executionAvailability: { state: 'unavailable', reason: 'not_installed' },
      profiles: [{ ...nativeProfile, dispatchAllowed: false, readiness: 'not_tested', blockedReason: 'unsupported_capability' }],
      projects: [{ ...nativeProject, dispatchAllowed: false, blockedReason: 'unsupported_capability', profileIds: [], defaultProfileId: undefined }],
    }),
  })
  assert.equal(draft.status, 'needs_input')
  assert.ok(codes(draft).includes('execution_unavailable'))
})

test('an explicitly selected but disabled profile is refused', () => {
  const draft = run({ selection: { profileId: 'profile-other', paths: ['src'] } })
  assert.equal(draft.status, 'needs_input')
  assert.deepEqual(codes(draft), ['profile_not_enabled'])
})

test('an unknown criterion id is refused rather than dropped', () => {
  const draft = run({ selection: { paths: ['src'], criteriaIds: ['tests', 'invented'] } })
  assert.equal(draft.status, 'needs_input')
  assert.deepEqual(codes(draft), ['criteria_selection_unknown'])
})

test('paths outside the configured scope and invalid paths are refused', () => {
  const outside = run({ selection: { paths: ['docs'] } })
  assert.equal(outside.status, 'needs_input')
  assert.deepEqual(codes(outside), ['scope_path_outside_allowed'])

  const absolute = run({ selection: { paths: ['/etc/passwd'] } })
  assert.equal(absolute.status, 'needs_input')
  assert.deepEqual(codes(absolute), ['scope_path_outside_allowed'])

  const traversal = run({ selection: { paths: ['src/../etc'] } })
  assert.equal(traversal.status, 'needs_input')
  assert.deepEqual(codes(traversal), ['scope_path_outside_allowed'])

  const excluded = run({ selection: { paths: ['src'], excludedPaths: ['../secret'] } })
  assert.equal(excluded.status, 'needs_input')
  assert.deepEqual(codes(excluded), ['scope_path_outside_allowed'])
})

test('an authorized path may be narrowed but not broadened', () => {
  const narrowed = run({ selection: { paths: ['src/parser/lexer.ts'] } })
  assert.equal(narrowed.status, 'draft')
  const broadened = run({ selection: { paths: ['src/parser', 'srcx'] } })
  assert.equal(broadened.status, 'needs_input')
  assert.deepEqual(codes(broadened), ['scope_path_outside_allowed'])
})

test('a monorepo root needs explicit member paths before a bounded draft', () => {
  const root = run({ facts: withFacts({ workspace: { declaration: 'pnpm_workspace_yaml' } }) })
  assert.equal(root.status, 'needs_input')
  assert.deepEqual(codes(root), ['workspace_member_required'])

  const scoped = run({ facts: withFacts({ workspace: { declaration: 'pnpm_workspace_yaml' } }), selection: { paths: ['src/app.ts'] } })
  assert.equal(scoped.status, 'draft')
  if (scoped.status !== 'draft') return
  assert.deepEqual(scoped.scope.allowedPaths, ['src/app.ts'])
  assert.ok(scoped.notes.some((note) => note.includes('monorepo')))

  const unknownLayout = run({ facts: withFacts({ workspace: { declaration: 'unknown' } }), selection: { paths: ['src'] } })
  assert.equal(unknownLayout.status, 'needs_input')
  assert.ok(codes(unknownLayout).includes('workspace_unknown'))
})

test('an unsupported configuration protocol is unsupported and records no revision', () => {
  const draft = run({ selection: { paths: ['src'] }, configuration: { ...configuration, protocol: 'application-configuration/2' } })
  assert.equal(draft.status, 'unsupported')
  assert.deepEqual(codes(draft), ['configuration_unsupported_version'])
  assert.equal(draft.provenance.configuration.protocol, 'application-configuration/2')
  assert.equal(draft.provenance.configuration.revision, null)
})

test('a configuration that fails the public schema is unsupported, not repaired', () => {
  const draft = run({ selection: { paths: ['src'] }, configuration: { ...configuration, revision: 'not-a-digest' } })
  assert.equal(draft.status, 'unsupported')
  assert.deepEqual(codes(draft), ['configuration_invalid'])
  assert.equal(draft.provenance.configuration.revision, null)
})

test('an unknown kind or malformed facts is a caller error, not a product answer', () => {
  assert.throws(() => run({ kind: 'deploy_everything' }), (error: unknown) => error instanceof RecipeInputError && error.code === 'unknown_kind')
  assert.throws(() => run({ facts: { ...alphaFacts, protocol: 'project-facts/2' } }), (error: unknown) => error instanceof RecipeInputError && error.code === 'invalid_facts')
  assert.throws(() => run({ facts: { ...alphaFacts, extra: true } }), (error: unknown) => error instanceof RecipeInputError && error.code === 'invalid_facts')
  assert.throws(() => run({ now: 'not-a-time' }), (error: unknown) => error instanceof RecipeInputError && error.code === 'invalid_clock')
})
