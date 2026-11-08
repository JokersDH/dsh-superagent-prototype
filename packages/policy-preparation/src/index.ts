/**
 * Prepared execution policy gate (WP-06).
 *
 * A prepared policy is the proof that an attempt's native settings were actually applied under a
 * known config fingerprint. The gate answers one question: **may this attempt execute business
 * work right now?**
 *
 * It refuses unless all of the following hold, in this order:
 *
 *   1. the record belongs to the attempt (ticket/assignment/attempt/epoch/contract);
 *   2. the policy was actually enforced (not merely advisory or approval-guarded);
 *   3. verification passed (not `not_tested`, not `failed`);
 *   4. the record's config fingerprint still matches the live fingerprint (no drift);
 *   5. the profile revision and permission-policy revision match the current profile.
 *
 * Every refusal carries a stable reason so a hold/reconcile flow can act without parsing text.
 */
import type { AgentProfile, AttemptSpec, PreparedExecutionPolicy } from '../../contracts/src/types.ts'

export type GateRefusal =
  | 'identity_mismatch'
  | 'not_prepared'
  | 'advisory_only'
  | 'unverified'
  | 'config_drift'
  | 'profile_revision_changed'
  | 'permission_policy_changed'

export type GateDecision = { allowed: true } | { allowed: false; reason: GateRefusal; detail: string }

export type GateContext = {
  /** Live fingerprint the native side currently reports. */
  currentFingerprint: string
  /** Profile the attempt is running under. */
  profile: AgentProfile
}

/** Decide whether a prepared policy admits business work for `spec`. */
export function admitPreparedPolicy(
  record: PreparedExecutionPolicy | undefined,
  spec: Pick<AttemptSpec, 'ticketId' | 'assignmentId' | 'attemptId' | 'fenceEpoch' | 'contract'>,
  context: GateContext,
): GateDecision {
  if (!record) return deny('not_prepared', 'no prepared policy record for this attempt')

  const identityFields = ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch'] as const
  for (const field of identityFields) {
    if (record[field] !== spec[field]) {
      return deny('identity_mismatch', `${field} does not belong to this attempt`)
    }
  }
  const left = record.contract
  const right = spec.contract
  if (left.workId !== right.workId || left.revision !== right.revision || left.digest !== right.digest) {
    return deny('identity_mismatch', 'contract does not belong to this attempt')
  }

  if (record.enforcement !== 'enforced') {
    // An advisory or approval-guarded policy is not proof that the native side restricted anything.
    return deny('advisory_only', `policy enforcement is ${record.enforcement}`)
  }
  if (record.verification !== 'passed') {
    return deny('unverified', `policy verification is ${record.verification}`)
  }
  if (record.effectiveConfigFingerprint !== context.currentFingerprint) {
    return deny('config_drift', 'resolved config fingerprint changed since preparation')
  }
  if (record.requestedPolicyRevision !== context.profile.permissionPolicyRevision) {
    return deny('permission_policy_changed', `prepared under ${record.requestedPolicyRevision}, profile now has ${context.profile.permissionPolicyRevision}`)
  }
  return { allowed: true }
}

function deny(reason: GateRefusal, detail: string): GateDecision {
  return { allowed: false, reason, detail }
}

/**
 * Track the preparation state of one attempt.
 *
 * `prepare()` records the record the driver produced; `hold()` is what a drift signal calls, and it
 * **keeps** the record for diagnosis while refusing execution. A held attempt can still be
 * cancelled; it must be re-prepared before it can execute again.
 */
export class PolicyPreparation {
  #record: PreparedExecutionPolicy | undefined
  #hold: { reason: GateRefusal; detail: string } | undefined

  get record(): PreparedExecutionPolicy | undefined {
    return this.#record
  }

  get held(): { reason: GateRefusal; detail: string } | undefined {
    return this.#hold
  }

  prepare(record: PreparedExecutionPolicy): void {
    this.#record = record
    this.#hold = undefined
  }

  /** Configuration, binary or permission drift invalidates the current preparation. */
  hold(reason: GateRefusal, detail: string): void {
    this.#hold = { reason, detail }
  }

  /** Cancel is always allowed: holding must never prevent stopping work. */
  canCancel(): true {
    return true
  }

  /** Admission for business work (begin/deliver/answer). */
  admit(spec: Pick<AttemptSpec, 'ticketId' | 'assignmentId' | 'attemptId' | 'fenceEpoch' | 'contract'>, context: GateContext): GateDecision {
    if (this.#hold) return deny(this.#hold.reason, `held: ${this.#hold.detail}`)
    return admitPreparedPolicy(this.#record, spec, context)
  }
}
