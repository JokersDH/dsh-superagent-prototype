/**
 * Presentation mapping for the trial workspace. Pure data in, pure view values out: no network,
 * no storage and no execution. Every value comes from the published TrialReadiness projection or the
 * existing ApplicationConfiguration read model; nothing here may invent a ready state.
 */
import type { ApplicationConfiguration, TrialNavigationAction, TrialReadiness } from '@personal-agent/contracts'
import { blockedLabel, executionUnavailableLabel } from '../configuration-labels.ts'

/** Semantic families already defined by apps/console/DESIGN.md; unknown never uses ok. */
export type TrialTone = 'ok' | 'warn' | 'danger' | 'process' | 'neutral'

export interface TrialStatusValue {
  readonly label: string
  readonly detail?: string
  readonly tone: TrialTone
}

export interface TrialStatusStrip {
  readonly mode: TrialStatusValue
  readonly discussion: TrialStatusValue
  readonly development: TrialStatusValue
}

export interface TrialAction {
  readonly action: TrialNavigationAction
  readonly label: string
  readonly primary: boolean
}

export interface TrialActionsInput {
  readonly readiness?: TrialReadiness
  readonly configuration?: ApplicationConfiguration
  readonly unavailable?: boolean
}

const actionLabel: Record<TrialNavigationAction, string> = {
  configure_model: '配置对话模型',
  import_project: '导入项目',
  inspect_executor: '检查执行器',
  open_conversation: '打开主对话',
}

/** The four navigation names are the complete allowed set; never accept an arbitrary string. */
export const trialActionLabel = (action: TrialNavigationAction): string => actionLabel[action]

export function trialModeValue(readiness: TrialReadiness): TrialStatusValue {
  const readonly = readiness.startupMode === 'recovery_readonly'
  if (readiness.mode === 'fixture') return { label: '固定流程', detail: readonly ? '只读恢复' : '受控测试通路', tone: 'process' }
  if (readiness.mode === 'product') return { label: '产品模式', detail: readonly ? '只读恢复' : '本机产品入口', tone: 'neutral' }
  return { label: '个人模式', detail: readonly ? '只读恢复' : '本机个人使用', tone: 'neutral' }
}

export function trialDiscussionValue(readiness: TrialReadiness): TrialStatusValue {
  switch (readiness.discussion) {
    case 'configuration_present': return { label: '已配置', tone: 'ok' }
    case 'not_configured': return { label: '未配置', detail: '普通对话暂不可开始', tone: 'warn' }
    case 'provider_error': return { label: '服务异常', detail: '对话模型返回错误', tone: 'danger' }
    case 'unknown': return { label: '未知', detail: '尚未观察到模型配置', tone: 'warn' }
  }
}

export function trialDevelopmentValue(readiness: TrialReadiness): TrialStatusValue {
  switch (readiness.development) {
    case 'configuration_present': return { label: '配置已具备', detail: '配置事实，非连接验证', tone: 'ok' }
    case 'needs_project': return { label: '需要项目', detail: '尚无已准入的原生项目', tone: 'warn' }
    case 'blocked': return {
      label: '暂不可用',
      detail: readiness.execution.state === 'unavailable' ? executionUnavailableLabel[readiness.execution.reason] : '开发执行不可用',
      tone: 'danger',
    }
    case 'fixture_only': return { label: '固定流程', detail: '非原生执行器', tone: 'process' }
    case 'readonly': return { label: '只读恢复', detail: '不派工，不改决定', tone: 'warn' }
    case 'unknown': return { label: '未知', detail: '尚未观察到执行状态', tone: 'warn' }
  }
}

export function trialStrip(readiness: TrialReadiness): TrialStatusStrip {
  return {
    mode: trialModeValue(readiness),
    discussion: trialDiscussionValue(readiness),
    development: trialDevelopmentValue(readiness),
  }
}

/** One short sentence naming the current gap and what the primary action will open. */
export function trialHeadline(input: TrialActionsInput): string {
  const { readiness } = input
  if (!readiness) {
    return input.unavailable
      ? '当前服务没有提供试用状态接口，既有视图仍可继续使用。'
      : '尚未读取试用状态；读取后这里会给出当前可用的入口。'
  }
  if (readiness.startupMode === 'recovery_readonly')
    return '当前以只读方式打开历史数据：可以审阅，不能派工、批准或恢复授权。'
  if (readiness.discussion === 'not_configured') return '先配置对话模型，才能开始普通对话。'
  if (readiness.discussion === 'provider_error') return '对话模型服务返回错误；核对模型设置后再试。'
  switch (readiness.development) {
    case 'blocked':
      return readiness.execution.state === 'unavailable'
        ? `开发执行暂不可用：${executionUnavailableLabel[readiness.execution.reason]}。普通对话仍可继续。`
        : '开发执行暂不可用；普通对话仍可继续。'
    case 'unknown': return '尚未观察到执行状态；先检查执行器连接，不要把它当作已就绪。'
    case 'needs_project': return '开发执行需要先导入一个项目，之后再在对话中明确委托。'
    case 'fixture_only': return '当前是固定流程测试通路，不会运行原生执行器。'
    case 'configuration_present':
      return readiness.discussion === 'unknown'
        ? '开发执行配置已具备，但尚未观察到对话模型；可先检查模型设置。'
        : '配置已到位；新任务仍需你在对话中明确委托。'
    case 'readonly': return '当前数据以只读方式打开，可以审阅历史，不能派工或授权。'
  }
}

/**
 * Next actions derived only from the DTO and main's four navigation callbacks. Import is a write, so
 * recovery-readonly never offers it. At most one primary plus two secondary actions are returned.
 */
export function trialActions(input: TrialActionsInput): readonly TrialAction[] {
  const { readiness, configuration } = input
  const readonly = readiness?.startupMode === 'recovery_readonly'
  const development = readiness?.development
  const projects = readiness?.projects
  // Unknown is not a known gap: only an observed missing/error state sends the user to model settings.
  const modelGap = readiness !== undefined && (readiness.discussion === 'not_configured' || readiness.discussion === 'provider_error')
  const offerModelSettings = readiness !== undefined && readiness.discussion !== 'configuration_present'
  const configuredProjects = configuration?.projects.length ?? 0
  const importApplicable = !readonly && (development === 'needs_project' ||
    (readiness !== undefined && projects !== undefined && projects.development === 0 && development !== 'readonly') ||
    (readiness === undefined && configuration !== undefined && configuredProjects === 0))
  const inspectApplicable = readiness === undefined || development !== 'configuration_present'

  let primary: TrialNavigationAction
  if (!readiness) primary = 'open_conversation'
  else if (modelGap) primary = 'configure_model'
  else if (development === 'blocked' || development === 'unknown') primary = 'inspect_executor'
  else if (development === 'needs_project') primary = 'import_project'
  else primary = 'open_conversation'

  const secondary: TrialNavigationAction[] = []
  const add = (action: TrialNavigationAction) => {
    if (action !== primary && !secondary.includes(action)) secondary.push(action)
  }
  if (importApplicable) add('import_project')
  if (inspectApplicable) add('inspect_executor')
  if (offerModelSettings) add('configure_model')
  add('open_conversation')

  return [{ action: primary, label: actionLabel[primary], primary: true },
    ...secondary.slice(0, 2).map(action => ({ action, label: actionLabel[action], primary: false }))]
}

export interface TrialProjectValue {
  readonly label: string
  readonly detail: string
  readonly tone: TrialTone
  readonly active: boolean
}

/** Project rows are read-only context: no row is a selector or a dispatch control. */
export function trialProjectValue(project: ApplicationConfiguration['projects'][number], activeProjectId?: string): TrialProjectValue {
  const kind = project.discussionOnly ? '讨论' : '开发'
  const state = project.discussionOnly ? '不参与开发派工'
    : project.dispatchAllowed ? '可派工' : project.blockedReason ? blockedLabel(project.blockedReason) : '不派工'
  const profiles = project.profileIds.length === 0 ? '未绑定执行器' : `${project.profileIds.length} 个执行器`
  return {
    label: project.displayName,
    detail: `${kind} · ${state} · ${profiles}`,
    tone: project.dispatchAllowed ? 'ok' : project.discussionOnly ? 'neutral' : 'warn',
    active: activeProjectId !== undefined && project.id === activeProjectId,
  }
}

export function formatObservedAt(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return '时间未知'
  return new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export const shortRevision = (revision: string): string => revision.slice(0, 8)
