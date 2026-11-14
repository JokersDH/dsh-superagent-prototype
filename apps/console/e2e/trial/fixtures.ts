/**
 * TEST DATA for the trial workspace harness. Every object is parsed by the published schemas before
 * it reaches the component, so a fixture cannot render a shape the product would reject. These states
 * are controlled examples, never evidence of a real vendor/native run or of release acceptance.
 */
import { ApplicationConfigurationSchema, TrialReadinessSchema } from '@personal-agent/contracts'
import type { ApplicationConfiguration, TrialReadiness } from '@personal-agent/contracts'
import type { TrialInsightsView } from '../../src/trial/insights.ts'

const revision = (character: string) => character.repeat(64)
const observedAt = '2026-11-14T04:00:00.000Z'
const scope = (id: string) => ({ projectId: id, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] })
const machineCriterion = (id: string) => ({ id, description: '注册的单元检查通过', kind: 'machine' as const, required: true as const, checkDefinitionRef: 'check-unit' })

const nativeProfile = {
  id: 'profile-codex-local', revision: 1, displayName: 'Codex 本机', driverId: 'codex-native',
  kind: 'native' as const, readiness: 'native_test_passed' as const, dispatchAllowed: true,
}
const blockedNativeProfile = {
  ...nativeProfile, readiness: 'needs_auth' as const, dispatchAllowed: false, blockedReason: 'auth_required' as const,
}
const unadmittedNativeProfile = {
  ...nativeProfile, readiness: 'not_tested' as const, dispatchAllowed: false, blockedReason: 'policy_unprepared' as const,
}
const controlledProfile = (suffix: string) => ({
  id: `profile-fixture-${suffix}`, revision: 1, displayName: `固定流程 ${suffix}`, driverId: 'fixture',
  kind: 'controlled_fixture' as const, readiness: 'fixture_ready' as const, dispatchAllowed: true,
})

const dispatchableProject = (id: string, name: string, profileIds: readonly string[]) => ({
  id, displayName: name, scope: scope(id), profileIds, defaultProfileId: profileIds[0]!, defaultCriteria: [machineCriterion(`criterion-${id}`)], dispatchAllowed: true,
})
const blockedProject = (id: string, name: string, reason: 'auth_required' | 'policy_unprepared' | 'unsupported_capability' | 'writer_indeterminate') => ({
  id, displayName: name, scope: scope(id), profileIds: [], defaultCriteria: [machineCriterion(`criterion-${id}`)], dispatchAllowed: false, blockedReason: reason,
})
const discussionProject = (id: string, name: string) => ({
  id, displayName: name, scope: scope(id), profileIds: [], defaultCriteria: [{ id: `criterion-${id}`, description: '人工接受', kind: 'human' as const, required: true }],
  discussionOnly: true, dispatchAllowed: false, blockedReason: 'unsupported_capability' as const,
})

const checks = [{ id: 'check-unit', revision: 1, displayName: '单元检查' }]
const configuration = (input: {
  projects: ApplicationConfiguration['projects']; profiles: ApplicationConfiguration['profiles']
  executionAvailability?: ApplicationConfiguration['executionAvailability']
}) => ApplicationConfigurationSchema.parse({
  protocol: 'application-configuration/1', revision: revision('c'), checks: [...checks],
  projects: input.projects, profiles: input.profiles,
  ...(input.executionAvailability === undefined ? {} : { executionAvailability: input.executionAvailability }),
})

const configured = configuration({
  projects: [dispatchableProject('project-atlas', '流程测试项目', ['profile-codex-local']), discussionProject('project-notes', '需求讨论')],
  profiles: [nativeProfile], executionAvailability: { state: 'available', kind: 'native' },
})
const fixtureConfiguration = configuration({
  projects: [dispatchableProject('project-atlas', '流程测试项目', ['profile-fixture-question', 'profile-fixture-pass', 'profile-fixture-fail', 'profile-fixture-slow'])],
  profiles: [controlledProfile('question'), controlledProfile('pass'), controlledProfile('fail'), controlledProfile('slow')],
  executionAvailability: { state: 'available', kind: 'controlled_fixture' },
})

const readinessBase = {
  protocol: 'trial-readiness/1' as const, observedAt, configurationRevision: revision('a'),
  mode: 'personal' as const, startupMode: 'normal' as const, discussion: 'configuration_present' as const,
  execution: { state: 'available' as const, kind: 'native' as const }, development: 'configuration_present' as const,
  projects: { development: 1, discussion: 1, dispatchable: 1 },
  profiles: { native: 1, controlled: 0, admittedNative: 1, admittedControlled: 0 },
  capabilities: { contextHistory: true, contextSources: true, decisions: true, proposals: true },
  authorization: 'none' as const,
}
const readiness = (over: Record<string, unknown> = {}): TrialReadiness => TrialReadinessSchema.parse({ ...readinessBase, ...over })

const readonlyReadiness = readiness({
  startupMode: 'recovery_readonly', development: 'readonly',
  execution: { state: 'unavailable', reason: 'recovery_readonly' },
  profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 },
  projects: { development: 1, discussion: 1, dispatchable: 0 },
  capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false },
})
const readonlyConfiguration = configuration({
  projects: [blockedProject('project-atlas', '流程测试项目', 'writer_indeterminate'), discussionProject('project-notes', '需求讨论')],
  profiles: [blockedNativeProfile], executionAvailability: { state: 'unavailable', reason: 'recovery_readonly' },
})
const blockedConfiguration = configuration({
  projects: [blockedProject('project-atlas', '流程测试项目', 'auth_required'), discussionProject('project-notes', '需求讨论')],
  profiles: [blockedNativeProfile], executionAvailability: { state: 'unavailable', reason: 'not_installed' },
})
const unadmittedConfiguration = configuration({
  projects: [blockedProject('project-atlas', '流程测试项目', 'policy_unprepared'), discussionProject('project-notes', '需求讨论')],
  profiles: [unadmittedNativeProfile],
})
const unknownConfiguration = configuration({
  projects: [blockedProject('project-atlas', '流程测试项目', 'unsupported_capability'), discussionProject('project-notes', '需求讨论')],
  profiles: [unadmittedNativeProfile],
})
const emptyConfiguration = configuration({ projects: [], profiles: [unadmittedNativeProfile] })

const longProjects = [
  dispatchableProject('project-quartz', 'Quartz 结算网关迁移：把多币种对账任务拆成可审阅的小批交付，并保留原有导出格式', ['profile-codex-local']),
  dispatchableProject('project-atlas', '流程测试项目', ['profile-codex-local']),
  dispatchableProject('project-harbor', 'Harbor', ['profile-codex-local']),
  discussionProject('project-requirements', '一个非常长的项目名称用于验证中文与 English mixed identifiers 在没有空格时也不会溢出或覆盖相邻状态'),
  discussionProject('project-notes', '需求讨论'),
]
const longConfiguration = configuration({
  projects: longProjects, profiles: [nativeProfile], executionAvailability: { state: 'available', kind: 'native' },
})
const longReadiness = readiness({
  projects: { development: 3, discussion: 2, dispatchable: 3 },
})
const longConversationTitle = '把本机执行器的连接状态、项目导入和对话入口整理成一次可审阅的试用准备检查，并保留原始授权边界'
const longInsights: TrialInsightsView = {
  status: 'ready', windowLabel: '11月1日–11月14日', coverage: 'partial：3/5 来源可读', coverageState: 'partial',
  scope: { projectIds: ['project-quartz', 'project-atlas', 'project-harbor', 'project-requirements', 'project-notes'], aggregation: 'declared_multi_project', label: '本项目群 5 个项目' },
  sampleCount: 12, unknownCount: 2,
  metrics: [
    { id: 'wait', label: '交付到接受的等待', value: '3.2 小时', unit: '小时', layer: 'controlled', sampleCount: 5, detail: '5 个工作' },
    { id: 'timing', label: '审阅计时覆盖', value: null, layer: 'observed', sampleCount: null, detail: '样本不足，未知' },
    { id: 'usage', label: '已知 usage', value: '1.20', unit: 'USD', layer: 'native', sampleCount: 2 },
  ],
  limitations: ['界面活动只是可见性代理，不是完整人力工时。', '受控流程与真实执行器分开统计。'],
}
const unscopedInsights: TrialInsightsView = {
  status: 'ready', windowLabel: '11月1日–11月14日', coverage: 'partial', sampleCount: 3,
  metrics: [{ id: 'wait', label: '交付到接受的等待', value: '1.5 小时' }],
  limitations: ['缺少项目范围声明，不应作为默认指标展示。'],
}
const wrongProjectInsights: TrialInsightsView = {
  status: 'ready', windowLabel: '11月1日–11月14日', coverage: 'complete', sampleCount: 4,
  scope: { projectIds: ['project-notes'], aggregation: 'single_project' },
  metrics: [{ id: 'wait', label: '交付到接受的等待', value: '2 小时' }],
  limitations: [],
}

export const trialStates = [
  'configured', 'unconfigured', 'blocked', 'needs-project', 'no-projects', 'fixture', 'unknown', 'readonly',
  'noreadiness', 'loading', 'unavailable', 'error', 'long', 'insights-empty', 'insights-unscoped', 'insights-wrong-project',
] as const
export type TrialHarnessState = (typeof trialStates)[number]

export interface TrialHarnessProps {
  readonly readiness?: TrialReadiness | undefined
  readonly configuration?: ApplicationConfiguration | undefined
  readonly loading?: boolean | undefined
  readonly error?: string | undefined
  readonly unavailable?: boolean | undefined
  readonly activeProjectId?: string | undefined
  readonly activeConversationTitle?: string | undefined
  readonly insights?: TrialInsightsView | undefined
}

export function trialHarnessProps(state: TrialHarnessState): TrialHarnessProps {
  switch (state) {
    case 'configured': return { readiness: readiness(), configuration: configured, activeProjectId: 'project-atlas', activeConversationTitle: '主对话' }
    case 'unconfigured': return { readiness: readiness({ discussion: 'not_configured' }), configuration: configured }
    case 'blocked': return {
      readiness: readiness({ development: 'blocked', execution: { state: 'unavailable', reason: 'not_installed' }, profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 }, projects: { development: 1, discussion: 1, dispatchable: 0 } }),
      configuration: blockedConfiguration,
    }
    case 'needs-project': return {
      readiness: readiness({ development: 'needs_project', execution: { state: 'available', kind: 'native' }, profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 }, projects: { development: 1, discussion: 1, dispatchable: 0 } }),
      configuration: unadmittedConfiguration,
    }
    case 'no-projects': return {
      readiness: readiness({ development: 'needs_project', execution: { state: 'available', kind: 'native' }, profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 }, projects: { development: 0, discussion: 0, dispatchable: 0 } }),
      configuration: emptyConfiguration,
    }
    case 'fixture': return {
      readiness: readiness({ mode: 'fixture', development: 'fixture_only', execution: { state: 'available', kind: 'controlled_fixture' }, profiles: { native: 0, controlled: 4, admittedNative: 0, admittedControlled: 4 }, projects: { development: 1, discussion: 0, dispatchable: 1 } }),
      configuration: fixtureConfiguration,
    }
    case 'unknown': return {
      readiness: readiness({ discussion: 'unknown', development: 'unknown', execution: { state: 'unknown' }, profiles: { native: 1, controlled: 0, admittedNative: 0, admittedControlled: 0 }, projects: { development: 1, discussion: 1, dispatchable: 0 } }),
      configuration: unknownConfiguration,
    }
    case 'readonly': return {
      readiness: readonlyReadiness, configuration: readonlyConfiguration, activeProjectId: 'project-atlas', activeConversationTitle: '历史对话',
    }
    case 'noreadiness': return { configuration: configured }
    case 'loading': return { configuration: configured, loading: true }
    case 'unavailable': return { configuration: configured, unavailable: true }
    case 'error': return { readiness: readiness(), configuration: configured, error: '无法连接本地服务；请确认工作台仍在运行后重试。' }
    case 'long': return {
      readiness: longReadiness, configuration: longConfiguration, activeProjectId: 'project-quartz',
      activeConversationTitle: longConversationTitle, insights: longInsights,
    }
    case 'insights-empty': return {
      readiness: readiness(), configuration: configured,
      insights: { status: 'insufficient_data', sampleCount: null, metrics: [], limitations: ['样本不足，未计算节省时间或质量结论。'] },
    }
    case 'insights-unscoped': return {
      readiness: readiness(), configuration: configured, insights: unscopedInsights,
    }
    case 'insights-wrong-project': return {
      readiness: readiness(), configuration: configured, activeProjectId: 'project-atlas', insights: wrongProjectInsights,
    }
  }
}

/** Two schema-valid observations used to prove that a late first response cannot overwrite a newer read. */
export function trialProbePair(): { first: TrialReadiness; second: TrialReadiness; configuration: ApplicationConfiguration } {
  const unconfigured = trialHarnessProps('unconfigured'), configuredState = trialHarnessProps('configured')
  return { first: unconfigured.readiness!, second: configuredState.readiness!, configuration: configuredState.configuration! }
}
