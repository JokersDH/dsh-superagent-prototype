#!/usr/bin/env node
/**
 * Repeatable zero-model local-trial smoke:
 *
 *   build -> first-run -> doctor -> start (fixture, no native/model)
 *   -> static console + proxied API + status + reuse
 *   -> live backup (consistent snapshot) -> verify
 *   -> stop -> offline verify
 *   -> restore to a new private directory -> managed import -> start restored -> stop
 *   -> rollback rehearsal (failed state kept, prior snapshot restored) -> start again -> stop
 *   -> negative restore cases (non-empty target, corrupted bundle)
 *
 * No model request is made, no native agent is dispatched, and no user project/account is touched.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PA = join(REPO_ROOT, 'apps/launcher/bin/pa.mjs')
const BUILD = join(REPO_ROOT, 'tools/distribution/build.mjs')
const REPORTS = join(REPO_ROOT, 'tools/distribution/reports')

const { values } = parseArgs({
  options: {
    'keep-root': { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})

const evidence = { case: 'DIST-TRIAL-01', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [] }
const results = []
const step = (id, status, detail) => results.push({ id, status, ...(detail === undefined ? {} : { detail }) })

const root = values['keep-root']
  ? (mkdirSync(values['keep-root'], { recursive: true, mode: 0o700 }), values['keep-root'])
  : mkdtempSync(join(tmpdir(), 'pa-trial-smoke-'))
const roots = {
  config: join(root, 'config'),
  data: join(root, 'data'),
  cache: join(root, 'cache'),
  logs: join(root, 'logs'),
  workspaces: join(root, 'workspaces'),
}
const restoredData = join(root, 'restored')
const importedRestoreData = join(root, 'restored-imported')
const backupDir = join(root, 'backup')
const backupPath = join(backupDir, 'state.pab')
const recoverySource = join(root, 'recovery-source')
const recoveryRestored = join(root, 'recovery-restored')
const recoveryBundle = join(backupDir, 'recovery.pab')
let backupArchiveSha256 = null
let importId = null
const activeTrials = new Set()

// The staged/launcher runtime is plain Node; smoke helpers read the product database and build a
// recovery fixture through the same public storage package the coordinator uses.
const requireStorage = createRequire(join(REPO_ROOT, 'packages/storage/package.json'))
const Database = requireStorage('better-sqlite3')
const { ProductStore } = await import(pathToFileURL(join(REPO_ROOT, 'packages/storage/dist/index.js')).href)

function readBusinessSnapshot(databasePath) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return {
      queue: db.prepare('SELECT kind, key, value, seq, generation, due, attempts, parked_at, parked_reason FROM effect ORDER BY kind, key, seq').all(),
      answers: db.prepare('SELECT answer_id, question_id, expected_version, answer_digest, recorded_at FROM answers ORDER BY answer_id').all(),
      deliveries: db.prepare('SELECT answer_id, target_binding_id, status, evidence FROM answer_deliveries ORDER BY answer_id, target_binding_id').all(),
      commandReceipts: Number(db.prepare('SELECT COUNT(*) AS count FROM command_receipts').get().count),
      tickets: Number(db.prepare('SELECT COUNT(*) AS count FROM ticket').get().count),
    }
  } finally {
    db.close()
  }
}

/** Queue rows for begin/deliver, assistant reply, answer and a parked verification plus an unknown writer. */
function createRecoveryFixtureState(stateDir) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  try {
    const now = new Date().toISOString()
    store.queue.enqueue('application.execute', 'fixture-begin', JSON.stringify({ kind: 'begin', ticketId: 'ticket-old' }), 1, 0, now)
    store.queue.enqueue('application.execute', 'fixture-deliver', JSON.stringify({ kind: 'deliver', ticketId: 'ticket-old' }), 2, 0, now)
    store.queue.enqueue('application.assistant.reply', 'fixture-chat', JSON.stringify({ messageId: 'message-old' }), 3, 0, now)
    store.queue.enqueue('question.answer', 'fixture-answer', JSON.stringify({ answerId: 'answer-old' }), 4, 0, now)
    store.queue.enqueue('verification.retry', 'fixture-verify', JSON.stringify({ verificationId: 'verification-old' }), 5, 0, now)
    const parked = store.queue.oldestRow('verification.retry')
    store.queue.park('verification.retry', parked.key, parked.seq, parked.generation, 'unknown-native-send', now)
    store.answers.record('answer-old', { questionId: 'question-old', expectedVersion: 1, digest: 'digest-old', answer: { kind: 'choices', optionIds: ['allow'] } })
    store.answers.upsertDelivery('answer-old', 'target-old', 'local_recorded', 'historical')
    // An uncertain writer: the claim process is gone and must never become new-machine authority.
    store.db.prepare('INSERT OR REPLACE INTO writer_claim (id, nonce, pid, started_at) VALUES (1, ?, ?, ?)')
      .run('dead-writer-nonce', 999_999, '2026-11-01T00:00:00.000Z')
  } finally {
    store.close()
  }
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const socket = createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address()
      socket.close(() => resolvePromise(port))
    })
  })
}

function stateArgs(dataRoot = roots.data) {
  return [
    '--install', REPO_ROOT,
    '--config-root', roots.config,
    '--data-root', dataRoot,
    '--cache-root', roots.cache,
    '--logs-root', roots.logs,
    '--workspace-root', roots.workspaces,
  ]
}

function runPa(args, options = {}) {
  const result = spawnSync(process.execPath, [PA, ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: options.timeout ?? 120000 })
  if (options.allowExit !== undefined && !options.allowExit.includes(result.status)) {
    throw new Error(`pa ${args[0]} exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  let json = null
  try { json = JSON.parse(result.stdout) } catch { json = null }
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

async function waitFor(url, predicate, { timeoutMs = 30000, child, label } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'not ready'
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`${label ?? url} failed: the start supervisor exited early (${child.exitCode ?? child.signalCode})`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'error', headers: { connection: 'close' } })
      if (response.ok) {
        const body = (response.headers.get('content-type') ?? '').includes('json') ? await response.json() : await response.text()
        if (predicate(body)) return body
        lastError = `unexpected response from ${url}`
      } else lastError = `HTTP ${response.status} from ${url}`
    } catch (error) {
      lastError = String(error.message ?? error)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`${label ?? url} did not become ready: ${lastError}`)
}

async function waitForRunning(dataRoot, { child, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`the start supervisor exited before recording the instance (${child.exitCode ?? child.signalCode})`)
    const status = runPa(['status', '--json', ...stateArgs(dataRoot)], { allowExit: [0, 1, 2] })
    if (status.json?.status === 'RUNNING') return status.json
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('the instance did not reach a verified RUNNING state')
}

async function startTrial(dataRoot, { label, consolePort, apiPort, requireLogin = false }) {
  const supervisorOut = join(roots.logs, `smoke-${label}.out.log`)
  const supervisorErr = join(roots.logs, `smoke-${label}.err.log`)
  mkdirSync(roots.logs, { recursive: true, mode: 0o700 })
  const outFd = openSync(supervisorOut, 'w', 0o600)
  const errFd = openSync(supervisorErr, 'w', 0o600)
  const child = spawn(
    process.execPath,
    [PA, 'start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...(requireLogin ? ['--require-login'] : []), ...stateArgs(dataRoot)],
    { cwd: REPO_ROOT, env: { ...process.env }, stdio: ['ignore', outFd, errFd] },
  )
  const exited = new Promise((resolvePromise) => child.once('exit', (code, signal) => resolvePromise({ code, signal })))
  const consoleURL = `http://127.0.0.1:${consolePort}`
  const apiURL = `http://127.0.0.1:${apiPort}`
  try {
    await waitFor(`${consoleURL}/`, (body) => typeof body === 'string' && body.includes('<div id="root">'), { child, label: `${label} console` })
    const marker = await waitFor(`${consoleURL}/__pa/instance`, (body) => body?.product === 'dsh-superagent', { child, label: `${label} marker` })
    const health = await waitFor(`${apiURL}/v1/health`, (body) => body?.status === 'ok', { child, label: `${label} health` })
    const proxied = await waitFor(`${consoleURL}/v1/health`, (body) => body?.status === 'ok', { child, label: `${label} proxied health` })
    // Token mode intentionally rejects product reads until a local session is bootstrapped.
    const configuration = requireLogin
      ? null
      : await waitFor(`${consoleURL}/v1/configuration`, (body) => Array.isArray(body?.projects), { child, label: `${label} configuration` })
    const html = await fetch(consoleURL, { headers: { connection: 'close' } }).then((response) => response.text())
    const assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
    if (!assetPath) throw new Error('static console does not reference a built JS asset')
    const asset = await fetch(`${consoleURL}${assetPath}`, { headers: { connection: 'close' } })
    const assetBytes = (await asset.arrayBuffer()).byteLength
    if (!asset.ok || assetBytes < 1000) throw new Error(`console asset is not served correctly (${asset.status}, ${assetBytes} bytes)`)
    const status = await waitForRunning(dataRoot, { child })
    const handle = { child, exited, outFd, errFd, consoleURL, apiURL, supervisorOut, supervisorErr, marker, health, proxied, configuration, assetPath, assetBytes, status, dataRoot }
    activeTrials.add(handle)
    return handle
  } catch (error) {
    child.kill('SIGTERM')
    for (const fd of [outFd, errFd]) { try { closeSync(fd) } catch { /* closed */ } }
    throw error
  }
}

function closeLogFds(handle) {
  for (const fd of [handle.outFd, handle.errFd]) {
    if (typeof fd === 'number' && fd >= 0) {
      try { closeSync(fd) } catch { /* closed */ }
    }
  }
}

async function stopTrial(handle, { label }) {
  const stopStarted = Date.now()
  const stop = runPa(['stop', '--json', ...stateArgs(handle.dataRoot)], { allowExit: [0] })
  const stopMs = Date.now() - stopStarted
  if (stop.json?.status !== 'STOPPED') throw new Error(`${label} stop expected STOPPED, got ${JSON.stringify(stop.json)}`)
  const exit = await Promise.race([handle.exited, new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 15000))])
  if (exit === 'timeout') throw new Error(`${label} start supervisor did not exit after stop`)
  if (exit.code !== 0) throw new Error(`${label} start supervisor exited ${exit.code ?? exit.signal} after stop`)
  closeLogFds(handle)
  activeTrials.delete(handle)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  const portClosed = await new Promise((resolvePromise) => {
    fetch(`${handle.consoleURL}/`, { signal: AbortSignal.timeout(1000) }).then(() => resolvePromise(false)).catch(() => resolvePromise(true))
  })
  if (!portClosed) throw new Error(`${label} console port still accepts connections after stop`)
  if (existsSync(join(roots.config, 'instance.json'))) throw new Error(`${label} instance record still exists after a verified stop`)
  return { stopMs, exit }
}

try {
  if (!values['skip-build']) {
    const build = spawnSync(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', roots.config, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 })
    if (build.status !== 0) throw new Error(`build failed (exit ${build.status})\n${build.stderr}`)
    const summary = JSON.parse(build.stdout)
    step('build', 'PASS', { buildId: summary.buildId, artifacts: summary.artifacts })
  } else step('build', 'SKIPPED')

  const firstRun = runPa(['first-run', '--json', ...stateArgs()], { allowExit: [0] })
  if (firstRun.json?.status !== 'OK') throw new Error('first-run did not report OK')
  step('first-run', 'PASS', { created: firstRun.json.created })

  const doctorBefore = runPa(['doctor', '--json', ...stateArgs()], { allowExit: [0, 1] })
  if (doctorBefore.json.checks.some((check) => check.status === 'FAIL')) throw new Error('doctor reported FAIL before start')
  step('doctor-before-start', 'PASS', { status: doctorBefore.json.status })

  const primaryPort = await freePort()
  let primaryApiPort = await freePort()
  if (primaryApiPort === primaryPort) primaryApiPort = await freePort()
  const primary = await startTrial(roots.data, { label: 'primary', consolePort: primaryPort, apiPort: primaryApiPort })
  primary.dataRoot = roots.data
  step('static-console', 'PASS', { url: primary.consoleURL })
  step('instance-marker', 'PASS', { buildId: primary.marker.buildId })
  step('api-health-direct', 'PASS', primary.health)
  step('api-health-via-proxy', 'PASS', primary.proxied)
  step('product-configuration', 'PASS', { revision: primary.configuration.revision, projects: primary.configuration.projects.length })
  step('console-asset', 'PASS', { path: primary.assetPath, bytes: primary.assetBytes })
  step('status-running', 'PASS', { pid: primary.status.instance.pid, checks: primary.status.checks.length })

  const reuse = runPa(['start', '--fixture', '--port', String(primaryPort), '--api-port', String(primaryApiPort), '--json', ...stateArgs()], { allowExit: [0] })
  if (reuse.json?.status !== 'REUSED') throw new Error(`second start expected REUSED, got ${reuse.json?.status}`)
  step('reuse-verified-instance', 'PASS', { pid: reuse.json.instance.pid })

  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const backup = runPa(['backup', '--json', '--out', backupPath, ...stateArgs()], { allowExit: [0] })
  if (backup.json?.status !== 'CREATED') throw new Error(`backup did not report CREATED: ${JSON.stringify(backup.json).slice(0, 600)}`)
  if (backup.json.database.integrity !== 'ok' || backup.json.database.foreignKeyViolations !== 0)
    throw new Error(`backup database facts are not clean: ${JSON.stringify(backup.json.database)}`)
  backupArchiveSha256 = backup.json.archiveSha256
  step('backup-live', 'PASS', { archiveSha256: backupArchiveSha256, counts: backup.json.counts, database: backup.json.database })

  const verifyLive = runPa(['verify-backup', '--json', '--bundle', backupPath, ...stateArgs()], { allowExit: [0] })
  if (verifyLive.json?.status !== 'VERIFIED' || verifyLive.json.database.integrity !== 'ok')
    throw new Error('verify-backup did not report a clean VERIFIED bundle')
  step('verify-backup-live', 'PASS', { manifestDigest: verifyLive.json.manifestDigest, entries: verifyLive.json.counts.entries })

  // Destructive rollback must refuse a live state: stop request/record is not physical stop.
  const activeRollback = runPa(['rollback', '--json', '--bundle', backupPath, '--target', roots.data, ...stateArgs()], { allowExit: [2] })
  if (!['state_in_use', 'writer_uncertain', 'target_active'].includes(activeRollback.json?.code))
    throw new Error(`active rollback was not refused: ${JSON.stringify(activeRollback.json).slice(0, 500)}`)
  const primaryStillHealthy = await fetch(`${primary.apiURL}/v1/health`, { headers: { connection: 'close' } })
  if (!primaryStillHealthy.ok) throw new Error('primary instance was disturbed by the refused rollback')
  if (!existsSync(join(roots.data, 'state.sqlite'))) throw new Error('active state directory moved despite refusal')
  step('rollback-refuses-active-state', 'PASS', { code: activeRollback.json.code })

  // Reuse must compare the requested identity, not just a listening port.
  const otherState = join(root, 'other-state')
  const conflictState = runPa(
    ['start', '--fixture', '--port', String(primaryPort), '--api-port', String(primaryApiPort), '--json', ...stateArgs(otherState)],
    { allowExit: [2] },
  )
  if (conflictState.json?.code !== 'instance_conflict') throw new Error(`different state reuse expected instance_conflict, got ${conflictState.json?.code}`)
  const otherConsole = await freePort()
  let otherApi = await freePort()
  if (otherApi === otherConsole) otherApi = await freePort()
  const conflictPorts = runPa(
    ['start', '--fixture', '--port', String(otherConsole), '--api-port', String(otherApi), '--json', ...stateArgs()],
    { allowExit: [2] },
  )
  if (conflictPorts.json?.code !== 'instance_conflict') throw new Error(`different port reuse expected instance_conflict, got ${conflictPorts.json?.code}`)
  step('reuse-requires-matching-identity', 'PASS', { state: conflictState.json.code, ports: conflictPorts.json.code })

  const primaryStop = await stopTrial(primary, { label: 'primary' })
  step('stop-primary', 'PASS', { stopMs: primaryStop.stopMs })

  const verifyOffline = runPa(['verify-backup', '--json', '--bundle', backupPath, ...stateArgs()], { allowExit: [0] })
  if (verifyOffline.json?.status !== 'VERIFIED') throw new Error('offline verify-backup did not report VERIFIED')
  step('verify-backup-offline', 'PASS', { manifestDigest: verifyOffline.json.manifestDigest })

  const restore = runPa(['restore', '--json', '--bundle', backupPath, '--to', restoredData, ...stateArgs()], { allowExit: [0] })
  if (restore.json?.status !== 'RESTORED') throw new Error(`restore did not report RESTORED: ${JSON.stringify(restore.json).slice(0, 600)}`)
  if (restore.json.report.database.integrity !== 'ok' || restore.json.report.database.foreignKeyViolations !== 0)
    throw new Error('restored database facts are not clean')
  step('restore-new-directory', 'PASS', { target: restoredData, pendingRebind: restore.json.report.pathMappings.pendingRebind.length })

  const nonEmpty = join(root, 'non-empty-target')
  mkdirSync(nonEmpty, { recursive: true, mode: 0o700 })
  writeFileSync(join(nonEmpty, 'keep.txt'), 'keep', { mode: 0o600 })
  const nonEmptyRestore = runPa(['restore', '--json', '--bundle', backupPath, '--to', nonEmpty, ...stateArgs()], { allowExit: [2] })
  if (nonEmptyRestore.json?.code !== 'target_not_empty') throw new Error('restore into a non-empty directory was not refused')
  if (readFileSync(join(nonEmpty, 'keep.txt'), 'utf8') !== 'keep') throw new Error('non-empty target was modified')
  step('restore-refuses-non-empty', 'PASS', { code: nonEmptyRestore.json.code })

  const corrupted = join(backupDir, 'corrupted.pab')
  const backupBytes = readFileSync(backupPath)
  writeFileSync(corrupted, backupBytes.subarray(0, backupBytes.length - 20))
  const corruptedTarget = join(root, 'corrupted-target')
  const corruptedRestore = runPa(['restore', '--json', '--bundle', corrupted, '--to', corruptedTarget, ...stateArgs()], { allowExit: [2] })
  if (corruptedRestore.json?.code !== 'archive_invalid') throw new Error(`corrupted bundle restore expected archive_invalid, got ${corruptedRestore.json?.code}`)
  if (existsSync(corruptedTarget)) throw new Error('corrupted bundle created the target directory')
  step('restore-refuses-corrupted', 'PASS', { code: corruptedRestore.json.code })

  const imported = runPa(['import-bundle', '--json', '--bundle', backupPath, ...stateArgs()], { allowExit: [0] })
  if (imported.json?.status !== 'IMPORTED') throw new Error('import-bundle did not report IMPORTED')
  importId = imported.json.archiveSha256
  step('import-managed-bundle', 'PASS', { importId })

  const importedRestore = runPa(['restore', '--json', '--bundle', importId, '--to', importedRestoreData, ...stateArgs()], { allowExit: [0] })
  if (importedRestore.json?.status !== 'RESTORED') throw new Error('restore from a managed import id did not report RESTORED')
  step('restore-managed-import', 'PASS', { target: importedRestoreData })

  // Recovery gate: a restored state with old business must start read-only and never consume it.
  createRecoveryFixtureState(recoverySource)
  const recoveryBefore = readBusinessSnapshot(join(recoverySource, 'state.sqlite'))
  if (recoveryBefore.queue.length < 5 || recoveryBefore.answers.length !== 1) throw new Error('recovery fixture was not built')
  const recoveryBackup = runPa(['backup', '--json', '--out', recoveryBundle, ...stateArgs(recoverySource)], { allowExit: [0] })
  if (recoveryBackup.json?.status !== 'CREATED') throw new Error('recovery fixture backup failed')
  const recoveryRestore = runPa(['restore', '--json', '--bundle', recoveryBundle, '--to', recoveryRestored, ...stateArgs()], { allowExit: [0] })
  if (recoveryRestore.json?.status !== 'RESTORED') throw new Error('recovery fixture restore failed')
  const recoveryPort = await freePort()
  let recoveryApiPort = await freePort()
  if (recoveryApiPort === recoveryPort) recoveryApiPort = await freePort()
  const recoveryInstance = await startTrial(recoveryRestored, { label: 'recovery', consolePort: recoveryPort, apiPort: recoveryApiPort })
  recoveryInstance.dataRoot = recoveryRestored
  if (recoveryInstance.health?.startupMode !== 'recovery_readonly')
    throw new Error(`restored first start was not read-only: ${JSON.stringify(recoveryInstance.health)}`)
  if (!recoveryInstance.configuration.profiles.every((profile) => profile.dispatchAllowed === false))
    throw new Error('recovery configuration exposed a dispatchable profile')
  const recoveryKey = readFileSync(join(recoveryRestored, 'api.key'), 'utf8').trim()
  const rejectedCommand = await fetch(`${recoveryInstance.apiURL}/v1/commands`, {
    method: 'POST',
    headers: { connection: 'close', authorization: `Bearer ${recoveryKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: 'recovery-smoke-command', conversationId: 'conv-main', kind: 'create_work' }),
  })
  if (rejectedCommand.status !== 422) throw new Error(`recovery command expected 422, got ${rejectedCommand.status}`)
  const rejectedBody = await rejectedCommand.json()
  step('restored-first-start-readonly', 'PASS', {
    startupMode: recoveryInstance.health.startupMode,
    commandStatus: rejectedCommand.status,
    errorCode: rejectedBody?.error?.code ?? null,
  })
  const recoveryStop = await stopTrial(recoveryInstance, { label: 'recovery' })
  step('stop-recovery-readonly', 'PASS', { stopMs: recoveryStop.stopMs })
  const recoveryAfter = readBusinessSnapshot(join(recoveryRestored, 'state.sqlite'))
  if (JSON.stringify(recoveryAfter) !== JSON.stringify(recoveryBefore))
    throw new Error('recovery first start consumed or replayed queued business/answers')
  if (!existsSync(join(recoveryRestored, 'restore-report.json')))
    throw new Error('the launcher deleted the restore marker')
  step('recovery-keeps-old-business', 'PASS', {
    queued: recoveryAfter.queue.length,
    answers: recoveryAfter.answers.length,
    deliveries: recoveryAfter.deliveries.length,
    markerPreserved: true,
  })

  // Token access mode: the console must be able to bootstrap a local session from the private
  // bootstrap key without exposing it in a URL or browser storage.
  const loginPort = await freePort()
  let loginApiPort = await freePort()
  if (loginApiPort === loginPort) loginApiPort = await freePort()
  const loginInstance = await startTrial(importedRestoreData, { label: 'login', consolePort: loginPort, apiPort: loginApiPort, requireLogin: true })
  loginInstance.dataRoot = importedRestoreData
  const unauthenticated = await fetch(`${loginInstance.consoleURL}/v1/session`, { headers: { connection: 'close' } })
  if (unauthenticated.status !== 401) throw new Error(`token mode expected 401 before bootstrap, got ${unauthenticated.status}`)
  const bootstrapToken = readFileSync(join(importedRestoreData, 'bootstrap.key'), 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(bootstrapToken)) throw new Error('bootstrap key is not the expected local credential')
  const bootstrap = await fetch(`${loginInstance.consoleURL}/v1/session`, {
    method: 'POST',
    headers: { connection: 'close', 'content-type': 'application/json', origin: loginInstance.consoleURL },
    body: JSON.stringify({ bootstrapToken }),
  })
  if (bootstrap.status !== 200) throw new Error(`session bootstrap failed with ${bootstrap.status}`)
  const cookie = (bootstrap.headers.get('set-cookie') ?? '').split(';')[0]
  if (!cookie.includes('=')) throw new Error('session bootstrap did not set a cookie')
  const authenticated = await fetch(`${loginInstance.consoleURL}/v1/session`, { headers: { connection: 'close', cookie } })
  if (authenticated.status !== 200) throw new Error(`authenticated session check failed with ${authenticated.status}`)
  if (loginInstance.health?.startupMode !== 'recovery_readonly')
    throw new Error('token-mode restored instance did not start read-only')
  const loginWrite = await fetch(`${loginInstance.apiURL}/v1/commands`, {
    method: 'POST',
    headers: { connection: 'close', cookie, 'content-type': 'application/json', origin: loginInstance.consoleURL },
    body: JSON.stringify({ commandId: 'login-smoke-command', conversationId: 'conv-main', kind: 'create_work' }),
  })
  if (loginWrite.status !== 422) throw new Error(`recovery login write expected 422, got ${loginWrite.status}`)
  step('login-gated-session', 'PASS', { beforeBootstrap: 'auth_required', afterBootstrap: 'authenticated', startupMode: 'recovery_readonly', writeStatus: 422 })
  const loginStop = await stopTrial(loginInstance, { label: 'login' })
  step('stop-login-instance', 'PASS', { stopMs: loginStop.stopMs })

  const restoredPort = await freePort()
  let restoredApiPort = await freePort()
  if (restoredApiPort === restoredPort) restoredApiPort = await freePort()
  const restored = await startTrial(restoredData, { label: 'restored', consolePort: restoredPort, apiPort: restoredApiPort })
  restored.dataRoot = restoredData
  if (restored.health?.startupMode !== 'recovery_readonly') throw new Error('restored instance did not start read-only')
  step('start-restored', 'PASS', { url: restored.consoleURL, health: restored.health, startupMode: restored.health.startupMode })
  const restoredStop = await stopTrial(restored, { label: 'restored' })
  step('stop-restored', 'PASS', { stopMs: restoredStop.stopMs })

  const rollback = runPa(['rollback', '--json', '--bundle', backupPath, '--target', restoredData, ...stateArgs()], { allowExit: [0] })
  if (rollback.json?.status !== 'ROLLED_BACK') throw new Error(`rollback did not report ROLLED_BACK: ${JSON.stringify(rollback.json).slice(0, 600)}`)
  if (!existsSync(rollback.json.failedDir)) throw new Error('rollback did not keep the failed state directory')
  if (!existsSync(join(restoredData, 'state.sqlite'))) throw new Error('rollback did not restore a product database')
  step('rollback-rehearsal', 'PASS', { failedDir: rollback.json.failedDir, target: rollback.json.target })

  const rollbackPort = await freePort()
  let rollbackApiPort = await freePort()
  if (rollbackApiPort === rollbackPort) rollbackApiPort = await freePort()
  const afterRollback = await startTrial(restoredData, { label: 'after-rollback', consolePort: rollbackPort, apiPort: rollbackApiPort })
  afterRollback.dataRoot = restoredData
  step('start-after-rollback', 'PASS', { url: afterRollback.consoleURL })
  const afterRollbackStop = await stopTrial(afterRollback, { label: 'after-rollback' })
  step('stop-after-rollback', 'PASS', { stopMs: afterRollbackStop.stopMs })

  const doctorAfter = runPa(['doctor', '--json', ...stateArgs()], { allowExit: [0, 1] })
  if (doctorAfter.json.checks.some((check) => check.id === 'instance' && check.status === 'FAIL'))
    throw new Error('doctor still reports a broken instance after stop')
  step('doctor-after-stop', 'PASS', { status: doctorAfter.json.status })

  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = { message: String(error.message ?? error) }
} finally {
  for (const handle of activeTrials) {
    try {
      runPa(['stop', '--json', ...stateArgs(handle.dataRoot)], { allowExit: [0, 1], timeout: 20000 })
      await Promise.race([handle.exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))])
      if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill('SIGTERM')
      closeLogFds(handle)
    } catch {
      /* best-effort cleanup of our own isolated trial */
    }
  }
  activeTrials.clear()
  evidence.steps = results
  evidence.durationMs = Date.now() - Date.parse(evidence.startedAt)
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations.push(
    'Fixture mode only: no vendor/model request, no native agent, no user project.',
    'Only darwin/arm64 + Node 24.21.x is a measured candidate; other platforms remain NOT_TESTED.',
    'The trial instance ran on isolated temporary roots/ports; user services were not touched.',
    'Native authentication/environment is not migrated; restored state must be revalidated before real execution.',
  )
  if (values['keep-root']) evidence.root = root
  mkdirSync(REPORTS, { recursive: true })
  evidence.outputs = {
    ...(backupArchiveSha256 ? { backupArchiveSha256 } : {}),
    ...(importId ? { importId } : {}),
    ...(values['keep-root'] ? { backupPath } : {}),
  }
  writeFileSync(join(REPORTS, 'zero-model-smoke.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  if (!values['keep-root']) rmSync(root, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
