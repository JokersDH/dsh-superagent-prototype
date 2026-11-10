#!/usr/bin/env node
/**
 * Repeatable zero-model local-trial smoke. It builds the distribution, creates private roots,
 * starts a fixture-mode instance (no native/model execution), verifies the static console and the
 * proxied product API, checks reuse, stops the instance and proves the owned process is really gone.
 * Later stages extend the same script with backup/verify/restore/rollback.
 *
 * No model request is made and no user project/account is touched.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

async function waitForRunning(args, { child, timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`the start supervisor exited before recording the instance (${child.exitCode ?? child.signalCode})`)
    const status = runPa(['status', '--json', ...args], { allowExit: [0, 1, 2] })
    if (status.json?.status === 'RUNNING') return status.json
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('the instance did not reach a verified RUNNING state')
}
const results = []
function step(id, status, detail) {
  results.push({ id, status, ...(detail === undefined ? {} : { detail }) })
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

function rootsArgs(roots) {
  return [
    '--install', REPO_ROOT,
    '--config-root', roots.config,
    '--data-root', roots.data,
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
  if (options.api !== false) {
    try { json = JSON.parse(result.stdout) } catch { json = null }
  }
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

async function waitFor(url, predicate, { timeoutMs = 30000, child, label } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'not ready'
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`${label ?? url} failed: the start process exited early (${child.exitCode ?? child.signalCode})`)
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
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`${label ?? url} failed: the start process exited early (${child.exitCode ?? child.signalCode})`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`${label ?? url} did not become ready: ${lastError}`)
}

const root = values['keep-root'] ? (mkdirSync(values['keep-root'], { recursive: true, mode: 0o700 }), values['keep-root']) : mkdtempSync(join(tmpdir(), 'pa-trial-smoke-'))
const roots = {
  config: join(root, 'config'),
  data: join(root, 'data'),
  cache: join(root, 'cache'),
  logs: join(root, 'logs'),
  workspaces: join(root, 'workspaces'),
}
const args = rootsArgs(roots)
let startChild = null
let consoleURL = null
let apiURL = null
let backupPath = null
let startOutLog = null
let startErrLog = null
let startOutFd = null
let startErrFd = null

try {
  if (!values['skip-build']) {
    const build = spawnSync(process.execPath, [BUILD, '--install-root', REPO_ROOT, '--config-root', roots.config, '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 })
    if (build.status !== 0) throw new Error(`build failed (exit ${build.status})\n${build.stderr}`)
    const summary = JSON.parse(build.stdout)
    step('build', 'PASS', { buildId: summary.buildId, artifacts: summary.artifacts })
  } else {
    step('build', 'SKIPPED', { note: '--skip-build reuses existing dist/ and a caller-provided config root' })
  }

  const firstRun = runPa(['first-run', '--json', ...args], { allowExit: [0] })
  if (firstRun.json?.status !== 'OK') throw new Error('first-run did not report OK')
  step('first-run', 'PASS', { created: firstRun.json.created })

  const doctor = runPa(['doctor', '--json', ...args], { allowExit: [0, 1] })
  const doctorFailures = doctor.json.checks.filter((check) => check.status === 'FAIL')
  if (doctorFailures.length) throw new Error(`doctor reported FAIL: ${JSON.stringify(doctorFailures)}`)
  step('doctor-before-start', 'PASS', { status: doctor.json.status })

  const consolePort = await freePort()
  let apiPort = await freePort()
  if (apiPort === consolePort) apiPort = await freePort()
  consoleURL = `http://127.0.0.1:${consolePort}`
  apiURL = `http://127.0.0.1:${apiPort}`
  const startedAt = Date.now()
  // Redirect the supervisor to files: a parent blocked in spawnSync must not apply pipe
  // backpressure to the long-lived launcher, and the full log is durable evidence.
  startOutLog = join(roots.logs, 'smoke-supervisor.out.log')
  startErrLog = join(roots.logs, 'smoke-supervisor.err.log')
  startOutFd = openSync(startOutLog, 'w', 0o600)
  startErrFd = openSync(startErrLog, 'w', 0o600)
  startChild = spawn(
    process.execPath,
    [PA, 'start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), ...args],
    { cwd: REPO_ROOT, env: { ...process.env }, stdio: ['ignore', startOutFd, startErrFd] },
  )
  const startExited = new Promise((resolvePromise) => startChild.once('exit', (code, signal) => resolvePromise({ code, signal })))

  await waitFor(`${consoleURL}/`, (body) => typeof body === 'string' && body.includes('<div id="root">'), { child: startChild, label: 'console page' })
  step('static-console', 'PASS', { url: consoleURL, readyMs: Date.now() - startedAt })

  const marker = await waitFor(`${consoleURL}/__pa/instance`, (body) => body?.product === 'dsh-superagent', { label: 'instance marker' })
  step('instance-marker', 'PASS', { buildId: marker.buildId })

  const health = await waitFor(`${apiURL}/v1/health`, (body) => body?.status === 'ok', { label: 'api health' })
  step('api-health-direct', 'PASS', health)

  const proxiedHealth = await waitFor(`${consoleURL}/v1/health`, (body) => body?.status === 'ok', { label: 'proxied health' })
  step('api-health-via-proxy', 'PASS', proxiedHealth)

  const configuration = await waitFor(`${consoleURL}/v1/configuration`, (body) => Array.isArray(body?.projects), { label: 'configuration' })
  step('product-configuration', 'PASS', { revision: configuration.revision, projects: configuration.projects.length })

  const html = await fetch(consoleURL, { headers: { connection: 'close' } }).then((response) => response.text())
  const assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
  if (!assetPath) throw new Error('static console does not reference a built JS asset')
  const asset = await fetch(`${consoleURL}${assetPath}`, { headers: { connection: 'close' } })
  const assetBytes = (await asset.arrayBuffer()).byteLength
  if (!asset.ok || assetBytes < 1000) throw new Error(`console asset is not served correctly (${asset.status}, ${assetBytes} bytes)`)
  step('console-asset', 'PASS', { path: assetPath, bytes: assetBytes })

  const status = await waitForRunning(args, { child: startChild })
  step('status-running', 'PASS', { pid: status.instance.pid, checks: status.checks.length })

  const reuse = runPa(['start', '--fixture', '--port', String(consolePort), '--api-port', String(apiPort), '--json', ...args], { allowExit: [0] })
  if (reuse.json?.status !== 'REUSED') throw new Error(`second start expected REUSED, got ${reuse.json?.status}`)
  step('reuse-verified-instance', 'PASS', { pid: reuse.json.instance.pid })

  // Complete backup while the instance is live: the SQLite online backup must yield a consistent
  // snapshot (WAL active) and the manifest must list the referenced artifacts.
  mkdirSync(join(root, 'backup'), { recursive: true, mode: 0o700 })
  backupPath = join(root, 'backup', 'state.pab')
  const backup = runPa(['backup', '--json', '--out', backupPath, ...args], { allowExit: [0] })
  if (backup.json?.status !== 'CREATED') throw new Error(`backup did not report CREATED: ${JSON.stringify(backup.json).slice(0, 500)}`)
  if (backup.json.database.integrity !== 'ok' || backup.json.database.foreignKeyViolations !== 0)
    throw new Error(`backup database facts are not clean: ${JSON.stringify(backup.json.database)}`)
  step('backup-live', 'PASS', { bundle: backupPath, archiveSha256: backup.json.archiveSha256, counts: backup.json.counts })

  const verifyLive = runPa(['verify-backup', '--json', '--bundle', backupPath, ...args], { allowExit: [0] })
  if (verifyLive.json?.status !== 'VERIFIED') throw new Error('verify-backup did not report VERIFIED')
  if (verifyLive.json.database.integrity !== 'ok' || verifyLive.json.database.foreignKeyViolations !== 0)
    throw new Error('verified bundle database facts are not clean')
  step('verify-backup-live', 'PASS', { manifestDigest: verifyLive.json.manifestDigest, entries: verifyLive.json.counts.entries })

  const stopStarted = Date.now()
  const stop = runPa(['stop', '--json', ...args], { allowExit: [0] })
  if (stop.json?.status !== 'STOPPED') throw new Error(`stop expected STOPPED, got ${JSON.stringify(stop.json)}`)
  const stopMs = Date.now() - stopStarted
  if (stopMs > 12000) throw new Error(`stop took ${stopMs}ms; resources may not have been released cleanly`)
  step('stop', 'PASS', { stopMs })

  const startExit = await Promise.race([startExited, new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 15000))])
  if (startExit === 'timeout') throw new Error('the start supervisor did not exit after stop')
  if (startExit.code !== 0) throw new Error(`the start supervisor exited ${startExit.code ?? startExit.signal} after stop`)
  step('supervisor-clean-exit', 'PASS', startExit)

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
  const portClosed = await new Promise((resolvePromise) => {
    fetch(`${consoleURL}/`, { signal: AbortSignal.timeout(1000) }).then(() => resolvePromise(false)).catch(() => resolvePromise(true))
  })
  if (!portClosed) throw new Error('console port still accepts connections after stop')
  if (existsSync(join(roots.config, 'instance.json'))) throw new Error('instance record still exists after a verified stop')
  step('resources-released', 'PASS')

  const verifyOffline = runPa(['verify-backup', '--json', '--bundle', backupPath, ...args], { allowExit: [0] })
  if (verifyOffline.json?.status !== 'VERIFIED') throw new Error('offline verify-backup did not report VERIFIED')
  step('verify-backup-offline', 'PASS', { manifestDigest: verifyOffline.json.manifestDigest })

  const doctorAfter = runPa(['doctor', '--json', ...args], { allowExit: [0, 1] })
  if (doctorAfter.json.checks.some((check) => check.id === 'instance' && check.status === 'FAIL'))
    throw new Error('doctor still reports a broken instance after stop')
  step('doctor-after-stop', 'PASS', { status: doctorAfter.json.status })

  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = {
    message: String(error.message ?? error),
    supervisorOut: tailFile(startOutLog),
    supervisorErr: tailFile(startErrLog),
  }
} finally {
  evidence.steps = results
  evidence.durationMs = Date.now() - Date.parse(evidence.startedAt)
  evidence.finishedAt = new Date().toISOString()
  evidence.limitations.push(
    'Fixture mode only: no vendor/model request, no native agent, no user project.',
    'Only darwin/arm64 + Node 24.21.x is a measured candidate; other platforms remain NOT_TESTED.',
    'The trial instance ran on isolated temporary roots/ports; user services were not touched.',
  )
  if (startChild && startChild.exitCode === null && startChild.signalCode === null) {
    runPa(['stop', '--json', ...args], { allowExit: [0, 1], timeout: 20000 })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500))
    if (startChild.exitCode === null && startChild.signalCode === null) startChild.kill('SIGTERM')
  }
  for (const fd of [startOutFd, startErrFd]) {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* already closed */ }
    }
  }
  if (values['keep-root']) evidence.root = root
  mkdirSync(REPORTS, { recursive: true })
  evidence.outputs = { consoleURL, apiURL, ...(backupPath ? { backupPath } : {}) }
  writeFileSync(join(REPORTS, 'zero-model-smoke.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  if (!values['keep-root']) rmSync(root, { recursive: true, force: true })
}

function tailFile(path) {
  if (!path) return []
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-40)
  } catch {
    return []
  }
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
