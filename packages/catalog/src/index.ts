/**
 * Agent catalog (WP-06).
 *
 * A catalog entry is what we can *prove* about one installed agent: its executable identity, the
 * config fingerprint we resolved, the capabilities we actually observed, and the readiness state.
 * Everything here is derived from the frozen `AgentProfile` / `CompatibilityIdentity` /
 * `ProbeReport` / `CapabilityObservation` types — this package adds no vendor brand branch and no
 * private wire type, and it never reads credentials or a private native home.
 *
 * Readiness is deliberately a closed set with distinct causes so an unproven agent can never be
 * mistaken for a working one:
 *
 *   missing          -> the executable does not exist
 *   needs_setup      -> it exists but the required config/profile is absent
 *   needs_auth       -> it needs an interactive login we must not perform automatically
 *   incompatible     -> version/wire/schema does not match the pinned expectation
 *   inspection_passed-> read-only probe succeeded; capability evidence recorded
 *   native_test_passed-> a real native handshake was exercised (NOT produced by this package)
 */
import type {
  AgentProfile,
  CapabilityObservation,
  CompatibilityIdentity,
  ProbeReport,
} from '../../contracts/src/types.ts'
import {
  resolveProfileRef,
  type ExecutionProfileRef,
  type Resolution,
  type ResolveOptions,
} from './profile-ref.ts'

export type { ExecutionProfileRef, Resolution, ResolveOptions, ResolutionRefusal, CapabilityClass } from './profile-ref.ts'
export { CAPABILITY_CLASSES, capabilityClassOf, identityDigestOf, refFor, resolveProfileRef } from './profile-ref.ts'

export type Readiness = ProbeReport['readiness']

/** Facts a probe may gather without starting a model task. */
export type ProbeFacts = {
  /** Absolute executable path that was inspected. */
  executable: string
  exists: boolean
  /** sha256 of the executable bytes, when readable. */
  digest?: string
  /** Reported version string, e.g. `0.1.4`. */
  version?: string
  /** Resolved config fingerprint; absent when no config could be read. */
  configFingerprint?: string
  configStability?: CompatibilityIdentity['configStability']
  /** Set when the profile requires an interactive login. */
  requiresAuth?: boolean
  /** Capabilities the profile requires; each must be observed or the entry is incompatible. */
  observedFeatures?: Record<string, { advertised: unknown; observed: unknown; policy: CapabilityObservation['policy'] }>
}

export type CatalogEntryInput = {
  profile: AgentProfile
  facts: ProbeFacts
  checkedAt: string
  /** Wire/schema identity established by the protocol layer, when it already knows one. */
  wire?: { wireVersion: string; schemaDigest: string; sdkVersion?: string; sdkEntrypoint?: string }
  /** Free-form evidence references gathered by the probe. */
  evidenceRefs?: string[]
}

/** What the catalog keeps per profile revision. */
export type CatalogEntry = {
  profileId: string
  profileRevision: number
  readiness: Readiness
  /** Absent unless readiness reached at least `inspection_passed`. */
  identity?: CompatibilityIdentity
  capabilities: CapabilityObservation[]
  /** Why the entry is not ready, when it is not. */
  diagnosis: string[]
  evidenceRefs: string[]
  checkedAt: string
}

const DIGEST = /^[a-f0-9]{64}$/

/**
 * Build a catalog entry from probe facts.
 *
 * The order of the checks is the order of precedence: an entry can only claim
 * `inspection_passed` when the executable, the config, the required capabilities and the pinned
 * version all check out. A missing feature is `incompatible`, never a silent downgrade.
 */
export function buildCatalogEntry(input: CatalogEntryInput): CatalogEntry {
  const { profile, facts } = input
  const diagnosis: string[] = []
  const evidenceRefs = [...(input.evidenceRefs ?? [])]

  if (facts.executable !== profile.executable) {
    diagnosis.push(`executable mismatch: profile pins ${profile.executable}, probe saw ${facts.executable}`)
  }
  if (!facts.exists) {
    return settle('missing', [...diagnosis, 'executable not found'])
  }
  if (facts.digest !== undefined && !DIGEST.test(facts.digest)) {
    diagnosis.push('executable digest is not a sha256 hex digest')
  }
  if (facts.requiresAuth) {
    // Authentication is an operator step; the catalog never performs it.
    return settle('needs_auth', [...diagnosis, 'profile requires interactive authentication'])
  }
  if (facts.configFingerprint === undefined || facts.configStability === 'unverified') {
    return settle('needs_setup', [...diagnosis, 'config could not be resolved and verified'])
  }
  if (!DIGEST.test(facts.configFingerprint)) {
    diagnosis.push('config fingerprint is not a sha256 hex digest')
    return settle('needs_setup', diagnosis)
  }
  if (facts.version !== undefined && facts.version !== profile.expectedVersion) {
    return settle('incompatible', [...diagnosis, `version ${facts.version} != expected ${profile.expectedVersion}`])
  }
  if (facts.version === undefined) {
    diagnosis.push('version could not be read')
    return settle('incompatible', diagnosis)
  }

  const capabilities = describeCapabilities(profile, facts)
  const missing = capabilities.filter(item => item.test !== 'PASS' && profile.requiredFeatures.includes(item.feature))
  if (missing.length > 0) {
    diagnosis.push(`required features not demonstrated: ${missing.map(item => item.feature).join(', ')}`)
    return settle('incompatible', diagnosis, capabilities)
  }

  const identity: CompatibilityIdentity = {
    profileId: profile.id,
    profileRevision: profile.revision,
    executableDigest: facts.digest ?? '',
    nativeVersion: facts.version,
    driverRelease: profile.driverRelease,
    driverApiMajor: 1,
    ...(input.wire?.sdkVersion === undefined ? {} : { sdkVersion: input.wire.sdkVersion }),
    ...(input.wire?.sdkEntrypoint === undefined ? {} : { sdkEntrypoint: input.wire.sdkEntrypoint }),
    wireVersion: input.wire?.wireVersion ?? 'unknown',
    schemaDigest: input.wire?.schemaDigest ?? '0'.repeat(64),
    resolvedConfigFingerprint: facts.configFingerprint,
    permissionPolicyRevision: profile.permissionPolicyRevision,
    configStability: facts.configStability ?? 'unverified',
    platform: process.platform,
    architecture: process.arch,
    runtimeVersion: process.version,
  }
  if (identity.executableDigest.length === 0) {
    diagnosis.push('executable digest unavailable; identity is incomplete')
    return settle('needs_setup', diagnosis, capabilities)
  }
  return { ...settle('inspection_passed', diagnosis, capabilities, evidenceRefs), identity }

  function settle(
    readiness: Readiness,
    notes: string[] = diagnosis,
    caps: CapabilityObservation[] = [],
    refs: string[] = evidenceRefs,
  ): CatalogEntry {
    return {
      profileId: profile.id,
      profileRevision: profile.revision,
      readiness,
      capabilities: caps,
      diagnosis: notes,
      evidenceRefs: refs,
      checkedAt: input.checkedAt,
    }
  }
}

function describeCapabilities(profile: AgentProfile, facts: ProbeFacts): CapabilityObservation[] {
  const observed = facts.observedFeatures ?? {}
  return profile.requiredFeatures.map(feature => {
    const found = observed[feature]
    if (!found) {
      return { feature, advertised: {}, observed: {}, test: 'NOT_TESTED' as const, policy: 'blocked' as const, evidenceRefs: [] }
    }
    return {
      feature,
      advertised: found.advertised as never,
      observed: found.observed as never,
      // A capability may only be called PASS when the probe actually observed it.
      test: 'PASS' as const,
      policy: found.policy,
      evidenceRefs: [`capability-${feature}`],
    }
  })
}

/** An entry may be scheduled only after inspection or a native test; nothing else qualifies. */
export function schedulable(entry: CatalogEntry): boolean {
  return entry.readiness === 'inspection_passed' || entry.readiness === 'native_test_passed'
}

/**
 * Compare a new probe with the entry it replaces. Any identity change invalidates the old entry:
 * a binary, config or permission-policy drift must never inherit a previous approval.
 */
export function driftBetween(previous: CatalogEntry | undefined, next: CatalogEntry): { drifted: boolean; reasons: string[] } {
  if (!previous?.identity || !next.identity) {
    return { drifted: previous?.readiness !== next.readiness, reasons: ['identity unavailable; readiness compared only'] }
  }
  const reasons: string[] = []
  const fields = [
    'executableDigest',
    'nativeVersion',
    'driverRelease',
    'wireVersion',
    'schemaDigest',
    'resolvedConfigFingerprint',
    'permissionPolicyRevision',
    'configStability',
    'platform',
    'architecture',
  ] as const
  for (const field of fields) {
    if (previous.identity[field] !== next.identity[field]) reasons.push(`${field} changed`)
  }
  return { drifted: reasons.length > 0, reasons }
}

/** In-memory catalog: one entry per profile id, newest revision wins. */
export class AgentCatalog {
  readonly #entries = new Map<string, CatalogEntry>()
  /** Retained revisions per profile id, oldest first, so a pinned ref can be honoured exactly. */
  readonly #history = new Map<string, CatalogEntry[]>()

  record(entry: CatalogEntry): { entry: CatalogEntry; drifted: boolean; reasons: string[] } {
    const previous = this.#entries.get(entry.profileId)
    const drift = driftBetween(previous, entry)
    this.#entries.set(entry.profileId, entry)
    const history = this.#history.get(entry.profileId) ?? []
    const withoutSame = history.filter(item => item.profileRevision !== entry.profileRevision)
    this.#history.set(entry.profileId, [...withoutSame, entry].sort((a, b) => a.profileRevision - b.profileRevision))
    return { entry, ...drift }
  }

  get(profileId: string): CatalogEntry | undefined {
    return this.#entries.get(profileId)
  }

  list(): CatalogEntry[] {
    return [...this.#entries.values()]
  }

  /** Profiles that may be dispatched; everything else needs an operator or a new probe. */
  schedulableProfiles(): CatalogEntry[] {
    return this.list().filter(schedulable)
  }

  /**
   * Every retained revision for one profile id, oldest first.
   *
   * `get()` answers "what is current", which is not enough to honour an `ExecutionProfileRef`:
   * a caller that pinned a revision needs that revision, or an explicit refusal. Retaining the
   * history (bounded per id) lets `resolveProfileRef` distinguish "this exact revision drifted"
   * from "this revision is gone" instead of collapsing both into the newest entry.
   */
  revisions(profileId: string): CatalogEntry[] {
    return (this.#history.get(profileId) ?? []).slice()
  }

  /** Resolve an exact profile reference against this catalog's retained revisions. */
  resolveRef(ref: ExecutionProfileRef, options: ResolveOptions = {}): Resolution {
    return resolveProfileRef(this.#allRevisions(), ref, options)
  }

  #allRevisions(): CatalogEntry[] {
    const all: CatalogEntry[] = []
    for (const entries of this.#history.values()) all.push(...entries)
    return all
  }
}
