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
import { ApplicationConfigurationSchema, UserCommandSchema, type Scope, type RequiredCriteria, type UserCommand } from '@personal-agent/contracts'
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

export const PREVIEW_ERROR_CODES = ['not_actionable', 'revision_mismatch', 'stale_inputs', 'invalid_clock', 'stale_draft_version'] as const
export type PreviewErrorCode = (typeof PREVIEW_ERROR_CODES)[number]

/** Which prerequisite changed, so a caller can tell the user exactly what to regenerate. */
export type StaleInput = 'configuration' | 'facts' | 'expiry'

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
  if (typeof (draft as { provenance?: { facts?: { contentDigest?: unknown } } }).provenance?.facts?.contentDigest !== 'string')
    throw new PreviewError('stale_draft_version', '该草稿由较早版本生成（缺少 provenance.facts.contentDigest）；请用当前配置与事实重新生成')
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
  /**
   * Optional: defaults to the real clock. Time is always checked, so omitting `now` cannot be used
   * to claim that a stale or future observation was verified.
   */
  readonly now?: string
  readonly maxFactsAgeMs?: number
}

/** Structured, stable reasons a draft is no longer current. A caller renders these; none grants. */
export const CURRENCY_REASON_CODES = [
  'configuration_unsupported_version',
  'configuration_invalid',
  'configuration_changed',
  'project_removed',
  'facts_invalid',
  'facts_changed',
  'facts_future',
  'facts_expired',
  'expiry_passed',
  'clock_invalid',
] as const
export type CurrencyReasonCode = (typeof CURRENCY_REASON_CODES)[number]
export type CurrencyField = 'configuration' | 'facts' | 'expiry' | 'clock'

export interface CurrencyReason {
  readonly code: CurrencyReasonCode
  readonly field: CurrencyField
}

export interface DraftCurrency {
  readonly current: boolean
  readonly reasons: readonly CurrencyReason[]
  /** False when the current observation itself has gaps (`missing`/`omissions`). */
  readonly observationComplete: boolean
}

const reason = (code: CurrencyReasonCode, field: CurrencyField): CurrencyReason => ({ code, field })

/**
 * Decide whether a draft still describes the current world, with one structured reason per cause.
 *
 * The rules are the single policy behind `assertDraftCurrent`:
 *  - configuration is re-parsed: an unsupported version, a malformed body, a changed revision or a
 *    removed project are separate reasons;
 *  - facts are compared by stable content (timestamps excluded), so re-reading unchanged bytes stays
 *    current while changed content is not;
 *  - time is always checked against a real clock unless `now` is supplied: an unparseable clock, a
 *    future observation, an expired observation and an expired scope are distinct reasons.
 */
export function draftCurrency(draft: ProjectRecipeDraft, current: CurrentInputs): DraftCurrency {
  verify(draft)
  const reasons: CurrencyReason[] = []

  const parsedConfiguration = ApplicationConfigurationSchema.safeParse(current.configuration)
  if (!parsedConfiguration.success) {
    const observed = (current.configuration as { protocol?: unknown } | null | undefined)?.protocol
    reasons.push(
      typeof observed === 'string' && observed !== 'application-configuration/1'
        ? reason('configuration_unsupported_version', 'configuration')
        : reason('configuration_invalid', 'configuration'),
    )
  } else {
    const configuration = parsedConfiguration.data
    if (configuration.revision !== draft.provenance.configuration.revision) reasons.push(reason('configuration_changed', 'configuration'))
    if (!configuration.projects.some((entry) => entry.id === draft.projectId)) reasons.push(reason('project_removed', 'configuration'))
  }

  const parsedFacts = ProjectFactsSchema.safeParse(current.facts)
  if (!parsedFacts.success) {
    reasons.push(reason('facts_invalid', 'facts'))
    return { current: false, reasons: Object.freeze(reasons), observationComplete: false }
  }
  const facts = parsedFacts.data
  const observationComplete = facts.missing.length === 0 && facts.omissions.length === 0
  if (factsContentDigest(facts) !== draft.provenance.facts.contentDigest) reasons.push(reason('facts_changed', 'facts'))

  const nowMs = current.now === undefined ? Date.now() : Date.parse(current.now)
  const maxAge = current.maxFactsAgeMs ?? DEFAULT_REUSE_MAX_FACTS_AGE_MS
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(maxAge) || maxAge < 0) reasons.push(reason('clock_invalid', 'clock'))
  else {
    const observedMs = Date.parse(facts.observedAt)
    if (!Number.isFinite(observedMs)) reasons.push(reason('facts_invalid', 'facts'))
    else if (observedMs > nowMs) reasons.push(reason('facts_future', 'facts'))
    else if (nowMs - observedMs > maxAge) reasons.push(reason('facts_expired', 'facts'))
  }

  const project = parsedConfiguration.success ? parsedConfiguration.data.projects.find((entry) => entry.id === draft.projectId) : undefined
  const draftExpiry = draft.status === 'draft' ? draft.scope.expiresAt : undefined
  const expiry = draftExpiry ?? project?.scope.expiresAt
  if (expiry !== undefined && Number.isFinite(nowMs) && Date.parse(expiry) <= nowMs) reasons.push(reason('expiry_passed', 'expiry'))

  const unique = reasons.filter((entry, index) => reasons.findIndex((other) => other.code === entry.code) === index)
  return { current: unique.length === 0, reasons: Object.freeze(unique), observationComplete }
}

const CURRENCY_TEXT: Record<CurrencyReasonCode, string> = {
  configuration_unsupported_version: '配置版本不受支持',
  configuration_invalid: '当前配置无法通过公开 schema',
  configuration_changed: '配置已变化',
  project_removed: '当前配置已不再包含该项目',
  facts_invalid: '当前项目事实无法解析',
  facts_changed: '项目事实内容已变化',
  facts_future: '项目事实的观察时间在未来',
  facts_expired: '项目事实已超过保留期限',
  expiry_passed: '项目授权已过期',
  clock_invalid: '时间或保留期限参数无效',
}

const STALE_FIELD: Record<CurrencyField, StaleInput | undefined> = {
  configuration: 'configuration',
  facts: 'facts',
  expiry: 'expiry',
  clock: undefined,
}

/**
 * Revalidate a draft against the current world; throw when it is not current.
 *
 * The structured detail is available from `draftCurrency` — this function keeps the established
 * error contract (`invalid_clock`, `stale_inputs` with `staleInputs`) for existing consumers.
 */
export function assertDraftCurrent(draft: ProjectRecipeDraft, current: CurrentInputs): void {
  const currency = draftCurrency(draft, current)
  if (currency.current) return
  if (currency.reasons.some((entry) => entry.code === 'clock_invalid'))
    throw new PreviewError('invalid_clock', 'now 必须是有效的 ISO 时间，maxFactsAgeMs 必须是非负安全整数')
  const stale = [...new Set(currency.reasons.map((entry) => STALE_FIELD[entry.field]).filter((field): field is StaleInput => field !== undefined))]
  const text = currency.reasons.map((entry) => CURRENCY_TEXT[entry.code]).join('；')
  throw new PreviewError('stale_inputs', `草稿前提已过期（${text}）：请重新生成`, stale)
}

/** Convenience for a consumer that wants both checks before showing a form. */
export function previewInputs(draft: ProjectRecipeDraft, current: CurrentInputs, overrides: CreateWorkOverrides = {}): CreateWorkFields {
  assertDraftCurrent(draft, current)
  return toCreateWorkFields(draft, overrides)
}
