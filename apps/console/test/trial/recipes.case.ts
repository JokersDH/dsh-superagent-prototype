import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TrialRecipeContext, TrialRecipeContextProject, TrialRecipeSuggestion } from '../../src/trial/recipes.ts'
import { trialRecipeOutcome } from '../../src/trial/recipes.ts'

const project: TrialRecipeContextProject = {
  id: 'project-atlas', displayName: '流程测试项目', dispatchAllowed: true, profileIds: ['profile-codex-local'],
  checkRefs: ['check-unit'],
  scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
  criteria: [{ id: 'criterion-1', description: '单元检查通过', kind: 'machine', required: true, checkDefinitionRef: 'check-unit' }],
  defaultProfileId: 'profile-codex-local',
}
const context = (over: Partial<TrialRecipeContext> = {}): TrialRecipeContext => ({
  projectId: 'project-atlas', projects: [project], registeredChecks: ['check-unit'],
  profiles: [{ id: 'profile-codex-local', kind: 'native', dispatchAllowed: true }], ...over,
})
const suggestion = (over: Partial<TrialRecipeSuggestion> = {}): TrialRecipeSuggestion => ({
  id: 'recipe-1', version: '1', source: 'project-recipes', projectId: 'project-atlas',
  title: '补充单元检查声明', goalPreview: '在现有检查上补充说明，不改变命令。', scopeNote: 'src/', scope: null,
  status: 'draft', missingInputs: [], checks: [{ id: 'check-unit', required: true, declared: true }],
  profiles: [{ id: 'profile-codex-local', required: true }],
  provenance: { manifest: 'package.json', declaredRoot: '.', note: '只读项目声明' },
  limitations: [], authority: 'none', ...over,
})

test('a draft is applicable only for a configured current project with its own check/profile refs', () => {
  const outcome = trialRecipeOutcome(suggestion(), context())
  assert.equal(outcome.applicable, true)
  assert.deepEqual(outcome.reasons, [])
  assert.deepEqual(outcome.checks, [{ id: 'check-unit', required: true, state: 'available' }])
  assert.deepEqual(outcome.profiles, [{ id: 'profile-codex-local', state: 'available' }])
  assert.ok(outcome.draft)
  assert.equal(outcome.draft.projectId, 'project-atlas')
  assert.equal(outcome.draft.profileId, 'profile-codex-local')
  assert.equal(outcome.draft.scope.allowedPaths[0], 'src/')
  assert.ok(outcome.draft.criteria.length === 1)
  assert.equal(outcome.draft.criteria[0]?.kind === 'machine' ? outcome.draft.criteria[0].checkDefinitionRef : undefined, 'check-unit')
  assert.equal(outcome.draft.authority, 'none')
  assert.equal(outcome.draft.source, 'project-recipes')

  const foreign = trialRecipeOutcome(suggestion({ projectId: 'project-other' }), context())
  assert.equal(foreign.applicable, false)
  assert.match(foreign.reasons.join(' '), /不属于当前项目/)
  assert.equal(foreign.draft, undefined)

  const allProjects = trialRecipeOutcome(suggestion(), context({ projectId: undefined }))
  assert.equal(allProjects.applicable, false)
  assert.match(allProjects.reasons.join(' '), /请先选择一个项目/)

  const deleted = trialRecipeOutcome(suggestion(), context({ projectId: 'project-deleted' }))
  assert.equal(deleted.applicable, false)
  assert.match(deleted.reasons.join(' '), /不在配置中/)
})

test('unknown source and undeclared project are explanation only', () => {
  const unknown = trialRecipeOutcome(suggestion({ source: 'unknown' }), context())
  assert.equal(unknown.applicable, false)
  assert.match(unknown.reasons.join(' '), /来源未知/)

  const undeclared = trialRecipeOutcome(suggestion({ projectId: null }), context())
  assert.equal(undeclared.applicable, false)
  assert.match(undeclared.reasons.join(' '), /未指明所属项目/)

  const forged = trialRecipeOutcome(suggestion({ authority: 'granted' as unknown as 'none' }), context())
  assert.equal(forged.applicable, false)
  assert.match(forged.reasons.join(' '), /只读草案/)
})

test('check applicability uses the project criteria, not the global registry alone', () => {
  const notInProject = trialRecipeOutcome(suggestion({ checks: [{ id: 'check-other', required: true, declared: true }] }),
    context({ registeredChecks: ['check-unit', 'check-other'] }))
  assert.equal(notInProject.applicable, false)
  assert.match(notInProject.reasons.join(' '), /当前项目未包含检查：check-other/)

  const notRegistered = trialRecipeOutcome(suggestion(), context({ registeredChecks: [] }))
  assert.equal(notRegistered.applicable, false)
  assert.match(notRegistered.reasons.join(' '), /当前配置未注册检查：check-unit/)

  const contradiction = trialRecipeOutcome(suggestion({ checks: [{ id: 'check-unit', required: true, declared: false }] }), context())
  assert.equal(contradiction.applicable, false)
  assert.match(contradiction.reasons.join(' '), /声明与项目检查矛盾/)
})

test('profile applicability uses project.profileIds, then registry admission', () => {
  const notBound = trialRecipeOutcome(suggestion(), context({
    projects: [{ ...project, profileIds: [] }],
  }))
  assert.equal(notBound.applicable, false)
  assert.match(notBound.reasons.join(' '), /当前项目未绑定执行器：profile-codex-local/)

  const blocked = trialRecipeOutcome(suggestion(), context({
    profiles: [{ id: 'profile-codex-local', kind: 'native', dispatchAllowed: false }],
  }))
  assert.equal(blocked.applicable, false)
  assert.match(blocked.reasons.join(' '), /执行器未准入：profile-codex-local/)

  const missing = trialRecipeOutcome(suggestion(), context({ profiles: [] }))
  assert.equal(missing.applicable, false)
  assert.match(missing.reasons.join(' '), /当前配置没有执行器：profile-codex-local/)

  const defaulted = trialRecipeOutcome(suggestion({ profiles: [] }), context())
  assert.equal(defaulted.applicable, true)
  assert.equal(defaulted.draft?.profileId, 'profile-codex-local')
})

test('scope atoms must already belong to the project; prefixes are not permission', () => {
  const inside = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }), context())
  assert.equal(inside.applicable, true)
  const outside = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['.'], excludedPaths: [], externalActions: [] } }), context())
  assert.equal(outside.applicable, false)
  assert.match(outside.reasons.join(' '), /范围原子不在当前项目范围内/)
  assert.equal(outside.draft, undefined)
  const prefixed = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['src/app/'], excludedPaths: [], externalActions: [] } }), context())
  assert.equal(prefixed.applicable, false, 'a child prefix is not treated as the declared atom')
})

test('needs_input, unsupported and form limits block preparation', () => {
  const needsInput = trialRecipeOutcome(suggestion({ status: 'needs_input', missingInputs: [{ field: 'root', label: '项目根目录' }] }), context())
  assert.equal(needsInput.applicable, false)
  assert.match(needsInput.reasons.join(' '), /缺少：项目根目录/)

  const unsupported = trialRecipeOutcome(suggestion({ status: 'unsupported' }), context())
  assert.equal(unsupported.applicable, false)
  assert.match(unsupported.reasons.join(' '), /不受支持/)

  const emptyGoal = trialRecipeOutcome(suggestion({ goalPreview: '   ' }), context())
  assert.equal(emptyGoal.applicable, false)
  assert.match(emptyGoal.reasons.join(' '), /缺少目标预览/)

  const oversized = trialRecipeOutcome(suggestion({ goalPreview: 'x'.repeat(16385) }), context())
  assert.equal(oversized.applicable, false)
  assert.match(oversized.reasons.join(' '), /超出原委托表单上限/)
})

test('untrusted long text is bounded for display but the draft keeps the original goal', () => {
  const text = '<img src=x onerror=alert(1)>'.repeat(40)
  const outcome = trialRecipeOutcome(suggestion({ goalPreview: text }), context())
  assert.equal(outcome.applicable, true)
  assert.equal(outcome.goalPreview.length, 601)
  assert.ok(outcome.goalPreview.endsWith('…'))
  assert.equal(outcome.draft?.goal, text)
})
