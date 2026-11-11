/**
 * Stable consumption interface for `ExecutionProfileRef` (wave-05 B1).
 *
 * A ref names one *exact* admitted profile revision: `{profileId, revision, identityDigest}`.
 * The contract type is main-owned (`packages/contracts/src/routing-review.ts`); this module is
 * the catalog-side resolver that turns a ref into a dispatchable entry, or refuses.
 *
 * Why this exists: `AgentCatalog` is keyed by `profileId` and keeps only the newest revision, so
 * a caller holding a ref cannot ask "give me this revision" and cannot tell that the entry it
 * got back is a *different* revision from the one it referenced. Resolving by bare profile id
 * silently upgrades to whatever was probed last, which is exactly the "latest same-name" mistake
 * review advice must never make. Also, a probe that observes identity drift replaces the entry,
 * so a previously admitted revision must stop resolving rather than inherit the new approval.
 *
 * Nothing here sends a native or model call; it is pure catalog lookup plus identity arithmetic.
 */
import { createHash } from 'node:crypto'
import type { CapabilityObservation } from '../../contracts/src/types.ts'
import type { CatalogEntry } from './index.ts'
import { driftBetween, schedulable } from './index.ts'

/** Structural mirror of the main-owned contract type. Kept local so this package owns no wire schema. */
export type ExecutionProfileRef = { profileId: string; revision: number; identityDigest: string }

const DIGEST = /^[a-f0-9]{64}$/

/**
 * Capability evidence classes, ordered weakest to strongest.
 *
 * A schema export or a fixture replay is *not* evidence that the real vendor binary behaves this
 * way. Downstream consumers ask for a minimum class and get `insufficient_evidence` instead of a
 * convenient upgrade, so a mock can never be promoted into "native compatible" by omission.
 *
 * Recording convention: a producer that actually exercised the vendor binary must include an
 * `evidenceRef` containing `actual_native` (or `native_tested`) for that observation. The default
 * requirement is `actual_native`, so forgetting the marker fails closed - the entry is refused
 * rather than silently trusted.
 */
export const CAPABILITY_CLASSES = ['schema', 'protocol_fixture', 'controlled', 'actual_native'] as const
export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number]

const CLASS_RANK: Readonly<Record<CapabilityClass, number>> = {
  schema: 0,
  protocol_fixture: 1,
  controlled: 2,
  actual_native: 3,
}

/**
 * Derive the identity digest a ref must carry for this entry.
 *
 * The digest covers exactly the fields `driftBetween` treats as approval-invalidating, in a fixed
 * order, so any binary/config/policy/version change produces a different digest and an old ref
 * stops resolving. An entry without identity has no digest and therefore cannot be referenced.
 */
export function identityDigestOf(entry: CatalogEntry): string | undefined {
  if (!entry.identity) return undefined
  const identity = entry.identity
  const canonical = JSON.stringify([
    entry.profileId,
    entry.profileRevision,
    identity.executableDigest ?? null,
    identity.nativeVersion ?? null,
    identity.driverRelease ?? null,
    identity.wireVersion ?? null,
    identity.schemaDigest ?? null,
    identity.resolvedConfigFingerprint ?? null,
    identity.permissionPolicyRevision ?? null,
    identity.configStability ?? null,
    identity.platform ?? null,
    identity.architecture ?? null,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

/** Build the ref a consumer should persist for this exact entry. */
export function refFor(entry: CatalogEntry): ExecutionProfileRef | undefined {
  const identityDigest = identityDigestOf(entry)
  if (!identityDigest) return undefined
  return { profileId: entry.profileId, revision: entry.profileRevision, identityDigest }
}

export type ResolutionRefusal =
  | 'unknown_profile'
  | 'revision_mismatch'
  | 'identity_drift'
  | 'not_admitted'
  | 'insufficient_evidence'
  | 'capability_missing'

export type Resolution =
  | { ok: true; entry: CatalogEntry; ref: ExecutionProfileRef; capabilityClass: CapabilityClass }
  | { ok: false; reason: ResolutionRefusal; detail: string; current?: ExecutionProfileRef }

export type ResolveOptions = {
  /** Lowest evidence class the caller will accept. Defaults to the strongest: real native. */
  minimumCapabilityClass?: CapabilityClass
  /** Capability features the caller requires. All must be present and allowed. */
  requireFeatures?: readonly string[]
}

/**
 * Classify the evidence behind an entry. The class is the *weakest* link across observations, so
 * one fixture-backed capability cannot hide behind another that was actually tested natively.
 */
export function capabilityClassOf(entry: CatalogEntry): CapabilityClass {
  if (entry.capabilities.length === 0) return 'schema'
  let weakest = CLASS_RANK.actual_native
  for (const capability of entry.capabilities) {
    const declared = classOfObservation(capability)
    if (CLASS_RANK[declared] < weakest) weakest = CLASS_RANK[declared]
  }
  return CAPABILITY_CLASSES[weakest]!
}

function classOfObservation(capability: CapabilityObservation): CapabilityClass {
  // The frozen contract carries no explicit evidence-class field, so the class is inferred from
  // structured signals only - never from free text. `test` is decisive and is checked first: an
  // observation that did not pass was not observed at all, so no ref naming can promote it.
  if (capability.test !== 'PASS') return 'schema'
  const refs = (capability.evidenceRefs ?? []).join(' ').toLowerCase()
  // Substring (not word-boundary) matching: refs are chosen by producers and commonly look like
  // `actual_native-stop-probe`, where `_`/`-` are both word characters and `\b` would not match.
  if (refs.includes('actual_native') || refs.includes('actual-native')) return 'actual_native'
  if (refs.includes('native_tested') || refs.includes('native-tested')) return 'actual_native'
  if (refs.includes('controlled') || refs.includes('process_capture') || refs.includes('process-capture')) return 'controlled'
  if (refs.includes('fixture') || refs.includes('replay') || refs.includes('mock')) return 'protocol_fixture'
  // A passing observation with no class marker is an inspection-level fact, not a native claim.
  return 'schema'
}

/**
 * Resolve an exact ref to its admitted entry.
 *
 * Every refusal is a distinct reason so a consumer can report *why* it did not dispatch, and no
 * refusal ever falls back to a nearby revision or to the newest entry with the same name.
 */
export function resolveProfileRef(
  entries: readonly CatalogEntry[],
  ref: ExecutionProfileRef,
  options: ResolveOptions = {},
): Resolution {
  if (typeof ref?.profileId !== 'string' || !Number.isInteger(ref?.revision) || ref.revision <= 0 || !DIGEST.test(ref?.identityDigest ?? '')) {
    return { ok: false, reason: 'unknown_profile', detail: 'the ref is not a well-formed ExecutionProfileRef' }
  }
  const sameName = entries.filter(entry => entry.profileId === ref.profileId)
  if (sameName.length === 0) {
    return { ok: false, reason: 'unknown_profile', detail: `no catalog entry for profile ${ref.profileId}` }
  }
  const exact = sameName.find(entry => entry.profileRevision === ref.revision)
  const newest = sameName.reduce((best, entry) => (entry.profileRevision > best.profileRevision ? entry : best))

  if (!exact) {
    // The referenced revision is gone. Report what is actually available instead of silently
    // substituting it - a revision is not interchangeable with its successor.
    const current = refFor(newest)
    return {
      ok: false,
      reason: 'revision_mismatch',
      detail: `profile ${ref.profileId} has no revision ${ref.revision}; catalog holds ${sameName.map(entry => entry.profileRevision).join(', ')}`,
      ...(current ? { current } : {}),
    }
  }

  const actualDigest = identityDigestOf(exact)
  if (!actualDigest) {
    return { ok: false, reason: 'identity_drift', detail: `revision ${ref.revision} has no verified identity to compare` }
  }
  if (actualDigest !== ref.identityDigest) {
    return {
      ok: false,
      reason: 'identity_drift',
      detail: `revision ${ref.revision} identity changed after the ref was taken`,
      current: { ...ref, identityDigest: actualDigest },
    }
  }

  // A newer revision must not be able to launder an older approval: if the newest revision
  // drifted from this one, the referenced approval no longer describes the installed software.
  if (newest.profileRevision !== exact.profileRevision) {
    const drift = driftBetween(exact, newest)
    if (drift.drifted) {
      return {
        ok: false,
        reason: 'identity_drift',
        detail: `revision ${newest.profileRevision} drifted from the referenced revision: ${drift.reasons.join(', ')}`,
        ...(refFor(newest) ? { current: refFor(newest)! } : {}),
      }
    }
  }

  if (!schedulable(exact)) {
    return { ok: false, reason: 'not_admitted', detail: `revision ${ref.revision} is ${exact.readiness}, not admitted for dispatch` }
  }

  const capabilityClass = capabilityClassOf(exact)
  const required = options.minimumCapabilityClass ?? 'actual_native'
  if (CLASS_RANK[capabilityClass] < CLASS_RANK[required]) {
    return {
      ok: false,
      reason: 'insufficient_evidence',
      detail: `capability evidence is ${capabilityClass}, below the required ${required}`,
    }
  }

  for (const feature of options.requireFeatures ?? []) {
    const observation = exact.capabilities.find(capability => capability.feature === feature)
    if (!observation) {
      return { ok: false, reason: 'capability_missing', detail: `revision ${ref.revision} never observed ${feature}` }
    }
    if (observation.policy !== 'allowed') {
      return { ok: false, reason: 'capability_missing', detail: `${feature} is ${observation.policy}, not allowed` }
    }
  }

  return { ok: true, entry: exact, ref: { ...ref }, capabilityClass }
}
