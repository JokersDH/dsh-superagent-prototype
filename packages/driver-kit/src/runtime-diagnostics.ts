/**
 * Production runtime diagnostics (wave-08 B1).
 *
 * This is the consumable library surface, not a test report. main, the launcher and the runner
 * entry are expected to import it; `tests/native-acceptance/runtime-diagnostics.mjs` becomes a thin
 * CLI over this module so there is exactly one description of the runtime.
 *
 * Three rules shape the design:
 *
 *   1. A green "executor usable" light is only ever derived from an OBSERVED identity. A missing
 *      binary, a version drift or an unsupported platform reports `not_usable` with the reason -
 *      it never degrades to "probably fine".
 *   2. Every fact carries the layer that produced it. A version string read from `--version` is not
 *      the same evidence as a measured protocol handshake, and neither of them is native
 *      compatibility evidence.
 *   3. Anything that could identify the machine or the user (home paths, store paths, credentials)
 *      is private by default and only appears when the caller asks for the private projection,
 *      which main owns.
 *
 * This module performs no thread creation, no turn and no profile mutation: `--version` and a
 * filesystem look are read-only.
 */
import { execFileSync } from 'node:child_process'
import { delimiter, isAbsolute, join as joinPath } from 'node:path'
import { createHash } from 'node:crypto'
import { accessSync, constants as fsConstants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One capability row. */
export type CapabilityRow = {
  id: string
  label: string
  state: string
  layer: string
  admitsBilling: boolean
  detail: string
  invalidation: string
}

/** A caller-supplied capability override. May only weaken a billing-relevant row. */
export type CapabilityOverride = { state?: string; layer?: string; detail?: string; invalidation?: string }

/** A caller-supplied model identity with provenance. */
export type ModelIdentityInput = { model?: string | null; modelProvider?: string | null; observedFrom?: string | null }

/** Options for {@link describeRuntime}. */
export type RuntimeDescriptionOptions = {
  binary?: string
  includePrivate?: boolean
  capabilities?: Record<string, CapabilityOverride>
  modelIdentity?: ModelIdentityInput | null
}

/** The observed identity of an installed CLI. */
export type RuntimeIdentity = {
  binary: string
  declaredPath: string | null
  realPath: string | null
  digest: string | null
  bytes: number | null
  version: string | null
  versionRaw: string | null
  versionError: string | null
  platform: string
  arch: string
  node: string
  model: string | null
  modelProvider: string | null
  pathRedacted?: boolean
  /** Every path the structural lookup considered, so a failure is diagnosable without a shell. */
  searchedPaths?: string[]
}

/** Measured host enforcement availability. */
export type HostEnforcement = { available: boolean; mechanism: string | null; executable: string | null; evidence: string }

/** Private machine facts, only present when explicitly requested. */
export type PrivateFacts = { home: string; platformHome: string; knownPaths: Array<{ path: string; present: boolean }> }

/** A blocked capability with what would invalidate its state. */
export type BlockedCapability = { id: string; label: string; state: string; invalidation: string }

/** The public runtime description. */
export type RuntimeDescription = {
  protocol: 'runtime-description/1'
  usable: boolean
  billableAdmitted: boolean
  billingReasons: string[]
  reasons: string[]
  identity: RuntimeIdentity
  enforcement: HostEnforcement
  capabilities: CapabilityRow[]
  blockedCapabilities: BlockedCapability[]
  modelIdentity: { model: string | null; modelProvider: string | null; observedFrom: string | null } | null
  pathRedacted: boolean
  notClaimed: string[]
  private?: PrivateFacts
}

/** Evidence layers, weakest to strongest for the claim each supports. */
export const EVIDENCE_LAYERS = Object.freeze([
  'declared', // read from a document or version string
  'observed_local', // read from this filesystem or a local process
  'measured_protocol', // a live protocol exchange was performed
  'measured_native', // a real vendor turn was executed
])

/** Capability cells. `absent` and `untested` are deliberately distinct. */
export const CAPABILITY_STATES = Object.freeze([
  'supported', // proven on this identity
  'absent', // proven not to exist
  'untested', // not exercised; never rendered as supported
  'unknown', // could not be determined
])

/**
 * The capability matrix this role can speak to. Each row names the layer that establishes it and
 * says explicitly whether it can ever be used to admit a billable run.
 */
const CAPABILITY_ROWS = Object.freeze([
  {
    id: 'binary_identity',
    label: 'exact executable and version resolve',
    layer: 'observed_local',
    admitsBilling: false,
    detail: 'path, real path and executable digest of the installed CLI',
  },
  {
    id: 'protocol_handshake',
    label: 'app-server answers initialize',
    layer: 'measured_protocol',
    admitsBilling: false,
    detail: 'proves transport and protocol version, not that any turn will succeed',
  },
  {
    id: 'session_start',
    label: 'thread/start returns a real thread id',
    layer: 'measured_protocol',
    admitsBilling: false,
    detail: 'also yields the model and provider actually served',
  },
  {
    id: 'checkpoint_resume',
    label: 'a thread checkpoint can be resumed or forked',
    layer: 'measured_protocol',
    admitsBilling: false,
    detail: 'requires an existing rollout, so a 0-turn thread cannot be resumed',
  },
  {
    id: 'turn_budget_field',
    label: 'a per-turn token ceiling can be expressed',
    layer: 'measured_protocol',
    admitsBilling: true,
    detail: 'turn/start exposes no token bound field on this version',
  },
  {
    id: 'pricing_surface',
    label: 'a checkable price exists for the served model',
    layer: 'measured_protocol',
    admitsBilling: true,
    detail: 'no price field in protocol, model list or config',
  },
  {
    id: 'host_isolation',
    label: 'the host can enforce network and filesystem scope',
    layer: 'observed_local',
    admitsBilling: false,
    detail: 'kernel-enforced profile availability, measured by executing a probe',
  },
  {
    id: 'native_control',
    label: 'real native stop/answer/steer were exercised',
    layer: 'measured_native',
    admitsBilling: true,
    detail: 'never exercised under the frozen grant; stays untested',
  },
])

/** Platforms whose local probing this module actually implements. */
const PROBED_PLATFORMS = Object.freeze(['darwin', 'linux'])

function run(command: string, args: string[], timeoutMs = 20_000): { ok: boolean; value: string | null; error?: string } {
  try {
    const value = execFileSync(command, args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { ok: true, value }
  } catch (error) {
    return { ok: false, value: null, error: (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Resolve the exact execution identity.
 *
 * `sha256` of the real file is what makes the identity comparable across upgrades: a version string
 * can repeat while the bytes change. Both are reported, and either being missing fails the light.
 */
/**
 * Resolve a binary to an absolute path WITHOUT a shell.
 *
 * Shelling out to `command -v <name>` loses a path that contains spaces or non-ASCII characters,
 * because the shell re-tokenizes it. An operator may legitimately select such an executable, so the
 * lookup is done structurally instead: an absolute input is used as given, and a bare name is
 * searched across PATH by joining and testing each entry.
 */
export function resolveExecutablePath(binary: string): { path: string | null; searched: string[]; reason: string | null } {
  const searched: string[] = []
  const isExecutableFile = (candidate: string): boolean => {
    try {
      // statSync follows symlinks: an operator-selected path is legitimately a symlink to the real
      // executable, so testing the link itself would reject a perfectly valid selection.
      const stat = statSync(candidate)
      if (!stat.isFile()) return false
      accessSync(candidate, fsConstants.X_OK)
      return true
    } catch {
      return false
    }
  }
  // An absolute or relative path is taken verbatim; no tokenization happens at all.
  if (isAbsolute(binary) || binary.includes('/')) {
    searched.push(binary)
    return isExecutableFile(binary)
      ? { path: binary, searched, reason: null }
      : { path: null, searched, reason: `"${binary}" is not an executable file` }
  }
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry === '') continue
    const candidate = joinPath(entry, binary)
    searched.push(candidate)
    if (isExecutableFile(candidate)) return { path: candidate, searched, reason: null }
  }
  return { path: null, searched, reason: `"${binary}" was not found in PATH` }
}

export function resolveRuntimeIdentity({ binary = 'codex' }: { binary?: string } = {}): RuntimeIdentity {
  const searched = resolveExecutablePath(binary)
  const declaredPath = searched.path
  const searchReason = searched.reason
  let realPath = null
  let digest = null
  let bytes = null
  if (declaredPath) {
    try {
      realPath = realpathSync(declaredPath)
      const stat = statSync(realPath)
      if (stat.isFile()) {
        bytes = stat.size
        digest = createHash('sha256').update(readFileSync(realPath)).digest('hex')
      }
    } catch {
      realPath = null
    }
  }
  // Invoke the RESOLVED absolute path so the version comes from the same file the digest covers.
  const version = declaredPath
    ? run(declaredPath, ['--version'])
    : { ok: false, value: null, error: searchReason ?? 'binary not found' }
  return {
    binary,
    declaredPath,
    realPath,
    digest,
    bytes,
    version: version.ok ? version.value : null,
    versionRaw: version.ok ? version.value : null,
    versionError: version.ok ? null : (version.error ?? searchReason ?? null),
    searchedPaths: searched.searched,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    /** A model/provider pair, when a caller has already measured one. Never guessed here. */
    model: null,
    modelProvider: null,
  }
}

/** Is a kernel-enforced host mechanism actually usable here? Measured by executing it. */
export function probeHostEnforcement(): HostEnforcement {
  if (process.platform === 'darwin') {
    const probe = run('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'])
    return probe.ok
      ? { available: true, mechanism: 'macos-seatbelt', executable: '/usr/bin/sandbox-exec', evidence: 'executed a trivial profile successfully' }
      : { available: false, mechanism: null, executable: null, evidence: 'sandbox-exec is not usable on this host' }
  }
  return {
    available: false,
    mechanism: null,
    executable: null,
    evidence: `no enforcement probe is implemented for platform ${process.platform}`,
  }
}

/**
 * Private machine facts. Separated out so main decides whether any of it is projected: the default
 * description must never leak a home directory or a store path.
 */
function privateFacts(): PrivateFacts {
  const home = homedir()
  const candidates = [
    join(home, '.codex', 'auth.json'),
    join(home, '.codex', 'config.toml'),
    join(home, '.codex', 'sessions'),
  ]
  return {
    home,
    platformHome: home,
    knownPaths: candidates.map(path => ({ path, present: existsSync(path) })),
  }
}

/**
 * Describe the runtime for a consumer.
 *
 * Returns either a usable executor description or an explicit refusal. The refusal path is not an
 * exception: main and the launcher need to render why, so it is a first-class result.
 */
/**
 * Validate a caller-supplied model identity.
 *
 * `measured` is true only when the caller names a real model and provider AND says where the values
 * came from. A bare pair with no provenance is not admitted as a measured identity.
 */
export function suppliedModelIdentity(input: ModelIdentityInput | null | undefined): { measured: boolean; value: { model: string | null; modelProvider: string | null; observedFrom: string | null } | null; problem: string | null } {
  if (input === undefined || input === null) {
    return { measured: false, value: null, problem: 'no model/provider was measured, so billing cannot be admitted' }
  }
  const { model, modelProvider, observedFrom } = input
  const value = { model: model ?? null, modelProvider: modelProvider ?? null, observedFrom: observedFrom ?? null }
  if (typeof model !== 'string' || model === '' || typeof modelProvider !== 'string' || modelProvider === '') {
    return { measured: false, value, problem: 'the model/provider values are missing, so billing cannot be admitted' }
  }
  if (typeof observedFrom !== 'string' || observedFrom === '') {
    return { measured: false, value, problem: 'the model/provider values carry no provenance, so they cannot be trusted as measured' }
  }
  return { measured: true, value, problem: null }
}

export function describeRuntime(options: RuntimeDescriptionOptions = {}): RuntimeDescription {
  const { binary = 'codex', includePrivate = false, capabilities = {} } = options
  const observed = resolveRuntimeIdentity({ binary })
  // Paths are private facts. The default projection publishes a redacted identity - enough to
  // compare and diagnose, not enough to disclose where this user keeps the tool. main owns the
  // decision to widen it, which is why the full form only appears behind includePrivate.
  // A bare command name is public; a caller-selected path can contain a home directory and is not.
  const publicBinary = isAbsolute(binary) || binary.includes('/') ? '[redacted]' : binary
  const identity = includePrivate
    ? observed
    : {
        ...observed,
        binary: publicBinary,
        // The version error quotes the path it tried, so it is private detail as well.
        versionError: observed.versionError === null ? null : '[redacted]',
        declaredPath: observed.declaredPath ? '[redacted]' : null,
        realPath: observed.realPath ? '[redacted]' : null,
        // The structural lookup records every candidate it tried, which are PATH entries and can
        // contain a home directory. The count is useful for a failure; the paths are private.
        // Spread rather than assign so the key is omitted entirely when there is nothing to say,
        // which is what exactOptionalPropertyTypes requires.
        ...(observed.searchedPaths
          ? { searchedPaths: [`[redacted ${observed.searchedPaths.length} candidate path(s)]`] }
          : {}),
        pathRedacted: true,
      }
  const enforcement = probeHostEnforcement()

  const reasons = []
  // Usability is judged on the observed identity. Judging it on the redacted projection would make
  // every redacted description look unusable.
  if (!observed.declaredPath) reasons.push(`binary "${publicBinary}" was not found on PATH`)
  else if (!observed.realPath) reasons.push('the binary path could not be resolved to a real file')
  else if (!observed.digest) reasons.push('the binary digest could not be read, so the identity is not comparable')
  if (identity.version === null) {
    // Keep the explanation useful without quoting a private path.
    reasons.push(includePrivate ? `the version could not be read: ${observed.versionError}` : `the version of "${publicBinary}" could not be read`)
  }
  if (!PROBED_PLATFORMS.includes(process.platform)) {
    reasons.push(`platform ${process.platform} is not probed by this module, so no local capability can be claimed`)
  }

  // A caller may supply measured protocol facts (model/provider, turn field presence, pricing).
  const supplied = capabilities ?? {}
  const rows = CAPABILITY_ROWS.map(row => {
    const override = supplied[row.id]
    const observedState = defaultStateFor(row.id, { identity: observed, enforcement })
    // A caller may REPORT a measurement, but never upgrade a billing-relevant row to supported.
    // Otherwise an override object would be a way to switch on admission, which is what wave-09
    // forbids: diagnostics report, they do not grant.
    const state =
      override?.state === undefined
        ? observedState
        : row.admitsBilling && override.state === 'supported'
          ? observedState
          : override.state
    return {
      id: row.id,
      label: row.label,
      state,
      layer: override?.layer ?? row.layer,
      admitsBilling: row.admitsBilling,
      detail: override?.detail ?? row.detail,
      invalidation: override?.invalidation ?? invalidationFor(row.id, state),
    }
  })

  const blocked = rows.filter(row => row.admitsBilling && row.state !== 'supported')
  const usable = reasons.length === 0
  // Billing needs a REAL model/provider pair from a measured source. A null identity, or one that
  // only exists because a caller claimed it, cannot produce the green light.
  // Billing reasons are separate from usability reasons: a missing measured model identity blocks
  // billing without claiming the executor is unusable.
  const modelIdentity = suppliedModelIdentity(options.modelIdentity)
  const billingReasons = modelIdentity.problem ? [modelIdentity.problem] : []

  return {
    protocol: 'runtime-description/1',
    usable,
    /** Only ever true when nothing blocks a billable run. Kept separate so a UI cannot conflate. */
    billableAdmitted: usable && blocked.length === 0 && billingReasons.length === 0 && modelIdentity.measured,
    billingReasons,
    modelIdentity: modelIdentity.value,
    reasons,
    identity,
    /** True when paths were withheld; main decides whether to publish the full form. */
    pathRedacted: !includePrivate,
    enforcement,
    capabilities: rows,
    blockedCapabilities: blocked.map(row => ({
      id: row.id,
      label: row.label,
      state: row.state,
      invalidation: row.invalidation,
    })),
    /** What this description is not allowed to be read as. */
    notClaimed: [
      'that any turn will succeed',
      'that native stop/question/reconciliation were exercised',
      'that this is product, install or release acceptance',
    ],
    ...(includePrivate ? { private: privateFacts() } : {}),
  }
}

/**
 * The default capability state for a row, derived only from what this module can observe.
 *
 * Billing-relevant rows default to `absent` on this version because the protocol surface was
 * measured and found to lack them; the measurement lives in the wave-07 dossier and is not
 * repeated here.
 */
function defaultStateFor(id: string, { identity, enforcement }: { identity: RuntimeIdentity; enforcement: HostEnforcement }): string {
  switch (id) {
    case 'binary_identity':
      return identity.declaredPath && identity.digest ? 'supported' : 'absent'
    case 'protocol_handshake':
    case 'session_start':
    case 'checkpoint_resume':
      // These need a live exchange; this module does not open one.
      return 'untested'
    case 'turn_budget_field':
    case 'pricing_surface':
      // Measured absent on this version (wave-07 B4); not re-probed here.
      return 'absent'
    case 'host_isolation':
      return enforcement.available ? 'supported' : 'absent'
    case 'native_control':
      return 'untested'
    default:
      return 'unknown'
  }
}

/** What would make this row's state stale. */
function invalidationFor(id: string, state: string): string {
  if (id === 'turn_budget_field' || id === 'pricing_surface') {
    return 'a protocol change that adds a per-turn ceiling or a price surface invalidates the absent verdict'
  }
  if (id === 'native_control') {
    return 'stays untested until a real native turn is executed under an admitted grant'
  }
  if (id === 'host_isolation') {
    return 'moving to a host without a usable enforcement mechanism invalidates a supported verdict'
  }
  return state === 'supported' ? 'a binary, version, digest or platform change invalidates this' : 'a measurement would be needed to change it'
}

/** Deterministic digest over the description minus volatile fields, so a consumer can detect drift. */
export function descriptionDigest(description: RuntimeDescription): string {
  const stable = {
    protocol: description.protocol,
    usable: description.usable,
    billableAdmitted: description.billableAdmitted,
    reasons: description.reasons,
    identity: {
      binary: description.identity.binary,
      digest: description.identity.digest,
      version: description.identity.version,
      platform: description.identity.platform,
      arch: description.identity.arch,
    },
    capabilities: description.capabilities.map(row => [row.id, row.state]),
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}
