/**
 * J1/J9: consume the actual main contract published in 0073 (`project-recipe-preview/1`) without
 * editing it. This pins the field shape and the stable facts digest that the coordinator computes,
 * so a change on either side fails here first instead of in the product.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ProjectRecipeFieldsSchema,
  ProjectRecipePreviewInputSchema,
  ProjectRecipePreviewSchema,
} from '../../../packages/contracts/dist/index.js'
import { canonicalDigest } from '../../../packages/contracts/dist/canonical.js'
import type { Json } from '../../../packages/contracts/dist/index.js'
import {
  RECIPE_CATALOG,
  catalogDigest,
  factsContentDigest,
  matchRecipe,
  parseProjectRecipeDraft,
  previewInputs,
} from '../../../packages/project-recipes/src/index.ts'
import { NOW, alphaFacts, configuration } from '../../../packages/project-recipes/test/fixtures.ts'

const project = configuration.projects[0]!
const profile = configuration.profiles[0]!

const input = ProjectRecipePreviewInputSchema.parse({
  projectId: project.id,
  kind: 'scoped_change',
  allowedPaths: ['src/'],
  profileId: profile.id,
})

const draftFor = () => {
  const draft = parseProjectRecipeDraft(matchRecipe({
    facts: alphaFacts,
    configuration,
    kind: input.kind,
    selection: { paths: [...input.allowedPaths], profileId: input.profileId },
    now: NOW,
  }))
  assert.equal(draft.status, 'draft')
  if (draft.status !== 'draft') throw new Error('fixture must draft')
  return draft
}

test('the main preview input shape selects only declared atoms and an existing profile', () => {
  assert.deepEqual(input.allowedPaths, ['src/'])
  assert.equal(input.profileId, profile.id)
  // An injected root or command is not part of the contract.
  assert.equal(ProjectRecipePreviewInputSchema.safeParse({ ...input, root: '/private' }).success, false)
  assert.equal(ProjectRecipePreviewInputSchema.safeParse({ ...input, allowedPaths: ['src/', 'src/'] }).success, false)
})

test('my draft fields satisfy the published ProjectRecipeFields contract exactly', () => {
  const draft = draftFor()
  const fields = previewInputs(draft, { configuration, facts: alphaFacts })
  const { projectId, goal, scope, criteria, profileId } = fields
  const parsed = ProjectRecipeFieldsSchema.parse({ projectId, goal, scope, criteria, profileId })
  assert.deepEqual(parsed.scope.allowedPaths, ['src/'])
  assert.equal(parsed.projectId, project.id)
  assert.equal(parsed.profileId, profile.id)
})

test('a synthesized main preview accepts my draft and my refusal issues', () => {
  const draft = draftFor()
  const base = {
    protocol: 'project-recipe-preview/1' as const,
    input,
    configurationRevision: configuration.revision,
    factsDigest: factsContentDigest(alphaFacts),
    catalogDigest: catalogDigest(),
    observedAt: NOW,
    authorization: 'none' as const,
  }
  const { projectId, goal, scope, criteria, profileId } = previewInputs(draft, { configuration, facts: alphaFacts })
  const actionable = ProjectRecipePreviewSchema.parse({
    ...base,
    status: 'draft',
    title: RECIPE_CATALOG[input.kind].title,
    fields: { projectId, goal, scope, criteria, profileId },
    issues: [],
  })
  assert.equal(actionable.status, 'draft')

  const refused = parseProjectRecipeDraft(matchRecipe({
    facts: alphaFacts,
    configuration,
    kind: 'scoped_change',
    selection: { paths: [] },
    now: NOW,
  }))
  assert.equal(refused.status, 'needs_input')
  if (refused.status !== 'needs_input') return
  const preview = ProjectRecipePreviewSchema.parse({
    ...base,
    status: refused.status,
    title: RECIPE_CATALOG[input.kind].title,
    fields: null,
    issues: refused.needsInput.map((issue) => ({ code: issue.code, message: issue.message })),
  })
  assert.equal(preview.fields, null)
})

test('my stable facts digest equals the coordinator formula (observedAt excluded)', () => {
  const { observedAt: _ignored, ...content } = alphaFacts
  assert.equal(factsContentDigest(alphaFacts), canonicalDigest(content as unknown as Json))
})
