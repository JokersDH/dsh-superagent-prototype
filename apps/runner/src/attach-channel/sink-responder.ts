/**
 * Guard-bound in-process coordinator responder (wave-29 I3).
 *
 * `runner-service` has an in-process lane where a FactSink answers the channel directly instead of a
 * remote coordinator. That lane must not turn "the attempt is open" or "a fact sink exists" into a
 * native-write approval: recording facts and admitting a native write are different authorities.
 *
 * This responder wires the three original answers and makes the native guard **required**:
 *
 * - `facts.record` answers facts (original A/public sink, its own idempotency);
 * - `payloads.read` answers immutable payload references (original Store/responder owns content);
 * - `guardNativeWrite` is consulted on **every** native intent, for the original command, and is the
 *   only thing that can produce `allowed: true`.
 *
 * Missing guard (undefined at runtime), a denial, or a guard that throws all fail closed to
 * `allowed: false`; nothing is cached, so a later intent always needs its own decision. The reply
 * always echoes the request's own `frame.id` correlation, never the business command id.
 */
import type {
  CoordinatorChannelReply,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import type { CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../../packages/contracts/src/types.ts'

export type CoordinatorSinkResponderOptions = {
  /** Original durable fact sink. A fact lane without a sink cannot acknowledge anything. */
  readonly facts: { record(fact: CriticalFact): Promise<DurableReceipt> }
  /** Original immutable payload reader. Content and permission remain the Store's. */
  readonly payloads: { read(reference: string): Promise<Json> }
  /**
   * The current main/Broker fresh guard for one original native intent. Required: this responder has
   * no policy of its own and cannot allow a native write without a genuine current decision.
   */
  readonly guardNativeWrite: (command: RunnerCommand) => Promise<boolean>
}

export type CoordinatorSinkResponder = (request: CoordinatorChannelRequest) => Promise<CoordinatorChannelReply | undefined>

const ACK_FAILED_REASON = 'sink_unavailable'

export function createCoordinatorSinkResponder(options: CoordinatorSinkResponderOptions): CoordinatorSinkResponder {
  const guard = options.guardNativeWrite
  return async request => {
    switch (request.type) {
      case 'fact': {
        try {
          const receipt = await options.facts.record(request.fact)
          return { v: 1, type: 'receipt', id: request.fact.factId, factId: request.fact.factId, receipt }
        } catch {
          // A refused/failed durable write is not an acknowledgement.
          return { v: 1, type: 'ack-failed', id: request.fact.factId, factId: request.fact.factId, reason: ACK_FAILED_REASON }
        }
      }
      case 'payload-read': {
        try {
          const value = await options.payloads.read(request.reference)
          return { v: 1, type: 'payload', id: request.requestId, requestId: request.requestId, value }
        } catch {
          // No negative payload reply exists on the wire: leave the read to its bounded deadline.
          return undefined
        }
      }
      case 'native-write-intent': {
        if (request.command.kind !== 'answer') return { v: 1, type: 'write-admission', id: request.id, allowed: false }
        // Fail closed when no guard was wired at all, the guard denies, or the guard cannot answer.
        if (typeof guard !== 'function') return { v: 1, type: 'write-admission', id: request.id, allowed: false }
        let allowed = false
        try {
          allowed = (await guard(request.command)) === true
        } catch {
          allowed = false
        }
        // Echo this intent's own correlation; a success never becomes a reusable grant.
        return { v: 1, type: 'write-admission', id: request.id, allowed }
      }
      default:
        return undefined
    }
  }
}
