import type { ContractRef, ReasonerProposal, Scope } from '@personal-agent/contracts'

export type ProposalState = 'pending' | 'confirmed' | 'rejected' | 'expired' | 'superseded'

/** Trusted values supplied by main from the authenticated actor and the current authorization. */
export interface ProposalTrustedContext {
  readonly actorRef: string
  readonly projectId: string
  readonly grant: { readonly grantId: string; readonly scope: Scope }
  readonly sourceMessageId: string
  /** Current contract for revision proposals; required for `propose_revision`. */
  readonly contract?: ContractRef
  readonly expiresAt?: string
}

export interface ProposalRecord {
  readonly proposalId: string
  readonly sourceMessageId: string
  readonly projectId: string
  readonly actorRef: string
  readonly grantId: string
  readonly grantScope: Scope
  readonly contract?: ContractRef
  readonly createdAt: string
  readonly expiresAt: string
  readonly version: number
  readonly payload: ReasonerProposal
  readonly payloadDigest: string
  readonly state: ProposalState
  readonly confirmedAt?: string
  readonly confirmedBy?: string
  readonly rejectedAt?: string
  readonly rejectionReason?: string
  readonly supersededBy?: string
  readonly intent?: ProposalIntent
}

/**
 * The only output of a confirmed proposal. It deliberately contains no actor, command id, scope
 * extension or tool grant: main builds the deterministic UserCommand and re-checks authority.
 */
export type ProposalIntent =
  | { readonly kind: 'reply'; readonly text: string; readonly sourceRefs: readonly string[] }
  | { readonly kind: 'create_work'; readonly projectId: string; readonly goal: string; readonly sourceMessageId: string }
  | {
      readonly kind: 'revise_work'
      readonly expected: ContractRef
      readonly rationale: string
      readonly sourceMessageId: string
    }
  | {
      readonly kind: 'record_decision'
      readonly content: string
      readonly scope: Scope
      readonly sourceMessageId: string
    }

export type StructuredParseResult =
  | { readonly ok: true; readonly proposal: ReasonerProposal }
  | {
      readonly ok: false
      readonly reason: 'not_structured' | 'invalid_proposal'
      /** A normal conversational reply is preserved, but it is never executable. */
      readonly reply?: string
      readonly issues?: readonly string[]
      readonly executable: false
    }

export interface ConfirmResult {
  readonly status: 'confirmed' | 'already_confirmed'
  readonly record: ProposalRecord
  readonly intent: ProposalIntent
  readonly idempotent: boolean
}
