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
import type { Json } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { RecipeDraftError, draftRevision, type ProjectRecipeDraft } from './draft.ts'

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

export class PreviewError extends Error {
  readonly code: PreviewErrorCode
  constructor(code: PreviewErrorCode, message: string) {
    super(message)
    this.name = 'PreviewError'
    this.code = code
  }
}

const verify = (draft: ProjectRecipeDraft): void => {
  if (draftRevision(draft) !== draft.revision) throw new RecipeDraftError('revision_mismatch', 'Draft revision does not match its content')
}

/** Only a complete `draft` may be previewed; the other two statuses explain themselves instead. */
export function toCreateWorkFields(draft: ProjectRecipeDraft): CreateWorkFields {
  verify(draft)
  if (draft.status !== 'draft') {
    const reason = draft.status === 'needs_input' ? draft.needsInput.map((item) => item.code).join(', ') : draft.unsupported.map((item) => item.code).join(', ')
    throw new PreviewError('not_actionable', `A ${draft.status} result cannot be previewed as work (${reason})`)
  }
  return Object.freeze({
    protocol: CREATE_WORK_FIELDS_PROTOCOL,
    recipe: Object.freeze({ id: draft.recipe.id, version: draft.recipe.version, revision: draft.revision }),
    projectId: draft.projectId,
    goal: draft.goal,
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
export function toCreateWorkCommand(draft: ProjectRecipeDraft, ids: { readonly commandId: string; readonly conversationId: string }): UserCommand {
  const fields = toCreateWorkFields(draft)
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
export function assertDraftCurrent(draft: ProjectRecipeDraft, current: { readonly configuration: unknown; readonly facts: unknown }): void {
  verify(draft)
  const revision = (current.configuration as { revision?: unknown } | null | undefined)?.revision
  if (typeof revision === 'string' && revision !== draft.provenance.configuration.revision)
    throw new PreviewError('stale_inputs', 'The configuration revision changed after this draft was produced; regenerate it')
  const factsDigest = canonicalDigest(current.facts as unknown as Json)
  if (factsDigest !== draft.provenance.facts.digest)
    throw new PreviewError('stale_inputs', 'The project facts changed after this draft was produced; re-observe and regenerate it')
}

/** Convenience for a consumer that wants both checks before showing a form. */
export function previewInputs(draft: ProjectRecipeDraft, current: { readonly configuration: unknown; readonly facts: unknown }): CreateWorkFields {
  assertDraftCurrent(draft, current)
  return toCreateWorkFields(draft)
}
