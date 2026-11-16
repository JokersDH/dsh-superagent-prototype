import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TrialRecipeContext, TrialRecipeContextProject, TrialRecipeSuggestion } from '../../src/trial/recipes.ts'
import { trialRecipeOutcome } from '../../src/trial/recipes.ts'

const now = Date.parse('2026-11-15T00:00:00.000Z')
const project: TrialRecipeContextProject = {
  id: 'project-atlas', displayName: '流程测试项目', dispatchAllowed: true, discussionOnly: false,
  profileIds: ['profile-codex-local'], checkRefs: ['check-unit'],
  scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
  defaultProfileId: 'profile-codex-local',
}
const context = (over: Partial<TrialRecipeContext> = {}): TrialRecipeContext => ({
  projectId: 'project-atlas', projects: [project], registeredChecks: ['check-unit'],
  profiles: [{ id: 'profile-codex-local', kind: 'native', dispatchAllowed: true }], now, ...over,
})
const suggestion = (over: Partial<TrialRecipeSuggestion> = {}): TrialRecipeSuggestion => ({
  id: 'recipe-1', version: '1', source: 'project-recipes', projectId: 'project-atlas',
  title: '补充单元检查声明', goalPreview: '在现有检查上补充说明，不改变命令。', scopeNote: 'src/', scope: null,
  preview: { kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-codex-local' },
  status: 'draft', missingInputs: [], checks: [{ id: 'check-unit', required: true, declared: true }],
  profiles: [{ id: 'profile-codex-local', required: true }],
  provenance: { manifest: 'package.json', declaredRoot: '.', note: '只读项目声明' },
  limitations: [], authority: 'none', ...over,
})

test('a current dispatchable project yields only a restricted preview selection', () => {
  const outcome = trialRecipeOutcome(suggestion(), context())
  assert.equal(outcome.applicable, true)
  assert.deepEqual(outcome.reasons, [])
  assert.deepEqual(outcome.checks, [{ id: 'check-unit', required: true, state: 'available' }])
  assert.deepEqual(outcome.profiles, [{ id: 'profile-codex-local', state: 'available' }])
  assert.deepEqual(outcome.selection, {
    suggestionId: 'recipe-1', projectId: 'project-atlas', kind: 'scoped_change',
    allowedPaths: ['src/'], profileId: 'profile-codex-local',
  })
  assert.equal('draft' in outcome, false, 'F does not reconstruct complete creation fields')
})

test('a blocked, discussion or expired project is not applicable even when its profile is admitted', () => {
  const blocked = trialRecipeOutcome(suggestion(), context({
    projects: [{ ...project, dispatchAllowed: false, blockedReason: 'auth_required' }],
  }))
  assert.equal(blocked.applicable, false)
  assert.match(blocked.reasons.join(' '), /当前项目不可派工/)
  assert.equal(blocked.selection, undefined)

  const discussion = trialRecipeOutcome(suggestion(), context({
    projects: [{ ...project, dispatchAllowed: false, discussionOnly: true, blockedReason: 'unsupported_capability' }],
  }))
  assert.equal(discussion.applicable, false)
  assert.match(discussion.reasons.join(' '), /讨论项目/)

  const expired = trialRecipeOutcome(suggestion(), context({
    projects: [{ ...project, scope: { ...project.scope, expiresAt: '2026-11-14T00:00:00.000Z' } }],
  }))
  assert.equal(expired.applicable, false)
  assert.match(expired.reasons.join(' '), /授权已过期/)

  const future = trialRecipeOutcome(suggestion(), context({
    projects: [{ ...project, scope: { ...project.scope, expiresAt: '2026-11-16T00:00:00.000Z' } }],
  }))
  assert.equal(future.applicable, true, 'an unexpired boundary stays usable')
})

test('all original exclusions must be preserved; extra exclusions narrow safely', () => {
  const withExclusions = { ...project, scope: { ...project.scope, excludedPaths: ['.git'] } }
  const omitted = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }),
    context({ projects: [withExclusions] }))
  assert.equal(omitted.applicable, false)
  assert.match(omitted.reasons.join(' '), /遗漏了当前项目必须保留的排除项/)
  assert.equal(omitted.selection, undefined)

  const extra = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['src/'], excludedPaths: ['.git', 'node_modules'], externalActions: [] } }),
    context({ projects: [withExclusions] }))
  assert.equal(extra.applicable, false, 'an extra exclusion cannot be carried through the restricted selection')
  assert.match(extra.reasons.join(' '), /追加排除项无法通过受限选择保留/)

  const widerAllowed = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['src/', 'test/'], excludedPaths: ['.git'], externalActions: [] } }),
    context({ projects: [withExclusions] }))
  assert.equal(widerAllowed.applicable, false)
  assert.match(widerAllowed.reasons.join(' '), /允许路径超出/)

  const widerActions = trialRecipeOutcome(suggestion({ scope: { allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: ['deploy'] } }),
    context({ projects: [withExclusions] }))
  assert.equal(widerActions.applicable, false)
  assert.match(widerActions.reasons.join(' '), /外部动作超出/)
})

test('the restricted selection must stay inside the project atoms/profile and match the declaration', () => {
  const outside = trialRecipeOutcome(suggestion({ preview: { kind: 'scoped_change', allowedPaths: ['.'], profileId: 'profile-codex-local' } }), context())
  assert.equal(outside.applicable, false)
  assert.match(outside.reasons.join(' '), /范围原子超出当前项目/)

  const empty = trialRecipeOutcome(suggestion({ preview: { kind: 'scoped_change', allowedPaths: [], profileId: 'profile-codex-local' } }), context())
  assert.equal(empty.applicable, false)
  assert.match(empty.reasons.join(' '), /未包含有效的范围原子/)

  const declaredMismatch = trialRecipeOutcome(suggestion({
    scope: { allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    preview: { kind: 'scoped_change', allowedPaths: ['test/'], profileId: 'profile-codex-local' },
  }), context({ projects: [{ ...project, scope: { ...project.scope, allowedPaths: ['src/', 'test/'] } }] }))
  assert.equal(declaredMismatch.applicable, false, 'preview atoms must stay inside the declared scope')
  assert.match(declaredMismatch.reasons.join(' '), /模板选择范围超出声明范围/)

  const missing = trialRecipeOutcome(suggestion({ preview: null }), context())
  assert.equal(missing.applicable, false)
  assert.match(missing.reasons.join(' '), /缺少可预览的模板选择/)

  const unbound = trialRecipeOutcome(suggestion({ preview: { kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-other' } }), context())
  assert.equal(unbound.applicable, false)
  assert.match(unbound.reasons.join(' '), /未绑定模板执行器/)

  const blocked = trialRecipeOutcome(suggestion(), context({
    profiles: [{ id: 'profile-codex-local', kind: 'native', dispatchAllowed: false }],
  }))
  assert.equal(blocked.applicable, false)
  assert.match(blocked.reasons.join(' '), /模板执行器未准入/)

  const mismatched = trialRecipeOutcome(suggestion({
    profiles: [{ id: 'profile-other', required: true }],
  }), context())
  assert.equal(mismatched.applicable, false)
  assert.match(mismatched.reasons.join(' '), /执行器与声明不一致/)
})

test('unknown source, foreign/deleted project and all-projects view are explanation only', () => {
  for (const [input, reason] of [
    [suggestion({ source: 'unknown' }), /来源未知/],
    [suggestion({ projectId: 'project-other' }), /不属于当前项目/],
    [suggestion({ projectId: null }), /未指明所属项目/],
    [suggestion({ authority: 'granted' as unknown as 'none' }), /只读草案/],
  ] as const) {
    const outcome = trialRecipeOutcome(input, context())
    assert.equal(outcome.applicable, false)
    assert.match(outcome.reasons.join(' '), reason)
    assert.equal(outcome.selection, undefined)
  }
  const allProjects = trialRecipeOutcome(suggestion(), context({ projectId: undefined }))
  assert.equal(allProjects.applicable, false)
  assert.match(allProjects.reasons.join(' '), /请先选择一个项目/)
  const deleted = trialRecipeOutcome(suggestion(), context({ projectId: 'project-deleted' }))
  assert.equal(deleted.applicable, false)
  assert.match(deleted.reasons.join(' '), /不在配置中/)
})

test('checks use project-local criteria and contradictions are explicit', () => {
  const notInProject = trialRecipeOutcome(suggestion({ checks: [{ id: 'check-other', required: true, declared: true }] }),
    context({ registeredChecks: ['check-unit', 'check-other'] }))
  assert.equal(notInProject.applicable, false)
  assert.match(notInProject.reasons.join(' '), /当前项目未包含检查：check-other/)

  const contradiction = trialRecipeOutcome(suggestion({ checks: [{ id: 'check-unit', required: true, declared: false }] }), context())
  assert.equal(contradiction.applicable, false)
  assert.match(contradiction.reasons.join(' '), /声明与项目检查矛盾/)
})

test('needs_input/unsupported/oversized goal block the template entry', () => {
  assert.equal(trialRecipeOutcome(suggestion({ status: 'needs_input', missingInputs: [{ field: 'root', label: '项目根目录' }] }), context()).applicable, false)
  assert.equal(trialRecipeOutcome(suggestion({ status: 'unsupported' }), context()).applicable, false)
  assert.equal(trialRecipeOutcome(suggestion({ goalPreview: '   ' }), context()).applicable, false)
  assert.equal(trialRecipeOutcome(suggestion({ goalPreview: 'x'.repeat(16385) }), context()).applicable, false)
})

test('untrusted long text is bounded for display only', () => {
  const outcome = trialRecipeOutcome(suggestion({ goalPreview: '<img src=x onerror=alert(1)>'.repeat(40) }), context())
  assert.equal(outcome.applicable, true)
  assert.equal(outcome.goalPreview.length, 601)
  assert.ok(outcome.goalPreview.endsWith('…'))
})
