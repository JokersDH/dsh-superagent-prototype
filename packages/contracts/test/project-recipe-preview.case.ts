import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProjectRecipePreviewInputSchema, ProjectRecipePreviewSchema } from '../src/index.ts'
const input = { projectId: 'one', kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-one' }
const value = { protocol: 'project-recipe-preview/1', input, configurationRevision: 'a'.repeat(64),
  factsDigest: 'b'.repeat(64), catalogDigest: 'c'.repeat(64), observedAt: '2026-11-15T01:00:00.000Z', status: 'draft', title: '变更',
  fields: { projectId: 'one', goal: 'Goal', scope: { projectId: 'one', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    criteria: [{ id: 'test', kind: 'machine', required: true, description: 'Tests', checkDefinitionRef: 'check-one' }], profileId: 'profile-one' },
  issues: [], authorization: 'none' }
test('recipe preview fields preserve exact selected project, profile and declared path atoms without authority', () => {
  assert.deepEqual(ProjectRecipePreviewSchema.parse(value), value)
  for (const update of [{ authorization: 'granted' }, { root: '/private' }, { status: 'needs_input' }, { factsDigest: null },
    { fields: { ...value.fields, profileId: 'other' } }, { fields: { ...value.fields, scope: { ...value.fields.scope, allowedPaths: ['.'] } } }])
    assert.equal(ProjectRecipePreviewSchema.safeParse({ ...value, ...update }).success, false)
})
test('recipe preview input is only a bounded original selection, never a filesystem or command request', () => {
  assert.deepEqual(ProjectRecipePreviewInputSchema.parse(input), input)
  for (const update of [{ root: '/private' }, { commandId: 'injected' }, { kind: 'run_script' },
    { allowedPaths: [] }, { allowedPaths: ['src/', 'src/'] }])
    assert.equal(ProjectRecipePreviewInputSchema.safeParse({ ...input, ...update }).success, false)
})
