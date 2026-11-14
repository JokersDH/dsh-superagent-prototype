import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TrialRecipeSuggestion } from '../../src/trial/recipes.ts'
import {
  trialRecipeContext, trialRecipeOutcome, trialRecipeSuggestionsForProject,
} from '../../src/trial/recipes.ts'

const suggestion = (over: Partial<TrialRecipeSuggestion> = {}): TrialRecipeSuggestion => ({
  id: 'recipe-1', version: '1', source: 'project-recipes', projectId: 'project-atlas',
  title: '补充单元检查声明', goalPreview: '在现有检查上补充说明，不改变命令。', scopeNote: 'src/',
  status: 'draft', missingInputs: [], checks: [{ id: 'check-unit', required: true, declared: true }],
  profiles: [{ id: 'profile-codex-local', required: true }],
  provenance: { manifest: 'package.json', declaredRoot: '.', note: '只读项目声明' },
  limitations: [], authority: 'none', ...over,
})
const context = (over: Partial<ReturnType<typeof trialRecipeContext>> = {}) => ({
  projectId: 'project-atlas', registeredChecks: ['check-unit'],
  profiles: [{ id: 'profile-codex-local', kind: 'native' as const, dispatchAllowed: true }], ...over,
})

test('a declared draft is applicable only against the current project and existing inputs', () => {
  const valid = trialRecipeOutcome(suggestion(), context())
  assert.equal(valid.applicable, true)
  assert.deepEqual(valid.reasons, [])
  assert.equal(valid.statusLabel, '草案')
  assert.deepEqual(valid.checks, [{ id: 'check-unit', required: true, state: 'available' }])
  assert.deepEqual(valid.profiles, [{ id: 'profile-codex-local', state: 'available' }])

  const wrongProject = trialRecipeOutcome(suggestion({ projectId: 'project-other' }), context())
  assert.equal(wrongProject.applicable, false)
  assert.match(wrongProject.reasons.join(' '), /不属于当前项目/)
  assert.equal(wrongProject.statusLabel, '草案', 'the declaration status is not silently relabelled')

  const missingProject = trialRecipeOutcome(suggestion({ projectId: null }), context())
  assert.equal(missingProject.applicable, false)
  assert.match(missingProject.reasons.join(' '), /未指明所属项目/)
})

test('needs_input, unsupported and missing configuration inputs block preparation with reasons', () => {
  const needsInput = trialRecipeOutcome(suggestion({ status: 'needs_input', missingInputs: [{ field: 'root', label: '项目根目录' }] }), context())
  assert.equal(needsInput.applicable, false)
  assert.equal(needsInput.statusLabel, '需要输入')
  assert.match(needsInput.reasons.join(' '), /缺少：项目根目录/)

  const unsupported = trialRecipeOutcome(suggestion({ status: 'unsupported' }), context())
  assert.equal(unsupported.applicable, false)
  assert.match(unsupported.reasons.join(' '), /不受支持/)

  const missingCheck = trialRecipeOutcome(suggestion({ checks: [{ id: 'check-missing', required: true, declared: true }] }), context())
  assert.equal(missingCheck.applicable, false)
  assert.equal(missingCheck.checks[0]?.state, 'missing')
  assert.match(missingCheck.reasons.join(' '), /未注册检查/)

  const blockedProfile = trialRecipeOutcome(suggestion(), context({ profiles: [{ id: 'profile-codex-local', kind: 'native', dispatchAllowed: false }] }))
  assert.equal(blockedProfile.applicable, false)
  assert.equal(blockedProfile.profiles[0]?.state, 'blocked')
  assert.match(blockedProfile.reasons.join(' '), /未准入/)

  const absentProfile = trialRecipeOutcome(suggestion({ profiles: [{ id: 'profile-unknown', required: true }] }), context())
  assert.equal(absentProfile.applicable, false)
  assert.match(absentProfile.reasons.join(' '), /没有执行器/)
})

test('a suggestion is never trusted as an authority or a command', () => {
  const forged = suggestion({ authority: 'granted' as unknown as 'none' })
  const outcome = trialRecipeOutcome(forged, context())
  assert.equal(outcome.applicable, false)
  assert.match(outcome.reasons.join(' '), /只读草案/)
  const emptyGoal = trialRecipeOutcome(suggestion({ goalPreview: '   ' }), context())
  assert.equal(emptyGoal.applicable, false)
  assert.match(emptyGoal.reasons.join(' '), /缺少目标预览/)
})

test('untrusted long text is bounded for display and never becomes markup', () => {
  const long = trialRecipeOutcome(suggestion({ goalPreview: '<img src=x onerror=alert(1)>'.repeat(40) }), context())
  assert.equal(long.goalPreview.length, 601)
  assert.ok(long.goalPreview.endsWith('…'))
  assert.equal(long.applicable, true, 'a long goal does not change applicability')
})

test('suggestions for other projects are not presented for the current project', () => {
  const list = [suggestion({ id: 'current' }), suggestion({ id: 'foreign', projectId: 'project-other' }), suggestion({ id: 'undeclared', projectId: null })]
  assert.deepEqual(trialRecipeSuggestionsForProject(list, 'project-atlas').map(item => item.id), ['current', 'undeclared'])
  assert.equal(trialRecipeSuggestionsForProject(list, undefined).length, 3)
})
