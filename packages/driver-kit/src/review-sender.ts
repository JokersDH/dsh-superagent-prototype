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
  AdmissionRequest,
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
    // Snapshot the admitted input synchronously, BEFORE any admission, reservation or transport work.
    // A caller that mutates its object while the reservation is awaited must not change what the
    // transport receives, and an uncloneable input must not reach the wire at all.
    const snapshot = snapshotInput(input)
    if (snapshot.ok === false) {
      return { sent: false, status: NO_SEND, reason: snapshot.reason, attempts, sends }
    }
    const payload = snapshot.value
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

    // Build the request by adding only the keys that actually have a value. Passing `undefined`
    // for an absent optional property is not the same as omitting it under
    // exactOptionalPropertyTypes, and main compiles its consumers with that rule on.
    const admissionRequest: AdmissionRequest = { gates: mergedGates, caseRef: caseRef ?? null, turn, subject }
    if (grant !== undefined && grant !== null) admissionRequest.grant = grant
    if (hook !== undefined && hook !== null) admissionRequest.hook = hook
    if (transport !== undefined && transport !== null) admissionRequest.transport = transport
    if (audit !== undefined && audit !== null) admissionRequest.audit = audit
    if (profile !== undefined && profile !== null) admissionRequest.profile = profile
    if (hostPolicy !== undefined && hostPolicy !== null) admissionRequest.hostPolicy = hostPolicy
    const admitted = admitSend(admissionRequest)

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
    // Same rule for the consume call: only the bound objects that exist are passed.
    const consumeRequest: { transport?: SenderTransport; hook?: ReservationHook; input?: unknown } = { input: payload }
    if (transport !== undefined && transport !== null) consumeRequest.transport = transport
    if (hook !== undefined && hook !== null) consumeRequest.hook = hook
    const consumed = await consumeSendToken(admitted.token, consumeRequest)
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
/**
 * Prove a value is JSON-safe model input BEFORE anything is reserved.
 *
 * `structuredClone` is the wrong test on its own: it happily clones a BigInt, a NaN and an object
 * whose symbol keys it silently drops. All three would reserve budget and then either fail to
 * serialise or lose required context on the wire. So the payload is checked as the structured JSON a
 * provider would actually receive, and anything that cannot round-trip refuses here.
 *
 * Returns the path of the first offending value so the refusal names where the problem is.
 */
function jsonSafety(value: unknown, path = 'input', seen = new Set<object>()): { ok: true } | { ok: false; reason: string } {
  if (value === null || value === undefined) return { ok: true }
  const kind = typeof value
  if (kind === 'string' || kind === 'boolean') return { ok: true }
  if (kind === 'number') {
    return Number.isFinite(value as number)
      ? { ok: true }
      : { ok: false, reason: `${path} is ${String(value)}, which has no JSON representation, so nothing is reserved or sent` }
  }
  if (kind === 'bigint') {
    return { ok: false, reason: `${path} is a bigint, which has no JSON representation, so nothing is reserved or sent` }
  }
  if (kind === 'function' || kind === 'symbol') {
    return { ok: false, reason: `${path} is a ${kind}, which is not model input, so nothing is reserved or sent` }
  }
  if (kind !== 'object') return { ok: false, reason: `${path} is a ${kind}, which is not model input` }

  const node = value as object
  if (seen.has(node)) return { ok: false, reason: `${path} is a cycle, which has no JSON representation` }
  seen.add(node)
  try {
    // A symbol key cannot be carried by JSON, and an array is just as capable of holding one as an
    // object. Checking only the object branch let an array smuggle a required key past validation.
    const symbolKeys = Object.getOwnPropertySymbols(node)
    if (symbolKeys.length > 0) {
      return { ok: false, reason: `${path} has ${symbolKeys.length} symbol key(s), which JSON cannot carry, so the request would be silently changed` }
    }
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const nested = jsonSafety(node[index], `${path}[${index}]`, seen)
        if (nested.ok === false) return nested
      }
      return { ok: true }
    }
    // Only a plain object survives a JSON round trip unchanged. A Map, Set, Date, RegExp or class
    // instance serialises to `{}` or to a string form, so the provider would receive something quite
    // different from the admitted request - a Map of required context would arrive empty.
    const prototype = Object.getPrototypeOf(node)
    if (prototype !== Object.prototype && prototype !== null) {
      const kind = prototype?.constructor?.name ?? 'non-plain object'
      return { ok: false, reason: `${path} is a ${kind}, which JSON cannot carry faithfully, so nothing is reserved or sent` }
    }
    for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
      const verdict = jsonSafety(nested, `${path}.${key}`, seen)
      if (verdict.ok === false) return verdict
    }
    return { ok: true }
  } finally {
    seen.delete(node)
  }
}

/**
 * Scan the CALLER's object for structure that cannot survive into a JSON payload.
 *
 * This has to run on the source object, not on the clone, because cloning is exactly what destroys
 * the evidence: `structuredClone` drops symbol-keyed properties without a word, and it resolves an
 * accessor to whatever it happens to return. An array can hold a symbol key just as an object can.
 * A getter is refused outright: its value can differ between the read that was validated and the
 * read that was sent, so no claim about the payload would be true.
 */
function scanHazards(value: unknown, path = 'input', seen = new Set<object>()): { ok: true } | { ok: false; reason: string } {
  if (value === null || typeof value !== 'object') return { ok: true }
  const node = value as object
  if (seen.has(node)) return { ok: false, reason: `${path} is a cycle, which has no JSON representation` }
  seen.add(node)
  try {
    const symbolKeys = Object.getOwnPropertySymbols(node)
    if (symbolKeys.length > 0) {
      return { ok: false, reason: `${path} has ${symbolKeys.length} symbol key(s), which JSON cannot carry, so the request would be silently changed` }
    }
    for (const key of Object.getOwnPropertyNames(node)) {
      const descriptor = Object.getOwnPropertyDescriptor(node, key)
      if (descriptor === undefined) continue
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        return { ok: false, reason: `${path}.${key} is an accessor, so its value is not stable between validation and sending` }
      }
      const nested = scanHazards(descriptor.value, `${path}.${key}`, seen)
      if (nested.ok === false) return nested
    }
    return { ok: true }
  } finally {
    seen.delete(node)
  }
}

function snapshotInput(input: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (input === null || input === undefined) return { ok: true, value: input }
  // 1. Reject structure the clone would silently change or drop.
  const hazards = scanHazards(input)
  if (hazards.ok === false) return { ok: false, reason: hazards.reason }
  // 2. Clone, then validate the cloned value as JSON. A getter can return a safe value the first time it
  // is read and something else the second time, so validating the caller's object proves nothing
  // about the value that would actually be sent. The clone is the payload.
  let cloned: unknown
  try {
    cloned = structuredClone(input)
  } catch (error) {
    // A value that cannot be cloned is REFUSED. Passing a placeholder onward would mean reserving
    // budget and sending stand-in text as model input, which is worse than refusing.
    return { ok: false, reason: `the admitted input cannot be snapshotted, so nothing is reserved or sent: ${error instanceof Error ? error.message : String(error)}` }
  }
  const safety = jsonSafety(cloned)
  if (safety.ok === false) return { ok: false, reason: safety.reason }
  if (cloned === null || typeof cloned !== 'object') return { ok: true, value: cloned }
  return { ok: true, value: deepFreeze(cloned) }
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
  // E calls this as `send({ protocolVersion, reservationId, ...turn })`, so the version and the
  // reservation id arrive at the TOP level. A nested descriptor is accepted too, but the flat form
  // is what E actually sends and is therefore the contract that has to work.
  const nested = (request.admission as { facts?: { entry?: { protocolVersion?: string; kind?: string } } } | undefined)?.facts?.entry
  const protocolVersion = (request.protocolVersion as string | undefined) ?? nested?.protocolVersion
  const reservationId = (request.reservationId as string | undefined) ?? null
  const caseRef = (request.caseRef as string | undefined) ?? null
  const input = request.input
  const entryKind = (request.entry as { kind?: string } | undefined)?.kind ?? nested?.kind

  // A reservation identity is required by the agreed envelope; without one there is nothing to echo.
  if (typeof reservationId !== 'string' || reservationId.trim() === '') {
    return {
      protocol: 'review-sender/1',
      sent: false,
      status: NO_SEND,
      reason: 'the request carries no reservationId, so this sender has no reservation identity to keep',
      reservationId,
    }
  }

  if (protocolVersion !== 'review-sender/1' || (entryKind !== undefined && entryKind !== 'b-sender')) {
    return {
      protocol: 'review-sender/1',
      sent: false,
      status: NO_SEND,
      reason: `the request is not a review-sender/1 b-sender call, so this module is not its consumer`,
      reservationId,
    }
  }

  // The module-level entry has no owned transport and no measured bound, so the supported answer is
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
