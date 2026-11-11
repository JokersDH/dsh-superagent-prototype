import { RouteAdviceSchema } from '@personal-agent/contracts'
import type { ExecutionProfileRef, RouteAdvice, Scope } from '@personal-agent/contracts'
import { snapshot } from './snapshot.ts'
import type { EligibilityResult } from './eligibility.ts'

export type RouteAdviceBasis = 'none_eligible' | 'only_eligible' | 'operator_default' | 'fixed_rule'

export interface FixedRouteRule {
  readonly profileRef: ExecutionProfileRef
  readonly description: string
  readonly evidenceRefs: readonly string[]
}

export interface RouteAdviceInput {
  readonly id: string
  readonly projectId: string
  readonly sourceRef: string
  readonly taskContextDigest: string
  readonly catalogRevision: string
  readonly policyRevision: string
  readonly eligibility: readonly EligibilityResult[]
  /** Evidence references proving why a profile is eligible, keyed by profileRefKey(). */
  readonly evidenceByProfile: Readonly<Record<string, readonly string[]>>
  readonly operatorDefaultProfileRef?: ExecutionProfileRef
  readonly fixedRule?: FixedRouteRule
  readonly reviewPolicy?: 'never' | 'optional' | 'required'
  readonly now?: Date
  readonly ttlMs?: number
}

export type RouteAdviceResult =
  | { readonly kind: 'advice'; readonly advice: RouteAdvice }
  | { readonly kind: 'needs_operator_choice'; readonly eligible: readonly ExecutionProfileRef[]; readonly excluded: RouteAdvice['excluded'] }
  | { readonly kind: 'blocked'; readonly reason: 'evidence_missing'; readonly eligible: readonly ExecutionProfileRef[] }

export function profileRefKey(ref: ExecutionProfileRef): string {
  return JSON.stringify([ref.profileId, ref.revision, ref.identityDigest])
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

function excludedOf(eligibility: readonly EligibilityResult[]): RouteAdvice['excluded'] {
  return eligibility
    .filter((item) => !item.eligible)
    .map((item) => ({
      profileRef: item.ref,
      reason: item.reasons[0]?.code ?? 'evidence_missing',
      evidenceRefs: [...new Set(item.reasons.flatMap((reason) => reason.evidenceRefs))],
    }))
}

/**
 * Cold-start advice: none_eligible / only_eligible / operator_default / fixed_rule only. Multiple
 * eligible profiles without an explicit rule produce `needs_operator_choice` instead of an invented
 * ranking. No measured history, probability or trained reward is used.
 */
export function adviseRoute(input: RouteAdviceInput): RouteAdviceResult {
  const now = input.now ?? new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString()
  const eligible = input.eligibility.filter((item) => item.eligible)
  const excluded = excludedOf(input.eligibility)
  const eligibleRefs = eligible.map((item) => item.ref)

  const build = (basis: RouteAdviceBasis, suggested: ExecutionProfileRef | null, evidenceRefs: readonly string[]): RouteAdvice =>
    snapshot(RouteAdviceSchema.parse({
      protocol: 'route-advice/1',
      id: input.id,
      projectId: input.projectId,
      sourceRef: input.sourceRef,
      taskContextDigest: input.taskContextDigest,
      catalogRevision: input.catalogRevision,
      policyRevision: input.policyRevision,
      eligibleProfileRefs: eligibleRefs,
      suggestedProfileRef: suggested,
      excluded,
      basis,
      evidenceRefs: [...new Set(evidenceRefs)],
      reviewSuggested: (input.reviewPolicy ?? 'optional') !== 'never',
      createdAt,
      expiresAt,
    }))

  if (eligible.length === 0) {
    return { kind: 'advice', advice: build('none_eligible', null, []) }
  }
  if (eligible.length === 1) {
    const selected = eligible[0]!
    const evidence = input.evidenceByProfile[profileRefKey(selected.ref)] ?? selected.evidenceRefs
    if (evidence.length === 0) return { kind: 'blocked', reason: 'evidence_missing', eligible: eligibleRefs }
    return { kind: 'advice', advice: build('only_eligible', selected.ref, evidence) }
  }

  if (input.operatorDefaultProfileRef) {
    const selected = eligible.find((item) => profileRefKey(item.ref) === profileRefKey(input.operatorDefaultProfileRef!))
    if (selected) {
      const evidence = input.evidenceByProfile[profileRefKey(selected.ref)] ?? selected.evidenceRefs
      if (evidence.length === 0) return { kind: 'blocked', reason: 'evidence_missing', eligible: eligibleRefs }
      return { kind: 'advice', advice: build('operator_default', selected.ref, evidence) }
    }
  }
  if (input.fixedRule) {
    const selected = eligible.find((item) => profileRefKey(item.ref) === profileRefKey(input.fixedRule!.profileRef))
    if (selected) {
      const evidence = [...input.fixedRule.evidenceRefs, ...(input.evidenceByProfile[profileRefKey(selected.ref)] ?? [])]
      if (evidence.length === 0) return { kind: 'blocked', reason: 'evidence_missing', eligible: eligibleRefs }
      return { kind: 'advice', advice: build('fixed_rule', selected.ref, evidence) }
    }
  }
  return { kind: 'needs_operator_choice', eligible: eligibleRefs, excluded }
}

export interface AdviceConfirmationProfile {
  readonly ref: ExecutionProfileRef
  readonly admitted: boolean
  readonly allowedScope: Scope
  readonly currentIdentityDigest: string
}

export interface AdviceConfirmationContext {
  readonly now: Date
  readonly projectId: string
  readonly taskContextDigest: string
  readonly catalogRevision: string
  readonly policyRevision: string
  readonly projectScope: Scope
  readonly profiles: readonly AdviceConfirmationProfile[]
}

export type AdviceConfirmationReasonCode =
  | 'expired'
  | 'project_mismatch'
  | 'task_context_changed'
  | 'catalog_changed'
  | 'policy_changed'
  | 'profile_missing'
  | 'profile_not_eligible'
  | 'identity_drift'
  | 'scope_denied'

export interface AdviceConfirmationVerdict {
  readonly ok: boolean
  readonly reasons: readonly { readonly code: AdviceConfirmationReasonCode; readonly detail?: string }[]
}

function scopeWithin(scope: Scope, grant: Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action))
  )
}

/** Main re-validates the advice before confirmation; stale/drifted advice cannot create work. */
export function validateAdviceForConfirmation(
  advice: RouteAdvice,
  current: AdviceConfirmationContext,
): AdviceConfirmationVerdict {
  const reasons: { code: AdviceConfirmationReasonCode; detail?: string }[] = []
  if (Date.parse(advice.expiresAt) <= current.now.getTime()) reasons.push({ code: 'expired' })
  if (advice.projectId !== current.projectId) reasons.push({ code: 'project_mismatch' })
  if (advice.taskContextDigest !== current.taskContextDigest) reasons.push({ code: 'task_context_changed' })
  if (advice.catalogRevision !== current.catalogRevision) reasons.push({ code: 'catalog_changed' })
  if (advice.policyRevision !== current.policyRevision) reasons.push({ code: 'policy_changed' })
  if (!advice.suggestedProfileRef) {
    reasons.push({ code: 'profile_missing', detail: 'advice has no eligible profile' })
    return { ok: false, reasons }
  }
  const profile = current.profiles.find((item) => profileRefKey(item.ref) === profileRefKey(advice.suggestedProfileRef!))
  if (!profile) {
    reasons.push({ code: 'profile_missing' })
    return { ok: false, reasons }
  }
  if (!profile.admitted) reasons.push({ code: 'profile_not_eligible' })
  if (profile.currentIdentityDigest !== profile.ref.identityDigest) reasons.push({ code: 'identity_drift' })
  if (profile.allowedScope.projectId !== current.projectId || !scopeWithin(profile.allowedScope, current.projectScope)) {
    reasons.push({ code: 'scope_denied' })
  }
  return { ok: reasons.length === 0, reasons }
}
