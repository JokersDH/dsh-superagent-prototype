import { ExecutionProfileViewSchema, ExecutionTrialAdmissionSchema } from '@personal-agent/contracts'
import type { AgentProfile, ExecutionOperationView, ExecutionProfileView, ExecutionTrialAdmission } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { CompatibilityVerdict } from '../../../packages/catalog/src/compatibility.ts'

/** Main's one public projection for B's compatibility facts. Invocation never performs admission. */
export function executionProfileView(input: {
  profile: AgentProfile
  displayName: string
  verdict: CompatibilityVerdict
  operations: readonly ExecutionOperationView[]
  /** Supplied only by the trusted runtime after current receipt/policy/consumer/resource checks. */
  admission?: { mode: 'verified' } | ExecutionTrialAdmission
}): ExecutionProfileView {
  const { profile, verdict } = input
  const compatible = ['verified', 'compatible_unverified'].includes(verdict.class)
  const identity = verdict.identity
  if (identity && (identity.profileId !== profile.id || identity.profileRevision !== profile.revision || identity.driverRelease !== profile.driverRelease))
    throw new TypeError('Compatibility facts belong to another profile or revision')
  const nativeVerified = verdict.class === 'verified' && verdict.nativeTestPassed && input.admission?.mode === 'verified'
  let trialAdmission: ExecutionTrialAdmission | undefined
  if (input.admission?.mode === 'explicit_trial') {
    trialAdmission = ExecutionTrialAdmissionSchema.parse(input.admission)
    if (!identity || verdict.class !== 'compatible_unverified' ||
      trialAdmission.identityDigest !== canonicalDigest(JSON.parse(JSON.stringify(identity))))
      throw new TypeError('Trial admission must bind the exact current compatibility identity')
  }
  if (input.admission?.mode === 'verified' && !nativeVerified)
    throw new TypeError('Protocol inspection cannot be promoted to native verification')
  const admitted = nativeVerified || !!trialAdmission
  const operations = input.operations.map(item => ({ ...item, enabled: compatible && admitted && item.enabled }))
  return ExecutionProfileViewSchema.parse({
    id: profile.id, revision: profile.revision, driverId: profile.driverId, kind: 'native', displayName: input.displayName,
    readiness: nativeVerified ? 'native_test_passed' : verdict.readiness,
    dispatchAllowed: admitted,
    ...(!admitted ? { blockedReason: verdict.class === 'incompatible' ? 'schema_mismatch' : 'unsupported_capability' } : {}),
    compatibility: { classification: verdict.class, nativeVersion: identity?.nativeVersion ?? null,
      protocol: identity?.wireVersion ?? null, schemaDigest: identity?.schemaDigest ?? null, checkedAt: verdict.checkedAt, operations },
    ...(trialAdmission ? { trialAdmission } : {}),
  })
}
