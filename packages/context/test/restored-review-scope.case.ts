import assert from 'node:assert/strict'
import { test } from 'node:test'
import { explainRestoredReviewScope } from '../src/index.ts'

const bindingScope = { projectId: 'project-a', allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
const selection = (overrides: Partial<typeof bindingScope> = {}) => ({ ...bindingScope, ...overrides })
const input = (value: ReturnType<typeof selection>, sourcesState: 'verified' | 'scope_changed' = 'verified') => ({
  bindingScope,
  selection: value,
  sourcesState,
  frozenSourceIds: ['source-1', 'source-2'],
  readableCandidates: 1,
  readableHistory: 1,
  readableWorks: 1,
  readableDeliveries: 1,
})

test('an unchanged selection keeps the frozen scope verified and complete', () => {
  const result = explainRestoredReviewScope(input(selection()))
  assert.equal(result.state, 'verified')
  assert.equal(result.scopeChanged, false)
  assert.equal(result.partial, false)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.withheldSourceIds, [])
  assert.equal(result.authorization, 'none')
})

test('a narrower allowed path or a new exclusion is explained as a partial scope change', () => {
  const narrowed = explainRestoredReviewScope(input(selection({ allowedPaths: ['src/narrow/'] }), 'scope_changed'))
  assert.equal(narrowed.state, 'scope_changed')
  assert.equal(narrowed.scopeChanged, true)
  assert.equal(narrowed.partial, true)
  assert.deepEqual(narrowed.reasons, ['selection_narrowed'])
  assert.deepEqual(narrowed.withheldSourceIds, ['source-1', 'source-2'])
  const excluded = explainRestoredReviewScope(input(selection({ excludedPaths: ['.git', 'src/secret/'] })))
  assert.equal(excluded.scopeChanged, true)
  assert.deepEqual(excluded.reasons, ['exclusion_added'])
})

test('a broadened or replaced selection is reported but still authorizes nothing', () => {
  const broadened = explainRestoredReviewScope(input(selection({ allowedPaths: ['src/', 'tests/'] })))
  assert.deepEqual(broadened.reasons, ['selection_broadened'])
  assert.equal(broadened.authorization, 'none')
  const replaced = explainRestoredReviewScope(input(selection({ allowedPaths: ['tests/'] })))
  assert.deepEqual(replaced.reasons, ['selection_replaced'])
  const other = explainRestoredReviewScope(input(selection({ projectId: 'project-b' })))
  assert.deepEqual(other.reasons, ['project_changed'])
})

test('unverified historical sources are partial regardless of the selection', () => {
  for (const state of ['missing', 'unverified'] as const) {
    const result = explainRestoredReviewScope(input(selection(), state as never))
    assert.equal(result.state, state)
    assert.equal(result.partial, true)
    assert.deepEqual(result.withheldSourceIds, [])
  }
})
