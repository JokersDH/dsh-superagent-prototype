import type { ExecutionProfileRef, Scope } from '@personal-agent/contracts'

export type EvidenceLayer = 'actual_native' | 'controlled' | 'protocol_fixture' | 'schema' | 'operator_note'
export type EligibilityReasonCode =
  | 'not_admitted'
  | 'evidence_missing'
  | 'identity_drift'
  | 'scope_denied'
  | 'budget_unavailable'
  | 'read_only_unproven'
  | 'unsupported_capability'

export interface CapabilityProof {
  readonly feature: string
  readonly proven: boolean
  readonly layer: EvidenceLayer
  readonly evidenceRefs: readonly string[]
}

export type ReviewIsolation =
  | { readonly kind: 'sealed_copy'; readonly proofRef: string; readonly capsuleManifestDigest: string }
  | { readonly kind: 'native_read_only'; readonly proofRef: string }

export interface ProfileFacts {
  readonly ref: ExecutionProfileRef
  /** Current trusted full compatibility/config identity digest; must equal `ref.identityDigest`. */
  readonly currentIdentityDigest: string
  readonly admitted: boolean
  readonly admissionLayer: EvidenceLayer
  readonly capabilities: readonly CapabilityProof[]
  readonly allowedScope: Scope
  readonly budget: { readonly available: boolean; readonly unknown?: boolean; readonly evidenceRefs?: readonly string[] }
  readonly isolation?: ReviewIsolation
  readonly dataEgressAuthorized: boolean
  readonly evidenceRefs?: readonly string[]
}

export interface EligibilityRequest {
  readonly projectId: string
  readonly projectScope: Scope
  readonly requiredLayer: EvidenceLayer
  readonly requiredCapabilities: readonly string[]
  readonly requiresIsolation: boolean
  readonly readOnlyRequired: boolean
}

export interface EligibilityReason {
  readonly code: EligibilityReasonCode
  readonly evidenceRefs: readonly string[]
}

export interface EligibilityResult {
  readonly ref: ExecutionProfileRef
  readonly eligible: boolean
  readonly reasons: readonly EligibilityReason[]
  readonly evidenceRefs: readonly string[]
  readonly budgetUnknown: boolean
}

const DIGEST = /^[a-f0-9]{64}$/

const LAYER_RANK: Record<EvidenceLayer, number> = {
  actual_native: 4,
  controlled: 3,
  protocol_fixture: 2,
  schema: 1,
  operator_note: 0,
}

function scopeWithin(scope: Scope, grant: Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action))
  )
}

function addReason(reasons: Map<EligibilityReasonCode, Set<string>>, code: EligibilityReasonCode, refs: readonly string[]): void {
  const set = reasons.get(code) ?? new Set<string>()
  for (const ref of refs) set.add(ref)
  reasons.set(code, set)
}

/**
 * Pure eligibility filter over already-fetched trusted facts. It never reads credentials, calls a
 * model, changes Catalog admission or invents a quality score. Mock/controlled evidence cannot satisfy
 * a native-layer requirement, and native branding never substitutes for identity/isolation proof.
 */
export function evaluateEligibility(facts: ProfileFacts, request: EligibilityRequest): EligibilityResult {
  const reasons = new Map<EligibilityReasonCode, Set<string>>()
  const general = facts.evidenceRefs ?? []
  const requiredRank = LAYER_RANK[request.requiredLayer]

  if (!facts.admitted) addReason(reasons, 'not_admitted', general)
  if (facts.currentIdentityDigest !== facts.ref.identityDigest) addReason(reasons, 'identity_drift', general)
  if (facts.allowedScope.projectId !== request.projectId || !scopeWithin(facts.allowedScope, request.projectScope)) {
    addReason(reasons, 'scope_denied', general)
  }
  if (LAYER_RANK[facts.admissionLayer] < requiredRank) addReason(reasons, 'evidence_missing', general)

  for (const feature of request.requiredCapabilities) {
    const proof = facts.capabilities.find((item) => item.feature === feature && item.proven)
    if (!proof) {
      addReason(reasons, 'unsupported_capability', general)
      continue
    }
    if (LAYER_RANK[proof.layer] < requiredRank) addReason(reasons, 'evidence_missing', proof.evidenceRefs)
  }

  if (!facts.budget.available || facts.budget.unknown === true) {
    addReason(reasons, 'budget_unavailable', facts.budget.evidenceRefs ?? [])
  }

  if (request.requiresIsolation || request.readOnlyRequired) {
    if (!facts.isolation) addReason(reasons, 'read_only_unproven', [])
    else if (facts.isolation.kind === 'sealed_copy') {
      if (!facts.isolation.proofRef || !DIGEST.test(facts.isolation.capsuleManifestDigest)) {
        addReason(reasons, 'read_only_unproven', [facts.isolation.proofRef].filter(Boolean))
      }
      if (!facts.dataEgressAuthorized) addReason(reasons, 'scope_denied', [])
    } else if (!facts.isolation.proofRef) {
      addReason(reasons, 'read_only_unproven', [])
    }
  }

  const evidence = new Set<string>(general)
  for (const proof of facts.capabilities) for (const ref of proof.evidenceRefs) evidence.add(ref)
  for (const refs of reasons.values()) for (const ref of refs) evidence.add(ref)

  return {
    ref: facts.ref,
    eligible: reasons.size === 0,
    reasons: [...reasons.entries()]
      .map(([code, refs]) => ({ code, evidenceRefs: [...refs] }))
      .sort((left, right) => left.code.localeCompare(right.code)),
    evidenceRefs: [...evidence],
    budgetUnknown: facts.budget.unknown === true,
  }
}

/** Evaluates a set of profiles and keeps the stable order supplied by the caller. */
export function evaluateProfiles(
  profiles: readonly ProfileFacts[],
  request: EligibilityRequest,
): readonly EligibilityResult[] {
  return profiles.map((profile) => evaluateEligibility(profile, request))
}
