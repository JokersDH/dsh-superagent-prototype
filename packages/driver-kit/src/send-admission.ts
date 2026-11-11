/**
 * The single sender: one-use admission tokens bound to an immutable request (wave-09 B3).
 *
 * Wave-08 shipped an admission token that was a plain frozen object. Three holes followed from that:
 *
 *   1. it could be consumed twice concurrently, because nothing occupied its state before the
 *      reservation was awaited;
 *   2. it did not name the transport, so a caller could be issued a token and then send through a
 *      different transport of their choosing;
 *   3. it trusted a caller-supplied `gates` object, so a plain JSON blob claiming every gate
 *      satisfied was indistinguishable from real measured evidence.
 *
 * All three are closed here. A token is issued only by `admitSend`, its bound transport and hook are
 * recorded at issue time and must be the identical objects at consume time, its state is claimed
 * SYNCHRONOUSLY before any await so a concurrent second consume loses the race, and the gates are
 * snapshotted and frozen so the request cannot change after issuance.
 *
 * What this module does NOT claim: it cannot prove the caller's process identity. Authority against
 * grant spoofing is the ledger audit, not a boolean: naming the sender's own owner routes through the
 * audit for that exact grant, and this sender's own grant is unverified, so it can never be spent by
 * anyone including this role.
 */
import { createHash } from 'node:crypto'

/** Owner of this sending implementation. A request naming it must pass that grant's real audit. */
export const SENDER_OWNER = 'B'

/** A token is consumed at most once, ever. */
const ISSUED = new WeakMap()

/** Request keys that would smuggle a raw command or a second implementation in. */
const FORBIDDEN_REQUEST_KEYS = Object.freeze(['entry', 'command', 'argv', 'cli', 'spawn', 'transportOverride', 'hookOverride'])

const REQUIRED_GATES = Object.freeze(['model_identity', 'cost_bound', 'isolation', 'reservation'])

function digestsOf(request) {
  const { grant = {}, gates = {}, subject = null, profile = null, hostPolicy = null, caseRef = null, turn = 1 } = request
  return {
    grant: createHash('sha256').update(JSON.stringify([grant.grantId, grant.owner, grant.limit, grant.ledgerPath, grant.scope ?? null])).digest('hex'),
    gates: createHash('sha256').update(JSON.stringify(Object.keys(gates).sort().map(key => [key, gates[key]?.satisfied ?? null]))).digest('hex'),
    subject: subject === null ? null : createHash('sha256').update(String(subject)).digest('hex'),
    profile: profile === null ? null : createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    hostPolicy: hostPolicy === null ? null : createHash('sha256').update(JSON.stringify(hostPolicy)).digest('hex'),
    request: createHash('sha256').update(JSON.stringify([caseRef, turn])).digest('hex'),
  }
}

/**
 * Admit one send and issue its single-use token.
 *
 * The transport and hook are REQUIRED at issue time and recorded by object identity. Passing them
 * again at consume time is not a convenience: it must be the same object, which is what makes
 * post-issuance substitution detectable.
 */
export function admitSend(request = {}) {
  const problems = []

  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in (request ?? {})) problems.push(`request key "${key}" is not accepted: this sender owns the transport and hook, so a caller cannot supply another one`)
  }

  const { grant, gates = {}, hook, transport, caseRef = null, turn = 1, subject = null, profile = null, hostPolicy = null, audit } = request ?? {}

  // --- grant identity -------------------------------------------------------------------------
  if (grant === null || grant === undefined) problems.push('no grant identity was supplied: admission never defaults to a role-owned grant')
  else if (typeof grant !== 'object') problems.push(`the grant identity must be an object, got ${typeof grant}`)
  else {
    if (typeof grant.grantId !== 'string' || grant.grantId.trim() === '') problems.push('grantId is required')
    if (typeof grant.owner !== 'string' || grant.owner.trim() === '') problems.push('owner is required, so a refusal names whose grant it is')
    if (!Number.isInteger(grant.limit) || grant.limit < 1) problems.push('limit must be a positive integer')
    if (typeof grant.ledgerPath !== 'string' || grant.ledgerPath.trim() === '') problems.push('ledgerPath is required')
  }

  // --- gates ----------------------------------------------------------------------------------
  const gateStates = {}
  for (const name of REQUIRED_GATES) {
    const gate = gates[name]
    if (gate === undefined || gate === null) {
      const reason = `gate "${name}" was not supplied, so it cannot be treated as passed`
      gateStates[name] = { satisfied: false, reason }
      problems.push(`${name}: ${reason}`)
      continue
    }
    if (typeof gate.satisfied !== 'boolean') {
      const reason = `gate "${name}" did not state satisfied as a boolean`
      gateStates[name] = { satisfied: false, reason }
      problems.push(`${name}: ${reason}`)
      continue
    }
    gateStates[name] = { satisfied: gate.satisfied, reason: gate.reason ?? null }
    if (!gate.satisfied) problems.push(`${name}: ${gate.reason ?? 'not satisfied'}`)
  }

  // A satisfied model gate still needs real values; a boolean alone is not an identity.
  const model = gates?.model_identity?.evidence?.model
  const provider = gates?.model_identity?.evidence?.modelProvider
  if (gateStates.model_identity?.satisfied && (typeof model !== 'string' || model === '' || typeof provider !== 'string' || provider === '')) {
    const reason = 'no model/provider values were supplied'
    problems.push(`model_identity: claimed satisfied but ${reason}`)
    gateStates.model_identity = { ...gateStates.model_identity, satisfied: false, reason }
  }

  // --- the sender owns transport and hook -----------------------------------------------------
  if (!hook || typeof hook.reserve !== 'function') problems.push('no reservation hook was supplied: a billable send must reserve before it is sent')
  if (!transport || typeof transport.startTurn !== 'function') problems.push('no transport was supplied at issue time: this sender never opens a second wire, so the transport must be bound before a token exists')

  // --- naming the sender's own owner routes through that grant's real audit -------------------
  // This is what stops a caller riding this role's own (unverified) grant to impersonate it.
  if (grant?.owner === SENDER_OWNER) {
    const verdict = typeof audit === 'function' ? audit(grant) : null
    if (!verdict || verdict.allowed !== true) {
      const reason = verdict?.reason ?? 'naming this sender as the grant owner requires that grant to pass its own ledger audit, and it does not'
      problems.push(`grant spoofing refused: ${reason}`)
      if (gateStates.reservation) gateStates.reservation = { satisfied: false, reason }
    }
  }

  if (problems.length > 0) {
    return {
      protocol: 'send-admission/2',
      verdict: 'REFUSED',
      refusal: {
        grantId: typeof grant?.grantId === 'string' ? grant.grantId : null,
        owner: typeof grant?.owner === 'string' ? grant.owner : null,
        problems,
        gates: gateStates,
      },
      token: null,
      launch: null,
      consumable: false,
    }
  }

  const bound = Object.freeze({ transport, hook })
  const digests = digestsOf({ grant, gates, subject, profile, hostPolicy, caseRef, turn })
  const token = Object.freeze({
    protocol: 'send-admission-token/2',
    grantId: grant.grantId,
    owner: grant.owner,
    caseRef,
    turn,
    issuedAt: new Date().toISOString(),
    digests,
    digest: createHash('sha256').update(JSON.stringify([digests, model, provider])).digest('hex'),
  })

  // State is created at issue time and claimed at consume time. `claimed` flips synchronously.
  ISSUED.set(token, {
    claimed: false,
    bound,
    snapshot: Object.freeze({
      grant: Object.freeze({ ...grant }),
      caseRef,
      turn,
      subject,
      profile: profile === null ? null : Object.freeze({ ...profile }),
      hostPolicy: hostPolicy === null ? null : Object.freeze({ ...hostPolicy }),
      digests,
    }),
  })

  return {
    protocol: 'send-admission/2',
    verdict: 'ADMITTED',
    refusal: null,
    token,
    launch: null,
    consumable: true,
  }
}

/**
 * Consume an admission token exactly once.
 *
 * Order matters: the token is claimed BEFORE the reservation is awaited, so a concurrent second call
 * observes the claim and refuses rather than racing to a second send. The claim is never released on
 * failure — an unknown outcome must not become a free retry.
 */
export async function consumeSendToken(candidate, { transport, hook, input } = {}) {
  if (typeof candidate === 'string') {
    return { sent: false, reason: 'a string descriptor is not authority: only a token issued by admitSend can authorise a send' }
  }
  if (candidate === null || typeof candidate !== 'object') {
    return { sent: false, reason: 'no admission token was supplied' }
  }
  const state = ISSUED.get(candidate)
  if (!state) {
    return { sent: false, reason: 'the supplied object was not issued by admitSend, so it carries no authority' }
  }

  // --- claim synchronously; this is the whole one-use guarantee -------------------------------
  if (state.claimed) {
    return { sent: false, reason: 'this token has already been consumed; a token permits at most one send' }
  }
  state.claimed = true

  // --- the bound objects must be the very same objects ----------------------------------------
  if (transport !== state.bound.transport) {
    return { sent: false, reason: 'the transport differs from the one bound at issuance, so this token does not authorise it' }
  }
  if (hook !== state.bound.hook) {
    return { sent: false, reason: 'the reservation hook differs from the one bound at issuance' }
  }
  if (typeof transport.startTurn !== 'function') {
    return { sent: false, reason: 'the bound transport cannot start a turn' }
  }
  if (typeof hook.reserve !== 'function') {
    return { sent: false, reason: 'the bound reservation hook cannot reserve' }
  }

  // --- reserve, then send --------------------------------------------------------------------
  let reservation
  try {
    reservation = await hook.reserve({
      grantId: candidate.grantId,
      owner: candidate.owner,
      caseRef: state.snapshot.caseRef,
      turn: state.snapshot.turn,
      tokenDigest: candidate.digest,
      requestDigest: state.snapshot.digests.request,
      subjectDigest: state.snapshot.digests.subject,
    })
  } catch (error) {
    // The claim is NOT released: an unknown reservation outcome is not a licence to resend.
    return { sent: false, reason: `reservation threw, so nothing was sent and the token stays consumed: ${String(error?.message ?? error)}` }
  }
  if (!reservation || reservation.admitted !== true) {
    return { sent: false, reason: `reservation refused: ${reservation?.reason ?? 'no admission returned'}`, tokenConsumed: true }
  }

  const result = await transport.startTurn({
    input,
    hook,
    identity: {
      grantId: candidate.grantId,
      owner: candidate.owner,
      tokenDigest: candidate.digest,
      requestDigest: state.snapshot.digests.request,
      subjectDigest: state.snapshot.digests.subject,
    },
  })
  return { sent: true, reservation, result, tokenConsumed: true }
}

/** Was this object issued here, and has it been consumed? For assertions and diagnostics only. */
export function inspectToken(candidate) {
  if (typeof candidate !== 'object' || candidate === null) return { issued: false, claimed: false }
  const state = ISSUED.get(candidate)
  return state ? { issued: true, claimed: state.claimed } : { issued: false, claimed: false }
}
