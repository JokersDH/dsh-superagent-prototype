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
export function createReviewSender({ transport, hook, grant, audit, costBound = null, profile = null, hostPolicy = null } = {}) {
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
  async function send({ caseRef, turn = 1, subject = null, input, gates = {}, modelIdentity = null } = {}) {
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
        : { satisfied: false, reason: callerSaysUnavailable ? gates.cost_bound.reason ?? 'caller reported the bound unavailable' : bound.reason ?? 'no measured bound was supplied' }

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

    const consumed = await consumeSendToken(admitted.token, { transport, hook, input })
    if (consumed.sent === true) sends += 1
    return {
      sent: consumed.sent === true,
      status: consumed.sent === true ? 'sent' : NO_SEND,
      reason: consumed.sent === true ? null : consumed.reason,
      attempts,
      sends,
      tokenState: inspectToken(admitted.token),
    }
  }

  /** Read-only view for a consumer that needs to show what the sender is bound to. */
  function describe() {
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
