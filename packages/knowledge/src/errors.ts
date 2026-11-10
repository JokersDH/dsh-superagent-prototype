export type DecisionErrorCode =
  | 'invalid_content'
  | 'invalid_scope'
  | 'invalid_version'
  | 'cross_project'
  | 'source_missing'
  | 'source_project_mismatch'
  | 'not_explicit_user_confirmation'
  | 'authorization_not_shareable'
  | 'scope_escalation'
  | 'supersede_missing'
  | 'supersede_inactive'
  | 'not_found'
  | 'inactive'
  | 'invalid_cursor'
  | 'conflict'

export class DecisionError extends Error {
  readonly code: DecisionErrorCode
  readonly details: Readonly<Record<string, unknown>>
  constructor(code: DecisionErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'DecisionError'
    this.code = code
    this.details = details
  }
}

export type DecisionConflictCode = 'payload_mismatch' | 'stale_version' | 'revoked' | 'immutable' | 'invalid_version'

export class DecisionConflict extends Error {
  readonly code: DecisionConflictCode
  constructor(code: DecisionConflictCode, message: string) {
    super(message)
    this.name = 'DecisionConflict'
    this.code = code
  }
}
