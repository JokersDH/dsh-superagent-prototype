import type { ProductStore } from '@personal-agent/storage'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { AgentProfile, ExecutionProfileView, ExecutionUnavailableReason } from '@personal-agent/contracts'
import { NativeAdmissionError, preparePersonalStartup, startupWithProfile } from './native-startup.ts'
import { inspectNativeExecutor, nativeInspectionPolicyDigest } from './native-inspection.ts'
import type { NativeExecutorInspection } from './native-inspection.ts'
import { readExecutorTrialAdmission } from './executor-trial.ts'
import { executionProfileView } from './execution-profile-view.ts'

/** Launcher may open this receiver in blocked mode; this marker grants no native execution. */
export const INSPECTED_NATIVE_STARTUP_PROTOCOL = 'inspected-native-startup/1' as const

/** A changed version never inherits the historical native PASS. Inspection and consent are separate. */
export async function prepareInspectedPersonalStartup(stateRoot: string, store: ProductStore,
  principal: { userId: string; authorityRef: string }, options: {
    discussionOnly?: boolean; admit?: () => AgentProfile; inspect?: () => Promise<NativeExecutorInspection>
  } = {}): Promise<ReturnType<typeof preparePersonalStartup> & { inspectedProfiles?: readonly ExecutionProfileView[] }> {
  const original = preparePersonalStartup(stateRoot, options)
  if ('native' in original || !['incompatible_version', 'not_admitted'].includes(original.executionUnavailable)) return original
  let inspection: NativeExecutorInspection
  try { inspection = await (options.inspect ?? inspectNativeExecutor)() }
  catch (error) {
    if (!(error instanceof NativeAdmissionError)) throw error
    return { ...original, executionUnavailable: error.reason }
  }
  const { profile, verdict, operations } = inspection
  const admission = readExecutorTrialAdmission(store, inspection, principal)
  if (admission) {
    const enabled = operations.map(item => ({ ...item, enabled: item.supported === true && ['native', 'controlled'].includes(item.validation) }))
    // Schema/initialize alone cannot reach this branch: a checked begin consumer is still required.
    if (enabled.some(item => item.operation === 'begin' && item.enabled)) {
      const view = executionProfileView({ profile, displayName: 'Codex · 未验证版本试用', verdict, operations: enabled, admission })
      const startup = startupWithProfile(stateRoot, profile)
      const admissionCurrent = () => {
        try { return !!startup.native.admissionCurrent?.() && !!verdict.identity &&
          createHash('sha256').update(readFileSync(profile.executable)).digest('hex') === verdict.identity.executableDigest &&
          nativeInspectionPolicyDigest(profile, verdict.identity.executableDigest) === inspection.policyDigest &&
          !!readExecutorTrialAdmission(store, inspection, principal) } catch { return false }
      }
      if (admissionCurrent()) return { ...startup, native: { ...startup.native, profileView: view, admissionCurrent } }
    }
  }
  const reason: ExecutionUnavailableReason = verdict.class === 'incompatible' ? 'incompatible_version'
    : verdict.class === 'unknown' ? 'probe_failed' : 'not_admitted'
  return { ...original, executionUnavailable: reason, inspectedProfiles: [executionProfileView({
    profile, displayName: 'Codex · 未验证版本', verdict, operations,
  })] }
}
