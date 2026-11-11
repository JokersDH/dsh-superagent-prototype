/**
 * One send-admission path shared by B and E (wave-08 B4).
 *
 * Before this module there were two chains: B's admission always audited B's own grant, while E's
 * guarded send spawned its own CLI. Two chains means the refusal E sees is not the refusal B proved,
 * and whichever chain is weaker becomes the real gate.
 *
 * So the contract is inverted here:
 *
 *   - the CALLER supplies the complete grant identity and scope. Nothing defaults to a role's own
 *     grant, because a default is exactly how B's grant ended up gating E's decision.
 *   - this module is the only place that can issue permission to send. A caller that does not hold
 *     a token issued here cannot send through the owned transport.
 *   - authorisation is a live object identity, not a value. A string descriptor, a JSON blob or a
 *     hand-built lookalike object is refused, because "the descriptor said allowed" is not authority.
 *   - a refused result carries no token and no launch function, so a caller cannot smuggle execution
 *     out of a refusal.
 *
 * The transport itself stays owned by this role; E supplies only a reservation hook. The hook is
 * invoked before the token is consumed, so a reservation failure cannot leave a send in flight.
 */
import { createHash } from 'node:crypto'

/** Tokens issued by this module. Membership is the only thing that authorises a consume. */
const ISSUED = new WeakSet()

/** Reasons a grant identity is not usable, checked before any other gate. */
function validateGrant(grant) {
  const problems = []
  if (grant === undefined || grant === null) {
    problems.push('no grant identity was supplied: admission never defaults to a role-owned grant')
    return problems
  }
  if (typeof grant !== 'object') {
    problems.push(`the grant identity must be an object, got ${typeof grant}`)
    return problems
  }
  if (typeof grant.grantId !== 'string' || grant.grantId.trim() === '') problems.push('grantId is required')
  if (typeof grant.owner !== 'string' || grant.owner.trim() === '') problems.push('owner is required, so a refusal names whose grant it is')
  if (!Number.isInteger(grant.limit) || grant.limit < 1) problems.push('limit must be a positive integer')
  if (typeof grant.ledgerPath !== 'string' || grant.ledgerPath.trim() === '') problems.push('ledgerPath is required')
  if (grant.scope !== undefined && typeof grant.scope !== 'string') problems.push('scope must be a string when supplied')
  return problems
}

/**
 * Admit one send.
 *
 * `gates` is supplied by the caller as the result of the real measurements it performed (identity,
 * isolation, cost bound, ledger). This function does not re-measure them; it enforces that every one
 * of them is present and satisfied, and it refuses when a gate is merely absent. An absent gate is
 * never treated as passed.
 */
export function admitSend(request = {}) {
  const { grant, gates = {}, hook, caseRef = null, turn = 1 } = request
  const problems = []

  problems.push(...validateGrant(grant))

  const REQUIRED_GATES = ['model_identity', 'cost_bound', 'isolation', 'reservation']
  const gateStates = {}
  for (const name of REQUIRED_GATES) {
    const gate = gates[name]
    if (gate === undefined) {
      // A missing gate is a refusal, not an empty slot. Setting the state without recording the
      // problem would let an empty `gates` object admit a send, which is the whole failure mode.
      const reason = `gate "${name}" was not supplied, so it cannot be treated as passed`
      gateStates[name] = { satisfied: false, reason }
      problems.push(`${name}: ${reason}`)
      continue
    }
    // A gate must state its own satisfaction explicitly. An empty object is not a pass.
    if (typeof gate.satisfied !== 'boolean') {
      const reason = `gate "${name}" did not state satisfied as a boolean`
      gateStates[name] = { satisfied: false, reason }
      problems.push(`${name}: ${reason}`)
      continue
    }
    gateStates[name] = { satisfied: gate.satisfied, reason: gate.reason ?? null, evidence: gate.evidence ?? null }
    if (!gate.satisfied) problems.push(`${name}: ${gate.reason ?? 'not satisfied'}`)
  }

  // The model/provider must be real values, not placeholders: a missing identity is a refusal even
  // when some caller marks the gate satisfied.
  const model = gates.model_identity?.evidence?.model
  const provider = gates.model_identity?.evidence?.modelProvider
  if (gateStates.model_identity?.satisfied && (typeof model !== 'string' || model === '' || typeof provider !== 'string' || provider === '')) {
    problems.push('model_identity claimed satisfied but no model/provider values were supplied')
    gateStates.model_identity = { ...gateStates.model_identity, satisfied: false, reason: 'no model/provider values' }
  }

  // A reservation hook is required. Without it a billable send could happen with nothing recorded.
  if (hook === undefined || hook === null || typeof hook.reserve !== 'function') {
    problems.push('no reservation hook was supplied: a billable send must reserve before it is sent')
    gateStates.reservation = { satisfied: false, reason: 'no reservation hook' }
  }

  if (problems.length > 0) {
    // A refusal is deliberately inert: no token, no launch function, nothing executable.
    return {
      protocol: 'send-admission/1',
      verdict: 'REFUSED',
      refusal: {
        grantId: typeof grant?.grantId === 'string' ? grant.grantId : null,
        owner: typeof grant?.owner === 'string' ? grant.owner : null,
        problems,
        gates: gateStates,
      },
      // Present and null so a consumer can assert the absence rather than a missing key.
      token: null,
      launch: null,
      consumable: false,
    }
  }

  const token = Object.freeze({
    protocol: 'send-admission-token/1',
    grantId: grant.grantId,
    owner: grant.owner,
    caseRef,
    turn,
    issuedAt: new Date().toISOString(),
    digest: createHash('sha256')
      .update(JSON.stringify([grant.grantId, grant.owner, grant.limit, caseRef, turn, model, provider]))
      .digest('hex'),
  })
  ISSUED.add(token)
  return {
    protocol: 'send-admission/1',
    verdict: 'ADMITTED',
    refusal: null,
    token,
    launch: null,
    consumable: true,
  }
}

/**
 * Consume an admission token and send.
 *
 * This is the only supported way to reach the owned transport. It refuses:
 *   - a string descriptor, a JSON blob or any value that is not a token issued here
 *   - a structurally identical object that was not issued here (forged lookalike)
 *   - a token when the reservation hook refuses
 *
 * The transport is injected so this module holds no second implementation of the wire.
 */
export async function consumeSendToken(candidate, { transport, hook, input } = {}) {
  if (typeof candidate === 'string') {
    return { sent: false, reason: 'a string descriptor is not authority: only a token issued by admitSend can authorise a send' }
  }
  if (candidate === null || typeof candidate !== 'object') {
    return { sent: false, reason: 'no admission token was supplied' }
  }
  if (!ISSUED.has(candidate)) {
    return { sent: false, reason: 'the supplied object was not issued by admitSend, so it carries no authority' }
  }
  if (!transport || typeof transport.startTurn !== 'function') {
    return { sent: false, reason: 'no owned transport was supplied; this module does not open a second wire' }
  }
  if (!hook || typeof hook.reserve !== 'function') {
    return { sent: false, reason: 'the reservation hook disappeared between admission and send' }
  }

  // Reserve immediately before consuming, so a reservation failure cannot leave a send in flight.
  let reservation
  try {
    reservation = await hook.reserve({
      grantId: candidate.grantId,
      owner: candidate.owner,
      caseRef: candidate.caseRef,
      turn: candidate.turn,
      tokenDigest: candidate.digest,
    })
  } catch (error) {
    return { sent: false, reason: `reservation threw, so nothing was sent: ${String(error?.message ?? error)}` }
  }
  if (!reservation || reservation.admitted !== true) {
    return { sent: false, reason: `reservation refused: ${reservation?.reason ?? 'no admission returned'}` }
  }

  const result = await transport.startTurn({ input, hook, identity: { grantId: candidate.grantId, tokenDigest: candidate.digest } })
  return { sent: true, reservation, result }
}

/** Was this object issued here? For assertions and diagnostics; it never authorises by itself. */
export function isIssuedToken(candidate) {
  return typeof candidate === 'object' && candidate !== null && ISSUED.has(candidate)
}
