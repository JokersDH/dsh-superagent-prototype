export type ProposalErrorCode =
  | 'invalid_proposal'
  | 'source_mismatch'
  | 'cross_project'
  | 'scope_escalation'
  | 'contract_stale'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'proposal_expired'
  | 'proposal_stale'
  | 'proposal_mutated'
  | 'proposal_not_pending'
  | 'barrier_blocked'
  | 'stale_authorization'
  | 'invalid_expiry'

export class ProposalError extends Error {
  readonly code: ProposalErrorCode
  readonly details: Readonly<Record<string, unknown>>
  constructor(code: ProposalErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'ProposalError'
    this.code = code
    this.details = details
  }
}
