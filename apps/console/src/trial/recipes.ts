/**
 * Read-only presentation input for project-recipe suggestions (J-owned data). It never executes a
 * script, installs a dependency, registers a check, creates a work or grants authority: it only says
 * whether a declaration is applicable to the *current configured project* and builds a bounded draft
 * payload that main can revalidate against current configuration/facts before prefilling its own form.
 *
 * Applicability uses the project's own profileIds/defaultCriteria/check refs, not just global registry
 * equality. Unknown sources, foreign/deleted projects and declared-contradictory checks are explanation
 * only. These strings are untrusted declaration data: rendered as text, bounded, never interpreted.
 */
import type { ApplicationConfiguration } from '@personal-agent/contracts'

export type TrialRecipeStatus = 'draft' | 'needs_input' | 'unsupported'

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

export interface TrialRecipeSuggestion {
  readonly id: string
  readonly version: string
  readonly source: 'project-recipes' | 'unknown'
  readonly projectId: string | null
  readonly title: string
  readonly goalPreview: string
  readonly scopeNote: string | null
  /** Declared scope atoms; null means the project's current atoms are proposed unchanged. */
  readonly scope: TrialRecipeScopeAtoms | null
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
export type TrialRecipeCriterion = TrialRecipeProject['defaultCriteria'][number]

export interface TrialRecipeContextProject {
  readonly id: string
  readonly displayName: string
  readonly dispatchAllowed: boolean
  readonly profileIds: readonly string[]
  /** Check ids referenced by this project's required machine criteria. */
  readonly checkRefs: readonly string[]
  readonly scope: TrialRecipeProject['scope']
  readonly criteria: TrialRecipeProject['defaultCriteria']
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

/** Complete prefill data for the original delegation form; main revalidates before using it. */
export interface TrialRecipeDraft {
  readonly suggestionId: string
  readonly suggestionVersion: string
  readonly projectId: string
  readonly goal: string
  readonly scope: TrialRecipeProject['scope']
  readonly criteria: readonly TrialRecipeCriterion[]
  readonly profileId: string
  readonly source: 'project-recipes'
  readonly authority: 'none'
}

export interface TrialRecipeOutcome {
  readonly applicable: boolean
  readonly statusLabel: string
  readonly reasons: readonly string[]
  readonly checks: readonly TrialRecipeCheckView[]
  readonly profiles: readonly TrialRecipeProfileView[]
  readonly goalPreview: string
  readonly draft?: TrialRecipeDraft | undefined
}

const statusLabel: Record<TrialRecipeStatus, string> = { draft: '草案', needs_input: '需要输入', unsupported: '不支持' }
const maxPreview = 600
const maxGoal = 16384

const boundedPreview = (text: string): string =>
  text.length <= maxPreview ? text : `${text.slice(0, maxPreview)}…`
const sameAtoms = (declared: readonly string[], allowed: readonly string[]) => declared.every(atom => allowed.includes(atom))

export function trialRecipeContext(configuration: ApplicationConfiguration | undefined, projectId: string | undefined): TrialRecipeContext {
  return {
    ...(projectId === undefined ? {} : { projectId }),
    projects: configuration?.projects.map(project => ({
      id: project.id,
      displayName: project.displayName,
      dispatchAllowed: project.dispatchAllowed,
      profileIds: project.profileIds,
      checkRefs: [...new Set(project.defaultCriteria.flatMap(criterion =>
        criterion.kind === 'machine' && criterion.checkDefinitionRef !== undefined ? [criterion.checkDefinitionRef] : []))],
      scope: project.scope,
      criteria: project.defaultCriteria,
      ...(project.defaultProfileId === undefined ? {} : { defaultProfileId: project.defaultProfileId }),
    })) ?? [],
    registeredChecks: configuration?.checks.map(check => check.id) ?? [],
    profiles: configuration?.profiles.map(profile => ({ id: profile.id, kind: profile.kind, dispatchAllowed: profile.dispatchAllowed })) ?? [],
  }
}

/**
 * Applicability and draft are derived only from the declaration, the current project record and the
 * existing configuration read model. Even an applicable draft is only a prefill proposal for main.
 */
export function trialRecipeOutcome(suggestion: TrialRecipeSuggestion, context: TrialRecipeContext): TrialRecipeOutcome {
  const reasons: string[] = []
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
  if (suggestion.source !== 'project-recipes') reasons.push('来源未知，不能准备草案')
  if (suggestion.status === 'unsupported') reasons.push('该声明当前不受支持')
  if (suggestion.status !== 'unsupported') {
    for (const missing of suggestion.missingInputs) reasons.push(`缺少：${missing.label}`)
  }
  if (context.projectId === undefined) reasons.push('请先选择一个项目；全部项目视图不能准备委托')
  else if (project === undefined) reasons.push('当前项目不在配置中，不能准备委托')
  if (suggestion.projectId === null) reasons.push('声明未指明所属项目')
  else if (context.projectId !== undefined && suggestion.projectId !== context.projectId) reasons.push('该草案不属于当前项目')

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
    if (!sameAtoms(suggestion.scope.allowedPaths, project.scope.allowedPaths) ||
      !sameAtoms(suggestion.scope.excludedPaths, project.scope.excludedPaths) ||
      !sameAtoms(suggestion.scope.externalActions, project.scope.externalActions))
      reasons.push('声明范围原子不在当前项目范围内')
  }
  if (suggestion.goalPreview.trim().length === 0) reasons.push('缺少目标预览')
  else if (suggestion.goalPreview.length > maxGoal) reasons.push('目标超出原委托表单上限')

  const chosenProfile = suggestion.profiles[0]?.id ?? project?.defaultProfileId
  if (project !== undefined && chosenProfile === undefined) reasons.push('当前项目没有可用执行器')
  if (project !== undefined && chosenProfile !== undefined) {
    const existing = context.profiles.find(item => item.id === chosenProfile)
    if (!project.profileIds.includes(chosenProfile)) reasons.push(`当前项目未绑定执行器：${chosenProfile}`)
    else if (existing === undefined) reasons.push(`当前配置没有执行器：${chosenProfile}`)
    else if (!existing.dispatchAllowed) reasons.push(`执行器未准入：${chosenProfile}`)
  }

  const criteria: TrialRecipeCriterion[] = []
  if (project !== undefined) {
    const selected = suggestion.checks.filter(check => check.declared !== false)
    for (const check of selected) {
      const criterion = project.criteria.find(item => item.kind === 'machine' && item.checkDefinitionRef === check.id)
      if (criterion !== undefined) criteria.push(criterion)
    }
    if (criteria.length === 0) criteria.push(...project.criteria)
  }

  const uniqueReasons = [...new Set(reasons)]
  const applicable = uniqueReasons.length === 0 && suggestion.status === 'draft' &&
    project !== undefined && chosenProfile !== undefined && criteria.length > 0
  const draft: TrialRecipeDraft | undefined = applicable && project !== undefined && chosenProfile !== undefined
    ? {
        suggestionId: suggestion.id,
        suggestionVersion: suggestion.version,
        projectId: project.id,
        goal: suggestion.goalPreview,
        scope: suggestion.scope === null
          ? project.scope
          : { projectId: project.id, allowedPaths: suggestion.scope.allowedPaths, excludedPaths: suggestion.scope.excludedPaths, externalActions: suggestion.scope.externalActions },
        criteria,
        profileId: chosenProfile,
        source: 'project-recipes',
        authority: 'none',
      }
    : undefined

  return {
    applicable,
    statusLabel: statusLabel[suggestion.status],
    reasons: uniqueReasons,
    checks,
    profiles,
    goalPreview: boundedPreview(suggestion.goalPreview),
    ...(draft === undefined ? {} : { draft }),
  }
}
