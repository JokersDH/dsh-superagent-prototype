/**
 * The pure catalog: three practical recipes over real configured projects, deterministic output,
 * references that already exist in the configuration, and revision verification.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ProjectRecipeDraftSchema,
  RECIPE_CATALOG_VERSION,
  catalogDigest,
  isActionableDraft,
  matchRecipe,
  parseProjectRecipeDraft,
  pathWithin,
  recipeCatalogEntries,
  type RecipeMatchInput,
} from '../src/index.ts'
import { NOW, alphaFacts, betaFacts, configuration, withFacts } from './fixtures.ts'

const match = (kind: string, overrides: Partial<RecipeMatchInput> = {}) =>
  matchRecipe({ facts: alphaFacts, configuration, kind, now: NOW, ...overrides })

const assertNoExecutableSurface = (value: unknown) => {
  const text = JSON.stringify(value)
  for (const forbidden of ['"executable"', '"argv"', '"command"', '"shell"', '"scriptBody"', '"token"', '"approval"'])
    assert.equal(text.includes(forbidden), false, `draft must not expose ${forbidden}`)
}

test('catalog ships three distinct, versioned task recipes', () => {
  const entries = recipeCatalogEntries()
  assert.equal(entries.length, 3)
  assert.deepEqual(entries.map((entry) => entry.id), ['regression_fix', 'scoped_change', 'verification_followup'])
  for (const entry of entries) {
    assert.equal(entry.version, RECIPE_CATALOG_VERSION)
    assert.ok(entry.goal('X').length > 10)
  }
  assert.match(catalogDigest(), /^[a-f0-9]{64}$/)
})

test('regression_fix produces a complete draft over the configured project', () => {
  const draft = match('regression_fix', { selection: { paths: ['src/parser.ts'] } })
  assert.equal(draft.status, 'draft')
  assert.ok(isActionableDraft(draft))
  if (draft.status !== 'draft') return
  assert.equal(draft.authorization, 'none')
  assert.equal(draft.projectId, 'project-alpha')
  assert.equal(draft.profileId, 'profile-native')
  assert.deepEqual(draft.scope, {
    projectId: 'project-alpha',
    allowedPaths: ['src/parser.ts'],
    excludedPaths: ['src/generated'],
    externalActions: [],
  })
  // Criteria are exactly the configured defaults; nothing is invented.
  assert.deepEqual(draft.criteria.map((criterion) => criterion.id), ['tests', 'review'])
  assert.ok(draft.goal.includes('Alpha 服务'))
  assert.equal(draft.provenance.configuration.revision, configuration.revision)
  assert.equal(draft.provenance.facts.provider, 'test-fixture/1')
  assert.equal(ProjectRecipeDraftSchema.safeParse(draft).success, true)
  assert.doesNotThrow(() => parseProjectRecipeDraft(draft))
  assertNoExecutableSurface(draft)
})

test('scoped_change refuses to invent a boundary without explicit paths', () => {
  const draft = match('scoped_change')
  assert.equal(draft.status, 'needs_input')
  if (draft.status !== 'needs_input') return
  assert.deepEqual(draft.needsInput.map((item) => item.code), ['scope_paths_required'])
  assertNoExecutableSurface(draft)
})

test('verification_followup reuses only registered machine checks and the project scope', () => {
  const draft = match('verification_followup')
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  assert.deepEqual(draft.criteria, [{ id: 'tests', description: 'Registered project tests pass.', kind: 'machine', required: true, checkDefinitionRef: 'check-node-test' }])
  assert.deepEqual(draft.scope.allowedPaths, ['src', 'test'])
  assert.equal(draft.scope.externalActions.length, 0)
})

test('identical input yields byte-identical output and revision', () => {
  const selection = { paths: ['src/a.ts', 'src/b.ts'], excludedPaths: ['test'] }
  const first = match('regression_fix', { selection })
  const second = match('regression_fix', { selection })
  assert.deepEqual(first, second)
  assert.equal(first.revision, second.revision)
  assert.match(first.revision, /^[a-f0-9]{64}$/)
})

test('a changed configuration revision changes the draft revision (no stale reuse)', () => {
  const before = match('verification_followup', { configuration })
  const after = match('verification_followup', { configuration: { ...configuration, revision: '9'.repeat(64) } })
  assert.notEqual(before.revision, after.revision)
  assert.equal(before.provenance.configuration.revision, configuration.revision)
  assert.equal(after.provenance.configuration.revision, '9'.repeat(64))
})

test('a tampered draft is refused by revision verification', () => {
  const draft = match('verification_followup')
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  const widened = { ...draft, scope: { ...draft.scope, allowedPaths: ['src', 'test', 'docs'] } }
  assert.throws(() => parseProjectRecipeDraft(widened), /revision does not match/)
  assert.throws(() => parseProjectRecipeDraft({ ...draft, authorization: 'granted' }), /Not a project recipe draft/)
})

test('two projects with different facts keep separate suggestions', () => {
  const alpha = match('verification_followup', { facts: alphaFacts })
  const beta = matchRecipe({ facts: betaFacts, configuration, kind: 'verification_followup', now: NOW })
  assert.equal(alpha.status, 'draft')
  assert.equal(beta.status, 'draft')
  if (alpha.status !== 'draft' || beta.status !== 'draft') return
  assert.equal(alpha.projectId, 'project-alpha')
  assert.equal(beta.projectId, 'project-beta')
  assert.deepEqual(beta.criteria.map((criterion) => criterion.id), ['beta-tests'])
  assert.deepEqual(beta.scope.allowedPaths, ['packages/core/src'])
  assert.notEqual(alpha.revision, beta.revision)
  assert.notEqual(alpha.provenance.facts.digest, beta.provenance.facts.digest)
})

test('explicit criteria selection may only narrow the configured defaults', () => {
  const draft = match('regression_fix', { selection: { paths: ['src'], criteriaIds: ['review'] } })
  assert.equal(draft.status, 'needs_input')
  if (draft.status !== 'needs_input') return
  assert.deepEqual(draft.needsInput.map((item) => item.code), ['criteria_machine_required'])

  const onlyTests = match('regression_fix', { selection: { paths: ['src'], criteriaIds: ['tests'] } })
  assert.equal(onlyTests.status, 'draft')
  if (onlyTests.status !== 'draft') return
  assert.deepEqual(onlyTests.criteria.map((criterion) => criterion.id), ['tests'])
})

test('scope exclusion may only grow, never disappear', () => {
  const draft = match('regression_fix', { selection: { paths: ['src'], excludedPaths: ['test'] } })
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') return
  assert.deepEqual(draft.scope.excludedPaths, ['src/generated', 'test'])
})

test('pathWithin respects directory boundaries', () => {
  assert.equal(pathWithin('src', 'src'), true)
  assert.equal(pathWithin('src/a.ts', 'src'), true)
  assert.equal(pathWithin('srcx/a.ts', 'src'), false)
  assert.equal(pathWithin('src', 'src/a.ts'), false)
})

test('a Node project with no manager declaration is still served, with a note', () => {
  const draft = match('verification_followup', { facts: withFacts({ manager: { kind: 'none' }, locks: [], stack: { kind: 'node' } }) })
  assert.equal(draft.status, 'draft')
  assert.ok(draft.notes.some((note) => note.includes('packageManager')))
})
