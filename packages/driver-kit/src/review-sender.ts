/**
 * The bounded review-sender adapter E can call directly (wave-09 B4).
 *
 * E must not spawn its own CLI and must not hold a descriptor it can trade for a send. So the only
 * supported entry is this factory: it takes the owned transport, the caller's grant, a ledger audit
 * and a reservation hook, and returns one `send` function. Everything else - admission, one-use
 * token, reservation ordering, transport binding - stays inside this module.
 *
 * The current bounded recipe is BLOCKED (no per-turn ceiling exists and no price surface), so `send`
 * refuses on a real host. That refusal is the product, not a stub: it is the same refusal an admitted
 * call would receive, produced by the same gate, with a fake send count of zero.
 *
 * A caller cannot pass a `costBound` to switch it on. The bound gate is derived from the measured
 * runtime, and a caller-supplied claim is only accepted to make things stricter.
 */
import { admitSend, consumeSendToken, inspectToken } from './send-admission.ts'

import type {
  AdmissionToken,
  GateClaim,
  GateSet,
  GrantAudit,
  GrantIdentity,
  ReservationHook,
  SenderTransport,
  SendOutcome,
} from './send-admission.ts'

/** One measured cost bound. `available:false` means the runtime cannot express a ceiling. */
export type CostBound = { available: boolean; reason?: string }

/** What a caller supplies to bind the sender. */
export type ReviewSenderInput = {
  transport?: SenderTransport
  hook?: ReservationHook
  grant?: GrantIdentity
  audit?: GrantAudit
  costBound?: CostBound | null
  profile?: Record<string, unknown> | null
  hostPolicy?: Record<string, unknown> | null
}

/** One bounded send attempt. */
export type ReviewSendInput = {
  caseRef?: string | null
  turn?: number
  subject?: string | null
  input?: unknown
  gates?: GateSet
  modelIdentity?: { model: string; modelProvider: string } | null
}

/** The result of a send attempt. */
export type ReviewSendResult = {
  sent: boolean
  status: string
  reason: string | null
  problems?: string[]
  gates?: Record<string, GateClaim>
  attempts: number
  sends: number
  tokenState?: { issued: boolean; claimed: boolean }
}

/** A read-only description of what the sender is bound to. */
export type ReviewSenderDescription = {
  protocol: 'review-sender/1'
  ownsTransport: boolean
  grantId: string | null
  owner: string | null
  costBoundAvailable: boolean
  attempts: number
  sends: number
  notClaimed: string[]
}

/** The sender E is allowed to use. */
export type ReviewSender = { send(input?: ReviewSendInput): Promise<ReviewSendResult>; describe(): ReviewSenderDescription }

/** Sentinel returned whenever no send happened. Kept stable so a consumer can assert it. */
export const NO_SEND = 'no_send'

/**
 * Create the one sender E may use.
 *
 * @param transport  the owned transport; the only object a token will authorise
 * @param hook       the caller's persistent reservation hook
 * @param grant      the caller's complete grant identity
 * @param audit      the caller's ledger audit callback for its own grant
 * @param costBound  a measured bound description, or null when none exists
 */
export function createReviewSender(input: ReviewSenderInput = {}): ReviewSender {
  const { transport, hook, grant, audit, costBound = null, profile = null, hostPolicy = null } = input
  if (!transport || typeof transport.startTurn !== 'function') throw new Error('createReviewSender needs the owned transport')
  if (!hook || typeof hook.reserve !== 'function') throw new Error('createReviewSender needs the reservation hook')

  let attempts = 0
  let sends = 0

  /**
   * Attempt one bounded send.
   *
   * Returns a result object rather than throwing for ordinary refusals, because E needs to render the
   * reason. The result always states whether anything was sent.
   */
  async function send(attempt: ReviewSendInput = {}): Promise<ReviewSendResult> {
    const { caseRef, turn = 1, subject = null, input, gates = {}, modelIdentity = null } = attempt
    // Snapshot the admitted input synchronously. A caller that mutates its object while the
    // reservation is awaited must not be able to change what the transport receives.
    const payload = snapshotInput(input)
    attempts += 1

    // The bound gate is the measured runtime, never a caller assertion. A caller may only make the
    // picture stricter by reporting a bound as unavailable.
    const bound = costBound !== null && typeof costBound === 'object' ? costBound : { available: false, reason: 'no per-turn bound and no price surface exist on this runtime' }
    // The measured bound decides. A caller can only make this stricter (by reporting the bound as
    // unavailable), never switch it on: otherwise a claim would be spending authority.
    const callerSaysUnavailable = gates?.cost_bound?.satisfied === false
    const costBoundGate =
      bound.available === true && !callerSaysUnavailable
        ? { satisfied: true, reason: bound.reason ?? 'measured' }
        : { satisfied: false, reason: callerSaysUnavailable ? (gates?.cost_bound?.reason ?? 'caller reported the bound unavailable') : (bound.reason ?? 'no measured bound was supplied') }

    const mergedGates = {
      ...gates,
      cost_bound: costBoundGate,
      isolation: gates?.isolation ?? { satisfied: false, reason: 'host policy was not supplied' },
      reservation: gates?.reservation ?? { satisfied: Boolean(hook), reason: hook ? null : 'no reservation hook' },
      model_identity: modelIdentity
        ? { satisfied: true, evidence: { model: modelIdentity.model, modelProvider: modelIdentity.modelProvider } }
        : gates?.model_identity ?? { satisfied: false, reason: 'no model identity was measured' },
    }

    const admitted = admitSend({
      grant,
      gates: mergedGates,
      hook,
      transport,
      caseRef: caseRef ?? null,
      turn,
      subject,
      profile,
      hostPolicy,
      audit,
    })

    if (admitted.verdict !== 'ADMITTED') {
      return {
        sent: false,
        status: NO_SEND,
        reason: admitted.refusal.problems[0] ?? 'admission refused',
        problems: admitted.refusal.problems,
        gates: admitted.refusal.gates,
        attempts,
        sends,
      }
    }

    // The admitted input is snapshotted here and the SAME reference is what gets sent, so a caller
    // mutating it while the reservation is awaited cannot change what the transport receives.
    const consumed = await consumeSendToken(admitted.token, { transport, hook, input: payload })
    if (consumed.sent === true) sends += 1
    return {
      sent: consumed.sent === true,
      status: consumed.sent === true ? 'sent' : NO_SEND,
      reason: consumed.sent === true ? null : (consumed.reason ?? null),
      attempts,
      sends,
      tokenState: inspectToken(admitted.token as AdmissionToken),
    }
  }

  /** Read-only view for a consumer that needs to show what the sender is bound to. */
  function describe(): ReviewSenderDescription {
    return {
      protocol: 'review-sender/1',
      ownsTransport: true,
      grantId: grant?.grantId ?? null,
      owner: grant?.owner ?? null,
      costBoundAvailable: costBound?.available === true,
      attempts,
      sends,
      notClaimed: [
        'that a real vendor turn will succeed',
        'that native stop or reconciliation were exercised',
        'that a caller-supplied descriptor can unlock a send',
      ],
    }
  }

  return { send, describe }
}

/**
 * Take a frozen copy of the admitted input.
 *
 * A structured clone is used so nested objects cannot be mutated through the caller's reference; the
 * copy is frozen so this module cannot mutate it either.
 */
function snapshotInput(input: unknown): unknown {
  if (input === null || input === undefined) return input
  if (typeof input !== 'object') return input
  try {
    return deepFreeze(structuredClone(input))
  } catch {
    // A value that cannot be cloned is refused rather than passed through by reference.
    return Object.freeze({ refused: 'the admitted input could not be snapshotted, so nothing may be sent' })
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}

/**
 * The module-level consumer entry E calls.
 *
 * E resolves a sender by module path and export name, so a factory alone is not a consumer entry.
 * This entry takes E's request shape, refuses by default because the bounded recipe is blocked, and
 * never spawns a CLI of its own. It is deliberately inert: without a measured bound and an owned
 * transport it reports why, which is the supported answer today.
 */
export async function send(request: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { admission: envelope, reservationId = null, input, caseRef = null } = request
  const facts = (envelope as { facts?: { entry?: { owner?: string; kind?: string; protocolVersion?: string } } } | undefined)?.facts?.entry

  // Refuse anything that is not the agreed B-sender binding rather than guessing an alternative.
  if (!facts || facts.protocolVersion !== 'review-sender/1' || facts.kind !== 'b-sender') {
    return {
      protocol: 'review-sender/1',
      sent: false,
      status: NO_SEND,
      reason: 'the request does not name a review-sender/1 b-sender entry, so this module is not the consumer for it',
      reservationId,
    }
  }

  // There is no owned transport and no measured bound in a module-level call, so the honest answer is
  // a refusal that names both. A caller cannot supply either through this entry.
  return {
    protocol: 'review-sender/1',
    sent: false,
    status: NO_SEND,
    reason: 'no owned transport and no measured per-turn bound were supplied to the module-level entry, so no send is possible',
    reservationId,
    caseRef,
    inputAccepted: input !== undefined,
    boundAvailable: false,
    notClaimed: [
      'that a real vendor turn will succeed',
      'that this entry can be unlocked by a descriptor or an override',
    ],
  }
}
