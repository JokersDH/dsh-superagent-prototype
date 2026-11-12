import { AssistantReplyBodySchema, ReasonerProposalSchema } from '@personal-agent/contracts'
import type { AssistantReplyBody, ContractRef, ReasonerProposal, Scope, UserCommand } from '@personal-agent/contracts'
import { planProposalCommand } from './command-plan.ts'
import { ProposalError } from './errors.ts'
import { proposalDigest, proposalIntent, validateProposalBindings } from './parser.ts'

/**
 * Pure review of the candidate data a model returned with a completed reply.
 *
 * This is a projection over already-returned `AssistantReplyBody` data: it performs no model call,
 * creates no Work, writes no policy, records no decision and accepts no delivery. Every candidate stays
 * untrusted data until the user explicitly confirms it through main's existing proposal flow.
 */

export interface ReplyCandidateBindings {
  /** Current authenticated project; the body must belong to it. */
  readonly projectId: string
  /** Current source user message; every executable candidate must be bound to it. */
  readonly sourceMessageId: string
  readonly conversationId: string
  readonly grantId: string
  /** Current authorization scope, used only to refuse an escalating decision scope. */
  readonly grantScope: Scope
  readonly currentContract?: ContractRef
  /** Authenticated principal the reply must belong to when verified by main. */
  readonly principal?: { readonly userId: string; readonly authorityRef: string }
  readonly maxCandidates?: number
}

/**
 * A body only reaches the candidate reviewer through main's completed-reply verification
 * (`CompletedAssistantReplies.read`): original request receipt, artifact bytes, reply identity and
 * principal were already checked by that owner. The marker is a private constructor contract for the
 * caller that did the verification; it is not a public proof, and C never mints it.
 */
export interface VerifiedCompletedReply {
  readonly verifiedBy: 'main-completed-reply'
  readonly body: AssistantReplyBody
  /** Identity the verifying owner observed on the original request/reply. */
  readonly identity: {
    readonly requestId: string
    readonly replyMessageId: string
    readonly sourceMessageId: string
    readonly projectId: string
    readonly conversationId: string
    readonly model: string
    readonly principal: { readonly userId: string; readonly authorityRef: string }
  }
}

export type ReplyCandidatePlan =
  | { readonly kind: 'no_effect'; readonly reason: 'reply' }
  | { readonly kind: 'needs_user_input'; readonly missing: readonly string[] }
  | {
      readonly kind: 'requires_explicit_confirmation'
      readonly commandKind: UserCommand['kind']
      /** Digest of the candidate payload, not of a dispatched command. */
      readonly payloadDigest: string
    }

export interface ReplyCandidateField {
  readonly name: string
  readonly value: string
}

export interface ReplyCandidateView {
  readonly index: number
  readonly kind: ReasonerProposal['kind']
  readonly title: string
  readonly summary: string
  readonly fields: readonly ReplyCandidateField[]
  readonly plan: ReplyCandidatePlan
  readonly payloadDigest: string
  readonly trust: 'untrusted_data'
  /** Nothing in this module can execute; main requires the user's explicit confirmation first. */
  readonly executable: false
  readonly requiresUserConfirmation: true
}

export interface ReplyCandidateRejection {
  readonly index: number
  readonly reason: string
  readonly detail?: string
}

export interface ReplyCandidateReview {
  readonly protocol: 'reply-candidate-review/1'
  readonly status: 'invalid_body' | 'no_candidates' | 'candidates'
  /** The model's ordinary reply text, preserved for the normal conversation path. */
  readonly reply: string
  readonly candidates: readonly ReplyCandidateView[]
  readonly rejected: readonly ReplyCandidateRejection[]
  readonly hasExecutableCandidates: boolean
  /** No authorization, tool permission or command is produced by reviewing candidates. */
  readonly authorization: 'none'
  readonly untrusted: true
  readonly modelCallPerformed: false
  /** `main-completed-reply` only when the body arrived through the verified entry point. */
  readonly verifiedBy: 'main-completed-reply' | 'none'
  readonly notes: readonly string[]
}

const MAX_CANDIDATES_CEILING = 8

function sanitize(value: string, maxLength = 400): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function resolveMaxCandidates(value: number | undefined): number {
  if (value === undefined) return MAX_CANDIDATES_CEILING
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError('Reply candidate maxCandidates must be a positive integer')
  }
  return Math.min(value, MAX_CANDIDATES_CEILING)
}

function displayOf(index: number, payload: ReasonerProposal, plan: ReplyCandidatePlan): ReplyCandidateView {
  const base = {
    index,
    kind: payload.kind,
    plan,
    payloadDigest: proposalDigest(payload),
    trust: 'untrusted_data' as const,
    executable: false as const,
    requiresUserConfirmation: true as const,
  }
  if (payload.kind === 'reply') {
    return {
      ...base,
      title: 'Reply text',
      summary: sanitize(payload.text, 2000),
      fields: [{ name: 'sourceRefs', value: String(payload.sourceRefs.length) }],
    }
  }
  if (payload.kind === 'propose_work') {
    return {
      ...base,
      title: 'Proposed work',
      summary: sanitize(payload.goal, 2000),
      fields: [{ name: 'projectId', value: sanitize(payload.projectId, 200) }],
    }
  }
  if (payload.kind === 'propose_revision') {
    return {
      ...base,
      title: 'Proposed contract revision',
      summary: sanitize(payload.rationale, 2000),
      fields: [
        { name: 'expectedWorkId', value: sanitize(payload.expected.workId, 200) },
        { name: 'expectedRevision', value: String(payload.expected.revision) },
        { name: 'expectedDigest', value: payload.expected.digest.slice(0, 16) },
      ],
    }
  }
  return {
    ...base,
    title: 'Proposed project decision',
    summary: sanitize(payload.content, 2000),
    fields: [
      { name: 'scopeProjectId', value: sanitize(payload.scope.projectId, 200) },
      { name: 'allowedPaths', value: sanitize(payload.scope.allowedPaths.join(', '), 400) },
      { name: 'excludedPaths', value: sanitize(payload.scope.excludedPaths.join(', '), 400) },
      { name: 'externalActions', value: String(payload.scope.externalActions.length) },
    ],
  }
}

/**
 * Validates a completed reply body and projects its suggestions for an explicit user decision.
 *
 * - An unparseable or unbound body is `invalid_body`: no candidate is invented and no retry is made.
 * - A body with no legal candidate still keeps the ordinary reply text (`no_candidates`).
 * - Each suggestion is re-validated against the current source/project/contract; refusals are listed
 *   with their reason instead of being dropped silently.
 * - Supported proposals report the exact inputs the user must still supply (`needs_user_input`) or the
 *   existing command kind that would need explicit confirmation. Nothing is dispatched here.
 */
export function reviewReplyCandidates(rawBody: unknown, bindings: ReplyCandidateBindings): ReplyCandidateReview {
  const maxCandidates = resolveMaxCandidates(bindings.maxCandidates)
  const notes = [
    'Candidates are untrusted model data; confirming one is the existing explicit user proposal flow.',
    'No model request, Work creation, policy write, decision record or delivery acceptance happens here.',
  ]
  const invalidBody = (rejected: readonly ReplyCandidateRejection[]): ReplyCandidateReview => ({
    protocol: 'reply-candidate-review/1',
    status: 'invalid_body',
    reply: '',
    candidates: [],
    rejected,
    hasExecutableCandidates: false,
    authorization: 'none',
    untrusted: true,
    modelCallPerformed: false,
    verifiedBy: 'none',
    notes,
  })
  const parsed = AssistantReplyBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return invalidBody(
      parsed.error.issues.slice(0, 8).map((issue, index) => ({
        index,
        reason: 'invalid_body',
        detail: sanitize(`${issue.path.join('.') || '$'}: ${issue.message}`, 300),
      })),
    )
  }
  const body: AssistantReplyBody = parsed.data
  // The whole body envelope must belong to the trusted request before any suggestion is considered:
  // a foreign conversation or project is not a candidate list to filter, it is another reply.
  if (body.projectId !== bindings.projectId || body.conversationId !== bindings.conversationId || body.sourceMessageId !== bindings.sourceMessageId) {
    return invalidBody([
      {
        index: 0,
        reason: 'body_binding_mismatch',
        detail: 'Reply body project/conversation/source does not match the trusted request',
      },
    ])
  }
  const trusted = {
    actorRef: 'candidate-review',
    projectId: bindings.projectId,
    grant: { grantId: bindings.grantId, scope: bindings.grantScope },
    sourceMessageId: bindings.sourceMessageId,
    ...(bindings.currentContract === undefined ? {} : { contract: bindings.currentContract }),
  }

  const candidates: ReplyCandidateView[] = []
  const rejected: ReplyCandidateRejection[] = []
  body.suggestions.forEach((suggestion, index) => {
    const revalidated = ReasonerProposalSchema.safeParse(suggestion)
    if (!revalidated.success) {
      rejected.push({ index, reason: 'invalid_candidate', detail: sanitize(revalidated.error.issues[0]?.message ?? 'invalid', 200) })
      return
    }
    if (candidates.length >= maxCandidates) {
      rejected.push({ index, reason: 'max_candidates' })
      return
    }
    try {
      validateProposalBindings(revalidated.data, trusted)
    } catch (error) {
      const code = error instanceof ProposalError ? error.code : 'binding_refused'
      rejected.push({ index, reason: code, ...(error instanceof Error ? { detail: sanitize(error.message, 200) } : {}) })
      return
    }
    const intent = proposalIntent(revalidated.data)
    // The plan is a preview only: placeholder ids are never dispatched or persisted.
    const planned = planProposalCommand(intent, { commandId: `candidate-review-${index}`, conversationId: bindings.conversationId })
    const plan: ReplyCandidatePlan =
      planned.kind === 'needs_user_input'
        ? { kind: 'needs_user_input', missing: planned.missing }
        : planned.kind === 'no_effect'
          ? { kind: 'no_effect', reason: 'reply' }
          : {
              kind: 'requires_explicit_confirmation',
              commandKind: planned.command.kind,
              payloadDigest: proposalDigest(revalidated.data),
            }
    candidates.push(displayOf(index, revalidated.data, plan))
  })

  return {
    protocol: 'reply-candidate-review/1',
    status: candidates.length === 0 ? 'no_candidates' : 'candidates',
    reply: body.text,
    candidates,
    rejected,
    // A reply-only candidate has no business effect, so it is not an "executable" proposal.
    hasExecutableCandidates: candidates.some((candidate) => candidate.plan.kind !== 'no_effect'),
    authorization: 'none',
    untrusted: true,
    modelCallPerformed: false,
    verifiedBy: 'none',
    notes,
  }
}

/**
 * The only entry point for candidate data that claims to come from a completed model reply.
 *
 * `input` must be a `VerifiedCompletedReply` produced by the owner that checked the original request
 * receipt and artifact bytes (main's `CompletedAssistantReplies.read`). A raw body, a row lookup or a
 * hand-written marker is refused with `invalid_body`; C mints no verification and keeps no second
 * confirmation authority.
 */
export function reviewVerifiedReplyCandidates(input: unknown, bindings: ReplyCandidateBindings): ReplyCandidateReview {
  const refuse = (reason: string, detail: string): ReplyCandidateReview => ({
    protocol: 'reply-candidate-review/1',
    status: 'invalid_body',
    reply: '',
    candidates: [],
    rejected: [{ index: 0, reason, detail }],
    hasExecutableCandidates: false,
    authorization: 'none',
    untrusted: true,
    modelCallPerformed: false,
    verifiedBy: 'none',
    notes: ['Only a main-verified completed reply can be reviewed; nothing here executes or re-sends.'],
  })
  // Unknown input is validated before any dereference: a null/partial wrapper is a refused claim,
  // never a thrown TypeError.
  if (!isObject(input)) return refuse('unverified_reply', 'No verified completed reply was supplied')
  if (input.verifiedBy !== 'main-completed-reply') {
    return refuse('unverified_reply', 'The reply did not arrive through the main completed-reply verifier')
  }
  const body = input.body
  const identity = input.identity
  if (!isObject(body) || !isObject(identity)) {
    return refuse('incomplete_identity', 'Verified reply body or identity is missing')
  }
  const bodyRef = {
    replyMessageId: body.replyMessageId,
    sourceMessageId: body.sourceMessageId,
    projectId: body.projectId,
    conversationId: body.conversationId,
    model: body.model,
  }
  const identityRef = {
    replyMessageId: identity.replyMessageId,
    sourceMessageId: identity.sourceMessageId,
    projectId: identity.projectId,
    conversationId: identity.conversationId,
    model: identity.model,
  }
  if (!Object.values(bodyRef).every(isNonEmptyString) || !Object.values(identityRef).every(isNonEmptyString)) {
    return refuse('incomplete_identity', 'Verified reply identity is incomplete')
  }
  if (!isObject(identity.principal) || !isNonEmptyString(identity.principal.userId) || !isNonEmptyString(identity.principal.authorityRef)) {
    return refuse('incomplete_identity', 'Verified reply principal is missing')
  }
  const principalRef = identity.principal
  if (
    bodyRef.replyMessageId !== identityRef.replyMessageId ||
    bodyRef.sourceMessageId !== identityRef.sourceMessageId ||
    bodyRef.projectId !== identityRef.projectId ||
    bodyRef.conversationId !== identityRef.conversationId ||
    bodyRef.model !== identityRef.model
  ) {
    return refuse('reply_identity_mismatch', 'Reply body does not match the verified request/reply identity')
  }
  if (
    identityRef.sourceMessageId !== bindings.sourceMessageId ||
    identityRef.projectId !== bindings.projectId ||
    identityRef.conversationId !== bindings.conversationId
  ) {
    return refuse('reply_binding_mismatch', 'Verified reply belongs to another source/project/conversation')
  }
  if (
    bindings.principal === undefined ||
    principalRef.userId !== bindings.principal.userId ||
    principalRef.authorityRef !== bindings.principal.authorityRef
  ) {
    return refuse('principal_unverified', 'Verified reply principal is not the current authenticated principal')
  }
  const review = reviewReplyCandidates(body, bindings)
  return { ...review, verifiedBy: 'main-completed-reply' }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
