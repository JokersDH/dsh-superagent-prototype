/**
 * Shared compatibility classification (Milestone 04).
 *
 * One implementation produces the four user-visible facts the product needs, on top of the existing
 * frozen contracts (`AgentProfile`, `CompatibilityIdentity`, `CapabilityObservation`, `ProbeReport`):
 *
 *   verified             - exact executable/version/wire/schema tuple already has original native
 *                          evidence supplied by the caller; this module never manufactures it
 *   compatible_unverified- the protocol surface actually used by the Driver is present and the
 *                          probe/identity/config are complete, but this exact tuple has no native
 *                          evidence; a caller may offer an explicit trial admission only through the
 *                          public contract, never as native_test_passed
 *   incompatible         - a concrete protocol/identity/capability mismatch; disabled
 *   unknown              - probe missing/failed/timed-out/auth/setup or unverifiable evidence;
 *                          disabled, never treated as compatible
 *
 * It does not read the filesystem, execute a CLI or write a Store. Driver probes supply observed
 * facts; main/D consume the verdict and own product admission.
 */
import type {
  AgentProfile,
  CapabilityObservation,
  CompatibilityIdentity,
  ProbeReport,
} from '../../contracts/src/types.ts'

export type CompatibilityClass = 'verified' | 'compatible_unverified' | 'incompatible' | 'unknown'
export type CompatibilityAdmission = 'native' | 'trial' | 'disabled'

export type ProtocolSurface = {
  /** e.g. `codex-app-server-json-schema` / `acp-v1` */
  wireVersion: string
  /** Canonical digest of the observed method/params/enums/notification surface. */
  schemaDigest: string
  /** Client -> agent request methods actually present in the observed schema/handshake. */
  methods: readonly string[]
  /** Per-method params fields (only fields the Driver actually uses are required later). */
  requestFields: Readonly<Record<string, readonly string[]>>
  /** Enum values observed anywhere in that method's params/response schema. */
  enums: Readonly<Record<string, readonly string[]>>
  /** Agent -> client notification methods present in the schema/handshake. */
  notifications: readonly string[]
  /** Agent -> client server-request methods (permission/question style). */
  serverRequests: readonly string[]
  /** JSON-RPC id types the peer can emit for server requests (e.g. integer/string). */
  requestIdTypes: readonly string[]
  /** Observed JSON types per method/field (from the actual schema, not only field names). */
  fieldTypes?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
  /** Fields the actual schema marks required per method. */
  requiredFields?: Readonly<Record<string, readonly string[]>>
}

export type RequiredSurface = {
  wireVersion?: string
  methods: readonly string[]
  requestFields: Readonly<Record<string, readonly string[]>>
  enums: Readonly<Record<string, readonly string[]>>
  notifications: readonly string[]
  /** Regex source; every observed server-request method matching this pattern counts as covered. */
  serverRequestPatterns?: readonly string[]
  /** Required values of `requestIdTypes`, e.g. ['integer','string']. */
  requestIdTypes?: readonly string[]
  /** Required observed JSON types per method/field. */
  fieldTypes?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>
  /** Fields that must be schema-required per method. */
  requiredFields?: Readonly<Record<string, readonly string[]>>
}

export type SurfaceObservation =
  | { status: 'observed'; surface: ProtocolSurface; evidenceRefs: readonly string[] }
  /** A real handshake observed only part of the surface; this can never be called compatible. */
  | { status: 'partial'; surface: ProtocolSurface; reason: string; evidenceRefs: readonly string[] }
  | { status: 'missing' | 'failed' | 'timeout'; reason: string; evidenceRefs: readonly string[] }

export type VerifiedVersion = {
  profileId: string
  profileRevision: number
  driverId: string
  nativeVersion: string
  executableDigest: string
  driverRelease: string
  wireVersion: string
  schemaDigest: string
  /** Original native acceptance evidence reference; the caller must have actually verified it. */
  evidenceRef: string
}

export type CompatibilityInput = {
  profile: AgentProfile
  probe: ProbeReport
  surface: SurfaceObservation
  required: RequiredSurface
  verifiedVersions?: readonly VerifiedVersion[]
  /** The machine the probe ran on; identity arguments are part of compatibility, not presentation. */
  environment?: { platform: string; architecture: string; runtimeVersion: string }
}

export type MissingEvidence = {
  methods: string[]
  requestFields: string[]
  enums: string[]
  notifications: string[]
  serverRequests: string[]
  requestIdTypes: string[]
  fieldTypes: string[]
  requiredFields: string[]
}

export type CompatibilityVerdict = {
  class: CompatibilityClass
  /** Existing public readiness, chosen so native dispatch cannot be granted by an unverified probe. */
  readiness: ProbeReport['readiness']
  admission: CompatibilityAdmission
  nativeTestPassed: boolean
  identity?: CompatibilityIdentity | undefined
  capabilities: readonly CapabilityObservation[]
  missing: MissingEvidence
  reasons: string[]
  evidenceRefs: string[]
  checkedAt: string
}

const DIGEST = /^[a-f0-9]{64}$/
const emptyMissing = (): MissingEvidence => ({ methods: [], requestFields: [], enums: [], notifications: [], serverRequests: [], requestIdTypes: [], fieldTypes: [], requiredFields: [] })

/** Classify one probe result without widening any permission. */
export function classifyCompatibility(input: CompatibilityInput): CompatibilityVerdict {
  const reasons: string[] = []
  const evidence = new Set<string>(input.probe.evidenceRefs)
  const missing = emptyMissing()
  const base = {
    capabilities: input.probe.capabilities,
    identity: input.probe.identity,
    evidenceRefs: [...evidence],
    checkedAt: input.probe.checkedAt,
  }
  const unknown = (reason: string): CompatibilityVerdict => ({
    ...base, class: 'unknown', readiness: 'needs_setup', admission: 'disabled', nativeTestPassed: false,
    missing, reasons: [...reasons, reason],
  })
  const incompatible = (reason: string, extra: { identity?: CompatibilityIdentity } = {}): CompatibilityVerdict => ({
    ...base, ...extra, class: 'incompatible', readiness: 'incompatible', admission: 'disabled', nativeTestPassed: false,
    missing, reasons: [...reasons, reason],
  })

  // Probe-level states are distinct: missing setup/auth/executable is unknown, not "compatible".
  if (input.surface.status === 'partial') {
    for (const ref of input.surface.evidenceRefs) evidence.add(ref)
    return unknown(`probe_partial:${input.surface.reason}`)
  }
  if (input.surface.status !== 'observed') {
    for (const ref of input.surface.evidenceRefs) evidence.add(ref)
    return unknown(`probe_${input.surface.status}:${input.surface.reason}`)
  }
  for (const ref of input.surface.evidenceRefs) evidence.add(ref)
  if (input.probe.readiness === 'missing') return unknown('executable_missing')
  if (input.probe.readiness === 'needs_auth') return unknown('auth_required')
  if (input.probe.readiness === 'needs_setup') return unknown('setup_incomplete')
  if (input.probe.readiness === 'incompatible') return incompatible('probe_incompatible')
  const identity = input.probe.identity
  if (!identity) return unknown('identity_unavailable')
  if (identity.profileId !== input.profile.id || identity.profileRevision !== input.profile.revision)
    return incompatible('identity_profile_mismatch')
  if (identity.driverApiMajor !== 1) return incompatible('driver_api_major_mismatch')
  if (identity.driverRelease !== input.profile.driverRelease) return incompatible('driver_release_mismatch')
  if (!DIGEST.test(identity.executableDigest)) return unknown('executable_digest_unverified')
  if (!DIGEST.test(identity.schemaDigest)) return unknown('schema_digest_unverified')
  if (!DIGEST.test(identity.resolvedConfigFingerprint)) return unknown('config_fingerprint_unverified')
  if (identity.configStability === 'unverified') return unknown('config_stability_unverified')
  if (identity.permissionPolicyRevision !== input.profile.permissionPolicyRevision) return incompatible('permission_policy_mismatch')
  if (input.environment) {
    if (identity.platform !== input.environment.platform || identity.architecture !== input.environment.architecture)
      return incompatible('environment_mismatch')
    if (identity.runtimeVersion !== input.environment.runtimeVersion) return incompatible('runtime_version_mismatch')
  }
  const surface = input.surface.surface
  if (input.required.wireVersion !== undefined && input.required.wireVersion !== surface.wireVersion)
    return incompatible('wire_version_mismatch')
  if (identity.wireVersion !== surface.wireVersion) return incompatible('identity_wire_mismatch')
  if (identity.schemaDigest !== surface.schemaDigest) return incompatible('identity_schema_mismatch')

  diffRequiredSurface(surface, input.required, missing)
  if (missing.methods.length || missing.requestFields.length || missing.enums.length ||
      missing.notifications.length || missing.serverRequests.length || missing.requestIdTypes.length ||
      missing.fieldTypes.length || missing.requiredFields.length) {
    for (const item of [...missing.methods.map(x => `method:${x}`), ...missing.requestFields.map(x => `field:${x}`),
      ...missing.enums.map(x => `enum:${x}`), ...missing.notifications.map(x => `notification:${x}`),
      ...missing.serverRequests.map(x => `serverRequest:${x}`), ...missing.requestIdTypes.map(x => `requestId:${x}`),
      ...missing.fieldTypes.map(x => `fieldType:${x}`), ...missing.requiredFields.map(x => `requiredField:${x}`)])
      reasons.push(`missing_${item}`)
    return incompatible('protocol_surface_incomplete')
  }

  const requiredCapabilities = input.profile.requiredFeatures
  const byFeature = new Map(input.probe.capabilities.map(item => [item.feature, item]))
  for (const feature of requiredCapabilities) {
    const capability = byFeature.get(feature)
    if (!capability) { missing.enums.push(`capability:${feature}`); reasons.push(`capability_missing:${feature}`); return incompatible('required_capability_unobserved') }
    if (capability.test !== 'PASS') { reasons.push(`capability_not_passed:${feature}`); return incompatible('required_capability_not_passed') }
    if (capability.policy === 'blocked') { reasons.push(`capability_blocked:${feature}`); return incompatible('required_capability_blocked') }
    for (const ref of capability.evidenceRefs) evidence.add(ref)
  }

  const verified = (input.verifiedVersions ?? []).find(item =>
    item.profileId === input.profile.id && item.profileRevision === input.profile.revision &&
    item.driverId === input.profile.driverId && item.nativeVersion === identity.nativeVersion &&
    item.executableDigest === identity.executableDigest && item.driverRelease === identity.driverRelease &&
    item.wireVersion === identity.wireVersion && item.schemaDigest === identity.schemaDigest &&
    item.evidenceRef.length > 0)
  if (verified) {
    evidence.add(verified.evidenceRef)
    reasons.push(`verified_native_evidence:${verified.evidenceRef}`)
    return {
      ...base, identity, class: 'verified', readiness: 'inspection_passed', admission: 'native',
      nativeTestPassed: true, missing, reasons, evidenceRefs: [...evidence],
    }
  }
  reasons.push(identity.nativeVersion === input.profile.expectedVersion
    ? 'exact_version_without_native_evidence'
    : `unverified_version:${identity.nativeVersion}`)
  reasons.push('protocol_surface_observed')
  // This is a recommendation only. The public contract must expose an explicit trial admission before
  // main may dispatch it; it is never written as native_test_passed.
  return {
    ...base, identity, class: 'compatible_unverified', readiness: 'inspection_passed', admission: 'trial',
    nativeTestPassed: false, missing, reasons, evidenceRefs: [...evidence],
  }
}

function diffRequiredSurface(surface: ProtocolSurface, required: RequiredSurface, missing: MissingEvidence): void {
  const methods = new Set(surface.methods)
  for (const method of required.methods) if (!methods.has(method)) missing.methods.push(method)
  const observedFields = new Map(Object.entries(surface.requestFields).map(([method, fields]) => [method, new Set(fields)]))
  for (const [method, fields] of Object.entries(required.requestFields)) {
    const observed = observedFields.get(method)
    if (!observed) { missing.methods.push(method); continue }
    for (const field of fields) if (!observed.has(field)) missing.requestFields.push(`${method}.${field}`)
  }
  const observedEnums = new Map(Object.entries(surface.enums).map(([method, values]) => [method, new Set(values)]))
  for (const [method, values] of Object.entries(required.enums)) {
    const observed = observedEnums.get(method)
    if (!observed) { missing.enums.push(`${method} (no enum surface)`); continue }
    for (const value of values) if (!observed.has(value)) missing.enums.push(`${method}.${value}`)
  }
  const notifications = new Set(surface.notifications)
  for (const method of required.notifications) if (!notifications.has(method)) missing.notifications.push(method)
  const patterns = required.serverRequestPatterns ?? []
  for (const pattern of patterns) {
    let regex: RegExp
    try { regex = new RegExp(pattern) } catch { missing.serverRequests.push(`invalid-pattern:${pattern}`); continue }
    if (!surface.serverRequests.some(method => regex.test(method))) missing.serverRequests.push(pattern)
  }
  for (const idType of required.requestIdTypes ?? []) if (!surface.requestIdTypes.includes(idType)) missing.requestIdTypes.push(idType)
  for (const [method, fields] of Object.entries(required.fieldTypes ?? {})) {
    for (const [field, types] of Object.entries(fields)) {
      const observed = surface.fieldTypes?.[method]?.[field]
      if (!observed) { missing.fieldTypes.push(`${method}.${field}`); continue }
      // A required type must be among the observed alternatives; nullable additions are allowed.
      if (!types.every(type => observed.includes(type))) missing.fieldTypes.push(`${method}.${field}:${types.join('|')}`)
    }
  }
  for (const [method, fields] of Object.entries(required.requiredFields ?? {})) {
    const observed = new Set(surface.requiredFields?.[method] ?? [])
    for (const field of fields) if (!observed.has(field)) missing.requiredFields.push(`${method}.${field}`)
  }
}

/**
 * Project the verdict onto the existing frozen ProbeReport. It can never emit native_test_passed:
 * that fact belongs to original native evidence and trusted admission, not to a probe classifier.
 */
export function toProbeReport(verdict: CompatibilityVerdict): ProbeReport {
  return {
    ...(verdict.identity === undefined ? {} : { identity: verdict.identity }),
    capabilities: verdict.capabilities,
    readiness: verdict.readiness,
    checkedAt: verdict.checkedAt,
    evidenceRefs: [...new Set([...verdict.evidenceRefs,
      `compatibility:${verdict.class}`, `admission:${verdict.admission}`])],
  }
}
