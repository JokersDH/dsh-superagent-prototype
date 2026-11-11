/**
 * Current resource facts for recovery and upgrade (wave-08 B2).
 *
 * Recovery and upgrade both need to answer one dangerous question: *has the old writer actually
 * stopped?* The whole point of this module is that most of the tempting evidence answers it wrongly.
 *
 * These are all invalid inferences and each one is named here so it cannot creep back in:
 *
 *   - the old attempt is `ended`            -> an endpoint can report ended while a child still runs
 *   - the PID is gone                       -> PIDs are reused; a missing PID proves nothing
 *   - the signature was written by another machine -> says nothing about this machine's writers
 *   - the resource is outside the new scope -> a new state does not release an old resource
 *   - contact with the endpoint was lost    -> loss of contact is not loss of the writer
 *
 * So the module never returns a bare boolean. It returns, per resource, a verdict plus the evidence
 * that produced it, plus what would change the verdict. Only an endpoint that reports complete
 * coverage over a resource that is explicitly quiescent with current, on-machine evidence can reach
 * `verified_quiescent`, and even that is scoped to that endpoint's own resources.
 *
 * This module imports the runner inspection schema rather than redefining it: the wire shape has one
 * owner and this is a reader of it, not a second DTO. If main needs a shared DTO it is requested as
 * exact fields, not invented here.
 */
import { createHash } from 'node:crypto'

/** Why a piece of evidence cannot establish that a writer stopped. */
export const INVALID_INFERENCES = Object.freeze({
  old_ended: 'an endpoint reporting a past attempt as ended does not prove its writer process stopped',
  pid_missing: 'process ids are reused, so the absence of a pid does not identify a stopped writer',
  other_machine: 'a signature produced on another machine says nothing about writers on this one',
  wrong_scope: 'a resource outside the new execution scope is not released by creating new state',
  lost_contact: 'losing contact with an endpoint is not evidence that its writers stopped',
  new_state: 'a new execution state or generation does not release resources owned by the old state',
  stale_proof: 'a proof recorded before the current observation cannot describe the current writer',
})

/** Per-resource verdicts. `unknown` is the correct answer far more often than callers expect. */
export const RESOURCE_VERDICTS = Object.freeze([
  'verified_quiescent', // current, on-machine, complete-coverage evidence says this writer is not running
  'possibly_active', // evidence says, or cannot exclude, that this writer may still run
  'unknown', // nothing sufficient either way
])

/** What a caller must supply to describe one observation. Deliberately explicit. */
function normalizeObservation(observation = {}) {
  const {
    runnerIdentityRef = null,
    attempt = null,
    source = null,
    state = 'unknown',
    admission = 'open',
    coverage = 'unknown',
    resources = [],
    observedAt = null,
    requiredAt = null,
    machineId = null,
    observedMachineId = null,
    proofRecordedAt = null,
  } = observation
  return {
    runnerIdentityRef,
    attempt,
    source,
    state,
    admission,
    coverage,
    resources,
    observedAt,
    requiredAt,
    machineId,
    observedMachineId,
    proofRecordedAt,
  }
}

/**
 * Classify one resource from one observation.
 *
 * Returns the verdict plus every reason that prevented a stronger one, so a UI can explain itself
 * and a test can assert the *reason* rather than only the verdict.
 */
export function classifyResource(resource, observation) {
  const reasons = []
  const evidence = []

  if (!resource || typeof resource.ref !== 'string') {
    return { ref: null, verdict: 'unknown', reasons: ['the resource has no identity, so nothing can be concluded'], evidence }
  }

  // Coverage is the first gate. Partial or unknown coverage means the endpoint itself is telling us
  // it cannot see everything it owns; no per-resource claim can be stronger than that.
  if (observation.coverage !== 'complete_owned_resources') {
    reasons.push(`the endpoint reports ${observation.coverage} coverage, so its resource list is not exhaustive`)
  }

  // Machine binding. Evidence about another machine is not evidence about this one.
  if (observation.observedMachineId && observation.machineId && observation.observedMachineId !== observation.machineId) {
    reasons.push(INVALID_INFERENCES.other_machine)
  } else if (!observation.observedMachineId) {
    reasons.push('the observation is not bound to a machine identity, so it cannot be attributed to this host')
  }

  // Timeliness. A proof older than the current observation cannot describe the current writer.
  if (observation.proofRecordedAt && observation.observedAt && Date.parse(observation.proofRecordedAt) < Date.parse(observation.observedAt)) {
    reasons.push(INVALID_INFERENCES.stale_proof)
  }

  // The writer field is the only thing that can speak to "is it running".
  if (resource.writer === 'active') {
    reasons.push('the endpoint reports this writer as active')
    return { ref: resource.ref, verdict: 'possibly_active', reasons, evidence, ownership: resource.ownership ?? null }
  }
  if (resource.writer === 'indeterminate') {
    reasons.push('the endpoint reports this writer as indeterminate, which is not a stop')
    return { ref: resource.ref, verdict: 'unknown', reasons, evidence, ownership: resource.ownership ?? null }
  }

  // writer === 'quiescent' from here on. It still is not enough on its own.
  if (!Array.isArray(resource.evidence) || resource.evidence.length === 0) {
    reasons.push('a quiescent report carries no evidence, so it cannot be audited')
  } else {
    evidence.push(...resource.evidence)
  }

  // An endpoint that still has business admission open has not fenced new work, so "quiescent now"
  // is not "stopped".
  if (observation.admission === 'open') {
    reasons.push('business admission is still open, so a quiescent writer can be reactivated')
  }

  // An endpoint reported terminated/unknown as a whole cannot vouch for a specific resource.
  if (observation.state === 'terminated' || observation.state === 'unknown') {
    reasons.push(`the endpoint itself reports state ${observation.state}, so it cannot vouch for this writer`)
  }

  const verdict = reasons.length === 0 ? 'verified_quiescent' : 'unknown'
  if (verdict === 'verified_quiescent') {
    evidence.push(`coverage complete, machine bound, admission closed, endpoint serving at ${observation.observedAt}`)
  }
  return { ref: resource.ref, verdict, reasons, evidence, ownership: resource.ownership ?? null }
}

/**
 * Describe the current resource facts for one or more observations.
 *
 * The aggregate answer is intentionally conservative: it is `all_verified_quiescent` only when every
 * observed resource reached that verdict. One unknown keeps the whole set unresolved, because a
 * single unknown writer is enough to make starting new execution unsafe.
 */
export function describeResourceFacts(observations = [], options = {}) {
  const { requiredAt = null } = options
  const normalized = observations.map(observation => normalizeObservation({ ...observation, requiredAt: observation?.requiredAt ?? requiredAt }))

  const perObservation = normalized.map(observation => ({
    runnerIdentityRef: observation.runnerIdentityRef,
    attempt: observation.attempt,
    source: observation.source,
    state: observation.state,
    admission: observation.admission,
    coverage: observation.coverage,
    observedAt: observation.observedAt,
    resources: observation.resources.map(resource => classifyResource(resource, observation)),
  }))

  const all = perObservation.flatMap(observation =>
    observation.resources.map(resource => ({ ...resource, runnerIdentityRef: observation.runnerIdentityRef, attempt: observation.attempt })),
  )

  const verified = all.filter(resource => resource.verdict === 'verified_quiescent')
  const possiblyActive = all.filter(resource => resource.verdict === 'possibly_active')
  const unknown = all.filter(resource => resource.verdict === 'unknown')

  const invalidInferencesDetected = new Set()
  for (const resource of all) {
    for (const reason of resource.reasons) {
      for (const [key, text] of Object.entries(INVALID_INFERENCES)) {
        if (reason === text) invalidInferencesDetected.add(key)
      }
    }
  }

  const verdict =
    all.length === 0
      ? 'no_resources_observed'
      : possiblyActive.length > 0
        ? 'possibly_active'
        : unknown.length > 0
          ? 'unknown'
          : 'all_verified_quiescent'

  return {
    protocol: 'resource-facts/1',
    verdict,
    /** Only this state authorises new execution. */
    releaseBarrierSatisfied: verdict === 'all_verified_quiescent' && all.length > 0,
    counts: { total: all.length, verified: verified.length, possiblyActive: possiblyActive.length, unknown: unknown.length },
    observations: perObservation,
    resources: all,
    invalidInferencesDetected: [...invalidInferencesDetected],
    /** Reasons a caller can show directly, with the invalid inference it refused to make. */
    blockers: all.filter(resource => resource.verdict !== 'verified_quiescent').map(resource => ({
      ref: resource.ref,
      verdict: resource.verdict,
      reasons: resource.reasons,
    })),
    /** What this description is not. */
    notClaimed: [
      'that an unobserved writer does not exist',
      'that a new execution state released any old resource',
      'that native stop or unknown-send reconciliation were exercised',
    ],
  }
}

/** A stable digest so a consumer can detect that the resource picture changed. */
export function resourceFactsDigest(facts) {
  const stable = facts.resources.map(resource => [resource.ref, resource.verdict, resource.ownership ?? null])
  return createHash('sha256').update(JSON.stringify([facts.verdict, facts.counts, stable])).digest('hex')
}
