/**
 * Hand-off to the existing confirmation flow.
 *
 * A `draft` result is not a proposal and not a command. This module only reshapes its fields into
 * the public `create_work` command *input* that the application already owns, so main/F can prefill
 * the existing delegation form (or hand the fields to `ProposalPrepare` when a source message
 * exists) without guessing field names or copying the matching algorithm.
 *
 * What stays with the application: `commandId`, `conversationId`, the trusted actor, the preview
 * token and the explicit user confirmation. Nothing here submits, executes, registers or grants.
 */
import { UserCommandSchema, type Scope, type RequiredCriteria, type UserCommand } from '@personal-agent/contracts'
import { ProjectFactsSchema, factsContentDigest } from './facts.ts'
import { RecipeDraftError, draftRevision, type ProjectRecipeDraft } from './draft.ts'

/** Matches the matcher's default freshness budget; reused so both layers agree. */
export const DEFAULT_REUSE_MAX_FACTS_AGE_MS = 60 * 60 * 1000

/** Stable field bundle for a delegation form; matches the `create_work` command's data fields. */
export const CREATE_WORK_FIELDS_PROTOCOL = 'project-recipe-create-work-fields/1' as const

export interface CreateWorkFields {
  readonly protocol: typeof CREATE_WORK_FIELDS_PROTOCOL
  readonly recipe: { readonly id: string; readonly version: number; readonly revision: string }
  readonly projectId: string
  readonly goal: string
  readonly scope: Scope
  readonly criteria: RequiredCriteria
  readonly profileId: string
  /** Always `none`: the fields are unconfirmed data. */
  readonly authorization: 'none'
}

export type PreviewErrorCode = 'not_actionable' | 'revision_mismatch' | 'stale_inputs'

/** Which prerequisite changed, so a caller can tell the user exactly what to regenerate. */
export type StaleInput = 'configuration' | 'facts'

export class PreviewError extends Error {
  readonly code: PreviewErrorCode
  /** Only populated for `stale_inputs`. */
  readonly staleInputs: readonly StaleInput[]
  constructor(code: PreviewErrorCode, message: string, staleInputs: readonly StaleInput[] = []) {
    super(message)
    this.name = 'PreviewError'
    this.code = code
    this.staleInputs = Object.freeze([...staleInputs])
  }
}

const verify = (draft: ProjectRecipeDraft): void => {
  if (draftRevision(draft) !== draft.revision) throw new RecipeDraftError('revision_mismatch', 'Draft revision does not match its content')
}

/** Only a complete `draft` may be previewed; the other two statuses explain themselves instead. */
/** Optional user edit of the goal text; scope, criteria and profile always stay the draft's. */
export interface CreateWorkOverrides {
  readonly goal?: string
}

const editGoal = (current: string, overrides: CreateWorkOverrides = {}): string => {
  if (overrides.goal === undefined) return current
  const goal = overrides.goal.trim()
  if (goal.length === 0 || goal.length > 16384) throw new PreviewError('not_actionable', '编辑后的目标必须是非空且不超过 16384 字符')
  return goal
}

export function toCreateWorkFields(draft: ProjectRecipeDraft, overrides: CreateWorkOverrides = {}): CreateWorkFields {
  verify(draft)
  if (draft.status !== 'draft') {
    const reason = draft.status === 'needs_input' ? draft.needsInput.map((item) => item.code).join(', ') : draft.unsupported.map((item) => item.code).join(', ')
    throw new PreviewError('not_actionable', `A ${draft.status} result cannot be previewed as work (${reason})`)
  }
  return Object.freeze({
    protocol: CREATE_WORK_FIELDS_PROTOCOL,
    recipe: Object.freeze({ id: draft.recipe.id, version: draft.recipe.version, revision: draft.revision }),
    projectId: draft.projectId,
    goal: editGoal(draft.goal, overrides),
    scope: draft.scope,
    criteria: draft.criteria,
    profileId: draft.profileId,
    authorization: 'none' as const,
  })
}

/**
 * Build the `create_work` command the application already validates. The caller supplies the
 * command and conversation identity from its own session; everything else comes from the draft.
 * The returned command still has to pass the normal authorization, preview and confirmation path.
 */
export function toCreateWorkCommand(
  draft: ProjectRecipeDraft,
  ids: { readonly commandId: string; readonly conversationId: string },
  overrides: CreateWorkOverrides = {},
): UserCommand {
  const fields = toCreateWorkFields(draft, overrides)
  const candidate = {
    kind: 'create_work',
    commandId: ids.commandId,
    conversationId: ids.conversationId,
    projectId: fields.projectId,
    goal: fields.goal,
    scope: fields.scope,
    criteria: fields.criteria,
    profileId: fields.profileId,
  }
  const parsed = UserCommandSchema.safeParse(candidate)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new PreviewError('not_actionable', `Draft fields are not a valid create_work command: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim())
  }
  return parsed.data
}

/**
 * Guard against reusing a suggestion after the configuration or the observation changed. A stale
 * draft must be regenerated so that scope/criteria/profile are re-derived from the current world.
 */
export interface CurrentInputs {
  readonly configuration: unknown
  readonly facts: unknown
  /** Optional: when supplied, an observation older than `maxFactsAgeMs` is not reusable. */
  readonly now?: string
  readonly maxFactsAgeMs?: number
}

/**
 * Revalidate a draft against the current world.
 *
 * Content is compared through the stable digest: a fresh read of unchanged bytes stays valid even
 * though `observedAt` moved. When `now` is supplied, an observation outside the freshness budget is
 * refused as well, so an old observation cannot silently become a new authorization.
 */
export function assertDraftCurrent(draft: ProjectRecipeDraft, current: CurrentInputs): void {
  verify(draft)
  const stale: StaleInput[] = []
  const revision = (current.configuration as { revision?: unknown } | null | undefined)?.revision
  if (typeof revision === 'string' && revision !== draft.provenance.configuration.revision) stale.push('configuration')
  const parsedFacts = ProjectFactsSchema.safeParse(current.facts)
  if (!parsedFacts.success) throw new PreviewError('stale_inputs', '当前项目事实无法解析，请重新观察后生成', ['facts'])
  if (factsContentDigest(parsedFacts.data) !== draft.provenance.facts.contentDigest) stale.push('facts')
  if (current.now !== undefined) {
    const nowMs = Date.parse(current.now)
    const observedMs = Date.parse(parsedFacts.data.observedAt)
    const maxAge = current.maxFactsAgeMs ?? DEFAULT_REUSE_MAX_FACTS_AGE_MS
    if (!Number.isFinite(nowMs) || !Number.isSafeInteger(maxAge) || maxAge < 0 || !Number.isFinite(observedMs) || nowMs - observedMs > maxAge)
      if (!stale.includes('facts')) stale.push('facts')
  }
  if (stale.length === 0) return
  const guidance = stale.map((input) => (input === 'configuration' ? '配置已变化：请按当前配置重新生成' : '项目事实已变化或已过期：请重新观察后生成')).join('；')
  throw new PreviewError('stale_inputs', `草稿前提已过期（${stale.join(', ')}）：${guidance}`, stale)
}

/** Convenience for a consumer that wants both checks before showing a form. */
export function previewInputs(draft: ProjectRecipeDraft, current: CurrentInputs, overrides: CreateWorkOverrides = {}): CreateWorkFields {
  assertDraftCurrent(draft, current)
  return toCreateWorkFields(draft, overrides)
}
