import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TrialReadinessSchema, ApplicationConfigurationSchema } from '@personal-agent/contracts'
import type { TrialReadiness } from '@personal-agent/contracts'
import {
  formatObservedAt, shortRevision, trialActions, trialDevelopmentValue, trialDiscussionValue, trialHeadline,
  trialModeValue, trialProjectValue, trialStrip,
} from '../../src/trial/trial-view.ts'
import { trialInsightsAdmission, trialInsightsCount } from '../../src/trial/insights.ts'
import { trialProbeError } from '../../src/trial/useTrialReadiness.ts'
import type { TrialInsightsView } from '../../src/trial/insights.ts'

const observedAt = '2026-11-14T04:00:00.000Z'
const base = {
  protocol: 'trial-readiness/1' as const, observedAt, configurationRevision: 'a'.repeat(64),
  mode: 'personal' as const, startupMode: 'normal' as const,
  discussion: 'configuration_present' as const, execution: { state: 'available' as const, kind: 'native' as const },
  development: 'configuration_present' as const,
  projects: { development: 1, discussion: 0, dispatchable: 1 },
  profiles: { native: 1, controlled: 0, admittedNative: 1, admittedControlled: 0 },
  capabilities: { contextHistory: true, contextSources: true, decisions: true, proposals: true },
  authorization: 'none' as const,
}
const readiness = (over: Record<string, unknown> = {}): TrialReadiness =>
  TrialReadinessSchema.parse({ ...base, ...over })
const fixtureReadiness = readiness({ mode: 'fixture', development: 'fixture_only',
  execution: { state: 'available', kind: 'controlled_fixture' },
  profiles: { native: 0, controlled: 1, admittedNative: 0, admittedControlled: 1 },
  projects: { development: 1, discussion: 0, dispatchable: 1 } })
const blockedReadiness = readiness({ development: 'blocked', execution: { state: 'unavailable', reason: 'not_installed' },
  profiles: { native: 0, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  projects: { development: 1, discussion: 0, dispatchable: 0 } })
const unknownReadiness = readiness({ development: 'unknown', execution: { state: 'unknown' },
  profiles: { native: 0, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  projects: { development: 1, discussion: 0, dispatchable: 0 } })
const needsProjectReadiness = readiness({ development: 'needs_project', execution: { state: 'available', kind: 'native' },
  profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  projects: { development: 1, discussion: 0, dispatchable: 0 } })
const readonlyReadiness = readiness({ development: 'readonly', startupMode: 'recovery_readonly',
  execution: { state: 'unavailable', reason: 'recovery_readonly' },
  profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  projects: { development: 1, discussion: 0, dispatchable: 0 },
  capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false } })

const projects = [
  { id: 'project-atlas', displayName: '流程测试项目', scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    profileIds: ['profile-codex-local'], defaultProfileId: 'profile-codex-local',
    defaultCriteria: [{ id: 'criterion-1', description: '单元检查通过', kind: 'machine', required: true, checkDefinitionRef: 'check-unit' }], dispatchAllowed: true },
  { id: 'project-archive', displayName: '一个很长很长的项目名称用于检查换行和截断行为是否符合工作台约束',
    scope: { projectId: 'project-archive', allowedPaths: ['.'], excludedPaths: [], externalActions: [] },
    profileIds: [], defaultCriteria: [{ id: 'criterion-2', description: '人工接受', kind: 'human', required: true }], discussionOnly: true, dispatchAllowed: false, blockedReason: 'unsupported_capability' },
  { id: 'project-blocked', displayName: '受限项目', scope: { projectId: 'project-blocked', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    profileIds: [], defaultCriteria: [{ id: 'criterion-3', description: '单元检查通过', kind: 'machine', required: true, checkDefinitionRef: 'check-unit' }],
    dispatchAllowed: false, blockedReason: 'auth_required' },
] as const
const configuration = ApplicationConfigurationSchema.parse({
  protocol: 'application-configuration/1', revision: 'b'.repeat(64),
  executionAvailability: { state: 'available', kind: 'native' },
  profiles: [{ id: 'profile-codex-local', revision: 1, displayName: 'Codex 本机', driverId: 'codex-native', kind: 'native', readiness: 'native_test_passed', dispatchAllowed: true }],
  projects, checks: [{ id: 'check-unit', revision: 1, displayName: '单元检查' }],
})

test('each published development state maps to honest text and never paints unknown as ready', () => {
  const cases: { value: TrialReadiness; label: string; tone: string }[] = [
    { value: readiness(), label: '配置已具备', tone: 'ok' },
    { value: needsProjectReadiness, label: '需要项目', tone: 'warn' },
    { value: blockedReadiness, label: '暂不可用', tone: 'danger' },
    { value: fixtureReadiness, label: '固定流程', tone: 'process' },
    { value: unknownReadiness, label: '未知', tone: 'warn' },
    { value: readonlyReadiness, label: '只读恢复', tone: 'warn' },
  ]
  for (const entry of cases) {
    const value = trialDevelopmentValue(entry.value)
    assert.equal(value.label, entry.label)
    assert.equal(value.tone, entry.tone)
    if (entry.label !== '配置已具备') assert.notEqual(value.tone, 'ok', 'only the admitted configuration state may use the ready colour')
  }
  assert.equal(trialDevelopmentValue(cases[2]!.value).detail, '未安装 Codex')
})

test('discussion and mode states stay separate from execution readiness', () => {
  assert.deepEqual(trialDiscussionValue(readiness({ discussion: 'not_configured' })), { label: '未配置', detail: '普通对话暂不可开始', tone: 'warn' })
  assert.deepEqual(trialDiscussionValue(readiness({ discussion: 'provider_error' })), { label: '服务异常', detail: '对话模型返回错误', tone: 'danger' })
  assert.deepEqual(trialDiscussionValue(readiness({ discussion: 'unknown' })), { label: '未知', detail: '尚未观察到模型配置', tone: 'warn' })
  assert.equal(trialModeValue(fixtureReadiness).tone, 'process')
  assert.equal(trialModeValue(readonlyReadiness).detail, '只读恢复')
  const strip = trialStrip(readiness())
  assert.equal(strip.discussion.label, '已配置')
  assert.equal(strip.development.label, '配置已具备')
})

test('next actions follow the DTO gap and never invent a fifth navigation name', () => {
  const allowed = new Set(['configure_model', 'import_project', 'inspect_executor', 'open_conversation'])
  const cases: { value: TrialReadiness; primary: string }[] = [
    { value: readiness({ discussion: 'not_configured' }), primary: 'configure_model' },
    { value: readiness({ discussion: 'provider_error' }), primary: 'configure_model' },
    { value: blockedReadiness, primary: 'inspect_executor' },
    { value: unknownReadiness, primary: 'inspect_executor' },
    { value: needsProjectReadiness, primary: 'import_project' },
    { value: fixtureReadiness, primary: 'open_conversation' },
    { value: readiness(), primary: 'open_conversation' },
  ]
  for (const entry of cases) {
    const actions = trialActions({ readiness: entry.value, configuration })
    assert.equal(actions[0]?.primary, true)
    assert.equal(actions[0]?.action, entry.primary)
    assert.ok(actions.length <= 3)
    assert.equal(new Set(actions.map(item => item.action)).size, actions.length)
    for (const item of actions) assert.ok(allowed.has(item.action))
    assert.equal(actions.filter(item => item.primary).length, 1)
  }
})

test('an unobserved model state offers settings as a secondary step, never as the primary gap', () => {
  const unknownDiscussion = readiness({ discussion: 'unknown' })
  const actions = trialActions({ readiness: unknownDiscussion, configuration })
  assert.equal(actions[0]?.action, 'open_conversation')
  assert.ok(actions.some(item => item.action === 'configure_model' && !item.primary))
  assert.equal(trialActions({ readiness: readiness({ discussion: 'not_configured' }), configuration })[0]?.action, 'configure_model')
})

test('no readiness and no configuration never guesses readiness or offers a write', () => {
  const unknown = trialActions({})
  assert.equal(unknown[0]?.action, 'open_conversation')
  assert.ok(unknown.every(item => item.action !== 'import_project'), 'import cannot be inferred before configuration is read')
  const emptyConfig = trialActions({ configuration: ApplicationConfigurationSchema.parse({ protocol: 'application-configuration/1', revision: 'c'.repeat(64), projects: [], profiles: [], checks: [] }) })
  assert.ok(emptyConfig.some(item => item.action === 'import_project'))
  assert.equal(trialHeadline({}).includes('已就绪'), false)
})

test('recovery readonly keeps readable navigation and never offers the import write', () => {
  const actions = trialActions({ readiness: readonlyReadiness, configuration })
  assert.equal(actions[0]?.action, 'open_conversation')
  assert.ok(actions.every(item => item.action !== 'import_project'))
  assert.ok(actions.some(item => item.action === 'inspect_executor'))
  assert.match(trialHeadline({ readiness: readonlyReadiness }), /只读/)
})

test('headlines name the actual gap instead of promising execution', () => {
  assert.match(trialHeadline({ readiness: readiness({ discussion: 'not_configured' }) }), /配置对话模型/)
  assert.match(trialHeadline({ readiness: blockedReadiness }), /未安装 Codex/)
  assert.match(trialHeadline({ readiness: fixtureReadiness }), /固定流程/)
  assert.match(trialHeadline({ readiness: readiness() }), /明确委托/)
  assert.match(trialHeadline({ unavailable: true }), /没有提供试用状态接口/)
  for (const value of [readiness(), readiness({ discussion: 'not_configured' })])
    assert.doesNotMatch(trialHeadline({ readiness: value }), /授权已通过|可以直接执行|已连接/)
})

test('project rows are display only and carry dispatch facts', () => {
  const [dispatchable, discussion, blocked] = projects
  assert.deepEqual(trialProjectValue(dispatchable!, 'project-atlas'), { label: '流程测试项目', detail: '开发 · 可派工 · 1 个执行器', tone: 'ok', active: true })
  assert.equal(trialProjectValue(discussion!).tone, 'neutral')
  assert.equal(trialProjectValue(discussion!).detail.includes('讨论'), true)
  assert.equal(trialProjectValue(blocked!).tone, 'warn')
  assert.equal(trialProjectValue(blocked!).detail.includes('需要重新认证'), true)
  assert.equal(trialProjectValue(dispatchable!).active, false)
})

test('observed time and revision formatting stay bounded and safe', () => {
  assert.notEqual(formatObservedAt('not-a-date'), 'Invalid Date')
  assert.equal(formatObservedAt('not-a-date'), '时间未知')
  assert.equal(shortRevision('abcdef0123456789'), 'abcdef01')
})

test('optional insights only show measurements after scope, window and coverage are declared', () => {
  const metric = { id: 'm', label: '交付到接受的等待', value: '3.2 小时' } as const
  const scoped = {
    status: 'ready' as const, windowLabel: '11月1日–11月14日', coverage: 'partial: 3/5 sources', sampleCount: 12,
    scope: { projectIds: ['project-atlas'], aggregation: 'single_project' as const },
    metrics: [metric], unknownCount: 2, limitations: ['界面活动只是可见性代理。'],
  }
  assert.equal(trialInsightsAdmission(scoped, 'project-atlas').rows.length, 1)
  assert.equal(trialInsightsAdmission(scoped, 'project-other').rows.length, 0)
  assert.match(trialInsightsAdmission(scoped, 'project-other').message ?? '', /不包含当前项目/)
  assert.equal(trialInsightsAdmission(scoped, undefined).admitted, true)

  const insufficient = { status: 'insufficient_data' as const, sampleCount: null, metrics: [metric], limitations: [] }
  assert.equal(trialInsightsAdmission(insufficient).admitted, false)
  assert.equal(trialInsightsCount(insufficient), '样本数未知')

  const unavailable = { status: 'unavailable' as const, sampleCount: 0, metrics: [], limitations: [] }
  assert.equal(trialInsightsAdmission(unavailable).admitted, false)

  const { scope: _scope, ...withoutScope } = scoped
  assert.equal(trialInsightsAdmission(withoutScope).admitted, false)
  assert.match(trialInsightsAdmission(withoutScope).message ?? '', /范围/)
  const { windowLabel: _window, ...withoutWindow } = scoped
  assert.equal(trialInsightsAdmission(withoutWindow, 'project-atlas').admitted, false)
  assert.match(trialInsightsAdmission(withoutWindow, 'project-atlas').message ?? '', /窗口/)
  const { coverage: _coverage, ...withoutCoverage } = scoped
  assert.equal(trialInsightsAdmission(withoutCoverage, 'project-atlas').admitted, false)
  assert.match(trialInsightsAdmission(withoutCoverage, 'project-atlas').message ?? '', /覆盖/)
  const emptyScope = { ...scoped, scope: { projectIds: [], aggregation: 'single_project' as const } }
  assert.equal(trialInsightsAdmission(emptyScope, 'project-atlas').admitted, false)
  const multi = { ...scoped, scope: { projectIds: ['project-atlas', 'project-harbor'], aggregation: 'declared_multi_project' as const } }
  assert.equal(trialInsightsAdmission(multi, 'project-harbor').admitted, true)

  const unknownMetric = { ...scoped, metrics: [{ id: 'x', label: '审阅计时覆盖', value: null }], sampleCount: null }
  const admitted = trialInsightsAdmission(unknownMetric, 'project-atlas')
  assert.equal(admitted.admitted, true)
  assert.equal(admitted.rows[0]?.value, null)
  assert.equal(trialInsightsCount(unknownMetric), '样本数未知')
})

test('probe failures map to bounded copy without raw stacks, paths or credentials', () => {
  for (const code of ['auth_required', 'storage_unavailable', 'invalid_request', 'schema_mismatch', 'unsupported_capability']) {
    const message = trialProbeError(Object.assign(new Error('raw /Users/secret token=abc stack'), { code }))
    assert.ok(message.length > 0)
    assert.doesNotMatch(message, /\/Users|token|stack|abc|secret/)
  }
  const raw = trialProbeError(new Error('raw /Users/secret token=abc'))
  assert.equal(raw, '试用状态暂时无法读取；请重试。')
  assert.doesNotMatch(trialProbeError({ code: 'something_new' }), /\/Users|abc/)
  assert.doesNotMatch(trialProbeError(undefined), /\/Users|abc/)
})
