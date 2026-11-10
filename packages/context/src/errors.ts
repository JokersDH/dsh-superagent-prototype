export type ContextErrorCode =
  | 'invalid_input'
  | 'grant_gateway'
  | 'grant_purpose'
  | 'grant_project'
  | 'grant_expired'
  | 'grant_unconfirmed'
  | 'contract_scope'
  | 'contract_stale'
  | 'unsupported_port'
  | 'denied_path'
  | 'cross_project'

/** Fatal request refusal. Insufficient or stale data is reported in the bundle instead. */
export class ContextError extends Error {
  readonly code: ContextErrorCode
  readonly details: Readonly<Record<string, unknown>>
  constructor(code: ContextErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message)
    this.name = 'ContextError'
    this.code = code
    this.details = details
  }
}

export type ContextSourceFailure =
  | 'missing'
  | 'unreadable'
  | 'binary'
  | 'oversized'
  | 'denied_path'
  | 'cross_project'
  | 'stale'

export class ContextSourceAccessError extends Error {
  readonly reason: ContextSourceFailure
  constructor(reason: ContextSourceFailure, message: string) {
    super(message)
    this.name = 'ContextSourceAccessError'
    this.reason = reason
  }
}
