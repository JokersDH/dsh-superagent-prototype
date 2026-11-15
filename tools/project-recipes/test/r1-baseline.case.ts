/**
 * R1 baseline is a pinned artifact, not a moving target.
 *
 * This test reads the **R1 source commit** (82ee5b8f) from git and asserts which J capabilities that
 * source actually contains. It is how the report states "R1 lacks the later freshness/budget work"
 * without modifying, re-freezing or re-installing R1.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const R1_SOURCE = '82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2'

const hasCommit = (): boolean => {
  try {
    execFileSync('git', ['cat-file', '-e', `${R1_SOURCE}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const read = (path: string): string => execFileSync('git', ['show', `${R1_SOURCE}:${path}`], { encoding: 'utf8' })

test('R1 source contains the wave-29 template layer and predates the wave-30 freshness/budget work', (t) => {
  if (!hasCommit()) {
    t.skip('R1 source commit is not available in this clone')
    return
  }
  for (const file of ['catalog.ts', 'draft.ts', 'facts.ts', 'index.ts', 'match.ts', 'observe.ts', 'preview.ts', 'scope.ts'])
    assert.ok(read(`packages/project-recipes/src/${file}`).length > 0, file)

  const preview = read('packages/project-recipes/src/preview.ts')
  const facts = read('packages/project-recipes/src/facts.ts')
  const observe = read('packages/project-recipes/src/observe.ts')
  const match = read('packages/project-recipes/src/match.ts')

  // Present in R1: stable content digest, edited goal, the wave-29 reuse comparison.
  assert.match(facts, /factsContentDigest/)
  assert.match(preview, /editGoal|toCreateWorkFields/)
  assert.match(match, /scope_path_outside_allowed/)
  // Absent in R1: future-observation refusal, omission reasons, limit validation, expired scope.
  assert.doesNotMatch(preview, /observedMs > nowMs/)
  assert.doesNotMatch(facts, /omissions/)
  assert.doesNotMatch(preview, /stale_draft_version/)
  assert.doesNotMatch(observe, /validateMetadataLimits/)
  assert.doesNotMatch(match, /project_scope_expired/)
})

test('R1 source already contains the 0073/0077 preview chain, so package one is not "missing an entry"', (t) => {
  if (!hasCommit()) {
    t.skip('R1 source commit is not available in this clone')
    return
  }
  for (const file of [
    'apps/coordinator/product/project-recipes.ts',
    'apps/console/src/useProjectRecipe.ts',
    'packages/contracts/src/project-recipe-preview.ts',
    'tests/integration/project-recipes.case.mjs',
    'tests/integration/project-recipes-browser.mjs',
  ]) assert.ok(read(file).length > 0, file)
  assert.match(read('apps/coordinator/http/app.ts'), /recipes\/preview/)
  // R1 ships the template entry but only the wave-29 freshness policy.
  assert.match(read('apps/coordinator/product/project-recipes.ts'), /createProjectFactsObserver/)
})

test('the pinned R1 tuple is recorded verbatim so D/E can bind it', () => {
  const record = {
    source: '82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2',
    build: '8296720d8a25f38c',
    tarSha256: '04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543',
    bytes: 20481470,
    entries: 6849,
    schema: 18,
    node: '24.21.0',
    abi: 137,
    platform: 'darwin-arm64',
  }
  assert.equal(record.source.length, 40)
  assert.match(record.tarSha256, /^[a-f0-9]{64}$/)
  assert.equal(record.schema, 18)
})
