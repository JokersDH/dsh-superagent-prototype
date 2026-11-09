/**
 * Catalog projection to the main-owned configuration read view (WP-06, wave-02 item 5).
 *
 * The console consumes `ApplicationConfiguration` from `@personal-agent/contracts`; the raw
 * `AgentProfile`, `ProbeReport` and native diagnostics never leave the backend. This module is the
 * adapter that turns accepted catalog entries into that **safe** view:
 *
 * - only identity, display name, driver and readiness are projected; the executable path, argv,
 *   native config reference, permission policy and every native evidence reference are dropped;
 * - readiness states stay distinct: a draft or inspection-only profile is never `native_test_passed`;
 * - native dispatch additionally requires explicit trusted runtime admission, so inspection alone
 *   never grants execution;
 * - a blocked profile always carries a reason, and an allowed one never does (the contract enforces
 *   the same rule).
 */
import type { ExecutionProfileView } from '../../contracts/src/configuration.ts'
import type { AppErrorCode } from '../../contracts/src/types.ts'
import type { Readiness } from './index.ts'

/** Everything the projector is allowed to know about one profile. */
export type CatalogProfileInput = {
  /** Stable public id. */
  id: string
  revision: number
  displayName: string
  driverId: string
  /** `native` for a real agent, `controlled_fixture` for a declared fixture profile. */
  kind: 'controlled_fixture' | 'native'
  /** Readiness from a probe, or `fixture_ready`/`not_tested` when none was run. */
  readiness: Readiness | 'fixture_ready' | 'not_tested'
  /** Trusted runtime admission: whether an operator/composition root admitted this profile. */
  admitted: boolean
}

export type ProjectionOptions = {
  /** Maximum number of profiles in one projection (the contract caps the collection at 128). */
  maxProfiles?: number
}

/** Frozen `AppErrorCode` values are the only legal reasons; readiness is mapped onto them. */
const BLOCKED_BY: Record<string, AppErrorCode> = {
  missing: 'unsupported_capability',
  needs_setup: 'policy_unprepared',
  needs_auth: 'auth_required',
  incompatible: 'schema_mismatch',
}

/**
 * Project catalog entries into profile views.
 *
 * Returns the views plus the ids that were dropped because the collection would exceed its bound, so
 * a caller can log a truncation instead of silently losing a profile.
 */
export function projectProfiles(
  profiles: CatalogProfileInput[],
  options: ProjectionOptions = {},
): { profiles: ExecutionProfileView[]; dropped: string[] } {
  const max = options.maxProfiles ?? 128
  const seen = new Set<string>()
  const views: ExecutionProfileView[] = []
  const dropped: string[] = []

  for (const profile of profiles) {
    if (seen.has(profile.id)) {
      // Unique ids are a contract rule: a duplicate is never emitted twice.
      dropped.push(profile.id)
      continue
    }
    if (views.length >= max) {
      dropped.push(profile.id)
      continue
    }
    seen.add(profile.id)
    views.push(toView(profile))
  }
  return { profiles: views, dropped }
}

function toView(profile: CatalogProfileInput): ExecutionProfileView {
  const fixture = profile.kind === 'controlled_fixture'
  const readiness = projectReadiness(profile, fixture)
  const allowed = allowsDispatch(profile, fixture, readiness)
  const blockReason = allowed ? undefined : blockedReason(profile, readiness)

  // Deliberately no executable, argv, nativeConfigRef, permissionPolicyRevision, identity digests or
  // evidence references: those are backend-only facts.
  return {
    id: profile.id,
    revision: profile.revision,
    displayName: profile.displayName,
    driverId: profile.driverId,
    kind: profile.kind,
    readiness,
    dispatchAllowed: allowed,
    ...(blockReason === undefined ? {} : { blockedReason: blockReason }),
  }
}

function projectReadiness(profile: CatalogProfileInput, fixture: boolean): ExecutionProfileView['readiness'] {
  if (fixture) {
    // A fixture is `fixture_ready` by declaration and every other state would be a lie.
    return 'fixture_ready'
  }
  // `fixture_ready` is not a legal native state.
  if (profile.readiness === 'fixture_ready') return 'not_tested'
  return profile.readiness
}

function allowsDispatch(profile: CatalogProfileInput, fixture: boolean, readiness: ExecutionProfileView['readiness']): boolean {
  if (fixture) return profile.admitted
  // Native dispatch needs a real native test plus explicit trusted admission.
  return profile.admitted && readiness === 'native_test_passed'
}

function blockedReason(profile: CatalogProfileInput, readiness: ExecutionProfileView['readiness']): AppErrorCode {
  if (!profile.admitted) return 'unsupported_capability'
  const mapped = BLOCKED_BY[readiness]
  if (mapped !== undefined) return mapped
  // Inspection passed (or untested) but no native test: execution is not yet permitted.
  return 'policy_unprepared'
}

/** A display name the console can show; it never contains a filesystem path or token. */
export function safeDisplayName(id: string, candidate?: string): string {
  const trimmed = candidate?.trim()
  if (trimmed && trimmed.length > 0 && trimmed.length <= 120 && !trimmed.includes('/') && !trimmed.includes('\\')) {
    return trimmed
  }
  return id
}
