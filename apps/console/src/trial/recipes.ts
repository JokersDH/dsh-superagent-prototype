/**
 * Read-only presentation input for project-recipe suggestions (J-owned data). It never executes a
 * script, installs a dependency, registers a check, creates a work or grants authority: it only says
 * whether a declaration is applicable to the current project and which existing inputs are missing.
 *
 * These strings are untrusted declaration data. They are rendered as text, bounded in length and never
 * interpreted as commands, links or HTML.
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

export interface TrialRecipeSuggestion {
  readonly id: string
  readonly version: string
  readonly source: 'project-recipes' | 'unknown'
  readonly projectId: string | null
  readonly title: string
  readonly goalPreview: string
  readonly scopeNote: string | null
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

export interface TrialRecipeContext {
  readonly projectId?: string | undefined
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

export interface TrialRecipeOutcome {
  readonly applicable: boolean
  readonly statusLabel: string
  readonly reasons: readonly string[]
  readonly checks: readonly TrialRecipeCheckView[]
  readonly profiles: readonly TrialRecipeProfileView[]
  /** Bounded display copy of the untrusted goal preview. */
  readonly goalPreview: string
}

const statusLabel: Record<TrialRecipeStatus, string> = { draft: '草案', needs_input: '需要输入', unsupported: '不支持' }
const maxPreview = 600

export function trialRecipeContext(configuration: ApplicationConfiguration | undefined, projectId: string | undefined): TrialRecipeContext {
  return {
    ...(projectId === undefined ? {} : { projectId }),
    registeredChecks: configuration?.checks.map(check => check.id) ?? [],
    profiles: configuration?.profiles.map(profile => ({ id: profile.id, kind: profile.kind, dispatchAllowed: profile.dispatchAllowed })) ?? [],
  }
}

const boundedPreview = (text: string): string =>
  text.length <= maxPreview ? text : `${text.slice(0, maxPreview)}…`

/**
 * Applicability is derived only from the declaration, the current project and the existing configuration
 * read model. It is never an execution grant: even an applicable draft is handed to the original form.
 */
export function trialRecipeOutcome(suggestion: TrialRecipeSuggestion, context: TrialRecipeContext): TrialRecipeOutcome {
  const reasons: string[] = []
  const checks = suggestion.checks.map(check => ({
    id: check.id,
    required: check.required,
    state: context.registeredChecks.includes(check.id) ? 'available' as const : 'missing' as const,
  }))
  const profiles = suggestion.profiles.map(profile => {
    const existing = context.profiles.find(item => item.id === profile.id)
    return {
      id: profile.id,
      state: existing === undefined ? 'missing' as const : existing.dispatchAllowed ? 'available' as const : 'blocked' as const,
    }
  })

  if (suggestion.authority !== 'none') reasons.push('来源未声明为只读草案')
  if (suggestion.status === 'unsupported') reasons.push('该声明当前不受支持')
  if (suggestion.status !== 'unsupported') {
    for (const missing of suggestion.missingInputs) reasons.push(`缺少：${missing.label}`)
  }
  if (suggestion.projectId === null) reasons.push('声明未指明所属项目')
  else if (context.projectId !== undefined && suggestion.projectId !== context.projectId) reasons.push('该草案不属于当前项目')
  if (suggestion.goalPreview.trim().length === 0) reasons.push('缺少目标预览')
  for (const check of checks) if (check.state === 'missing') reasons.push(`当前配置未注册检查：${check.id}`)
  for (const profile of profiles) {
    if (profile.state === 'missing') reasons.push(`当前配置没有执行器：${profile.id}`)
    else if (profile.state === 'blocked') reasons.push(`执行器未准入：${profile.id}`)
  }

  return {
    applicable: reasons.length === 0 && suggestion.status === 'draft',
    statusLabel: statusLabel[suggestion.status],
    reasons: [...new Set(reasons)],
    checks,
    profiles,
    goalPreview: boundedPreview(suggestion.goalPreview),
  }
}

/** Only suggestions for the current project are useful; others are kept visible but refused. */
export function trialRecipeSuggestionsForProject(
  suggestions: readonly TrialRecipeSuggestion[], projectId: string | undefined,
): readonly TrialRecipeSuggestion[] {
  if (projectId === undefined) return suggestions
  return suggestions.filter(suggestion => suggestion.projectId === projectId || suggestion.projectId === null)
}
