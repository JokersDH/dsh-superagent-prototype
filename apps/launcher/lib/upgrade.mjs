/**
 * `pa upgrade`: switch a stopped installation to a different frozen install, and recover if the
 * switch or the first start fails.
 *
 * Safety properties this module owns (D scope):
 * - the target must be a complete, digest-verified distribution install whose release manifest is
 *   recorded in its own `install.json`; a corrupt or partially copied install is refused *before*
 *   anything is stopped;
 * - only the recorded instance of this config root may be stopped, and it must verify (pid + start
 *   identity + ports) first; a foreign or half-dead record blocks instead of killing a process;
 * - a pre-upgrade backup is written before the pointer moves (unless explicitly skipped), so a
 *   failed upgrade can always be returned to a known data state;
 * - the install pointer is two files (`release.previous.json` + `release.json`) plus a journal, so an
 *   interrupted switch is detectable and recoverable;
 * - after switching, the target binary must answer health and report its own buildId; otherwise the
 *   pointer is reverted to the previous install and the journal records the failure. Reverting the
 *   *binary pointer* never rolls data back and never deletes post-upgrade records;
 * - re-running the same upgrade is idempotent.
 *
 * It never deletes a restore marker, never downgrades the database schema, and never removes user
 * data to make a downgrade pass.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { backupState } from './backup.mjs'
import { processAlive, processStart, readInstanceRecord, removeInstanceRecord, verifyCoordinatorProcess, verifyInstance } from './instance.mjs'
import { requestedScopeCheck } from './identity.mjs'
import { RELEASE_FILE, readRelease, validateRelease, verifyReleaseArtifacts } from './release.mjs'
import { hasInstallManifest, initializeRelease, releaseBinding } from './release-bootstrap.mjs'
import { stopInstance } from './stop.mjs'
import { stopProcess } from './instance.mjs'

export class UpgradeError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'UpgradeError'
    this.code = code
    this.detail = detail
  }
}

export const SWITCH_JOURNAL = 'install-switch.json'
export const PREVIOUS_RELEASE = 'release.previous.json'

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const freePort = () => new Promise((resolvePort) => {
  const server = createServer()
  server.unref()
  server.once('error', () => resolvePort(0))
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolvePort(port))
  })
})

const writePrivateJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch { /* renamed or gone */ }
  }
}

export const readJournal = (configRoot) => {
  const path = join(configRoot, SWITCH_JOURNAL)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { status: 'unreadable', path }
  }
}

/** Read and validate a target install without touching any running instance. */
export function inspectTargetInstall(targetRoot) {
  const installDir = resolve(targetRoot)
  const wrapper = join(installDir, 'bin', 'pa')
  if (!existsSync(wrapper)) throw new UpgradeError('target_not_install', 'The target is not a distribution install (no bin/pa)', { path: installDir })
  if (!existsSync(join(installDir, 'install.json')))
    throw new UpgradeError('target_not_install', 'The target has no install manifest', { path: installDir })
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(installDir, 'install.json'), 'utf8'))
  } catch {
    throw new UpgradeError('target_manifest_invalid', 'The target install manifest is not valid JSON', { path: installDir })
  }
  if (manifest.format !== 'pa-install' || manifest.formatVersion !== 1)
    throw new UpgradeError('target_manifest_invalid', 'The target install manifest format is unsupported')
  const appRoot = resolve(installDir, typeof manifest.appRoot === 'string' ? manifest.appRoot : 'app')
  if (!existsSync(join(appRoot, 'package.json')) && !existsSync(join(appRoot, 'apps')))
    throw new UpgradeError('target_incomplete', 'The target install has no application tree', { appRoot })
  // Full digest verification of every recorded file: a truncated/corrupted/half-copied install must
  // fail here, before the current instance is stopped.
  const failures = []
  for (const entry of manifest.files) {
    if (entry.kind !== 'file') continue
    const path = join(installDir, entry.path)
    try {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        failures.push({ path: entry.path, reason: 'not_a_regular_file' })
        continue
      }
      if (stat.size !== entry.bytes) {
        failures.push({ path: entry.path, reason: 'size_mismatch' })
        continue
      }
      if (sha256File(path) !== entry.sha256) {
        failures.push({ path: entry.path, reason: 'digest_mismatch' })
        continue
      }
    } catch {
      failures.push({ path: entry.path, reason: 'missing' })
    }
    if (failures.length >= 20) break
  }
  if (failures.length > 0) throw new UpgradeError('target_tampered', 'The target install bytes do not match its inventory', { failures })
  const releaseRecord = manifest.files.find((entry) => entry.path === `${'var'}/config/${RELEASE_FILE}`)
  if (releaseRecord === undefined) throw new UpgradeError('target_incomplete', 'The target install does not record its release manifest')
  const releasePath = join(installDir, 'var', 'config', RELEASE_FILE)
  const releaseBytes = readFileSync(releasePath)
  if (releaseBytes.byteLength !== releaseRecord.bytes || sha256File(releasePath) !== releaseRecord.sha256)
    throw new UpgradeError('target_tampered', 'The target release manifest does not match the install inventory')
  let release
  try {
    release = validateRelease(JSON.parse(releaseBytes.toString('utf8')))
  } catch (error) {
    throw new UpgradeError('target_manifest_invalid', `The target release manifest is invalid: ${error.message}`)
  }
  if (release.buildId !== manifest.buildId || release.source.commit !== manifest.source.commit)
    throw new UpgradeError('target_manifest_invalid', 'The target release manifest and install manifest disagree on build/source')
  const artifacts = verifyReleaseArtifacts(appRoot, release, { hash: true })
  if (!artifacts.ok) throw new UpgradeError('target_tampered', 'The target release artifacts do not match the release manifest', { failures: artifacts.failures.slice(0, 20) })
  return {
    installDir,
    appRoot,
    wrapper,
    manifest,
    release,
    releaseDigest: releaseRecord.sha256,
    releaseBytes,
    dataSchema: typeof release.producer?.productSchema === 'number' ? release.producer.productSchema : null,
  }
}

/** Start flags for the next launcher must preserve the mode/access the instance actually ran with. */
export function launcherStartArgs({ mode, access }) {
  if (mode !== 'fixture' && mode !== 'personal') throw new UpgradeError('upgrade_mode_unavailable', 'A launcher mode is required to preserve the running instance identity', { mode })
  if (access !== 'token' && access !== 'local-development') throw new UpgradeError('upgrade_access_unavailable', 'An access mode is required to preserve the running instance identity', { access })
  return [
    ...(mode === 'fixture' ? ['--fixture'] : []),
    ...(access === 'token' ? ['--require-login'] : []),
  ]
}

/** Identity that must survive the switch; without it the upgrade refuses instead of guessing. */
export function preserveIdentity({ record, explicitMode, explicitAccess, journal }) {
  const mode = record?.mode ?? journal?.mode ?? explicitMode ?? null
  const access = record?.access ?? journal?.access ?? explicitAccess ?? null
  if (mode === null || access === null)
    throw new UpgradeError('upgrade_mode_unavailable', 'The running instance mode/access cannot be established; refusing to switch instead of silently changing it', {
      mode,
      access,
      hint: 'Pass --mode personal|fixture and --access local-development|token only if you know the intended identity; otherwise start the instance once so its record exists.',
    })
  return { mode, access }
}

/** A journal may record the app root or the install dir; both resolve to the install with bin/pa. */
export function installDirOf(path) {
  return existsSync(join(path, 'install.json')) ? path : dirname(path)
}

const readPreviousRelease = (configRoot) => {
  const path = join(configRoot, PREVIOUS_RELEASE)
  if (!existsSync(path)) return null
  try {
    const bytes = readFileSync(path)
    return { path, bytes, digest: createHash('sha256').update(bytes).digest('hex'), release: validateRelease(JSON.parse(bytes.toString('utf8'))) }
  } catch {
    return { path, bytes: null, digest: null, release: null, unreadable: true }
  }
}

/** Decide whether an upgrade is allowed; never mutates state. */
export async function planUpgrade({ installRoot, roots, to, allowSameSource = false }) {
  const target = inspectTargetInstall(to)
  const current = releaseBinding({ installRoot, configRoot: roots.config })
  const currentRelease = readRelease(roots.config).release
  const alreadySwitched = current.bound && currentRelease !== null && currentRelease.buildId === target.release.buildId
  if (alreadySwitched && !allowSameSource)
    throw new UpgradeError('upgrade_already_applied', 'This config root already runs the target build', {
      buildId: target.release.buildId,
      installRoot: target.installDir,
    })
  // The install that is being replaced is the one this config root actually runs, not the install the
  // upgrade tool itself was launched from (a new distribution carries the tool).
  const instance = readInstanceRecord(roots.config)
  const fromInstallRoot = instance?.install ?? currentRelease?.installRoot ?? resolve(installRoot)
  const plan = {
    protocol: 'personal-install-switch/1',
    plannedAt: new Date().toISOString(),
    from: {
      installRoot: fromInstallRoot,
      bound: current.bound,
      buildId: currentRelease?.buildId ?? null,
      commit: currentRelease?.source?.commit ?? null,
      schema: currentRelease?.producer?.productSchema ?? null,
    },
    to: { installDir: target.installDir, buildId: target.release.buildId, commit: target.release.source.commit, schema: target.dataSchema, digest: target.releaseDigest },
    instance: instance === null ? null : { pid: instance.pid, apiURL: instance.apiURL, consoleURL: instance.consoleURL, buildId: instance.buildId, mode: instance.mode, access: instance.access },
    sharedData: true,
    dataMigration: (target.dataSchema ?? 0) > (currentRelease?.producer?.productSchema ?? 0),
    binaryDowngrade: (target.dataSchema ?? 0) < (currentRelease?.producer?.productSchema ?? 0),
  }
  return { plan, target, current }
}

/**
 * Execute an install switch.
 *
 * `fault` is a test-only injection point (also usable by E to prove failure recovery); it never
 * changes the product path when unset.
 */
export async function upgradeInstall({ installRoot, roots, values, fault = process.env.PA_UPGRADE_FAULT ?? null }) {
  const to = values.to
  if (to === undefined) throw new UpgradeError('usage', 'upgrade 需要 --to <安装目录>')

  // Re-entry with an unsettled journal is not a new operation: settle the earlier one first. This is
  // checked before planning, because the crashed attempt may already look like "already applied".
  const pendingJournal = readJournal(roots.config)
  const terminal = (status) => ['confirmed', 'binary_rolled_back'].includes(status) || String(status).startsWith('reverted')
  if (pendingJournal !== null && !terminal(pendingJournal.status))
    throw new UpgradeError('upgrade_recover_required', 'An interrupted install switch is still recorded; re-entering a new switch is refused', {
      journalStatus: pendingJournal.status,
      hint: 'Run `pa upgrade --recover` (same operation identity), then start a new switch.',
    })

  const { plan, target } = await planUpgrade({ installRoot, roots, to, allowSameSource: values.force === true })
  const journalPath = join(roots.config, SWITCH_JOURNAL)
  const previousPath = join(roots.config, PREVIOUS_RELEASE)
  const previous = readPreviousRelease(roots.config)

  // The mode/access that the running instance actually used must survive the switch. Read it before
  // stopping; if the record is gone, only an explicit --mode/--access may replace it, otherwise refuse.
  const instance = (() => { try { return readInstanceRecord(roots.config) } catch (error) {
    throw new UpgradeError('invalid_instance_record', 'The instance record is untrusted; refusing to stop or switch', { cause: error.message, code: error.code })
  } })()
  if (instance !== null) {
    const scope = requestedScopeCheck({ roots, record: instance })
    if (!scope.ok)
      throw new UpgradeError('requested_root_mismatch', 'The recorded instance belongs to another state/install; refusing to stop or switch it', { scope })
  }
  const identity = preserveIdentity({ record: instance, explicitMode: values.mode, explicitAccess: values.access, journal: pendingJournal })

  // 1. Full resource barrier: launcher, API child, console listener and descendants must all be
  // accounted for, including orphans after a launcher crash. No empty-set "proof".
  let stopped = null
  if (instance !== null && values['no-stop'] !== true) {
    const barrier = await ensureResourceBarrier({ roots, target, journal: pendingJournal })
    stopped = barrier.stopped
  } else if (instance === null) {
    // A stopped install still needs the barrier: a crashed previous upgrade may have left a target.
    const barrier = await ensureResourceBarrier({ roots, target, journal: pendingJournal })
    stopped = barrier.stopped ?? null
  } else {
    // --no-stop: refuse a running instance explicitly, never bypass the identity check.
    const verification = await verifyInstance(instance)
    if (verification.ok)
      throw new UpgradeError('upgrade_requires_stopped_instance', 'The instance is running; stop it explicitly or let upgrade stop it', { pid: instance.pid })
    throw new UpgradeError('instance_record_unverified', 'The recorded instance does not verify but its pid is alive; refusing to stop or switch', {
      pid: instance.pid,
      failures: verification.failures.slice(0, 8),
      hint: 'Inspect `pa status` and the process yourself; do not delete instance.json blindly.',
    })
  }

  // 2. Pre-upgrade backup before the pointer moves.
  let backup = null
  if (values['no-backup'] !== true) {
    if (values.backup === undefined)
      throw new UpgradeError('upgrade_backup_required', 'An install switch needs --backup <path> (or explicit --no-backup)', { hint: 'A backup is the only supported way back to the pre-upgrade data.' })
    const created = await backupState({ installRoot, roots, values: { out: values.backup } })
    if (created.ok !== true) throw new UpgradeError('upgrade_backup_failed', 'The pre-upgrade backup failed; nothing was switched', { code: created.code ?? null, message: created.message ?? null })
    backup = { path: created.bundlePath, sha256: created.archiveSha256, manifestDigest: created.manifestDigest, evidenceDigest: created.evidence?.digest ?? null }
  }
  if (fault === 'stop_fail') throw new UpgradeError('upgrade_stop_failed', 'Injected stop failure (test fault); nothing was switched')

  // 3. Keep the previous pointer, then adopt the target pointer.
  if (existsSync(join(roots.config, RELEASE_FILE))) {
    const previousBytes = readFileSync(join(roots.config, RELEASE_FILE))
    writePrivateJson(previousPath, JSON.parse(previousBytes.toString('utf8')))
  }
  const switchedAt = new Date().toISOString()
  writePrivateJson(journalPath, {
    protocol: 'personal-install-switch/1',
    status: 'switching',
    switchedAt,
    from: plan.from,
    to: plan.to,
    stopped,
    backup,
    mode: identity.mode,
    access: identity.access,
    ports: instance === null ? null : { consoleURL: instance.consoleURL, apiURL: instance.apiURL },
    previousReleasePath: existsSync(previousPath) ? previousPath : null,
  })
  if (fault === 'crash_after_stop') {
    // Test fault: the instance is stopped and the previous pointer is saved, but nothing was
    // switched. Recovery must restart the previous release with the same mode/access/ports.
    throw new UpgradeError('upgrade_interrupted', 'Injected crash after stop but before the pointer switch (test fault); run `pa upgrade --recover`')
  }
  if (fault === 'crash_after_stop_kill') {
    // Real crash window: the journal has the stopped resources, then this process dies by SIGKILL
    // (not a thrown error), so only the durable journal can explain the interrupted switch.
    process.kill(process.pid, 'SIGKILL')
  }
  const adopted = initializeRelease({ installRoot: target.appRoot, configRoot: roots.config, adoptExisting: true })
  writePrivateJson(journalPath, {
    protocol: 'personal-install-switch/1',
    status: 'switched_unconfirmed',
    switchedAt,
    from: plan.from,
    to: plan.to,
    stopped,
    backup,
    adopted,
    mode: identity.mode,
    access: identity.access,
    ports: instance === null ? null : { consoleURL: instance.consoleURL, apiURL: instance.apiURL },
    previousReleasePath: existsSync(previousPath) ? previousPath : null,
  })
  if (fault === 'crash_after_switch_kill') process.kill(process.pid, 'SIGKILL')
  if (fault === 'crash_after_switch') throw new UpgradeError('upgrade_interrupted', 'Injected crash after pointer switch (test fault); run `pa upgrade --recover`')

  // 4. Start the target binary on the same data roots and require its own identity. The spawn pid is
  // persisted before health so a crash or missing record is recoverable from the journal.
  const started = await startTarget({
    roots, target, seed: instance, identity, fault,
    onSpawn: (spawn) => writeJournal({ roots, status: 'starting', reason: 'target_spawned', spawn }),
  })
  writePrivateJson(journalPath, {
    protocol: 'personal-install-switch/1',
    status: 'confirmed',
    switchedAt,
    confirmedAt: new Date().toISOString(),
    from: plan.from,
    to: plan.to,
    stopped,
    backup,
    adopted,
    started,
    mode: identity.mode,
    access: identity.access,
    previousReleasePath: existsSync(previousPath) ? previousPath : null,
    dataRolledBack: false,
  })
  return { protocol: 'personal-install-switch/1', status: 'CONFIRMED', plan, backup, stopped, started, journalPath }
}

const freeFrom = async (seed, key, fallback) => {
  const url = seed?.[key]
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      return Number(parsed.port)
    } catch { /* fall through */ }
  }
  return fallback
}

/** Descendants of one pid inside this process tree (BFS over one ps snapshot). */
const processTree = (rootPid, snapshot = null) => {
  const ps = snapshot ?? spawnSyncPs()
  if (ps === null) return null
  const children = new Map()
  for (const line of ps) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid).push(pid)
  }
  const out = []
  const queue = [rootPid]
  const seen = new Set()
  while (queue.length > 0) {
    const pid = queue.shift()
    if (seen.has(pid)) continue
    seen.add(pid)
    out.push(pid)
    queue.push(...(children.get(pid) ?? []))
  }
  return out
}

const spawnSyncPs = () => {
  try {
    const result = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
    if (result.error !== undefined || result.status !== 0) return null
    return result.stdout.split('\n').filter(Boolean)
  } catch { return null }
}

const commandOf = (pid) => spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout.trim()

const alive = (pid) => {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  // A reaped-but-not-collected zombie cannot write anything; treating it as a live unknown writer
  // would block every switch whose stopped launcher has an unreaped child.
  const state = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim()
  return state !== '' && !state.startsWith('Z')
}

const canonicalPath = (value) => {
  try { return realpathSync(value) } catch { return value }
}

// A shared install path can serve independent state roots, so install paths alone never prove process
// ownership. Only this operation's private roots (state/config/logs/cache/workspace) are identity.
// Ownership identity is the per-operation private config root and the single requested state root.
// cache/logs/workspace may be shared between independent states, so a hit there never proves that a
// global PID belongs to this operation.
const ROOT_TOKENS = (roots) => {
  const raw = [roots.config, roots.data].filter((value) => typeof value === 'string' && value.length > 0)
  const tokens = new Set()
  for (const value of raw) {
    tokens.add(value)
    tokens.add(canonicalPath(value))
  }
  return [...tokens]
}

const commandMatchesIdentity = (command, tokens) => {
  if (command === '') return false
  return tokens.some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // A path token must stand alone as a whole argument segment, so a sibling temp root sharing a
    // prefix (e.g. /tmp/x-sibling vs /tmp/x) is not claimed as this operation's process.
    return new RegExp(`(?:^|[\\s'"=])${escaped}(?=$|[\\s'"/])`).test(command)
  })
}

const listProcesses = (snapshot = spawnSyncPs()) => {
  if (snapshot === null) return null
  return snapshot
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid))
    .map(([pid, ppid]) => ({ pid, ppid }))
}

/**
 * Every registered resource must be accounted for: launcher, API child, console listener and any
 * descendant. A live process that cannot be proven to belong to this operation's config/data/target
 * identity stays UNKNOWN and blocks the switch. Filtering a live candidate out of the set and then
 * reporting an empty "proven" set is not a stop proof.
 */
export async function accountRegisteredResources({ roots, target, record, spawnedPid, spawnedStart, journalSpawn }) {
  const tokens = ROOT_TOKENS(roots)
  const snapshot = spawnSyncPs()
  const scannerOk = snapshot !== null
  const treeCandidates = new Set()
  const unverifiable = []
  let pidReused = false
  const addTree = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return
    const tree = processTree(pid, snapshot)
    if (tree === null) return
    for (const child of tree) treeCandidates.add(child)
  }
  // A recorded numeric pid is authority only together with its exact recorded start identity. A
  // missing, unreadable or reused start stays UNKNOWN and contributes no tree.
  const addVerifiedTree = async (pid, expectedStart, label) => {
    if (!Number.isInteger(pid) || pid <= 0) return
    if (!alive(pid)) return
    if (typeof expectedStart !== 'string' || expectedStart.length === 0) {
      unverifiable.push({ pid, label, reason: 'start_missing' })
      return
    }
    let observed = null
    try { observed = await processStart(pid) } catch { observed = null }
    if (observed === null || observed !== expectedStart) {
      pidReused = true
      unverifiable.push({ pid, label, reason: observed === null ? 'start_unreadable' : 'start_mismatch' })
      return
    }
    addTree(pid)
  }
  const claimed = new Set()
  if (Number.isInteger(spawnedPid) && spawnedPid > 0) {
    const expected = spawnedStart ?? (journalSpawn?.pid === spawnedPid ? journalSpawn?.processStart ?? null : null)
    if (expected === null || expected === undefined) unverifiable.push({ pid: spawnedPid, label: 'spawn', reason: 'start_missing' })
    else await addVerifiedTree(spawnedPid, expected, 'spawn')
  }
  if (journalSpawn !== undefined && journalSpawn !== null && Number.isInteger(journalSpawn.pid) && journalSpawn.pid > 0 && !claimed.has(journalSpawn.pid)) {
    await addVerifiedTree(journalSpawn.pid, journalSpawn.processStart, 'journal')
  }
  if (record !== null && record !== undefined) {
    await addVerifiedTree(record.pid, record.processStart, 'launcher')
    await addVerifiedTree(record.apiPid, record.apiProcessStart, 'api')
    if (Number.isInteger(record.consolePid) && record.consolePid !== record.pid)
      await addVerifiedTree(record.consolePid, record.consoleProcessStart, 'console')
  }

  const discovered = listProcesses(snapshot)
  const owned = []
  const unknownLive = []
  for (const pid of treeCandidates) {
    if (pid === process.pid || !alive(pid)) continue
    const command = commandOf(pid)
    if (command !== '' && commandMatchesIdentity(command, tokens)) owned.push({ pid, command })
    else unknownLive.push({ pid, command: command === '' ? 'unknown' : command })
  }
  const unregistered = []
  for (const entry of discovered ?? []) {
    const { pid, ppid } = entry
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    if (pid === process.pid || treeCandidates.has(pid) || claimed.has(pid) || !alive(pid)) continue
    const command = commandOf(pid)
    if (command !== '' && commandMatchesIdentity(command, tokens)) unregistered.push({ pid, command })
  }
  for (const entry of unregistered) unknownLive.push({ ...entry, unregistered: true })
  return { owned, unknownLive, unregistered, unverifiable, considered: treeCandidates.size, pidReused, scannerOk }
}

export async function stopRegisteredResources({ roots, target, record, spawnedPid, spawnedStart, journalSpawn }) {
  const accounted = await accountRegisteredResources({ roots, target, record, spawnedPid, spawnedStart, journalSpawn })
  const stopped = []
  for (const { pid } of accounted.owned) {
    try { process.kill(pid, 'SIGTERM'); stopped.push(pid) } catch { /* gone */ }
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && accounted.owned.some(({ pid }) => alive(pid))) await new Promise((r) => setTimeout(r, 100))
  for (const { pid } of accounted.owned) {
    if (!alive(pid)) continue
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  }
  const killDeadline = Date.now() + 3000
  while (Date.now() < killDeadline && accounted.owned.some(({ pid }) => alive(pid))) await new Promise((r) => setTimeout(r, 100))
  const remaining = accounted.owned.filter(({ pid }) => alive(pid)).map(({ pid, command }) => ({ pid, command }))
  return {
    proven: remaining.length === 0 && accounted.unknownLive.length === 0 && accounted.unknownLive.length === 0 &&
      accounted.scannerOk === true && accounted.pidReused !== true && (accounted.unverifiable ?? []).length === 0,
    scannerOk: accounted.scannerOk === true,
    unverifiable: (accounted.unverifiable ?? []).map(({ pid, label, reason }) => ({ pid, label, reason })),
    stopped,
    remaining,
    unknownLive: accounted.unknownLive.map(({ pid, command, unregistered }) => ({ pid, command: command.slice(0, 240), ...(unregistered === true ? { unregistered: true } : {}) })),
    considered: accounted.considered,
    pidReused: accounted.pidReused === true,
  }
}

/**
 * The pre-switch barrier. It reuses the recorded instance identity (including the orphan-API proof
 * from `stop.mjs`) and refuses to touch the pointer while any registered resource is unaccounted for.
 */
export async function ensureResourceBarrier({ roots, target, journal }) {
  const record = (() => {
    try { return readInstanceRecord(roots.config) } catch (error) {
      throw new UpgradeError('invalid_instance_record', 'The instance record is untrusted; refusing to stop or switch anything', { cause: error.message, code: error.code })
    }
  })()
  let stopped = null
  let orphan = false
  if (record !== null) {
    const scope = requestedScopeCheck({ roots, record })
    if (!scope.ok)
      throw new UpgradeError('requested_root_mismatch', 'The recorded instance belongs to another state/install; refusing to stop or switch it', { scope })
    // Account first, stop second: an unregistered but plausible writer must block the switch while
    // this state's own instance is still running, instead of stopping it and only then discovering
    // the unknown resource (which would leave an unsettled stop with no replacement).
    const preflight = await accountRegisteredResources({ roots, target, record })
    if (preflight.unknownLive.length > 0)
      throw new UpgradeError('unknown_live_resource', 'An unregistered live process matches this state but is not owned by this operation; refusing to stop or switch anything', {
        unknownLive: preflight.unknownLive.slice(0, 8).map(({ pid, command, unregistered }) => ({ pid, command: String(command).slice(0, 200), ...(unregistered === true ? { unregistered: true } : {}) })),
      })
    const verification = await verifyInstance(record)
    if (verification.ok) {
      const result = await stopInstance({ roots, requireInstall: false })
      if (!result.ok || String(result.status).startsWith('STOP_TIMEOUT'))
        throw new UpgradeError('upgrade_stop_failed', 'The running instance could not be stopped; nothing was switched', { status: result.status ?? null, code: result.code ?? null })
      stopped = result
      orphan = result.status === 'STOPPED_ORPHAN'
    } else {
      if (await processAlive(record.pid))
        throw new UpgradeError('instance_record_unverified', 'The recorded launcher does not verify but its pid is alive; a live unknown target blocks the switch', { pid: record.pid, failures: verification.failures.slice(0, 8) })
      // The launcher is gone; the recorded API child may still be the coordinator for this state.
      const orphanCheck = await verifyCoordinatorProcess(record).catch(() => ({ ok: false, failures: ['verify_failed'] }))
      if (!orphanCheck.ok && (await processAlive(record.apiPid)))
        throw new UpgradeError('unknown_live_resource', 'The recorded API child is alive but cannot be proven to belong to this state; the switch is blocked', { apiPid: record.apiPid, failures: orphanCheck.failures.slice(0, 8) })
      if (orphanCheck.ok) {
        const stopResult = await stopProcess(record.apiPid, { timeoutMs: 6000 })
        if (!stopResult.stopped)
          throw new UpgradeError('upgrade_stop_failed', 'The orphaned API child could not be stopped; nothing was switched', { apiPid: record.apiPid })
        orphan = true
        stopped = { status: 'STOPPED_ORPHAN', apiPid: record.apiPid }
      }
    }
  }
  const proof = await stopRegisteredResources({ roots, target: target ?? null, record, journalSpawn: journal?.spawn ?? null })
  if (!proof.proven) {
    const code = proof.unknownLive.length > 0 ? 'unknown_live_resource' : 'target_stop_unproven'
    throw new UpgradeError(code, 'A registered resource is still alive or cannot be proven to belong to this operation; the install pointer is unchanged', {
      remaining: proof.remaining,
      unknownLive: proof.unknownLive,
      considered: proof.considered,
    })
  }
  // The record described processes that are now proven stopped; removing it lets the target launcher
  // start without inheriting a dead identity. A record that could not be proven is never removed.
  if (record !== null) {
    try { removeInstanceRecord(roots.config) } catch { /* the target start re-checks the record anyway */ }
  }
  return { proven: true, record: record === null ? null : { pid: record.pid, apiPid: record.apiPid, consolePid: record.consolePid }, stopped, orphan, proof }
}

async function startTarget({ roots, target, seed, identity, fault, onSpawn }) {
  let consolePort = await freeFrom(seed, 'consoleURL', 0)
  let apiPort = await freeFrom(seed, 'apiURL', 0)
  if (!Number.isInteger(consolePort) || consolePort <= 0 || !Number.isInteger(apiPort) || apiPort <= 0 || consolePort === apiPort) {
    // A crashed switch may have no recorded instance; recovery uses fresh isolated ports.
    consolePort = await freePort()
    apiPort = await freePort()
    if (apiPort === consolePort) apiPort = await freePort()
  }
  if (consolePort <= 0 || apiPort <= 0)
    throw new UpgradeError('upgrade_ports_unavailable', 'No usable local ports were available for the target instance', { consolePort, apiPort })
  const out = join(roots.logs, 'upgrade-target.out.log')
  const err = join(roots.logs, 'upgrade-target.err.log')
  mkdirSync(roots.logs, { recursive: true, mode: 0o700 })
  const outFd = openSync(out, 'a', 0o600)
  const errFd = openSync(err, 'a', 0o600)
  const modeArgs = launcherStartArgs(identity)
  const child = spawn(
    target.wrapper,
    ['start', ...modeArgs, '--port', String(consolePort), '--api-port', String(apiPort),
      '--install', target.appRoot, '--config-root', roots.config,
      '--data-root', roots.data, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace],
    {
      cwd: target.installDir,
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: { ...process.env, ...(fault === 'target_record_missing' ? { PA_SUPPRESS_INSTANCE_RECORD: '1' } : {}) },
    },
  )
  child.unref()
  closeSync(outFd)
  closeSync(errFd)
  // Persist the spawn identity BEFORE any health/record work: a crash between spawn and the instance
  // record must still leave a proven pid to stop on recovery.
  const spawnedStart = await processStart(child.pid)
  if (typeof onSpawn === 'function') onSpawn({ pid: child.pid, startedAt: new Date().toISOString(), processStart: spawnedStart })

  const fail = async (reason, detail = {}) => {
    // Prove the process tree this operation started is gone BEFORE touching the pointer or record.
    const cleanup = fault === 'target_stop_unproven'
      // Test fault: pretend the stop could not be proven. The state machine must keep the indeterminate
      // state instead of reverting the pointer or restarting the old writer.
      ? { proven: false, stopped: [], remaining: [child.pid], considered: 1 }
      : await stopRegisteredResources({ roots, target, spawnedPid: child.pid, spawnedStart, record: readInstanceRecord(roots.config) })
    if (!cleanup.proven) {
      writeJournalStatus({ roots, status: 'target_stop_unproven', reason, cleanup, ...(typeof plan === 'object' && plan !== null ? { extra: { from: plan.from, to: plan.to } } : {}) })
      throw new UpgradeError('target_stop_unproven', 'The failed target process tree could not be proven stopped; pointer and record are left as-is (no old writer is restarted)', {
        reason,
        remaining: cleanup.remaining,
        unknownLive: cleanup.unknownLive ?? [],
        considered: cleanup.considered ?? null,
        ...detail,
      })
    }
    await revertPointer({ roots, target })
    writeJournalStatus({ roots, status: 'reverted_after_failed_start', reason, cleanup })
    throw new UpgradeError(reason === 'injected_unhealthy_target' ? 'upgrade_target_unhealthy' : 'upgrade_target_unhealthy',
      'The target instance did not verify after the switch; its process tree is stopped and the install pointer was reverted (data untouched)', {
        reason,
        cleanup,
        ...detail,
      })
  }

  if (fault === 'target_unhealthy' || fault === 'target_stop_unproven') {
    // Test fault: the instance may have started; failure cleanup must still stop it (or, for the
    // stop-unproven variant, prove that the state machine keeps the indeterminate state).
    await new Promise((r) => setTimeout(r, 1200))
    await fail(fault === 'target_stop_unproven' ? 'injected_stop_unproven' : 'injected_unhealthy_target', { health: null })
  }
  const deadline = Date.now() + 60_000
  let health = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) {
        health = await response.json()
        break
      }
    } catch { /* not ready */ }
    if (child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 150))
  }
  if (fault === 'target_coordinator_exit') {
    // Test fault: the coordinator dies right after answering health, before any record is written.
    await stopRegisteredResources({ roots, target, spawnedPid: child.pid })
    await fail('coordinator_exited_after_health', { health: health?.status ?? null })
  }
  // Health can answer before the launcher persists its instance record; wait for the exact identity.
  let record = readInstanceRecord(roots.config)
  const recordDeadline = Date.now() + 15_000
  while (Date.now() < recordDeadline && (record === null || record.buildId !== target.release.buildId)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
    record = readInstanceRecord(roots.config)
  }
  if (fault === 'target_record_missing') {
    // Test fault: the instance answered health but never persisted its record.
    await fail('instance_record_missing', { health: health?.status ?? null })
  }
  const instanceVerified = record === null ? false : (await verifyInstance(record)).ok
  const modeMatches = record !== null && record.mode === identity.mode && record.access === identity.access && health?.mode === identity.mode
  if (health === null || !instanceVerified || record.buildId !== target.release.buildId || !modeMatches) {
    await fail(health === null ? 'unhealthy' : modeMatches ? 'identity_mismatch' : 'mode_mismatch', {
      health: health?.status ?? null,
      mode: { expected: identity.mode, health: health?.mode ?? null, record: record?.mode ?? null },
      access: { expected: identity.access, record: record?.access ?? null },
      buildId: record?.buildId ?? null,
      targetBuildId: target.release.buildId,
    })
  }
  return { pid: record.pid, apiURL: record.apiURL, consoleURL: record.consoleURL, buildId: record.buildId, mode: record.mode, access: record.access, health: health.status }
}

const writeJournal = ({ roots, status, reason, spawn, extra }) => {
  const path = join(roots.config, SWITCH_JOURNAL)
  const existing = readJournal(roots.config) ?? {}
  writePrivateJson(path, {
    ...existing,
    ...(extra === undefined ? {} : extra),
    status,
    ...(reason === undefined ? {} : { reason }),
    // spawn/cleanup identity is part of the operation record, not a transient test detail.
    ...(spawn === undefined ? {} : { spawn: { ...(existing.spawn ?? {}), ...spawn } }),
    updatedAt: new Date().toISOString(),
    dataRolledBack: false,
  })
}
const writeJournalStatus = ({ roots, status, reason, cleanup, spawn, extra }) => writeJournal({ roots, status, reason, spawn, extra })

async function revertPointer({ roots, target }) {
  const previousPath = join(roots.config, PREVIOUS_RELEASE)
  if (!existsSync(previousPath)) throw new UpgradeError('upgrade_revert_unavailable', 'No previous install pointer was saved', { path: previousPath })
  const bytes = readFileSync(previousPath)
  const path = join(roots.config, RELEASE_FILE)
  const temporary = `${path}.${process.pid}.revert.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
  // Data is untouched: reverting the pointer is not a data rollback.
  return { revertedTo: validateRelease(JSON.parse(bytes.toString('utf8'))).buildId, targetBuildId: target.release.buildId }
}

/** Recover an interrupted switch from the journal; idempotent and never touches data. */
export async function recoverSwitch({ installRoot, roots, values = {} }) {
  const journal = readJournal(roots.config)
  if (journal === null) throw new UpgradeError('upgrade_recover_not_needed', 'No interrupted install switch was recorded')
  if (['confirmed', 'binary_rolled_back'].includes(journal.status) || String(journal.status).startsWith('reverted'))
    return { protocol: 'personal-install-switch/1', status: 'NO_OP', journalStatus: journal.status }
  if (!['switched_unconfirmed', 'switching', 'stopping', 'starting', 'target_stop_unproven'].includes(journal.status))
    throw new UpgradeError('upgrade_recover_unknown_state', 'The switch journal is not in a recoverable state', { journalStatus: journal.status })
  // Every recovery branch is a side-effect path: the requested roots must first agree with the
  // recorded instance (config/data/install especially). A copy of another state's record cannot make
  // this operation stop that state or write confirmed/pointer.
  const recorded = readInstanceRecord(roots.config)
  if (recorded !== null) {
    const scope = requestedScopeCheck({ roots, record: recorded })
    if (!scope.ok)
      return { protocol: 'personal-install-switch/1', status: 'BLOCKED', code: 'requested_root_mismatch',
        message: 'The recorded instance belongs to another config/state/install; recovery refuses to stop it or write the pointer', scope }
  }
  // The record must be one of the two roles named by the journal, never an arbitrary install that
  // happens to share state/config. This is the recover analogue of the old/new role check.
  if (recorded !== null) {
    const recordedInstall = canonicalPath(recorded.install ?? '')
    const roles = [journal.from?.installRoot, journal.from?.installDir, journal.to?.installRoot, journal.to?.installDir]
      .filter((value) => typeof value === 'string' && value.length > 0)
    const allowed = [...new Set(roles.flatMap((value) => [canonicalPath(value), canonicalPath(join(value, 'app')), canonicalPath(dirname(value))]))]
    const requestedRole = canonicalPath(installRoot)
    // A confirming/starting branch writes the journal terminal state for an operation that began under
    // a specific role pair, so the requested tool install must also be one of those roles. Cleanup or
    // revert branches may legitimately be driven by a newer tool install; the recorded resource must
    // still be exactly the journal old/new role in every branch.
    const requestedRoleIsRole = allowed.includes(requestedRole)
    const requiringRequestedRole = ['starting', 'switched_unconfirmed'].includes(journal.status)
    if (allowed.length === 0 || !allowed.includes(recordedInstall) || (requiringRequestedRole && !requestedRoleIsRole))
      return { protocol: 'personal-install-switch/1', status: 'BLOCKED', code: 'requested_root_mismatch',
        message: 'The recorded install is not the journal old/new role, or a confirming request comes from a third role; recovery refuses to confirm or clean it',
        detail: { recordedInstall, requestedRole, allowed, journalStatus: journal.status } }
  }
  // Never start (or revert over) an unknown live process: the same rule as upgrade/rollback.
  const existing = readInstanceRecord(roots.config)
  if (existing !== null && !(await verifyInstance(existing)).ok && (await processAlive(existing.pid)))
    throw new UpgradeError('instance_record_unverified', 'The recorded instance does not verify but its pid is alive; recovery refuses to touch the pointer or start a second writer', {
      pid: existing.pid,
    })
  const identity = preserveIdentity({ record: existing, explicitMode: values.mode, explicitAccess: values.access, journal })
  const target = inspectTargetInstall(journal.to.installDir)

  // The target may have been spawned (identity persisted) but never confirmed. Stop the persisted
  // spawn tree first; only a proven stop allows a pointer decision.
  if (journal.status === 'starting') {
    const current = readInstanceRecord(roots.config)
    if (current !== null && current.buildId === target.release.buildId) {
      const verification = await verifyInstance(current)
      if (verification.ok) {
        writeJournalStatus({ roots, status: 'confirmed', reason: 'recovered_after_spawn' })
        return { protocol: 'personal-install-switch/1', status: 'RECOVERED', started: { pid: current.pid, apiURL: current.apiURL, buildId: current.buildId, mode: current.mode, access: current.access } }
      }
    }
    const cleanup = await stopRegisteredResources({ roots, target, record: current, journalSpawn: journal.spawn ?? null })
    if (!cleanup.proven) {
      writeJournalStatus({ roots, status: 'target_stop_unproven', reason: 'spawn_stop_unproven', cleanup })
      throw new UpgradeError('target_stop_unproven', 'The spawned target cannot be proven stopped; pointer and record are left as-is', { remaining: cleanup.remaining, unknownLive: cleanup.unknownLive })
    }
    const bindingNow = releaseBinding({ installRoot, configRoot: roots.config })
    if (bindingNow.bound && bindingNow.installBuildId === target.release.buildId) {
      await revertPointer({ roots, target })
      writeJournalStatus({ roots, status: 'reverted_after_interrupted_switch', reason: 'spawn_without_record', cleanup })
      return { protocol: 'personal-install-switch/1', status: 'REVERTED', reason: 'spawn_without_record', cleanup }
    }
    writeJournalStatus({ roots, status: 'reverted_after_interrupted_switch', reason: 'pointer_not_bound_to_target', cleanup })
    return { protocol: 'personal-install-switch/1', status: 'REVERTED', reason: 'pointer_not_bound_to_target', cleanup }
  }

  // A failed target whose stop could not be proven must first be stopped; only then may the pointer
  // be reverted. If it still cannot be proven stopped, keep the indeterminate state (no old writer).
  if (journal.status === 'target_stop_unproven') {
    const cleanup = await stopRegisteredResources({ roots, target, record: existing, journalSpawn: journal.spawn ?? null })
    if (!cleanup.proven) {
      writeJournalStatus({ roots, status: 'target_stop_unproven', reason: 'recover_stop_still_unproven', cleanup })
      const unknownIdentity = cleanup.pidReused === true || cleanup.scannerOk === false || (cleanup.unverifiable ?? []).length > 0 || (cleanup.unknownLive ?? []).length > 0
      if (unknownIdentity)
        return { protocol: 'personal-install-switch/1', status: 'BLOCKED', code: 'unknown_live_resource',
          message: 'The failed target cannot be attributed (missing/reused start, scanner failure or unknown live resource); no pointer, record or signal change', cleanup }
      throw new UpgradeError('target_stop_unproven', 'The failed target still cannot be proven stopped; refusing to revert or start another writer', {
        remaining: cleanup.remaining,
      })
    }
    await revertPointer({ roots, target })
    writeJournalStatus({ roots, status: 'reverted_after_failed_start', reason: 'recover_after_stop_proven', cleanup })
    return { protocol: 'personal-install-switch/1', status: 'REVERTED', reason: 'recover_after_stop_proven', cleanup }
  }

  // The instance was stopped but nothing was switched: restart the previous install, never the target.
  if (journal.status === 'stopping') {
    const previous = inspectTargetInstall(installDirOf(journal.from.installRoot))
    const started = await startTarget({ roots, target: previous, seed: journal.ports ?? null, identity })
    writeJournalStatus({ roots, status: 'reverted_after_interrupted_switch', reason: 'crash_after_stop_restarted_previous' })
    return { protocol: 'personal-install-switch/1', status: 'RECOVERED_PREVIOUS', started }
  }
  const binding = releaseBinding({ installRoot, configRoot: roots.config })
  if (!binding.bound || binding.installBuildId !== target.release.buildId) {
    // The pointer was never bound to the target (crash before/during adoption): keep the previous
    // pointer and restart the previous release so the user gets a running product back, not a
    // silently stopped install.
    await revertPointer({ roots, target })
    writeJournalStatus({ roots, status: 'reverted_after_interrupted_switch', reason: 'pointer_not_bound_to_target' })
    const previousInstall = inspectTargetInstall(installDirOf(journal.from.installRoot))
    const running = readInstanceRecord(roots.config)
    if (running === null || !(await verifyInstance(running)).ok) {
      const started = await startTarget({ roots, target: previousInstall, seed: journal.ports ?? null, identity })
      return { protocol: 'personal-install-switch/1', status: 'RECOVERED_PREVIOUS', reason: 'pointer_not_bound_to_target', started }
    }
    return { protocol: 'personal-install-switch/1', status: 'REVERTED', reason: 'pointer_not_bound_to_target' }
  }
  const started = await startTarget({ roots, target, seed: journal.ports ?? null, identity })
  writeJournalStatus({ roots, status: 'confirmed', reason: 'recovered' })
  return { protocol: 'personal-install-switch/1', status: 'RECOVERED', started }
}

/** Binary-only rollback: restore the previous install pointer. Data is never rolled back. */
export async function rollbackInstall({ installRoot, roots, values }) {
  const previous = readPreviousRelease(roots.config)
  if (previous === null || previous.unreadable === true)
    throw new UpgradeError('rollback_unavailable', 'No previous install pointer is recorded; restore a backup explicitly to return data')
  // Same resource barrier as upgrade: a live orphan API/console or an unverifiable target blocks the
  // pointer change instead of being filtered away.
  const barrier = await ensureResourceBarrier({ roots, target: null, journal: readJournal(roots.config) })
  void barrier
  const targetBuild = readRelease(roots.config).release?.buildId ?? null
  await revertPointer({ roots, target: { release: { buildId: targetBuild } } })
  writeJournalStatus({ roots, status: 'binary_rolled_back', reason: 'explicit_binary_rollback' })
  return {
    protocol: 'personal-install-switch/1',
    status: 'BINARY_ROLLED_BACK',
    from: targetBuild,
    to: previous.release?.buildId ?? null,
    dataRolledBack: false,
    note: 'Only the installed binary pointer changed. Post-upgrade data remains in the same state directory; if the older binary cannot read the newer schema it must refuse to start instead of deleting data.',
  }
}

export { hasInstallManifest }
