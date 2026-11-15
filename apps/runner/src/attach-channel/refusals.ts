/**
 * Typed channel failure surface for consumers (wave-29 I14).
 *
 * B's transport currently throws `RunnerLinkError(code, …)` with a narrow code union, so forwarding a
 * channel refusal through it fails to compile (TS2345) and invites an unchecked cast or an
 * `unknown_outcome` fallback that loses the real meaning.
 *
 * `AttachFailureCode` is the complete set a consumer can actually receive from this module. A
 * consumer should widen its own error-code union with this type alias (no cast) and forward
 * `toAttachFailure(error)` details, which stay bounded and secret-free.
 */
import type { CoordinatorChannelFailure } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { CoordinatorChannelError, NativeWriteDenied } from './errors.ts'
import type { AttachRefusal } from './attach.ts'

/** Everything a channel consumer can observe, including the authoritative denial. */
export type AttachFailureCode = CoordinatorChannelFailure | 'native_write_denied'

export type AttachFailure = {
  readonly code: AttachFailureCode
  /** Stable machine reason, e.g. `generation_mismatch`; never a free-form detail. */
  readonly reason: string
  /** Bounded, secret-free text safe to surface or log. */
  readonly message: string
}

const MAX_MESSAGE = 200

function bounded(message: string): string {
  return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message
}

/** Map one thrown channel error to a typed failure. Unknown errors never keep their raw message. */
export function toAttachFailure(error: unknown): AttachFailure {
  if (error instanceof CoordinatorChannelError)
    return { code: error.code, reason: error.reason, message: bounded(error.message) }
  if (error instanceof NativeWriteDenied) return { code: 'native_write_denied', reason: error.reason, message: bounded(error.message) }
  return { code: 'protocol_error', reason: 'unexpected_error', message: 'unexpected channel failure' }
}

/** Map an adapter refusal (poll/reply from a stale or foreign connection) to the same surface. */
export function refusalFailure(refused: AttachRefusal): AttachFailure {
  switch (refused) {
    case 'stale_connection':
      return { code: 'stale_connection', reason: 'stale_connection', message: 'connection is not the live lease' }
    case 'identity_mismatch':
      return { code: 'identity_mismatch', reason: 'producer_mismatch', message: 'connection does not match the registered producer' }
    case 'closed':
      return { code: 'closed', reason: 'module_closed', message: 'channel is closed' }
  }
}
