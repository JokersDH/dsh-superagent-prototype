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
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

function run(command, args, timeoutMs = 20_000) {
  try {
    const value = execFileSync(command, args, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { ok: true, value }
  } catch (error) {
    return { ok: false, value: null, error: String(error?.message ?? error) }
  }
}

/**
 * Resolve the exact execution identity.
 *
 * `sha256` of the real file is what makes the identity comparable across upgrades: a version string
 * can repeat while the bytes change. Both are reported, and either being missing fails the light.
 */
export function resolveRuntimeIdentity({ binary = 'codex' } = {}) {
  const located = run('sh', ['-c', `command -v ${binary} 2>/dev/null || true`])
  const declaredPath = located.value || null
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
  const version = declaredPath ? run(binary, ['--version']) : { ok: false, value: null, error: 'binary not on PATH' }
  return {
    binary,
    declaredPath,
    realPath,
    digest,
    bytes,
    version: version.ok ? version.value : null,
    versionRaw: version.ok ? version.value : null,
    versionError: version.ok ? null : version.error,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    /** A model/provider pair, when a caller has already measured one. Never guessed here. */
    model: null,
    modelProvider: null,
  }
}

/** Is a kernel-enforced host mechanism actually usable here? Measured by executing it. */
export function probeHostEnforcement() {
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
function privateFacts() {
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
export function describeRuntime(options = {}) {
  const { binary = 'codex', includePrivate = false, capabilities = {} } = options
  const observed = resolveRuntimeIdentity({ binary })
  // Paths are private facts. The default projection publishes a redacted identity - enough to
  // compare and diagnose, not enough to disclose where this user keeps the tool. main owns the
  // decision to widen it, which is why the full form only appears behind includePrivate.
  const identity = includePrivate
    ? observed
    : {
        ...observed,
        declaredPath: observed.declaredPath ? '[redacted]' : null,
        realPath: observed.realPath ? '[redacted]' : null,
        pathRedacted: true,
      }
  const enforcement = probeHostEnforcement()

  const reasons = []
  // Usability is judged on the observed identity. Judging it on the redacted projection would make
  // every redacted description look unusable.
  if (!observed.declaredPath) reasons.push(`binary "${binary}" was not found on PATH`)
  else if (!observed.realPath) reasons.push('the binary path could not be resolved to a real file')
  else if (!observed.digest) reasons.push('the binary digest could not be read, so the identity is not comparable')
  if (identity.version === null) reasons.push(`the version could not be read: ${identity.versionError}`)
  if (!PROBED_PLATFORMS.includes(process.platform)) {
    reasons.push(`platform ${process.platform} is not probed by this module, so no local capability can be claimed`)
  }

  // A caller may supply measured protocol facts (model/provider, turn field presence, pricing).
  const supplied = capabilities ?? {}
  const rows = CAPABILITY_ROWS.map(row => {
    const override = supplied[row.id]
    const state = override?.state ?? defaultStateFor(row.id, { identity: observed, enforcement })
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

  return {
    protocol: 'runtime-description/1',
    usable,
    /** Only ever true when nothing blocks a billable run. Kept separate so a UI cannot conflate. */
    billableAdmitted: usable && blocked.length === 0,
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
function defaultStateFor(id, { identity, enforcement }) {
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
function invalidationFor(id, state) {
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
export function descriptionDigest(description) {
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
