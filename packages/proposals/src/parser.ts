import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ReasonerProposalSchema } from '@personal-agent/contracts'
import type { Json, ReasonerProposal, Scope } from '@personal-agent/contracts'
import { ProposalError } from './errors.ts'
import type { ProposalIntent, ProposalTrustedContext, StructuredParseResult } from './types.ts'

const MAX_REPLY_CHARS = 32768

/**
 * Parses only already-structured output from the existing reasoner. Plain text and Markdown are a
 * normal reply and are never scanned for JSON or executable instructions.
 */
export function parseStructuredOutput(raw: unknown): StructuredParseResult {
  if (typeof raw === 'string') {
    const reply = raw.trim()
    return {
      ok: false,
      reason: 'not_structured',
      ...(reply.length === 0 ? {} : { reply: reply.slice(0, MAX_REPLY_CHARS) }),
      executable: false,
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not_structured', executable: false }
  }
  if (!Object.hasOwn(raw, 'kind')) {
    return { ok: false, reason: 'not_structured', executable: false }
  }
  const parsed = ReasonerProposalSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_proposal',
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`),
      executable: false,
    }
  }
  return { ok: true, proposal: parsed.data }
}

export function proposalDigest(payload: ReasonerProposal): string {
  return canonicalDigest(payload as unknown as Json)
}

export function sameContract(
  left: { readonly workId: string; readonly revision: number; readonly digest: string },
  right: { readonly workId: string; readonly revision: number; readonly digest: string },
): boolean {
  return left.workId === right.workId && left.revision === right.revision && left.digest === right.digest
}

/** Conservative atom containment; it is not a glob-language inclusion proof. */
export function scopeWithin(
  scope: import('@personal-agent/contracts').Scope,
  grant: import('@personal-agent/contracts').Scope,
): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action)) &&
    (!grant.expiresAt || (!!scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(grant.expiresAt)))
  )
}


/** Trusted source/project/contract/scope binding shared by the registry and persisted service. */
export function validateProposalBindings(payload: ReasonerProposal, trusted: ProposalTrustedContext): void {
  if (trusted.grant.scope.projectId !== trusted.projectId) {
    throw new ProposalError('cross_project', 'Authorization grant belongs to another project')
  }
  if (payload.kind === 'reply') return
  if (payload.sourceMessageId !== trusted.sourceMessageId) {
    throw new ProposalError('source_mismatch', 'Proposal is bound to another source message')
  }
  if (payload.kind === 'propose_work') {
    if (payload.projectId !== trusted.projectId) {
      throw new ProposalError('cross_project', 'Proposal targets another project')
    }
    return
  }
  if (payload.kind === 'propose_revision') {
    if (!trusted.contract || !sameContract(payload.expected, trusted.contract)) {
      throw new ProposalError('contract_stale', 'Proposal does not reference the current contract')
    }
    return
  }
  if (payload.scope.projectId !== trusted.projectId) {
    throw new ProposalError('cross_project', 'Decision scope targets another project')
  }
  if (!scopeWithin(payload.scope, trusted.grant.scope)) {
    throw new ProposalError('scope_escalation', 'Decision scope exceeds the current authorization')
  }
}

/** The only output of a confirmed proposal: no actor, command id or work-scope grant. */
export function proposalIntent(payload: ReasonerProposal): ProposalIntent {
  switch (payload.kind) {
    case 'reply':
      return { kind: 'reply', text: payload.text, sourceRefs: [...payload.sourceRefs] }
    case 'propose_work':
      return {
        kind: 'create_work',
        projectId: payload.projectId,
        goal: payload.goal,
        sourceMessageId: payload.sourceMessageId,
      }
    case 'propose_revision':
      return {
        kind: 'revise_work',
        expected: { ...payload.expected },
        rationale: payload.rationale,
        sourceMessageId: payload.sourceMessageId,
      }
    case 'propose_decision':
      return {
        kind: 'record_decision',
        content: payload.content,
        scope: payload.scope as Scope,
        sourceMessageId: payload.sourceMessageId,
      }
  }
}
