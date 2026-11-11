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
import { backupState } from './backup.mjs'
import { processAlive, readInstanceRecord, verifyInstance } from './instance.mjs'
import { RELEASE_FILE, readRelease, validateRelease, verifyReleaseArtifacts } from './release.mjs'
import { hasInstallManifest, initializeRelease, releaseBinding } from './release-bootstrap.mjs'
import { stopInstance } from './stop.mjs'

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
  const { plan, target } = await planUpgrade({ installRoot, roots, to, allowSameSource: values.force === true })
  const journalPath = join(roots.config, SWITCH_JOURNAL)
  const previousPath = join(roots.config, PREVIOUS_RELEASE)
  const previous = readPreviousRelease(roots.config)

  // The mode/access that the running instance actually used must survive the switch. Read it before
  // stopping; if the record is gone, only an explicit --mode/--access may replace it, otherwise refuse.
  const instance = readInstanceRecord(roots.config)
  const identity = preserveIdentity({ record: instance, explicitMode: values.mode, explicitAccess: values.access, journal: readJournal(roots.config) })

  // 1. Stop the recorded instance if it is running. A misleading record must not kill anything.
  let stopped = null
  if (instance !== null) {
    const verification = await verifyInstance(instance)
    if (verification.ok) {
      if (values['no-stop'] === true)
        throw new UpgradeError('upgrade_requires_stopped_instance', 'The instance is running; stop it explicitly or let upgrade stop it', { pid: instance.pid })
      try {
        stopped = await stopInstance({ roots })
      } catch (error) {
        throw new UpgradeError('upgrade_stop_failed', 'The running instance could not be stopped; nothing was switched', { cause: String(error?.message ?? error) })
      }
      if (stopped?.status !== 'STOPPED')
        throw new UpgradeError('upgrade_stop_failed', 'The instance did not report a clean stop; nothing was switched', { status: stopped?.status ?? null })
    } else if (await processAlive(instance.pid)) {
      // A live process that is not the recorded instance is never killed and never treated as ours. It
      // may still be an old writer for the same state, so the switch stays blocked instead of racing.
      throw new UpgradeError('instance_record_unverified', 'The recorded instance does not verify but its pid is alive; refusing to stop or switch', {
        pid: instance.pid,
        failures: verification.failures.slice(0, 8),
        hint: 'Inspect `pa status` and the process yourself; do not delete instance.json blindly.',
      })
    } else {
      // A record whose process is gone is not authority and does not block a stopped-instance switch.
      stopped = { status: 'ALREADY_STOPPED', reason: verification.code ?? 'not_running' }
    }
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
  if (fault === 'crash_after_switch') throw new UpgradeError('upgrade_interrupted', 'Injected crash after pointer switch (test fault); run `pa upgrade --recover`')

  // 4. Start the target binary on the same data roots and require its own identity.
  const started = await startTarget({ roots, target, seed: instance, fault })
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

/** Descendants of one pid inside this process tree (BFS over ps output). */
const processTree = (rootPid) => {
  const ps = spawnSyncPs()
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
  const result = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
  return result.stdout.split('\n').filter(Boolean)
}

const commandOf = (pid) => spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout.trim()

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Stop only processes this operation can prove it started: the spawn root and its descendants, plus
 * the recorded target instance. Every candidate must name the target install or this operation's
 * roots in its command line, so a reused pid or a foreign process is never touched.
 *
 * Returns whether the stop is proven. When it is not, the caller must keep the indeterminate state
 * (no pointer revert, no old-writer restart) instead of pretending the switch is clean.
 */
export async function stopOwnedTarget({ roots, target, spawnedPid, record }) {
  const candidates = new Set()
  if (Number.isInteger(spawnedPid) && spawnedPid > 0) for (const pid of processTree(spawnedPid)) candidates.add(pid)
  for (const pid of [record?.pid, record?.apiPid]) {
    if (!Number.isInteger(pid) || pid <= 0) continue
    candidates.add(pid)
    for (const child of processTree(pid)) candidates.add(child)
  }
  const owned = []
  for (const pid of candidates) {
    if (pid === process.pid) continue
    const command = commandOf(pid)
    if (command === '') continue
    if (command.includes(target.installDir) || command.includes(roots.config) || command.includes(roots.data) || command.includes(roots.logs))
      owned.push(pid)
  }
  const stopped = []
  for (const pid of owned) {
    try { process.kill(pid, 'SIGTERM'); stopped.push(pid) } catch { /* gone */ }
  }
  const deadline = Date.now() + 4000
  while (Date.now() < deadline && owned.some((pid) => alive(pid))) await new Promise((r) => setTimeout(r, 100))
  for (const pid of owned) {
    if (!alive(pid)) continue
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  }
  const killDeadline = Date.now() + 2000
  while (Date.now() < killDeadline && owned.some((pid) => alive(pid))) await new Promise((r) => setTimeout(r, 100))
  const remaining = owned.filter((pid) => alive(pid))
  return { proven: remaining.length === 0, stopped, remaining, considered: owned.length }
}

async function startTarget({ roots, target, seed, identity, fault }) {
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
    { cwd: target.installDir, detached: true, stdio: ['ignore', outFd, errFd] },
  )
  child.unref()
  closeSync(outFd)
  closeSync(errFd)

  const fail = async (reason, detail = {}) => {
    // Prove the process tree this operation started is gone BEFORE touching the pointer or record.
    const cleanup = await stopOwnedTarget({ roots, target, spawnedPid: child.pid, record: readInstanceRecord(roots.config) })
    if (!cleanup.proven) {
      writeJournalStatus({ roots, status: 'target_stop_unproven', reason, cleanup })
      throw new UpgradeError('target_stop_unproven', 'The failed target process tree could not be proven stopped; pointer and record are left as-is (no old writer is restarted)', {
        reason,
        remaining: cleanup.remaining,
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

  if (fault === 'target_unhealthy') {
    // Test fault: the instance may have started; failure cleanup must still stop it.
    await new Promise((r) => setTimeout(r, 1200))
    await fail('injected_unhealthy_target', { health: null })
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
  // Health can answer before the launcher persists its instance record; wait for the exact identity.
  let record = readInstanceRecord(roots.config)
  const recordDeadline = Date.now() + 15_000
  while (Date.now() < recordDeadline && (record === null || record.buildId !== target.release.buildId)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
    record = readInstanceRecord(roots.config)
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

const writeJournalStatus = ({ roots, status, reason }) => {
  const path = join(roots.config, SWITCH_JOURNAL)
  const existing = readJournal(roots.config) ?? {}
  writePrivateJson(path, { ...existing, status, ...(reason === undefined ? {} : { reason }), updatedAt: new Date().toISOString(), dataRolledBack: false })
}

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
  if (journal.status === 'confirmed' || journal.status === 'reverted_after_failed_start')
    return { protocol: 'personal-install-switch/1', status: 'NO_OP', journalStatus: journal.status }
  if (journal.status !== 'switched_unconfirmed' && journal.status !== 'switching')
    throw new UpgradeError('upgrade_recover_unknown_state', 'The switch journal is not in a recoverable state', { journalStatus: journal.status })
  // Never start (or revert over) an unknown live process: the same rule as upgrade/rollback.
  const existing = readInstanceRecord(roots.config)
  if (existing !== null && !(await verifyInstance(existing)).ok && (await processAlive(existing.pid)))
    throw new UpgradeError('instance_record_unverified', 'The recorded instance does not verify but its pid is alive; recovery refuses to touch the pointer or start a second writer', {
      pid: existing.pid,
    })
  const identity = preserveIdentity({ record: existing, explicitMode: values.mode, explicitAccess: values.access, journal })
  const target = inspectTargetInstall(journal.to.installDir)
  const binding = releaseBinding({ installRoot, configRoot: roots.config })
  if (!binding.bound || binding.installBuildId !== target.release.buildId) {
    // The pointer write was interrupted or does not match the target: revert.
    await revertPointer({ roots, target })
    writeJournalStatus({ roots, status: 'reverted_after_interrupted_switch', reason: 'pointer_not_bound_to_target' })
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
  const instance = readInstanceRecord(roots.config)
  if (instance !== null) {
    const verification = await verifyInstance(instance)
    if (verification.ok) {
      if (values['no-stop'] === true) throw new UpgradeError('upgrade_requires_stopped_instance', 'Stop the running instance before rolling the binary back')
      const stopped = await stopInstance({ roots })
      if (stopped?.status !== 'STOPPED') throw new UpgradeError('upgrade_stop_failed', 'The running instance could not be stopped', { status: stopped?.status ?? null })
    } else if (await processAlive(instance.pid)) {
      throw new UpgradeError('instance_record_unverified', 'The recorded instance does not verify but its pid is alive; refusing to roll the binary back over an unknown writer', {
        pid: instance.pid,
        failures: verification.failures.slice(0, 8),
      })
    }
  }
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
