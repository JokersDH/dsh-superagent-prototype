import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ReasonerProposalSchema } from '@personal-agent/contracts'
import type { Json, ReasonerProposal } from '@personal-agent/contracts'
import type { StructuredParseResult } from './types.ts'

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
