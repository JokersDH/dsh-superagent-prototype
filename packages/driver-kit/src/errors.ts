/**
 * Stable Driver error taxonomy (WP-03, REL-07 / 04 §8).
 *
 * The `code` values are the frozen contract's DriverErrorCode union; this module only adds a
 * stable `reason` for the local transport layer so tests and diagnostics never match on message
 * text. Nothing here redefines a wire type.
 */
import type { DriverErrorCode } from '../../contracts/src/types.ts'

export type FramingErrorReason =
  | 'invalid_utf8'
  | 'invalid_json'
  | 'frame_too_large'
  | 'buffer_limit'
  | 'trailing_partial_frame'

export class DriverError extends Error {
  readonly code: DriverErrorCode
  readonly reason: string
  readonly detail: Readonly<Record<string, unknown>>

  constructor(code: DriverErrorCode, reason: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'DriverError'
    this.code = code
    this.reason = reason
    this.detail = Object.freeze({ ...detail })
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, reason: this.reason, message: this.message, detail: this.detail }
  }
}

export class FramingError extends DriverError {
  constructor(reason: FramingErrorReason, message: string, detail: Record<string, unknown> = {}) {
    super('protocol_error', reason, message, detail)
    this.name = 'FramingError'
  }
}

/** Classify an unknown thrown value without leaking a non-contract error name upward. */
export function asDriverError(value: unknown): DriverError {
  if (value instanceof DriverError) return value
  const message = value instanceof Error ? value.message : String(value)
  return new DriverError('state_indeterminate', 'unexpected_error', message)
}
