/**
 * Bounded, secret-free channel failures.
 *
 * A channel failure names *how the local promise settled*, never what the payload contained. Messages
 * carry at most bounded request IDs and counters; no fact body, payload value, credential, stack or
 * private absolute path is ever interpolated.
 */
import type { CoordinatorChannelFailure } from '../../../../packages/contracts/src/coordinator-channel.ts'

export class CoordinatorChannelError extends Error {
  readonly code: CoordinatorChannelFailure
  /** Stable machine reason, e.g. `generation_mismatch`. Never a free-form detail. */
  readonly reason: string

  constructor(code: CoordinatorChannelFailure, reason: string, message?: string) {
    super(message ?? `${code}:${reason}`)
    this.name = 'CoordinatorChannelError'
    this.code = code
    this.reason = reason
  }
}

/**
 * An authoritative negative admission answer from the current coordinator guard.
 *
 * This is a *decision*, not a channel fault: it is definitely not allowed to write, and the caller
 * may later ask again through the same original command. It is deliberately not a
 * `CoordinatorChannelError` code, because `indeterminate`/`timeout` mean the opposite kind of thing
 * (an unknown outcome that must not be replayed).
 */
export class NativeWriteDenied extends Error {
  readonly reason = 'native_write_denied'
  readonly commandId: string

  constructor(commandId: string) {
    super(`native write denied for ${commandId}`)
    this.name = 'NativeWriteDenied'
    this.commandId = commandId
  }
}

export function isCoordinatorChannelError(value: unknown): value is CoordinatorChannelError {
  return value instanceof CoordinatorChannelError
}
