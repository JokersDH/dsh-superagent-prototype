/**
 * Trusted resource barrier evaluation (wave-09 B1/B2).
 *
 * Wave-08 shipped this module reading plain JSON. A caller could assemble machine, timeliness and
 * writer fields by hand and get `releaseBarrierSatisfied: true`, which meant ordinary JSON carried
 * release authority. That is now closed.
 *
 * The only accepted input is the EXISTING authenticated proof, `VerifiedRunnerInspection`, which is
 * issued solely by `connectRunnerRecovery` and validated through the single `verified` WeakMap in
 * `recovery-transport.ts`. This module deliberately does not create a second registry: it calls
 * `verifiedRunnerInspection()`, so a plain object, a structured clone, a JSON round-trip or a
 * hand-assembled lookalike is refused for exactly the same reason it is refused everywhere else.
 *
 * Because the proof already binds the machine (the authenticated socket identity), the runner
 * identity, the attempt tuple and the observation time, this module never accepts those as caller
 * fields. What it adds is the barrier SEMANTICS: which authenticated observations actually mean "the
 * old writer stopped".
 *
 * The rule that survives from wave-08 and stays the whole point: most tempting evidence does not
 * answer that question. An ended attempt, a missing pid, another machine's signature, a new
 * generation, partial coverage or a stale proof are all recorded as invalid inferences.
 */
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { VerifiedRunnerInspection } from './recovery-transport.ts'
import { RunnerLinkError, verifiedRunnerInspection } from './recovery-transport.ts'

/**
 * Re-exported type only. It exists so a consumer can name the parameter without importing the
 * transport directly; it carries no authority of its own.
 */
export type { VerifiedRunnerInspection }

/** Why a piece of evidence cannot establish that a writer stopped. */
export const INVALID_INFERENCES = Object.freeze({
  plain_json: 'an ordinary object is not an authenticated inspection, so it carries no release authority',
  old_ended: 'an endpoint reporting a past attempt as ended does not prove its writer process stopped',
  pid_missing: 'process ids are reused, so the absence of a pid does not identify a stopped writer',
  other_machine: 'evidence bound to another machine or socket does not describe writers on this one',
  wrong_scope: 'a resource outside the registered scope is not released by creating new state',
  lost_contact: 'losing contact with an endpoint is not evidence that its writers stopped',
  new_generation: 'a new generation or execution state does not release resources owned by the old state',
  stale_proof: 'a proof older than the requirement cannot describe the current writer',
  serving: 'an endpoint that is still serving has not fenced new work, so quiescence now is not a stop',
  partial_coverage: 'partial or unknown coverage means the endpoint cannot enumerate everything it owns',
  missing_fields: 'missing machine, time, runner, attempt, epoch, source, writer or resource fields cannot be read as quiescence',
})

/** Per-resource verdicts. `unknown` is the honest answer far more often than callers expect. */
export const RESOURCE_VERDICTS = Object.freeze(['verified_quiescent', 'possibly_active', 'unknown'])

/** Terminal endpoint states that can support a release claim, from the current protocol semantics. */
const TERMINAL_STATES = Object.freeze(['terminated'])

/** The fields a barrier claim depends on. A proof missing any of them is refused outright. */
const REQUIRED_INSPECTION_FIELDS = Object.freeze([
  'protocol',
  'attempt',
  'runnerIdentityRef',
  'source',
  'state',
  'admission',
  'coverage',
  'resources',
  'evidence',
  'observedAt',
])

function checkCompleteShape(inspection) {
  const problems = []
  for (const field of REQUIRED_INSPECTION_FIELDS) {
    if (inspection?.[field] === undefined || inspection?.[field] === null) problems.push(`inspection.${field} is missing`)
  }
  if (inspection?.attempt) {
    for (const field of ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch']) {
      if (inspection.attempt[field] === undefined || inspection.attempt[field] === null) {
        problems.push(`inspection.attempt.${field} is missing`)
      }
    }
  }
  if (!Array.isArray(inspection?.evidence) || inspection.evidence.length === 0) {
    problems.push('inspection.evidence is missing or empty, so the claim cannot be audited')
  }
  return problems
}

/**
 * Evaluate the barrier from an authenticated proof.
 *
 * `requiredAt` is VALIDATED, not merely echoed into the output: a proof observed before the moment
 * the caller requires cannot describe the world at that moment, so it is refused.
 */
export function describeResourceFacts(proof, options = {}) {
  const { maxAgeMs = 5000, requiredAt = null } = options
  const now = options.now ?? (() => performance.now())

  // The single gate. This call throws for anything that is not an issued proof, which is what makes
  // ordinary JSON inert.
  let verified
  try {
    verified = verifiedRunnerInspection(proof, maxAgeMs)
  } catch (error) {
    const reason = error instanceof RunnerLinkError ? error.code : 'unverifiable_proof'
    const explanation =
      reason === 'stale_proof'
        ? INVALID_INFERENCES.stale_proof
        : reason === 'identity_mismatch'
          ? INVALID_INFERENCES.plain_json
          : String(error?.message ?? error)
    return {
      protocol: 'resource-facts/2',
      verdict: 'refused',
      releaseBarrierSatisfied: false,
      reason,
      explanation,
      counts: { total: 0, verified: 0, possiblyActive: 0, unknown: 0 },
      resources: [],
      invalidInferencesDetected: [reason === 'stale_proof' ? 'stale_proof' : 'plain_json'],
      blockers: [{ ref: null, verdict: 'unknown', reasons: [explanation] }],
      notClaimed: notClaimed(),
    }
  }

  const inspection = verified.value
  const endpoint = verified.endpoint
  const shapeProblems = checkCompleteShape(inspection)
  if (shapeProblems.length > 0) {
    return {
      protocol: 'resource-facts/2',
      verdict: 'refused',
      releaseBarrierSatisfied: false,
      reason: 'incomplete_inspection',
      explanation: INVALID_INFERENCES.missing_fields,
      problems: shapeProblems,
      counts: { total: 0, verified: 0, possiblyActive: 0, unknown: 0 },
      resources: [],
      invalidInferencesDetected: ['missing_fields'],
      blockers: [{ ref: null, verdict: 'unknown', reasons: shapeProblems }],
      notClaimed: notClaimed(),
    }
  }

  // requiredAt is a real constraint: a proof from before the required instant cannot answer for it.
  let requiredAtProblem = null
  if (requiredAt !== null && requiredAt !== undefined) {
    const requiredMs = Date.parse(String(requiredAt))
    const observedMs = Date.parse(String(inspection.observedAt))
    if (!Number.isFinite(requiredMs)) requiredAtProblem = `requiredAt ${String(requiredAt)} is not a valid timestamp`
    else if (!Number.isFinite(observedMs)) requiredAtProblem = 'the inspection observedAt is not a valid timestamp'
    else if (observedMs < requiredMs) {
      requiredAtProblem = `the inspection was observed at ${inspection.observedAt}, which is before the required ${String(requiredAt)}`
    }
  }
  if (requiredAtProblem) {
    return {
      protocol: 'resource-facts/2',
      verdict: 'refused',
      releaseBarrierSatisfied: false,
      reason: 'stale_relative_to_requirement',
      explanation: INVALID_INFERENCES.stale_proof,
      problems: [requiredAtProblem],
      counts: { total: 0, verified: 0, possiblyActive: 0, unknown: 0 },
      resources: [],
      invalidInferencesDetected: ['stale_proof'],
      blockers: [{ ref: null, verdict: 'unknown', reasons: [requiredAtProblem] }],
      notClaimed: notClaimed(),
    }
  }

  const classified = inspection.resources.map(resource => classifyVerifiedResource(resource, inspection, endpoint))

  const verifiedResources = classified.filter(resource => resource.verdict === 'verified_quiescent')
  const possiblyActive = classified.filter(resource => resource.verdict === 'possibly_active')
  const unknown = classified.filter(resource => resource.verdict === 'unknown')

  const detected = new Set()
  for (const resource of classified) {
    for (const reason of resource.reasons) {
      for (const [key, text] of Object.entries(INVALID_INFERENCES)) {
        if (reason === text) detected.add(key)
      }
    }
  }

  const verdict =
    classified.length === 0
      ? 'no_resources_observed'
      : possiblyActive.length > 0
        ? 'possibly_active'
        : unknown.length > 0
          ? 'unknown'
          : 'all_verified_quiescent'

  return {
    protocol: 'resource-facts/2',
    verdict,
    /** Only this authorises new execution, and only because the proof was authenticated. */
    releaseBarrierSatisfied: verdict === 'all_verified_quiescent' && classified.length > 0,
    reason: null,
    /** Provenance of the authenticated input, so a consumer can see what it was evaluated on. */
    proof: {
      runnerIdentityRef: inspection.runnerIdentityRef,
      attempt: inspection.attempt,
      source: inspection.source,
      observedAt: inspection.observedAt,
      state: inspection.state,
      admission: inspection.admission,
      coverage: inspection.coverage,
      /** The authenticated machine/socket binding. Not a caller field. */
      socketIdentity: endpoint.socketIdentity,
    },
    counts: { total: classified.length, verified: verifiedResources.length, possiblyActive: possiblyActive.length, unknown: unknown.length },
    resources: classified,
    invalidInferencesDetected: [...detected],
    blockers: classified.filter(resource => resource.verdict !== 'verified_quiescent').map(resource => ({
      ref: resource.ref,
      verdict: resource.verdict,
      reasons: resource.reasons,
    })),
    notClaimed: notClaimed(),
    evaluatedAt: new Date().toISOString(),
    evaluatedAtMonotonic: now(),
  }
}

/** Classify one resource from an AUTHENTICATED inspection. */
export function classifyVerifiedResource(resource, inspection, endpoint = null) {
  const reasons = []
  const evidence = []

  if (!resource || typeof resource.ref !== 'string' || resource.ref === '') {
    return { ref: null, verdict: 'unknown', reasons: ['the resource has no identity, so nothing can be concluded'], evidence }
  }
  if (typeof resource.writer !== 'string') {
    return { ref: resource.ref, verdict: 'unknown', reasons: [INVALID_INFERENCES.missing_fields], evidence }
  }
  if (endpoint === null) {
    // A caller evaluating a bare resource has no authenticated machine binding to appeal to.
    return { ref: resource.ref, verdict: 'unknown', reasons: [INVALID_INFERENCES.plain_json], evidence }
  }

  // Coverage first: an endpoint that cannot enumerate its own resources cannot vouch for one.
  if (inspection.coverage !== 'complete_owned_resources') {
    reasons.push(INVALID_INFERENCES.partial_coverage)
  }

  // Terminal state. `serving` is explicitly not a release: it has not fenced new work.
  if (!TERMINAL_STATES.includes(inspection.state)) {
    if (inspection.state === 'serving') reasons.push(INVALID_INFERENCES.serving)
    else reasons.push(INVALID_INFERENCES.old_ended)
  }

  // Business admission must be closed; an open endpoint can reactivate a quiescent writer.
  if (inspection.admission !== 'closed') {
    reasons.push('business admission is still open, so a quiescent writer can be reactivated')
  }

  if (resource.writer === 'active') {
    reasons.push('the endpoint reports this writer as active')
    return { ref: resource.ref, verdict: 'possibly_active', reasons, evidence, ownership: resource.ownership ?? null }
  }
  if (resource.writer === 'indeterminate') {
    reasons.push('the endpoint reports this writer as indeterminate, which is not a stop')
    return { ref: resource.ref, verdict: 'unknown', reasons, evidence, ownership: resource.ownership ?? null }
  }

  // writer === 'quiescent'. Still needs auditable evidence.
  if (!Array.isArray(resource.evidence) || resource.evidence.length === 0) {
    reasons.push('a quiescent report carries no evidence, so it cannot be audited')
  } else {
    evidence.push(...resource.evidence)
  }

  const verdict = reasons.length === 0 ? 'verified_quiescent' : 'unknown'
  if (verdict === 'verified_quiescent') {
    evidence.push(
      `authenticated inspection: terminated, admission closed, coverage complete, observed ${inspection.observedAt}, socket ${endpoint.socketIdentity.dev}:${endpoint.socketIdentity.ino}`,
    )
  }
  return { ref: resource.ref, verdict, reasons, evidence, ownership: resource.ownership ?? null }
}

function notClaimed() {
  return [
    'that an unobserved writer does not exist',
    'that a new generation or execution state released any old resource',
    'that native stop or unknown-send reconciliation were exercised',
    'that a diagnostic summary carries any release authority',
  ]
}

/** A stable digest so a consumer can detect that the trusted picture changed. */
export function resourceFactsDigest(facts) {
  const stable = [
    facts.protocol,
    facts.verdict,
    facts.releaseBarrierSatisfied,
    facts.counts,
    facts.proof?.socketIdentity ?? null,
    facts.proof?.attempt ?? null,
    facts.resources.map(resource => [resource.ref, resource.verdict, resource.ownership ?? null]),
  ]
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}
