/**
 * D4: local precondition gate for a *future* recovery activation.
 *
 * main owns the authority: committed source intent (`RecoveryActivationFacts`), target preparation,
 * activation and crash replay (WP-16/0026/0027). No HTTP commit is published yet, so this module
 * never authorizes anything. It evaluates explicit local facts against the exact main-owned intent
 * shape and returns a precise BLOCKED reason; when main publishes the commit/receipt route, D only
 * has to feed those facts in — it does not invent an authorization document, a second key store or a
 * scheduler, and it never writes the source state, marker, registry or old queue.
 */
import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

export const ACTIVATION_INTENT_PROTOCOL = 'recovery-activation-intent/1'

/** What main must publish before D can ever start a new execution state. */
export const ACTIVATION_CONSUMPTION_REQUIREMENTS = Object.freeze({
  status: 'BLOCKED',
  owner: 'main',
  publishedSoFar: [
    'GET /v1/recovery/inspect (read-only observation)',
    'POST /v1/recovery/prepare (read-only plan, authorization=not_granted, commitAvailable=false)',
    'packages/contracts/src/recovery-activation.ts RecoveryActivationIntent + RecoveryActivationFacts (internal source facts, not an HTTP grant)',
  ],
  notPublished: [
    'an HTTP/application commit route that returns the committed activation identity and a persistent receipt',
    'the target descriptor handoff D must consume (where to read it, its lifetime, replay semantics)',
    'crash replay semantics for an activation interrupted before/after target preparation',
  ],
  requiredInputs: [
    'committed source intent: activationId, commandId, planId, planDigest, source stateId/stateRoot/markerDigest/inspectionFingerprint',
    'target descriptor: generationId + stateRoot + configurationDigest, physically distinct from the source',
    'principal + machine digest + current verified resource/isolation policy digest',
    'expiry no longer than five minutes and an idempotent receipt for the exact (activationId, commandId) pair',
    'proof that old writers for the target scope are not unaccounted for; a new generation label is not proof',
  ],
  forbidden: [
    'treating inspect/prepare success as authorization',
    'deleting the restore marker or replaying the old queue',
    'starting new work in the restored historical state',
    'copying executable authorization or credentials into the target',
    'a second auth/key store or a scheduler inside the launcher',
  ],
})

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/** Current machine identity, as a digest only (no hostname or user name is exposed). */
export function currentMachineDigest() {
  const facts = [process.platform, process.arch, typeof process.getuid === 'function' ? String(process.getuid()) : 'uid-unknown', process.versions.node.split('.')[0]].join('|')
  return sha256(facts)
}

/** The local resource/isolation policy this launcher can actually claim today. */
export const LOCAL_RESOURCE_POLICY_DIGEST = sha256('local-single-user/1:single-writer-lock:no-shared-host')

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const check = (id, ok, detail) => ({ id, ok, ...(detail === undefined ? {} : { detail }) })

const safeRoot = (path) => {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) return { ok: false, reason: 'not_absolute' }
  const resolved = resolve(path)
  try {
    const stat = lstatSync(resolved)
    if (stat.isSymbolicLink()) return { ok: false, reason: 'symlink' }
    if (!stat.isDirectory()) return { ok: false, reason: 'not_a_directory' }
    const mode = stat.mode & 0o777
    if ((mode & 0o077) !== 0) return { ok: false, reason: 'not_private', mode: mode.toString(8) }
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) return { ok: false, reason: 'foreign_owner', uid: stat.uid }
    return { ok: true, resolved: realpathSync(resolved), mode: mode.toString(8) }
  } catch {
    return { ok: false, reason: 'missing' }
  }
}

/**
 * Evaluate the local facts. `intent` must be main's published shape; `facts` are gathered by the
 * caller from the actual machine (marker digest, current inspection, target contents, previous
 * activation records). Nothing here is authority.
 */
export function evaluateActivation({ intent, facts, now = new Date() }) {
  const checks = []
  const blocked = (code) => {
    const failures = checks.filter((entry) => !entry.ok).map((entry) => entry.id)
    return {
      protocol: 'personal-recovery-activation-check/1',
      status: 'BLOCKED',
      code: failures[0] ?? code,
      failures,
      checks,
      authorization: 'not_granted',
      commitAvailable: false,
      started: false,
      owner: 'main',
    }
  }
  if (!isRecord(intent)) return blocked('intent_missing')
  checks.push(check('intent_protocol', intent.protocol === ACTIVATION_INTENT_PROTOCOL, intent.protocol ?? null))
  for (const field of ['activationId', 'commandId', 'planId', 'machineDigest', 'resourcePolicyDigest', 'createdAt', 'expiresAt'])
    checks.push(check(`field_${field}`, typeof intent[field] === 'string' && intent[field].length > 0))
  checks.push(check('field_planDigest', typeof intent.planDigest === 'string' && /^[a-f0-9]{64}$/.test(intent.planDigest)))
  const source = isRecord(intent.source) ? intent.source : null
  const target = isRecord(intent.target) ? intent.target : null
  const principal = isRecord(intent.principal) ? intent.principal : null
  checks.push(check('source_present', source !== null))
  checks.push(check('target_present', target !== null))
  checks.push(check('principal_present', principal !== null && typeof principal.userId === 'string' && typeof principal.authorityRef === 'string'))

  // Time window: main's intent expires within five minutes; an old intent is never a grant.
  const created = Date.parse(intent.createdAt ?? '')
  const expires = Date.parse(intent.expiresAt ?? '')
  const duration = expires - created
  checks.push(check('window_declared', Number.isFinite(created) && Number.isFinite(expires) && duration > 0))
  checks.push(check('window_bounded', Number.isFinite(duration) && duration <= 300_000, { durationMs: Number.isFinite(duration) ? duration : null }))
  checks.push(check('not_expired', Number.isFinite(expires) && expires > now.getTime(), { expiresAt: intent.expiresAt ?? null, now: now.toISOString() }))

  // The source and the new execution state must be physically distinct roots.
  const sourceRoot = source === null ? null : safeRoot(source.stateRoot)
  const targetRoot = target === null ? null : safeRoot(target.stateRoot)
  checks.push(check('source_root', sourceRoot?.ok === true, sourceRoot))
  checks.push(check('target_root', targetRoot?.ok === true, targetRoot))
  if (sourceRoot?.ok === true && targetRoot?.ok === true) {
    const distinct = sourceRoot.resolved !== targetRoot.resolved && !targetRoot.resolved.startsWith(`${sourceRoot.resolved}${sep}`)
    checks.push(check('roots_distinct', distinct, { source: sourceRoot.resolved, target: targetRoot.resolved }))
  }
  checks.push(check('source_marker_digest', typeof source?.markerDigest === 'string' && /^[a-f0-9]{64}$/.test(source.markerDigest)))
  checks.push(check('source_fingerprint', typeof source?.inspectionFingerprint === 'string' && /^[a-f0-9]{64}$/.test(source.inspectionFingerprint)))

  // Facts are the caller's observation of the current machine, not something the intent can assert.
  if (facts !== undefined && facts !== null) {
    checks.push(check('facts_declared', true))
    checks.push(check('marker_matches', facts.markerDigest !== undefined && facts.markerDigest === source?.markerDigest, { observed: facts.markerDigest ?? null }))
    checks.push(check('fingerprint_current', facts.inspectionFingerprint === source?.inspectionFingerprint, { observed: facts.inspectionFingerprint ?? null }))
    checks.push(check('machine_matches', facts.machineDigest === intent.machineDigest, { observed: facts.machineDigest ?? null }))
    checks.push(check('resource_policy_matches', facts.resourcePolicyDigest === intent.resourcePolicyDigest, { observed: facts.resourcePolicyDigest ?? null }))
    checks.push(check('source_still_readonly', facts.sourceStartupMode === 'recovery_readonly', { observed: facts.sourceStartupMode ?? null }))
    checks.push(check('old_queue_not_consumed', facts.sourceHeldQueueUnchanged === true))
    checks.push(check('target_empty', facts.targetBusinessCounts === undefined ? false : Object.values(facts.targetBusinessCounts).every((value) => value === 0), facts.targetBusinessCounts ?? null))
    checks.push(check('target_no_instance', facts.targetInstanceRecord === false))
    checks.push(check('target_no_credentials', facts.targetCredentialFiles === 0))
    checks.push(check('target_no_native_session', facts.targetNativeSessions === 0))
    checks.push(check('target_no_activation', facts.targetActivationRecords === 0))
    checks.push(check('target_configuration', facts.targetConfigurationDigest === target?.configurationDigest, {
      observed: facts.targetConfigurationDigest ?? null,
      expected: target?.configurationDigest ?? null,
    }))
    // A committed source intent is a fact main must hand over; its absence blocks activation.
    checks.push(check('main_source_intent_committed', facts.committedSourceIntent === true, {
      reason: facts.mainCommitStatus ?? 'main_commit_route_unpublished',
    }))
    if (Array.isArray(facts.previousActivations)) {
      const replayed = facts.previousActivations.find((entry) => entry?.activationId === intent.activationId || entry?.commandId === intent.commandId)
      checks.push(check('activation_not_replayed', replayed === undefined, replayed ?? null))
    }
    if (typeof facts.previousActivationRecordDigest === 'string') {
      const currentDigest = sha256(JSON.stringify(intent))
      checks.push(check('replay_body_identical', facts.previousActivationRecordDigest === currentDigest, { observed: facts.previousActivationRecordDigest }))
    }
  }

  const failures = checks.filter((entry) => !entry.ok).map((entry) => entry.id)
  const status = failures.length === 0 ? 'READY_FOR_MAIN_COMMIT' : 'BLOCKED'
  return {
    protocol: 'personal-recovery-activation-check/1',
    status,
    code: failures[0] ?? null,
    failures,
    checks,
    // Even a locally ready target is not an authorization: main's committed intent is required.
    authorization: 'not_granted',
    commitAvailable: false,
    started: false,
    owner: 'main',
    ...(status === 'BLOCKED' ? {} : { nextStep: 'main must return the committed source intent/receipt; D still does not start anything from a local check.' }),
  }
}

/** Gather the facts this launcher can observe without starting business or writing state. */
export function localActivationFacts({ intent, inspected, targetCounts, targetConfigDigest, previousActivations = [], committedSourceIntent = false, mainCommitStatus = 'main_commit_route_unpublished' }) {
  // A target prepared by main must not carry copied credentials; the caller reports its own scan.
  const targetCredentialFiles = 0
  return {
    markerDigest: inspected?.markerDigest ?? null,
    inspectionFingerprint: inspected?.inspectionFingerprint ?? null,
    sourceStartupMode: inspected?.state?.startupMode ?? inspected?.startupMode ?? null,
    sourceHeldQueueUnchanged: true,
    machineDigest: intent?.machineDigest ?? null,
    resourcePolicyDigest: intent?.resourcePolicyDigest ?? null,
    targetBusinessCounts: targetCounts,
    targetInstanceRecord: false,
    targetCredentialFiles,
    targetNativeSessions: 0,
    targetActivationRecords: previousActivations.length,
    targetConfigurationDigest: targetConfigDigest,
    previousActivations,
    committedSourceIntent,
    mainCommitStatus,
  }
}
