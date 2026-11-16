/**
 * Read-only presentation input for project-recipe suggestions (J-owned data) and the restricted
 * selection F hands back to main. It never executes, installs, registers a check, creates a work or
 * grants authority. Complete fields, criteria and the actual preview come from main's authenticated
 * POST /v1/projects/:id/recipes/preview; F only supplies project/kind/atoms/profile selection and a
 * display judgement used to enable that entry.
 *
 * Applicability uses the *current configured project*: dispatchability, expiry, the project's own
 * profileIds/defaultCriteria/check refs and the original Scope atoms. Exclusions may be added (narrower)
 * but no project exclusion may be dropped; allowed paths/external actions may only narrow.
 */
import type { ApplicationConfiguration, ProjectRecipePreviewInput } from '@personal-agent/contracts'
import { blockedLabel } from '../configuration-labels.ts'

export type TrialRecipeStatus = 'draft' | 'needs_input' | 'unsupported'
export type TrialRecipeKind = ProjectRecipePreviewInput['kind']

export interface TrialRecipeMissingInput {
  readonly field: 'project' | 'scope' | 'check' | 'profile' | 'manifest' | 'stack' | 'root' | 'unknown'
  readonly label: string
}

export interface TrialRecipeCheckRef {
  readonly id: string
  readonly required: boolean
  /** J's declaration state; null means the declaration did not say. */
  readonly declared: boolean | null
}

export interface TrialRecipeProfileRef {
  readonly id: string
  readonly required: boolean
}

/** Declared atoms only. F never treats a prefix match as permission. */
export interface TrialRecipeScopeAtoms {
  readonly allowedPaths: readonly string[]
  readonly excludedPaths: readonly string[]
  readonly externalActions: readonly string[]
}

/** Restricted selection that main maps to ProjectRecipePreviewInput and its original form. */
export interface TrialRecipeSelection {
  readonly suggestionId: string
  readonly projectId: string
  readonly kind: TrialRecipeKind
  readonly allowedPaths: readonly string[]
  readonly profileId: string
}

export interface TrialRecipeSuggestion {
  readonly id: string
  readonly version: string
  readonly source: 'project-recipes' | 'unknown'
  readonly projectId: string | null
  readonly title: string
  readonly goalPreview: string
  readonly scopeNote: string | null
  /** Declared scope atoms; null means the project's current atoms are shown unchanged. */
  readonly scope: TrialRecipeScopeAtoms | null
  /** J/main-provided restricted selection for the real preview; null means not previewable yet. */
  readonly preview: { readonly kind: TrialRecipeKind; readonly allowedPaths: readonly string[]; readonly profileId: string } | null
  readonly status: TrialRecipeStatus
  readonly missingInputs: readonly TrialRecipeMissingInput[]
  readonly checks: readonly TrialRecipeCheckRef[]
  readonly profiles: readonly TrialRecipeProfileRef[]
  readonly provenance: {
    readonly manifest: string | null
    readonly declaredRoot: string | null
    readonly note: string | null
  }
  readonly limitations: readonly string[]
  readonly authority: 'none'
}

export type TrialRecipeProject = ApplicationConfiguration['projects'][number]

export interface TrialRecipeContextProject {
  readonly id: string
  readonly displayName: string
  readonly dispatchAllowed: boolean
  readonly discussionOnly: boolean
  readonly blockedReason?: string | undefined
  readonly profileIds: readonly string[]
  /** Check ids referenced by this project's required machine criteria. */
  readonly checkRefs: readonly string[]
  readonly scope: TrialRecipeProject['scope']
  readonly defaultProfileId?: string | undefined
}

export interface TrialRecipeContext {
  readonly projectId?: string | undefined
  readonly projects: readonly TrialRecipeContextProject[]
  readonly registeredChecks: readonly string[]
  readonly profiles: readonly {
    readonly id: string
    readonly kind: 'native' | 'controlled_fixture'
    readonly dispatchAllowed: boolean
  }[]
  /** Injectable for deterministic expiry tests; defaults to Date.now(). */
  readonly now?: number | undefined
}

export interface TrialRecipeCheckView {
  readonly id: string
  readonly required: boolean
  readonly state: 'available' | 'missing'
}

export interface TrialRecipeProfileView {
  readonly id: string
  readonly state: 'available' | 'blocked' | 'missing'
}

export interface TrialRecipeOutcome {
  readonly applicable: boolean
  readonly statusLabel: string
  readonly reasons: readonly string[]
  readonly checks: readonly TrialRecipeCheckView[]
  readonly profiles: readonly TrialRecipeProfileView[]
  readonly goalPreview: string
  readonly selection?: TrialRecipeSelection | undefined
}

const statusLabel: Record<TrialRecipeStatus, string> = { draft: '草案', needs_input: '需要输入', unsupported: '不支持' }
const maxPreview = 600
const maxGoal = 16384

const boundedPreview = (text: string): string =>
  text.length <= maxPreview ? text : `${text.slice(0, maxPreview)}…`
const within = (declared: readonly string[], allowed: readonly string[]) => declared.every(atom => allowed.includes(atom))
const unique = (values: readonly string[]) => new Set(values).size === values.length

export function trialRecipeContext(
  configuration: ApplicationConfiguration | undefined, projectId: string | undefined, now = Date.now(),
): TrialRecipeContext {
  return {
    ...(projectId === undefined ? {} : { projectId }),
    now,
    projects: configuration?.projects.map(project => ({
      id: project.id,
      displayName: project.displayName,
      dispatchAllowed: project.dispatchAllowed,
      discussionOnly: project.discussionOnly === true,
      ...(project.blockedReason === undefined ? {} : { blockedReason: project.blockedReason }),
      profileIds: project.profileIds,
      checkRefs: [...new Set(project.defaultCriteria.flatMap(criterion =>
        criterion.kind === 'machine' && criterion.checkDefinitionRef !== undefined ? [criterion.checkDefinitionRef] : []))],
      scope: project.scope,
      ...(project.defaultProfileId === undefined ? {} : { defaultProfileId: project.defaultProfileId }),
    })) ?? [],
    registeredChecks: configuration?.checks.map(check => check.id) ?? [],
    profiles: configuration?.profiles.map(profile => ({ id: profile.id, kind: profile.kind, dispatchAllowed: profile.dispatchAllowed })) ?? [],
  }
}

/**
 * Display applicability plus the restricted selection for main's real preview. Even `applicable`
 * is not a grant: main re-reads configuration/facts and the user confirms in the original form.
 */
export function trialRecipeOutcome(suggestion: TrialRecipeSuggestion, context: TrialRecipeContext): TrialRecipeOutcome {
  const reasons: string[] = []
  const now = context.now ?? Date.now()
  const project = context.projectId === undefined ? undefined : context.projects.find(item => item.id === context.projectId)
  const checks = suggestion.checks.map(check => ({
    id: check.id,
    required: check.required,
    state: project !== undefined && project.checkRefs.includes(check.id) && context.registeredChecks.includes(check.id)
      ? 'available' as const : 'missing' as const,
  }))
  const profiles = suggestion.profiles.map(profile => {
    const existing = context.profiles.find(item => item.id === profile.id)
    const inProject = project?.profileIds.includes(profile.id) ?? false
    return {
      id: profile.id,
      state: !inProject || existing === undefined ? 'missing' as const : existing.dispatchAllowed ? 'available' as const : 'blocked' as const,
    }
  })

  if (suggestion.authority !== 'none') reasons.push('来源未声明为只读草案')
  if (suggestion.source !== 'project-recipes') reasons.push('来源未知，不能打开模板')
  if (suggestion.status === 'unsupported') reasons.push('该声明当前不受支持')
  if (suggestion.status !== 'unsupported') {
    for (const missing of suggestion.missingInputs) reasons.push(`缺少：${missing.label}`)
  }
  if (context.projectId === undefined) reasons.push('请先选择一个项目；全部项目视图不能打开模板')
  else if (project === undefined) reasons.push('当前项目不在配置中，不能打开模板')
  if (suggestion.projectId === null) reasons.push('声明未指明所属项目')
  else if (context.projectId !== undefined && suggestion.projectId !== context.projectId) reasons.push('该草案不属于当前项目')

  if (project !== undefined) {
    if (project.discussionOnly) reasons.push('讨论项目不能准备开发委托')
    else if (!project.dispatchAllowed) reasons.push(`当前项目不可派工：${blockedLabel(project.blockedReason)}`)
    const expiresAt = project.scope.expiresAt
    if (expiresAt !== undefined) {
      const expiry = Date.parse(expiresAt)
      if (!Number.isFinite(expiry) || expiry <= now) reasons.push('当前项目授权已过期，不能打开模板')
    }
  }

  for (const check of checks) {
    const declared = suggestion.checks.find(item => item.id === check.id)
    if (declared?.declared === false && declared.required) reasons.push(`声明与项目检查矛盾：${check.id} 未声明却要求必需`)
    else if (check.state === 'missing') {
      if (project !== undefined && !project.checkRefs.includes(check.id)) reasons.push(`当前项目未包含检查：${check.id}`)
      else reasons.push(`当前配置未注册检查：${check.id}`)
    }
  }
  for (const profile of profiles) {
    if (profile.state === 'missing') {
      if (project !== undefined && !project.profileIds.includes(profile.id)) reasons.push(`当前项目未绑定执行器：${profile.id}`)
      else reasons.push(`当前配置没有执行器：${profile.id}`)
    } else if (profile.state === 'blocked') reasons.push(`执行器未准入：${profile.id}`)
  }

  if (suggestion.scope !== null && project !== undefined) {
    if (!within(suggestion.scope.allowedPaths, project.scope.allowedPaths)) reasons.push('声明允许路径超出当前项目范围')
    if (!within(project.scope.excludedPaths, suggestion.scope.excludedPaths)) reasons.push('声明遗漏了当前项目必须保留的排除项')
    if (!within(suggestion.scope.externalActions, project.scope.externalActions)) reasons.push('声明外部动作超出当前项目范围')
    // The restricted selection carries only allowed atoms; extra declared exclusions would be silently dropped.
    if (!within(suggestion.scope.excludedPaths, project.scope.excludedPaths)) reasons.push('声明的追加排除项无法通过受限选择保留')
  }

  const preview = suggestion.preview
  if (preview === null) reasons.push('缺少可预览的模板选择')
  if (project !== undefined && preview !== null) {
    if (!unique(preview.allowedPaths) || preview.allowedPaths.length === 0) reasons.push('模板选择未包含有效的范围原子')
    else if (!within(preview.allowedPaths, project.scope.allowedPaths)) reasons.push('模板选择的范围原子超出当前项目')
    else if (suggestion.scope !== null && !within(preview.allowedPaths, suggestion.scope.allowedPaths))
      reasons.push('模板选择范围超出声明范围')
    if (!project.profileIds.includes(preview.profileId)) reasons.push(`当前项目未绑定模板执行器：${preview.profileId}`)
    const existing = context.profiles.find(item => item.id === preview.profileId)
    if (existing === undefined) reasons.push(`当前配置没有模板执行器：${preview.profileId}`)
    else if (!existing.dispatchAllowed) reasons.push(`模板执行器未准入：${preview.profileId}`)
    if (suggestion.profiles.length > 0 && !suggestion.profiles.some(item => item.id === preview.profileId))
      reasons.push('模板选择的执行器与声明不一致')
  }
  if (suggestion.goalPreview.trim().length === 0) reasons.push('缺少目标预览')
  else if (suggestion.goalPreview.length > maxGoal) reasons.push('目标超出原委托表单上限')

  const uniqueReasons = [...new Set(reasons)]
  const applicable = uniqueReasons.length === 0 && suggestion.status === 'draft' &&
    project !== undefined && preview !== null
  return {
    applicable,
    statusLabel: statusLabel[suggestion.status],
    reasons: uniqueReasons,
    checks,
    profiles,
    goalPreview: boundedPreview(suggestion.goalPreview),
    ...(applicable && project !== undefined && preview !== null
      ? {
          selection: {
            suggestionId: suggestion.id,
            projectId: project.id,
            kind: preview.kind,
            allowedPaths: preview.allowedPaths,
            profileId: preview.profileId,
          },
        }
      : {}),
  }
}
