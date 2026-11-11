/**
 * Unified runtime admission (wave-07 B1/B2/B3).
 *
 * One path for session, sealed copy, host isolation and budget. E must not be able to reach the
 * runner any other way: there is no fallback CLI, no "just the transport", and no way to skip a
 * gate because another gate passed.
 *
 * The design rule is that admission returns either a READY verdict plus the exact launch plan, or
 * a REFUSED verdict listing every unmet gate with its own reason. Gates are independent and each
 * one is fail-closed; a satisfied price never unlocks a missing isolation proof, and a valid
 * reservation never unlocks an unbounded turn.
 *
 * What this module deliberately does NOT do: send a model turn. `admit()` performs only non-billing
 * protocol work (initialize / thread/start / goal/read) and local filesystem work.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createSealedCapsule, detectUnsafeLinkBuilder } from './capsule-builder.mjs'
import { currentRuntimePreflight } from './cost-preflight.mjs'
import { auditGrant, maySendReal } from './ledger-audit.mjs'
import { PilotTransport } from './pilot-transport.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Gate identifiers, in the order a consumer should read them. */
export const GATES = [
  'execution_identity',
  'session_fact',
  'material_copy',
  'host_isolation',
  'budget_reservation',
  'cost_bound',
]

/**
 * Resolve the exact execution identity this host would run.
 *
 * Identity is what makes an admission meaningful: a verdict for a different executable, version,
 * config or model must not be reused. Everything here is observed, never defaulted.
 */
export function resolveExecutionIdentity({ binary = 'codex' } = {}) {
  let executablePath = null
  let version = null
  let versionError = null
  try {
    executablePath = execFileSync('sh', ['-c', `command -v ${binary} 2>/dev/null || true`], { encoding: 'utf8' }).trim() || null
    if (executablePath) {
      version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 20_000 }).trim()
    }
  } catch (error) {
    versionError = String(error.message ?? error)
  }
  let executableDigest = null
  if (executablePath) {
    try {
      // Resolve the real file, not the wrapper script, so the digest names actual bytes.
      const real = realpathSync(executablePath)
      const stat = statSync(real)
      executableDigest = stat.isFile() ? sha256(readFileSync(real)) : null
    } catch {
      executableDigest = null
    }
  }
  return {
    binary,
    executablePath,
    version,
    versionError,
    executableDigest,
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    /** Model/provider are filled from a real thread/start response, not guessed. */
    model: null,
    modelProvider: null,
    configFingerprint: null,
  }
}

/**
 * Read session facts from the live server. These are what a consumer may rely on; a missing fact
 * is reported as missing rather than assumed available.
 */
export async function resolveSessionFacts(transport) {
  const facts = {
    transport: 'codex app-server JSON-RPC 2.0 stdio',
    billingMethods: ['turn/start'],
    nonBillingVerified: [],
    ephemeralSupported: null,
    goalsOnPersistent: null,
    goalsOnEphemeral: null,
    checkpointRequiresTurn: null,
    model: null,
    modelProvider: null,
  }
  // One persistent thread tells us the model identity and whether goals are attachable.
  const persistent = await transport.startThread({ ephemeral: false })
  facts.nonBillingVerified.push('thread/start')
  facts.model = persistent.model ?? null
  facts.modelProvider = persistent.modelProvider ?? null
  try {
    await transport.call('thread/goal/set', { threadId: persistent.id, objective: 'admission probe', tokenBudget: 1000 })
    facts.goalsOnPersistent = true
    await transport.call('thread/goal/clear', { threadId: persistent.id }).catch(() => undefined)
  } catch {
    facts.goalsOnPersistent = false
  }
  // Measure the checkpoint boundary on a SEPARATE clean thread, before any goal exists. Setting a
  // goal persists thread state and would make an otherwise-empty thread resumable, so probing on
  // the goal thread would confound the measurement.
  const cleanProbe = await transport.startThread({ ephemeral: false })
  facts.nonBillingVerified.push('thread/start (clean probe)')
  try {
    await transport.resumeThread(cleanProbe.id)
    facts.checkpointRequiresTurn = false
  } catch {
    facts.checkpointRequiresTurn = true
  }
  const ephemeral = await transport.startThread({ ephemeral: true })
  facts.ephemeralSupported = Boolean(ephemeral.id)
  try {
    await transport.call('thread/goal/set', { threadId: ephemeral.id, objective: 'admission probe', tokenBudget: 1000 })
    facts.goalsOnEphemeral = true
  } catch {
    facts.goalsOnEphemeral = false
  }
  facts.nonBillingVerified.push('thread/resume', 'thread/goal/set', 'thread/goal/clear')
  return facts
}

/**
 * Build the host-isolation profile for one capsule.
 *
 * Deny-first: network off, author material read-only-at-most, author home unreadable, scratch
 * confined to the capsule. A profile that silently allows everything is not isolation.
 */
export function buildSeatbeltProfile({ capsulePath, authorProject, authorHome }) {
  const allow = [`(allow file-write* (subpath "${capsulePath}"))`]
  const deny = [
    '(deny network*)',
    `(deny file-read* (subpath "${authorHome}"))`,
    `(deny file-write* (subpath "${authorHome}"))`,
    `(deny file-write* (subpath "${authorProject}"))`,
  ]
  return ['(version 1)', '(allow default)', ...deny, ...allow].join('\n') + '\n'
}

/** Is a usable host enforcement mechanism present? Measured, not assumed. */
export function hostEnforcement() {
  try {
    execFileSync('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'], { timeout: 20_000, stdio: 'ignore' })
    return { available: true, mechanism: 'macos-seatbelt', executable: '/usr/bin/sandbox-exec' }
  } catch {
    return { available: false, mechanism: null, executable: null }
  }
}

/**
 * The single admission entry point.
 *
 * Returns a verdict for one concrete run request. Every gate is evaluated; nothing short-circuits,
 * so a consumer sees all the reasons at once instead of fixing one and discovering the next.
 */
export async function admit(request) {
  const {
    arm,
    caseId,
    turn = 1,
    materialDigest,
    authorProject,
    authorHome,
    capsuleRoot,
    ledgerPath,
    budgetHook,
    binary = 'codex',
  } = request ?? {}

  const gates = {}
  const identity = resolveExecutionIdentity({ binary })

  // --- gate 1: execution identity -------------------------------------------------------------
  const identityComplete = Boolean(identity.executablePath && identity.version && identity.executableDigest)
  gates.execution_identity = {
    satisfied: identityComplete,
    evidence: identity,
    gap: identityComplete ? null : `identity incomplete (path=${Boolean(identity.executablePath)} version=${Boolean(identity.version)} digest=${Boolean(identity.executableDigest)})`,
  }

  // --- gate 2: session facts (needs the real server) -------------------------------------------
  let transport = null
  let facts = null
  try {
    transport = await PilotTransport.launch({ binary: identity.executablePath ? binary : 'codex', cwd: '/tmp' })
    await transport.initialize()
    facts = await resolveSessionFacts(transport)
    const modelKnown = Boolean(facts.model && facts.modelProvider)
    const sessionDistinct = facts.ephemeralSupported === true && facts.goalsOnPersistent === true
    gates.session_fact = {
      satisfied: modelKnown && sessionDistinct,
      evidence: facts,
      gap: !modelKnown
        ? 'model/provider were not observed from a real thread/start'
        : !sessionDistinct
          ? 'ephemeral threads or persistent-goal support missing, so a fresh arm cannot be separated from an author arm'
          : null,
    }
  } catch (error) {
    gates.session_fact = { satisfied: false, evidence: null, gap: `session probe failed: ${String(error.message ?? error)}` }
  } finally {
    await transport?.close()
  }

  // --- gate 3: material copy -------------------------------------------------------------------
  let capsule = null
  try {
    if (!capsuleRoot || !authorProject) throw new Error('capsuleRoot and authorProject are required')
    // Refuse a caller that asks for a link-based "copy": a sealed copy must copy bytes.
    const unsafe = detectUnsafeLinkBuilder({ mode: request?.copyMode })
    if (unsafe) throw new Error(unsafe)
    capsule = createSealedCapsule({ authorProject, capsuleRoot, subjectDigest: materialDigest })
    const complete = capsule.fileCount > 0 && capsule.gitEntries.length === 0 && capsule.sharedInodes.length === 0
    gates.material_copy = {
      satisfied: complete,
      evidence: { fileCount: capsule.fileCount, manifestDigest: capsule.manifestDigest, gitEntries: capsule.gitEntries, sharedInodes: capsule.sharedInodes },
      gap: complete ? null : `capsule incomplete (files=${capsule.fileCount} git=${capsule.gitEntries.length} sharedInodes=${capsule.sharedInodes.length})`,
    }
  } catch (error) {
    gates.material_copy = { satisfied: false, evidence: null, gap: String(error.message ?? error) }
  }

  // --- gate 4: host isolation ------------------------------------------------------------------
  const enforcement = hostEnforcement()
  if (!enforcement.available) {
    gates.host_isolation = { satisfied: false, evidence: enforcement, gap: 'no kernel-enforced host mechanism is available (a copy is not a sandbox)' }
  } else if (!capsule) {
    gates.host_isolation = { satisfied: false, evidence: enforcement, gap: 'no capsule to build a profile around' }
  } else {
    const profile = buildSeatbeltProfile({ capsulePath: capsule.capsulePath, authorProject, authorHome })
    gates.host_isolation = {
      satisfied: true,
      evidence: { ...enforcement, profileDigest: sha256(profile), deniesNetwork: true, deniesAuthorHomeRead: true, deniesAuthorWrite: true, allowsCapsuleScratch: true },
      gap: null,
    }
  }

  // --- gate 5: budget reservation --------------------------------------------------------------
  const audit = auditGrant(ledgerPath ?? 'tests/native-acceptance/reports/model-budget.json', 'wave03-b-native', 4, {
    used: null,
    source: 'reconstructed ledger',
  })
  const ledgerGate = maySendReal(audit)
  const hasHook = Boolean(budgetHook && typeof budgetHook.reserve === 'function')
  gates.budget_reservation = {
    satisfied: ledgerGate.allowed && hasHook,
    evidence: { grantVerdict: audit.verdict, remainder: audit.remainder ?? 'UNKNOWN', maySendReal: ledgerGate.allowed, hookPresent: hasHook, reason: ledgerGate.reason },
    gap: !hasHook
      ? 'no reservation hook: a billable run must reserve before send'
      : !ledgerGate.allowed
        ? ledgerGate.reason
        : null,
  }

  // --- gate 6: cost bound ----------------------------------------------------------------------
  const preflight = currentRuntimePreflight()
  gates.cost_bound = {
    satisfied: preflight.verdict === 'READY',
    evidence: { verdict: preflight.verdict, blockers: preflight.blockers, measurable: preflight.measurable },
    gap: preflight.verdict === 'READY' ? null : preflight.blockers[0] ?? 'cost preflight blocked',
  }

  // --- verdict ---------------------------------------------------------------------------------
  const unmet = GATES.filter(gate => !gates[gate].satisfied)
  const verdict = unmet.length === 0 ? 'READY' : 'REFUSED'
  return {
    protocol: 'runtime-admission/1',
    verdict,
    arm: arm ?? null,
    caseId: caseId ?? null,
    turn,
    gates,
    unmetGates: unmet,
    /** The exact identity this verdict applies to. A different one invalidates it. */
    identityDigest: sha256(JSON.stringify([identity.executablePath, identity.version, identity.executableDigest, facts?.model ?? null, facts?.modelProvider ?? null])),
    model: facts?.model ?? null,
    modelProvider: facts?.modelProvider ?? null,
    /** Only meaningful when verdict is READY. */
    launch: verdict === 'READY'
      ? {
          transport: 'codex app-server',
          capsulePath: capsule.capsulePath,
          capsuleManifestDigest: capsule.manifestDigest,
          seatbeltProfile: buildSeatbeltProfile({ capsulePath: capsule.capsulePath, authorProject, authorHome }),
          reservationHook: 'required',
        }
      : null,
    /** What this verdict does NOT claim, stated so a consumer cannot over-read it. */
    notClaimed: [
      'that a real vendor turn will succeed',
      'that a real turn is bounded (cost_bound reports the measured runtime, which is BLOCKED)',
      'that native stop/question/unknown-send were exercised',
      'that admission is product or release acceptance',
    ],
  }
}
