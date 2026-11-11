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
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
const stageBuild = join(root, 'stage-build')
const stagedRoot = join(root, 'stage-relocated')
const backupDir = join(root, 'backup')
const backupPath = join(backupDir, 'state.pab')
const recoverySource = join(root, 'recovery-source')
const recoveryRestored = join(root, 'recovery-restored')
const recoveryBundle = join(backupDir, 'recovery.pab')
let backupArchiveSha256 = null
let importId = null
const deliveryArtifacts = []
let deliveredWorkId = null
const activeTrials = new Set()
const raceChildren = []
let raceStopped = false
let raceArgsCleanup = null

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
    const build = spawnSync(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', roots.config, '--output', stageBuild, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 })
    if (build.status !== 0) throw new Error(`build failed (exit ${build.status})\n${build.stderr}`)
    const summary = JSON.parse(build.stdout)
    step('build', 'PASS', { buildId: summary.buildId, artifacts: summary.artifacts, dependencies: summary.dependencies, staged: summary.staged })
    if (!existsSync(join(stageBuild, 'install.json'))) throw new Error('build --output did not produce a staged install closure')
    renameSync(stageBuild, stagedRoot)
    const install = JSON.parse(readFileSync(join(stagedRoot, 'install.json'), 'utf8'))
    if (install.format !== 'pa-install' || install.formatVersion !== 1) throw new Error('unexpected install manifest format')
    if (install.files.length < 1000 || !install.dependencies.some((dependency) => dependency.name === 'better-sqlite3'))
      throw new Error('staged install manifest does not cover the runtime closure')
    for (const entry of ['launcher', 'coordinator', 'runner', 'consoleEntry', 'nativeBinding']) {
      const path = install.entrypoints?.[entry]
      if (typeof path !== 'string' || !existsSync(join(stagedRoot, path))) throw new Error(`staged entrypoint ${entry} is missing`)
    }
    if (!Array.isArray(install.workspacePackages) || install.workspacePackages.length < 10)
      throw new Error('staged install does not list the workspace packages')
    if (install.supportMatrix?.abi !== null && install.supportMatrix?.abi !== undefined && String(install.supportMatrix.abi) !== process.versions.modules)
      throw new Error('support matrix ABI does not match the producer')
    for (const runtimeFile of [
      'app/apps/coordinator/product/project-settings.ts',
      'app/apps/coordinator/product/review-timing.ts',
      'app/packages/contracts/src/routing-review.ts',
    ]) {
      if (!existsSync(join(stagedRoot, runtimeFile))) throw new Error(`staged closure is missing latest main runtime file ${runtimeFile}`)
    }
    const forbidden = install.files.filter((entry) => /(?:^|\/)(?:api\.key|auth\.json|\.env|instance\.json|launcher\.json|start\.lock)$/.test(entry.path))
    if (forbidden.length > 0) throw new Error(`staged install carries non-closure secret/runtime material: ${forbidden.slice(0, 5).map((entry) => entry.path)}`)
    step('stage-closure', 'PASS', {
      root: stagedRoot,
      files: install.files.length,
      dependencies: install.dependencies.length,
      workspacePackages: install.workspacePackages.length,
      entrypoints: install.entrypoints,
      supportMatrix: install.supportMatrix,
      buildId: install.buildId,
    })
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

  // A completed controlled delivery (real patch/check artifacts, zero model calls) is created
  // before the backup so the restore roundtrip can verify actual delivered bytes afterwards.
  const productReportPath = join(root, 'product-delivery.json')
  const productSmoke = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'tools/bootstrap/smoke-product-api.mjs'), '--url', primary.apiURL, '--state', roots.data, '--report', productReportPath],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 },
  )
  if (productSmoke.status !== 0)
    throw new Error(`completed-delivery fixture failed (exit ${productSmoke.status})\n${productSmoke.stdout}\n${productSmoke.stderr}`)
  const delivery = JSON.parse(readFileSync(productReportPath, 'utf8'))
  if (delivery.status !== 'PASS_REAL_LOOPBACK_CONTROLLED_PRODUCT' || delivery.artifactIds.length === 0)
    throw new Error('completed-delivery fixture did not produce artifacts')
  const primaryToken = readFileSync(join(roots.data, 'api.key'), 'utf8').trim()
  for (const artifactId of delivery.artifactIds) {
    const response = await fetch(`${primary.apiURL}/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      headers: { connection: 'close', authorization: `Bearer ${primaryToken}` },
    })
    if (!response.ok) throw new Error(`primary artifact download failed: ${artifactId} ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    deliveryArtifacts.push({ id: artifactId, bytes, sha256 })
  }
  deliveredWorkId = delivery.workId
  step('completed-delivery-fixture', 'PASS', {
    workId: delivery.workId,
    artifacts: deliveryArtifacts.length,
    bytes: deliveryArtifacts.reduce((total, artifact) => total + artifact.bytes.byteLength, 0),
    vendorCalls: delivery.vendorCalls ?? 0,
  })

  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const backup = runPa(['backup', '--json', '--out', backupPath, ...stateArgs()], { allowExit: [0] })
  if (backup.json?.status !== 'CREATED') throw new Error(`backup did not report CREATED: ${JSON.stringify(backup.json).slice(0, 600)}`)
  if (backup.json.database.integrity !== 'ok' || backup.json.database.foreignKeyViolations !== 0)
    throw new Error(`backup database facts are not clean: ${JSON.stringify(backup.json.database)}`)
  backupArchiveSha256 = backup.json.archiveSha256
  const backupEvidence = backup.json.evidence
  if (backupEvidence === undefined || backupEvidence.protocol !== 'personal-evidence')
    throw new Error('backup manifest does not record evidence coverage')
  if (backupEvidence.counts.artifacts < 1) throw new Error('backup evidence does not cover the delivered artifacts')
  if (!['included', 'unavailable'].includes(backupEvidence.routingEvidence.status))
    throw new Error('backup evidence does not describe routing evidence capability')
  if (backupEvidence.routingEvidence.status === 'included' && backupEvidence.formatVersion !== 2)
    throw new Error('a bundle that covers routing evidence must use evidence format 2')
  if (backupEvidence.routingEvidence.status === 'unavailable' && backupEvidence.formatVersion !== 1)
    throw new Error('a schema-12 bundle without routing evidence must remain evidence format 1')
  step('backup-live', 'PASS', { archiveSha256: backupArchiveSha256, counts: backup.json.counts, database: backup.json.database, evidence: { digest: backupEvidence.digest, counts: backupEvidence.counts, routing: backupEvidence.routingEvidence.status } })

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

  // Concurrent start: exactly one launcher may pass the startup lock and record the instance.
  const raceRoot = join(root, 'race')
  const race = {
    config: join(raceRoot, 'config'),
    data: join(raceRoot, 'data'),
    cache: join(raceRoot, 'cache'),
    logs: join(raceRoot, 'logs'),
    workspaces: join(raceRoot, 'workspaces'),
  }
  mkdirSync(race.config, { recursive: true, mode: 0o700 })
  copyFileSync(join(roots.config, 'release.json'), join(race.config, 'release.json'))
  const raceArgs = [
    '--install', REPO_ROOT,
    '--config-root', race.config,
    '--data-root', race.data,
    '--cache-root', race.cache,
    '--logs-root', race.logs,
    '--workspace-root', race.workspaces,
  ]
  raceArgsCleanup = raceArgs
  const raceFirstRun = runPa(['first-run', '--json', ...raceArgs], { allowExit: [0] })
  if (raceFirstRun.json?.status !== 'OK') throw new Error('race config first-run failed')
  const racePort = await freePort()
  const raceApiPort = await freePort()
  const raceOtherPort = await freePort()
  const raceOtherApiPort = await freePort()
  const spawnStart = (port, apiPort) =>
    spawn(process.execPath, [PA, 'start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort), ...raceArgs], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const first = spawnStart(racePort, raceApiPort)
  const second = spawnStart(raceOtherPort, raceOtherApiPort)
  raceChildren.push(first, second)
  const collect = (child) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const exited = new Promise((resolvePromise) => child.once('exit', (code, signal) => resolvePromise({ code, signal, stdout, stderr })))
    return exited
  }
  const firstExit = collect(first)
  const secondExit = collect(second)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000))
  const exitedChildren = [first, second].filter((child) => child.exitCode !== null || child.signalCode !== null)
  const winner = [first, second].find((child) => !exitedChildren.includes(child))
  if (exitedChildren.length !== 1 || !winner) throw new Error('concurrent start did not settle to exactly one winner')
  const loser = exitedChildren[0]
  const loserExit = await (loser === first ? firstExit : secondExit)
  let loserJson = null
  try { loserJson = JSON.parse(loserExit.stdout) } catch { loserJson = null }
  if (loserExit.code !== 2 || !['start_in_progress', 'instance_conflict'].includes(loserJson?.code))
    throw new Error(`concurrent start loser did not fail closed: ${JSON.stringify(loserExit).slice(0, 500)}`)
  const raceRunning = runPa(['status', '--json', ...raceArgs], { allowExit: [0] })
  if (raceRunning.json?.status !== 'RUNNING') throw new Error('concurrent start did not leave exactly one running instance')
  const raceStop = runPa(['stop', '--json', ...raceArgs], { allowExit: [0] })
  raceStopped = true
  if (raceStop.json?.status !== 'STOPPED') throw new Error('concurrent winner did not stop cleanly')
  const winnerExit = await Promise.race([winner === first ? firstExit : secondExit, new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 15000))])
  if (winnerExit === 'timeout') throw new Error('concurrent start winner did not exit after stop')
  step('concurrent-start-single-winner', 'PASS', { loserCode: loserJson?.code, winnerExit: winnerExit.code })

  // Stable diagnostics for a busy port and a missing author executor: fail before any daemon.
  const diagRoot = join(root, 'diag')
  const diag = {
    config: join(diagRoot, 'config'), data: join(diagRoot, 'data'), cache: join(diagRoot, 'cache'),
    logs: join(diagRoot, 'logs'), workspaces: join(diagRoot, 'workspaces'),
  }
  mkdirSync(diag.config, { recursive: true, mode: 0o700 })
  copyFileSync(join(roots.config, 'release.json'), join(diag.config, 'release.json'))
  const diagArgs = ['--install', REPO_ROOT, '--config-root', diag.config, '--data-root', diag.data, '--cache-root', diag.cache, '--logs-root', diag.logs, '--workspace-root', diag.workspaces]
  const diagFirstRun = runPa(['first-run', '--json', ...diagArgs], { allowExit: [0] })
  if (diagFirstRun.json?.status !== 'OK') throw new Error('diagnostic config first-run failed')
  const busyPort = runPa(['start', '--fixture', '--json', '--port', String(primaryPort), '--api-port', String(primaryApiPort), ...diagArgs], { allowExit: [2] })
  if (busyPort.json?.code !== 'port_in_use') throw new Error(`busy port expected port_in_use, got ${busyPort.json?.code}`)
  const missingAuthor = spawnSync(process.execPath, [PA, 'start', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()), ...diagArgs], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000, env: { ...process.env, PA_CODEX_BIN: '/nonexistent/codex' },
  })
  const missingAuthorJson = (() => { try { return JSON.parse(missingAuthor.stdout) } catch { return null } })()
  if (missingAuthor.status !== 2 || missingAuthorJson?.code !== 'author_executor_unavailable')
    throw new Error(`missing author executor expected author_executor_unavailable, got ${missingAuthor.status} ${missingAuthorJson?.code}`)
  if (existsSync(join(diag.config, 'instance.json'))) throw new Error('missing-executor probe wrote an instance record')
  const fakeCodex = join(root, 'fake-codex')
  writeFileSync(fakeCodex, '#!/bin/sh\necho "codex-cli 0.164.0"\nexit 0\n', { mode: 0o755 })
  const emptyCodexHome = join(root, 'empty-codex-home')
  mkdirSync(emptyCodexHome, { recursive: true, mode: 0o700 })
  const missingAuth = spawnSync(process.execPath, [PA, 'start', '--json', '--port', String(await freePort()), '--api-port', String(await freePort()), ...diagArgs], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PA_CODEX_BIN: fakeCodex, CODEX_HOME: emptyCodexHome },
  })
  const missingAuthJson = (() => { try { return JSON.parse(missingAuth.stdout) } catch { return null } })()
  if (missingAuth.status !== 2 || missingAuthJson?.code !== 'author_auth_unavailable')
    throw new Error(`missing author auth expected author_auth_unavailable, got ${missingAuth.status} ${missingAuthJson?.code}`)
  if (/auth\.json|token|secret/i.test(missingAuthJson?.detail?.cause ?? '')) throw new Error('author auth diagnostic leaked credential-like text')
  step('start-stable-diagnostics', 'PASS', { busyPort: busyPort.json.code, missingAuthor: missingAuthorJson.code, missingAuth: missingAuthJson.code })

  const primaryStop = await stopTrial(primary, { label: 'primary' })
  step('stop-primary', 'PASS', { stopMs: primaryStop.stopMs })

  const verifyOffline = runPa(['verify-backup', '--json', '--bundle', backupPath, ...stateArgs()], { allowExit: [0] })
  if (verifyOffline.json?.status !== 'VERIFIED') throw new Error('offline verify-backup did not report VERIFIED')
  step('verify-backup-offline', 'PASS', { manifestDigest: verifyOffline.json.manifestDigest })

  // Orphan recovery: SIGKILL the launcher while the API child survives. A breadcrumb is not proof
  // the process is gone; only the verified orphan may be stopped, and an unknown PID is left alone.
  const orphanPort = await freePort()
  let orphanApiPort = await freePort()
  if (orphanApiPort === orphanPort) orphanApiPort = await freePort()
  const orphanState = join(root, 'orphan-state')
  const orphanRestore = runPa(['restore', '--json', '--bundle', backupPath, '--to', orphanState, ...stateArgs()], { allowExit: [0] })
  if (orphanRestore.json?.status !== 'RESTORED') throw new Error('orphan fixture restore failed')
  const orphanTrial = await startTrial(orphanState, { label: 'orphan', consolePort: orphanPort, apiPort: orphanApiPort })
  orphanTrial.dataRoot = orphanState
  const orphanApiPid = orphanTrial.status.instance.apiPid
  process.kill(orphanTrial.child.pid, 'SIGKILL')
  await Promise.race([orphanTrial.exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5000))])
  closeLogFds(orphanTrial)
  activeTrials.delete(orphanTrial)
  const orphanStatus = runPa(['status', '--json', ...stateArgs(orphanState)], { allowExit: [0, 1, 2] })
  if (orphanStatus.json?.status !== 'UNVERIFIED') throw new Error(`killed-launcher record expected UNVERIFIED, got ${orphanStatus.json?.status}`)
  const orphanStop = runPa(['stop', '--json', ...stateArgs(orphanState)], { allowExit: [0] })
  if (orphanStop.json?.status !== 'STOPPED_ORPHAN') throw new Error(`orphan stop expected STOPPED_ORPHAN, got ${JSON.stringify(orphanStop.json).slice(0, 400)}`)
  if (existsSync(join(roots.config, 'instance.json'))) throw new Error('orphan stop left an instance record')
  const orphanPortClosed = await new Promise((resolvePromise) => {
    fetch(`http://127.0.0.1:${orphanApiPort}/v1/health`, { signal: AbortSignal.timeout(1000) })
      .then(() => resolvePromise(false))
      .catch(() => resolvePromise(true))
  })
  if (!orphanPortClosed) throw new Error(`orphan API child ${orphanApiPid} was not stopped`)
  step('orphan-record-recovery', 'PASS', { killedLauncherPid: orphanTrial.child.pid, stoppedApiPid: orphanApiPid, status: orphanStop.json.status })

  const restore = runPa(['restore', '--json', '--bundle', backupPath, '--to', restoredData, ...stateArgs()], { allowExit: [0] })
  if (restore.json?.status !== 'RESTORED') throw new Error(`restore did not report RESTORED: ${JSON.stringify(restore.json).slice(0, 600)}`)
  if (restore.json.report.database.integrity !== 'ok' || restore.json.report.database.foreignKeyViolations !== 0)
    throw new Error('restored database facts are not clean')
  if (!['verified', 'verified_with_migration'].includes(restore.json.report.evidence?.status))
    throw new Error('restore did not verify evidence coverage')
  if (restore.json.report.evidence.digest !== backupEvidence.digest)
    throw new Error('restored evidence digest does not match the bundle manifest')
  if (JSON.stringify(restore.json.report.evidence.counts) !== JSON.stringify(backupEvidence.counts))
    throw new Error('restored evidence counts do not match the bundle manifest')
  const recoveryStatus = runPa(['recovery-status', '--json', ...stateArgs(restoredData)], { allowExit: [1] })
  if (recoveryStatus.json?.startupMode !== 'recovery_readonly') throw new Error('recovery-status did not report recovery_readonly for a restored state')
  if (recoveryStatus.json?.authorization?.status !== 'BLOCKED' || recoveryStatus.json?.authorization?.owner !== 'main')
    throw new Error('recovery-status must report the main-owned authorization interface as BLOCKED')
  if (recoveryStatus.json?.markerPresent !== true || recoveryStatus.json?.queueReplay !== 'never')
    throw new Error('recovery-status must preserve the marker and never replay the queue')
  if (typeof recoveryStatus.json?.stateName !== 'string' || recoveryStatus.json.stateName.includes('/'))
    throw new Error('recovery-status leaked an absolute state path')
  step('recovery-status-blocked-authorization', 'PASS', {
    startupMode: recoveryStatus.json.startupMode,
    authorization: recoveryStatus.json.authorization.status,
    owner: recoveryStatus.json.authorization.owner,
    pendingRebind: recoveryStatus.json.pendingRebind.length,
    queueReplay: recoveryStatus.json.queueReplay,
  })

  step('restore-new-directory', 'PASS', {
    target: restoredData,
    pendingRebind: restore.json.report.pathMappings.pendingRebind.length,
    evidence: { status: restore.json.report.evidence.status, digest: restore.json.report.evidence.digest, counts: restore.json.report.evidence.counts },
  })

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

  // Path rebinding is verified offline (no start): entity ids survive, only an explicit map
  // rewrites the bound path, and unmapped environment stores stay pending revalidation.
  const rebindSource = join(root, 'rebind-source')
  mkdirSync(rebindSource, { recursive: true, mode: 0o700 })
  const rebindStore = new ProductStore({ path: join(rebindSource, 'state.sqlite') })
  rebindStore.close()
  writeFileSync(
    join(rebindSource, 'native-projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{
        id: 'project-rebind-old',
        path: '/old/recovery-repo',
        displayName: 'old project',
        check: 'node_test',
        environment: { policy: 'offline_install', storeDir: '/old/recovery-store' },
      }],
    }),
    { mode: 0o600 },
  )
  const rebindBundle = join(backupDir, 'rebind.pab')
  const rebindBackup = runPa(['backup', '--json', '--out', rebindBundle, ...stateArgs(rebindSource)], { allowExit: [0] })
  if (rebindBackup.json?.status !== 'CREATED') throw new Error('rebind source backup failed')
  const rebindTarget = join(root, 'rebind-restored')
  const rebound = runPa(
    ['restore', '--json', '--bundle', rebindBundle, '--to', rebindTarget, '--map-path', '/old/recovery-repo=/tmp/recovery-rebound', ...stateArgs()],
    { allowExit: [0] },
  )
  if (rebound.json?.status !== 'RESTORED') throw new Error('rebind restore failed')
  const mapped = rebound.json.report.pathMappings.applied
  if (!mapped.some((entry) => entry.from === '/old/recovery-repo' && entry.to === '/tmp/recovery-rebound'))
    throw new Error('explicit path mapping was not applied on restore')
  if (rebound.json.report.pathMappings.pendingRebind.includes('/old/recovery-repo'))
    throw new Error('mapped project path still reported as pending')
  const reboundProjects = JSON.parse(readFileSync(join(rebindTarget, 'native-projects.json'), 'utf8'))
  if (reboundProjects.projects[0].id !== 'project-rebind-old' || reboundProjects.projects[0].path !== '/tmp/recovery-rebound')
    throw new Error('restore did not preserve entity id while rebinding the explicit path')
  if (reboundProjects.projects[0].environment?.storeDir !== '/old/recovery-store')
    throw new Error('unmapped environment store should stay pending, not be silently rewritten')
  step('restore-rebind-preserves-identity', 'PASS', {
    entity: reboundProjects.projects[0].id,
    applied: mapped.length,
    pendingRebind: rebound.json.report.pathMappings.pendingRebind.length,
    credentialsCarried: false,
  })

  // Recovery gate: a restored state with old business must start read-only and never consume it.
  createRecoveryFixtureState(recoverySource)
  const recoveryBefore = readBusinessSnapshot(join(recoverySource, 'state.sqlite'))
  if (recoveryBefore.queue.length < 5 || recoveryBefore.answers.length !== 1) throw new Error('recovery fixture was not built')
  const recoveryBackup = runPa(['backup', '--json', '--out', recoveryBundle, ...stateArgs(recoverySource)], { allowExit: [0] })
  if (recoveryBackup.json?.status !== 'CREATED') throw new Error('recovery fixture backup failed')
  const recoveryRestore = runPa(['restore', '--json', '--bundle', recoveryBundle, '--to', recoveryRestored, ...stateArgs()], { allowExit: [0] })
  if (recoveryRestore.json?.status !== 'RESTORED') throw new Error('recovery fixture restore failed')
  if (!recoveryRestore.json.report.requiresRevalidation.some((line) => /Native authentication|environment/.test(line)))
    throw new Error('restore report does not require native environment/authentication revalidation')
  const restoredFilesBeforeStart = readdirSync(recoveryRestored)
  if (restoredFilesBeforeStart.some((name) => name.endsWith('.key')) || restoredFilesBeforeStart.includes('coordinator.lock'))
    throw new Error('restore carried credentials or a runtime lock')
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
  // D4: consume main's read-only recovery inspect/prepare. Neither may write the database, marker,
  // project registry or old queue, and the response is never treated as authorization.
  const recoveryDb = join(recoveryRestored, 'state.sqlite')
  const recoveryMarkerPath = join(recoveryRestored, 'restore-report.json')
  const digestOfFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const dbBeforePreflight = digestOfFile(recoveryDb)
  const markerBeforePreflight = readFileSync(recoveryMarkerPath)
  const inspected = runPa(['recovery-inspect', '--json', ...stateArgs(recoveryRestored)], { allowExit: [0] })
  if (inspected.json?.startupMode !== 'recovery_readonly') throw new Error('recovery-inspect did not observe recovery_readonly')
  if (typeof inspected.json?.inspectionFingerprint !== 'string' || inspected.json.inspectionFingerprint.length !== 64)
    throw new Error('recovery-inspect did not return a bounded inspection fingerprint')
  if (inspected.json?.authorization !== 'not_granted' || inspected.json?.commitAvailable !== false)
    throw new Error('recovery-inspect must never report a grant')
  const heldTotal = (inspected.json?.heldQueue?.waiting ?? -1) + (inspected.json?.heldQueue?.parked ?? -1)
  if (heldTotal !== recoveryBefore.queue.length)
    throw new Error(`recovery-inspect held queue (${heldTotal}) does not match the preserved queue ${recoveryBefore.queue.length}`)
  if (!inspected.json.projects.some((project) => project.id === 'project-atlas'))
    throw new Error('recovery-inspect did not list the configured project')

  const preflightSource = join(root, 'recovery-preflight-project')
  mkdirSync(preflightSource, { recursive: true })
  writeFileSync(join(preflightSource, 'index.mjs'), 'export const ok = true\n')
  const git = (args) => spawnSync('git', args, { cwd: preflightSource, encoding: 'utf8' })
  git(['init', '-q'])
  git(['add', 'index.mjs'])
  git(['-c', 'user.name=Recovery Smoke', '-c', 'user.email=smoke@localhost', 'commit', '-qm', 'recovery base'])
  const planned = runPa(['recovery-prepare', '--json', '--source-project', 'project-atlas', '--path', preflightSource, ...stateArgs(recoveryRestored)], { allowExit: [1, 2] })
  if (planned.json?.status === 'BLOCKED') {
    // A git identity that cannot be observed is an honest blocker, not a silent success.
    if (planned.json.code !== 'prepare_refused') throw new Error(`unexpected prepare blocker ${planned.json.code}`)
  }
  if (planned.json?.authorization !== undefined && planned.json.authorization !== 'not_granted')
    throw new Error('recovery-prepare must not grant authorization')
  if (planned.json?.applied !== false) throw new Error('recovery-prepare must not apply anything')
  if (planned.json?.bindings?.length !== 1 || planned.json.bindings[0].sourceProjectId !== 'project-atlas')
    throw new Error('recovery-prepare did not bind the requested source project')
  if (planned.json.bindings[0].proposedProjectId === 'project-atlas')
    throw new Error('recovery-prepare silently reused the old project identity as a new binding')
  if (planned.json?.commitRequirements?.status !== 'BLOCKED' || planned.json.commitRequirements.owner !== 'main')
    throw new Error('recovery-prepare did not report the main-owned commit blocker')
  const stalePrepare = runPa(['recovery-prepare', '--json', '--source-project', 'project-atlas', '--path', join(root, 'missing-project'), ...stateArgs(recoveryRestored)], { allowExit: [2] })
  if (stalePrepare.json?.status !== 'BLOCKED' || !['prepare_refused', 'inspect_unavailable'].includes(stalePrepare.json.code))
    throw new Error(`a missing project path must be refused, got ${JSON.stringify(stalePrepare.json).slice(0, 300)}`)

  if (digestOfFile(recoveryDb) !== dbBeforePreflight) throw new Error('recovery inspect/prepare wrote the restored database')
  if (!readFileSync(recoveryMarkerPath).equals(markerBeforePreflight)) throw new Error('recovery inspect/prepare changed the restore marker')
  const afterPreflight = readBusinessSnapshot(recoveryDb)
  if (JSON.stringify(afterPreflight) !== JSON.stringify(recoveryBefore))
    throw new Error('recovery inspect/prepare consumed or replayed the old queue')
  step('recovery-inspect-prepare-readonly', 'PASS', {
    startupMode: inspected.json.startupMode,
    fingerprintPresent: true,
    heldQueue: inspected.json.heldQueue,
    authorization: planned.json.authorization,
    commitAvailable: planned.json.commitAvailable,
    proposedProjectId: planned.json.bindings[0].proposedProjectId,
    planBlockers: planned.json.blockers.map((blocker) => blocker.code ?? blocker),
    commitOwner: planned.json.commitRequirements.owner,
    databaseUnchanged: true,
    markerUnchanged: true,
    queueUnchanged: true,
  })

  const recoveryStop = await stopTrial(recoveryInstance, { label: 'recovery' })
  step('stop-recovery-readonly', 'PASS', { stopMs: recoveryStop.stopMs })
  const recoveryAfter = readBusinessSnapshot(join(recoveryRestored, 'state.sqlite'))
  if (JSON.stringify(recoveryAfter) !== JSON.stringify(recoveryBefore))
    throw new Error('recovery first start consumed or replayed queued business/answers')
  if (!existsSync(join(recoveryRestored, 'restore-report.json')))
    throw new Error('the launcher deleted the restore marker')
  const oldClaim = (() => {
    const db = new Database(join(recoveryRestored, 'state.sqlite'), { readonly: true })
    try {
      const claim = db.prepare('SELECT nonce, pid FROM writer_claim WHERE id = 1').get()
      return claim ?? null
    } finally {
      db.close()
    }
  })()
  if (oldClaim && Number(oldClaim.pid) === 999_999)
    throw new Error('the restored instance kept the historical writer claim as current authority')
  step('restore-does-not-revive-old-authority', 'PASS', {
    oldWriterPid: 999999,
    currentWriterPid: oldClaim ? Number(oldClaim.pid) : null,
    credentialsCarried: false,
    markerPreserved: true,
  })
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

  // Read-only restored instance: downloaded delivery artifacts must match the pre-backup bytes and
  // the delivered work must still be readable. No queue consumption occurs in recovery mode.
  const restoredToken = readFileSync(join(restoredData, 'api.key'), 'utf8').trim()
  const restoredDigests = []
  for (const artifact of deliveryArtifacts) {
    const response = await fetch(`${restored.apiURL}/v1/artifacts/${encodeURIComponent(artifact.id)}`, {
      headers: { connection: 'close', authorization: `Bearer ${restoredToken}` },
    })
    if (!response.ok) throw new Error(`restored artifact download failed: ${artifact.id} ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== artifact.sha256 || bytes.byteLength !== artifact.bytes.byteLength)
      throw new Error(`restored artifact bytes differ for ${artifact.id}`)
    restoredDigests.push(sha256)
  }
  const restoredWork = await fetch(`${restored.apiURL}/v1/works/${encodeURIComponent(deliveredWorkId)}`, {
    headers: { connection: 'close', authorization: `Bearer ${restoredToken}` },
  })
  if (!restoredWork.ok) throw new Error(`restored work read failed: ${restoredWork.status}`)
  const restoredWorkBody = await restoredWork.json()
  if (restoredWorkBody.phase !== 'delivered') throw new Error(`restored work phase expected delivered, got ${restoredWorkBody.phase}`)
  step('restored-delivery-bytes-roundtrip', 'PASS', {
    workId: deliveredWorkId,
    artifacts: restoredDigests.length,
    digestsMatch: true,
    phase: restoredWorkBody.phase,
  })
  const restoredStop = await stopTrial(restored, { label: 'restored' })
  step('stop-restored', 'PASS', { stopMs: restoredStop.stopMs })

  // A corrupted snapshot must fail verification before any directory is moved.
  const preRollbackFailedDirs = readdirSync(root).filter((name) => name.startsWith('restored.failed-'))
  const badRollback = runPa(['rollback', '--json', '--bundle', corrupted, '--target', restoredData, ...stateArgs()], { allowExit: [2] })
  if (badRollback.json?.code !== 'archive_invalid') throw new Error(`corrupted rollback expected archive_invalid, got ${badRollback.json?.code}`)
  if (!existsSync(join(restoredData, 'state.sqlite'))) throw new Error('failed rollback moved the current state')
  if (readdirSync(root).filter((name) => name.startsWith('restored.failed-')).length !== preRollbackFailedDirs.length)
    throw new Error('failed rollback created a moved/failed directory')
  step('rollback-verifies-snapshot-before-move', 'PASS', { code: badRollback.json.code })

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

  // Relocated staged closure: the checkout is not referenced; every loaded module must come from
  // the moved install directory (NODE_DEBUG=esm records the resolved module URLs).
  const stageLogs = join(stagedRoot, 'var/logs')
  mkdirSync(stageLogs, { recursive: true, mode: 0o700 })
  const stagedSupervisorOut = join(stageLogs, 'staged-smoke.out.log')
  const stagedSupervisorErr = join(stageLogs, 'staged-smoke.err.log')
  const wrapper = join(stagedRoot, 'bin', 'pa')
  const wrapperRun = (args, options = {}) => {
    const result = spawnSync(wrapper, args, { encoding: 'utf8', timeout: options.timeout ?? 120000, env: { ...process.env } })
    if (options.allowExit !== undefined && !options.allowExit.includes(result.status))
      throw new Error(`staged pa ${args[0]} exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    let json = null
    try { json = JSON.parse(result.stdout) } catch { json = null }
    return { exit: result.status, stdout: result.stdout, stderr: result.stderr, json }
  }
  const stagedFirstRun = wrapperRun(['first-run', '--json'], { allowExit: [0] })
  if (stagedFirstRun.json?.status !== 'OK') throw new Error('staged first-run failed')
  const stagedPort = await freePort()
  let stagedApiPort = await freePort()
  if (stagedApiPort === stagedPort) stagedApiPort = await freePort()
  const stagedOutFd = openSync(stagedSupervisorOut, 'w', 0o600)
  const stagedErrFd = openSync(stagedSupervisorErr, 'w', 0o600)
  const stagedChild = spawn(
    wrapper,
    ['start', '--fixture', '--port', String(stagedPort), '--api-port', String(stagedApiPort)],
    { cwd: stagedRoot, env: { ...process.env, NODE_DEBUG: 'esm' }, stdio: ['ignore', stagedOutFd, stagedErrFd] },
  )
  const stagedExited = new Promise((resolvePromise) => stagedChild.once('exit', (code, signal) => resolvePromise({ code, signal })))
  const stagedConsole = `http://127.0.0.1:${stagedPort}`
  const stagedApi = `http://127.0.0.1:${stagedApiPort}`
  try {
    await waitFor(`${stagedConsole}/`, (body) => typeof body === 'string' && body.includes('<div id="root">'), { child: stagedChild, label: 'staged console', timeoutMs: 45000 })
    await waitFor(`${stagedApi}/v1/health`, (body) => body?.status === 'ok', { child: stagedChild, label: 'staged health', timeoutMs: 45000 })
    const stagedStatus = await (async () => {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        if (stagedChild.exitCode !== null || stagedChild.signalCode !== null)
          throw new Error(`staged supervisor exited before recording the instance (${stagedChild.exitCode ?? stagedChild.signalCode})`)
        const status = wrapperRun(['status', '--json'], { allowExit: [0, 1, 2] })
        if (status.json?.status === 'RUNNING') return status.json
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
      }
      throw new Error('staged instance did not reach RUNNING')
    })()
    const moduleText = readFileSync(stagedSupervisorErr, 'utf8')
    const modulePaths = [...new Set([...moduleText.matchAll(/file:\/\/([^'",\s)]+)/g)].map((match) => match[1]))]
    const stagedReal = realpathSync(stagedRoot)
    const outside = modulePaths.filter((path) => !path.startsWith(`${stagedReal}/app/`))
    const checkoutReferences = modulePaths.filter((path) => path.startsWith(realpathSync(REPO_ROOT)))
    if (modulePaths.length < 100 || outside.length > 0 || checkoutReferences.length > 0)
      throw new Error(`staged closure module proof failed: total ${modulePaths.length}, outside ${outside.slice(0, 5)}, checkout ${checkoutReferences.slice(0, 5)}`)
    step('stage-closure-start', 'PASS', {
      url: stagedConsole,
      modules: modulePaths.length,
      outsideClosure: outside.length,
      checkoutReferences: checkoutReferences.length,
    })
    // Doctor inside the relocated closure: release/ABI/console/dependency gates must pass, and the
    // second-executor interface is explicit about being unavailable by default.
    const stagedDoctor = wrapperRun(['doctor', '--json'], { allowExit: [0, 1] })
    const stagedDoctorCheck = (id) => stagedDoctor.json?.checks?.find((check) => check.id === id)
    for (const id of ['release_manifest', 'runtime_abi', 'console_mode', 'runtime_dependencies']) {
      if (stagedDoctorCheck(id)?.status !== 'PASS') throw new Error(`staged doctor gate ${id} did not pass: ${JSON.stringify(stagedDoctorCheck(id))}`)
    }
    if (stagedDoctorCheck('review_executor')?.status !== 'WARN' || stagedDoctorCheck('review_executor')?.detail?.reason !== 'no_executor_interface')
      throw new Error('default doctor must report the review executor interface as unavailable, not configured')
    const authorOnlyFixture = join(root, 'executors-author-only.json')
    writeFileSync(authorOnlyFixture, JSON.stringify({ protocol: 'personal-executors-fixture/1', requiredReview: true, executors: [{ role: 'author', profileId: 'codex', version: 'codex-cli 0.164.0', admitted: true }] }))
    const blockedReview = wrapperRun(['doctor', '--json', '--executors-fixture', authorOnlyFixture], { allowExit: [2] })
    if (blockedReview.json?.status !== 'BLOCKED') throw new Error('required review without a reviewer executor must be BLOCKED')
    if (blockedReview.json?.checks?.find((check) => check.id === 'review_executor')?.detail?.reason !== 'required_reviewer_missing')
      throw new Error('required review block did not name the missing reviewer executor')
    const reviewerFixture = join(root, 'executors-with-reviewer.json')
    writeFileSync(reviewerFixture, JSON.stringify({ protocol: 'personal-executors-fixture/1', requiredReview: true, executors: [
      { role: 'author', profileId: 'codex', version: 'codex-cli 0.164.0', admitted: true },
      { role: 'reviewer', profileId: 'review-sealed', version: 'fixture-0', capabilities: ['sealed_copy'], admitted: true },
    ] }))
    const reviewerDoctor = wrapperRun(['doctor', '--json', '--executors-fixture', reviewerFixture], { allowExit: [0, 1] })
    if (reviewerDoctor.json?.checks?.find((check) => check.id === 'review_executor')?.status !== 'PASS')
      throw new Error('reviewer fixture did not produce a PASS review_executor check')
    const authorOnlyOptional = join(root, 'executors-author-optional.json')
    writeFileSync(authorOnlyOptional, JSON.stringify({ protocol: 'personal-executors-fixture/1', requiredReview: false, executors: [{ role: 'author', profileId: 'codex', admitted: true }] }))
    const optionalDoctor = wrapperRun(['doctor', '--json', '--executors-fixture', authorOnlyOptional], { allowExit: [0, 1] })
    if (optionalDoctor.json?.status === 'BLOCKED') throw new Error('a missing optional reviewer must not block the author path')
    if (optionalDoctor.json?.checks?.find((check) => check.id === 'review_executor')?.status !== 'WARN')
      throw new Error('optional missing reviewer must be WARN, not silently enabled')
    step('doctor-executor-capabilities', 'PASS', {
      defaultReview: stagedDoctorCheck('review_executor')?.detail?.reason,
      requiredReviewBlocked: blockedReview.json.status,
      authorPathWithoutReviewer: optionalDoctor.json.status,
      reviewerCheck: 'PASS',
    })
    const stagedStopStarted = Date.now()
    const stagedStop = wrapperRun(['stop', '--json'], { allowExit: [0] })
    if (stagedStop.json?.status !== 'STOPPED') throw new Error('staged stop did not report STOPPED')
    const stagedExit = await Promise.race([stagedExited, new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 20000))])
    if (stagedExit === 'timeout' || stagedExit.code !== 0) throw new Error('staged supervisor did not exit cleanly')
    step('stage-closure-stop', 'PASS', { stopMs: Date.now() - stagedStopStarted, status: stagedStatus.status })
  } finally {
    for (const fd of [stagedOutFd, stagedErrFd]) {
      try { closeSync(fd) } catch { /* already closed */ }
    }
  }

  // A same-length mutation of an executed coordinator file must fail the startup content-digest
  // gate; the launcher must not execute or serve the drifted bytes.
  const stagedDemo = join(stagedRoot, 'app/apps/coordinator/product/demo.ts')
  const originalDemo = readFileSync(stagedDemo)
  const tamperedDemo = Buffer.from(originalDemo)
  tamperedDemo[0] = tamperedDemo[0] === 0x2f ? 0x21 : 0x2f
  writeFileSync(stagedDemo, tamperedDemo)
  const tamperPort = await freePort()
  let tamperApiPort = await freePort()
  if (tamperApiPort === tamperPort) tamperApiPort = await freePort()
  const tamperedStart = wrapperRun(
    ['start', '--fixture', '--json', '--port', String(tamperPort), '--api-port', String(tamperApiPort)],
    { allowExit: [2] },
  )
  if (tamperedStart.json?.code !== 'release_artifact_missing')
    throw new Error(`same-length staged drift was not refused: ${JSON.stringify(tamperedStart.json).slice(0, 400)}`)
  writeFileSync(stagedDemo, originalDemo)
  step('startup-verifies-executed-bytes', 'PASS', { code: tamperedStart.json.code, sameLength: tamperedDemo.length === originalDemo.length })

  // `--skip-console` may only reuse a stamped HTTP build whose digest still matches the files.
  const skipConfig = join(root, 'skip-console-config')
  const skipBuild = (configRoot) =>
    spawnSync(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', configRoot, '--skip-packages', '--skip-console', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120000,
    })
  const reused = skipBuild(skipConfig)
  if (reused.status !== 0) throw new Error(`--skip-console rejected a fresh HTTP build (exit ${reused.status})\n${reused.stderr}`)
  const consoleDir = join(REPO_ROOT, 'apps/console/dist')
  const consoleAsset = readdirSync(consoleDir).find((name) => name.endsWith('.html')) ?? 'index.html'
  const consoleAssetPath = join(consoleDir, consoleAsset)
  const originalConsole = readFileSync(consoleAssetPath)
  const tamperedConsole = Buffer.from(originalConsole)
  tamperedConsole[tamperedConsole.length - 1] = tamperedConsole[tamperedConsole.length - 1] ^ 1
  writeFileSync(consoleAssetPath, tamperedConsole)
  const rejected = skipBuild(skipConfig)
  writeFileSync(consoleAssetPath, originalConsole)
  if (rejected.status !== 2 || !/console files do not match/.test(String(rejected.stderr)))
    throw new Error(`--skip-console did not reject a drifted console bundle (exit ${rejected.status})`)
  step('skip-console-refuses-tampered-http-bundle', 'PASS', { exit: rejected.status })

  const doctorAfter = runPa(['doctor', '--json', ...stateArgs()], { allowExit: [0, 1] })
  if (doctorAfter.json.checks.some((check) => check.id === 'instance' && check.status === 'FAIL'))
    throw new Error('doctor still reports a broken instance after stop')
  step('doctor-after-stop', 'PASS', { status: doctorAfter.json.status })

  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = { message: String(error.message ?? error) }
} finally {
  if (!raceStopped) {
    for (const child of raceChildren) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      try { runPa(['stop', '--json', ...(raceArgsCleanup ?? [])], { allowExit: [0, 1], timeout: 15000 }) } catch { /* best effort */ }
    }
  }
  for (const child of raceChildren) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill('SIGTERM')
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  for (const child of raceChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
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
  if (!values['keep-root']) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (error) {
      evidence.cleanup = { status: 'INCOMPLETE', code: error.code ?? null, path: root }
    }
  }
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
