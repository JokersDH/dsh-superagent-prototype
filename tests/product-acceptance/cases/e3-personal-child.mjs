#!/usr/bin/env node
/**
 * Bounded child probe for D's ordinary personal install: cold first-run, doctor, personal-mode
 * start, static console, bearer refusal, config-root adoption of an older release, and stop.
 *
 * Inputs: PA_E_PERSONAL_SPEC (target tuple), PA_E_PERSONAL_BASE (baseline tuple), PA_E_PERSONAL_PORTS
 * (four free ports). It prints one JSON line and never chats, so no model/native send can occur.
 */
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spec = JSON.parse(process.env.PA_E_PERSONAL_SPEC ?? '{}')
const baseSpec = JSON.parse(process.env.PA_E_PERSONAL_BASE ?? '{}')
const ports = JSON.parse(process.env.PA_E_PERSONAL_PORTS ?? '[]')
const result = { protocol: 'e3-personal-child/1', steps: [], ok: false, modelSends: 0 }
const step = (id, status, detail) => result.steps.push({ id, status, detail })
const w = realpathSync(mkdtempSync(join(tmpdir(), 'pa-e-personal-')))
const target = join(w, 'target')
const baseline = join(w, 'baseline')
const launcher = join(target, 'app/apps/launcher/bin/pa.mjs')
const roots = (name) => ({
  config: join(w, name, 'cfg'), data: join(w, name, 'data'), cache: join(w, name, 'cache'),
  logs: join(w, name, 'logs'), workspace: join(w, name, 'ws'),
})
const rootArgs = (r) => ['--config-root', r.config, '--data-root', r.data, '--cache-root', r.cache, '--logs-root', r.logs, '--workspace-root', r.workspace]
const first = roots('first')
const migrated = roots('migrated')
const started = []
const parse = (text) => {
  const trimmed = String(text ?? '').trim()
  try { return JSON.parse(trimmed) } catch { /* fall through */ }
  for (const line of trimmed.split('\n').filter(Boolean).reverse()) {
    try { return JSON.parse(line) } catch { /* keep */ }
  }
  return undefined
}
const health = async (url, attempts = 30) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return await response.json()
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return undefined
}
const startPersonal = (install, r, port, apiPort) => {
  const child = spawn(process.execPath, [launcher, 'start', '--json', '--port', String(port), '--api-port', String(apiPort), ...rootArgs(r)], { cwd: w, stdio: ['ignore', 'pipe', 'pipe'] })
  started.push(child)
  let buffer = ''
  child.stdout.on('data', (chunk) => { buffer += chunk })
  child.stderr.on('data', () => {})
  return new Promise((resolve) => {
    const deadline = Date.now() + 45_000
    const poll = () => {
      const value = parse(buffer)
      if (value) return resolve({ child, value })
      if (Date.now() > deadline) return resolve({ child, value: undefined })
      setTimeout(poll, 150)
    }
    poll()
  })
}
const stop = (r) => {
  const stopped = spawnSync(process.execPath, [launcher, 'stop', '--json', ...rootArgs(r)], { cwd: w, encoding: 'utf8', timeout: 45_000 })
  return { exit: stopped.status, value: parse(stopped.stdout), stderr: stopped.stderr.slice(-300) }
}
const portBusy = (port) =>
  new Promise((resolve) => {
    const socket = new Socket()
    socket.setTimeout(400)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.connect(port, '127.0.0.1')
  })
const portsClosed = async (values) => {
  for (let index = 0; index < 20; index += 1) {
    const states = await Promise.all(values.map(portBusy))
    if (states.every((busy) => busy === false)) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}
const releaseOf = (r) => {
  try { return JSON.parse(readFileSync(join(r.config, 'release.json'), 'utf8')) } catch { return undefined }
}
const schemaOf = (r) => {
  try {
    const db = new DatabaseSync(join(r.data, 'state.sqlite'), { readOnly: true })
    try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value) } finally { db.close() }
  } catch { return null }
}
const instanceOf = (r) => {
  try { return JSON.parse(readFileSync(join(r.config, 'instance.json'), 'utf8')) } catch { return undefined }
}

try {
  for (const dir of [target, baseline]) mkdirSync(dir, { recursive: true })
  spawnSync('tar', ['-xzf', spec.tarPath, '-C', target, '--strip-components=1'])
  spawnSync('tar', ['-xzf', baseSpec.tarPath, '-C', baseline, '--strip-components=1'])
  for (const r of [first, migrated]) for (const dir of Object.values(r)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  step('extract', existsSync(launcher) ? 'PASS' : 'FAIL', launcher)

  const firstRun = spawnSync(process.execPath, [launcher, 'first-run', '--json', '--install', join(target, 'app'), ...rootArgs(first)], { cwd: w, encoding: 'utf8', timeout: 60_000 })
  const firstJson = parse(firstRun.stdout)
  step('first_run', firstJson?.status === 'OK' && firstJson?.release?.buildId === spec.buildId ? 'PASS' : 'FAIL', firstJson?.release?.buildId ?? firstRun.stderr.slice(-200))
  result.firstRun = firstJson ? { status: firstJson.status, build: firstJson.release?.buildId, schema: firstJson.release?.productSchema, created: firstJson.created } : null

  const doctor = spawnSync(process.execPath, [launcher, 'doctor', '--json', ...rootArgs(first)], { cwd: w, encoding: 'utf8', timeout: 60_000 })
  const doctorJson = parse(doctor.stdout)
  const checks = doctorJson?.checks ?? []
  const failed = checks.filter((item) => item.status === 'FAIL' || item.status === 'BLOCKED')
  const technical = checks.filter((item) => ['node_version', 'platform', 'sqlite_binding', 'release_binding', 'release_manifest', 'console_assets', 'console_mode', 'runtime_dependencies', 'source_identity', 'runtime_abi', 'support_matrix', 'roots'].includes(item.id))
  step('doctor', doctorJson !== undefined && failed.length === 0 && technical.every((item) => item.status === 'PASS') && technical.length >= 10 ? 'PASS' : 'FAIL', JSON.stringify({ status: doctorJson?.status, failed: failed.map((item) => item.id) }))
  result.doctor = { status: doctorJson?.status, exit: doctor.status, warns: checks.filter((item) => item.status !== 'PASS').map((item) => item.id), technical: technical.length }

  const [port, apiPort, migratedPort, migratedApiPort] = ports
  const start = await startPersonal(target, first, port, apiPort)
  step('start', start.value?.status === 'RUNNING' && start.value?.instance?.mode === 'personal' && start.value?.instance?.buildId === spec.buildId ? 'PASS' : 'FAIL', JSON.stringify({ status: start.value?.status, mode: start.value?.instance?.mode, build: start.value?.instance?.buildId }))
  result.start = start.value?.status ?? null
  const apiURL = `http://127.0.0.1:${apiPort}`
  const consoleURL = `http://127.0.0.1:${port}`
  const healthJson = await health(apiURL)
  step('health', healthJson?.status === 'ok' ? 'PASS' : 'FAIL', String(healthJson?.status))
  result.health = healthJson?.status ?? null
  let consoleStatus = 0
  let consoleHasAsset = false
  try {
    const page = await fetch(`${consoleURL}/`, { signal: AbortSignal.timeout(3_000) })
    consoleStatus = page.status
    const text = await page.text()
    const asset = /(?:src|href)="([^"]+\.(?:js|css))"/u.exec(text)?.[1]
    consoleHasAsset = Boolean(asset)
    if (asset) {
      const bundle = await fetch(new URL(asset, consoleURL), { signal: AbortSignal.timeout(3_000) })
      consoleHasAsset = bundle.ok && (await bundle.text()).length > 100
    }
    writeFileSync(join(w, 'console.html'), text)
  } catch { /* recorded below */ }
  step('console_assets', consoleStatus === 200 && consoleHasAsset ? 'PASS' : 'FAIL', JSON.stringify({ status: consoleStatus, asset: consoleHasAsset }))
  let unauthStatus = 0
  try {
    const refused = await fetch(`${apiURL}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commandId: 'personal-probe', conversationId: 'c', kind: 'chat', text: 'x' }), signal: AbortSignal.timeout(3_000) })
    unauthStatus = refused.status
  } catch { /* recorded */ }
  step('auth_required', unauthStatus === 401 || unauthStatus === 403 ? 'PASS' : 'FAIL', String(unauthStatus))
  const release = releaseOf(first)
  const instance = instanceOf(first)
  const dbSchema = schemaOf(first)
  step('instance_mode', instance?.mode === 'personal' && instance?.buildId === spec.buildId ? 'PASS' : 'FAIL', JSON.stringify({ mode: instance?.mode, build: instance?.buildId }))
  step('schema', dbSchema === spec.productSchema && Number(release?.producer?.productSchema) === spec.productSchema ? 'PASS' : 'FAIL', JSON.stringify({ db: dbSchema, release: release?.producer?.productSchema }))
  result.schema = dbSchema
  result.console = { status: consoleStatus, asset: consoleHasAsset }
  result.auth = unauthStatus
  result.ports = { console: port, api: apiPort }

  const stopFirst = stop(first)
  step('stop', stopFirst.exit === 0 && stopFirst.value?.status === 'STOPPED' ? 'PASS' : 'FAIL', JSON.stringify({ exit: stopFirst.exit, status: stopFirst.value?.status, code: stopFirst.value?.code }))
  const closed = await portsClosed([port, apiPort])
  step('stopped', closed ? 'PASS' : 'FAIL', JSON.stringify({ closed }))
  result.stop = { exit: stopFirst.exit, status: stopFirst.value?.status, code: stopFirst.value?.code ?? null, closed }

  // A config root bound to a different install must be a deliberate conflict, not a silent adopt.
  const oldRelease = join(baseline, 'var/config/release.json')
  if (existsSync(oldRelease)) cpSync(oldRelease, join(migrated.config, 'release.json'))
  const before = releaseOf(migrated)
  const conflict = spawnSync(process.execPath, [launcher, 'first-run', '--json', '--install', join(target, 'app'), ...rootArgs(migrated)], { cwd: w, encoding: 'utf8', timeout: 60_000 })
  const conflictJson = parse(conflict.stdout)
  const after = releaseOf(migrated)
  const conflictCode = conflictJson?.code ?? conflictJson?.error?.code ?? (String(conflict.stderr).match(/release_source_conflict/u) ? 'release_source_conflict' : null)
  step('config_conflict', before?.buildId === baseSpec.buildId && after?.buildId === baseSpec.buildId && conflict.status !== 0 && conflictCode === 'release_source_conflict' ? 'PASS' : 'FAIL', JSON.stringify({ exit: conflict.status, code: conflictCode, before: before?.buildId, after: after?.buildId }))
  result.configConflict = { exit: conflict.status, code: conflictCode, before: before?.buildId ?? null, after: after?.buildId ?? null }

  const blockedStart = await startPersonal(target, migrated, migratedPort, migratedApiPort)
  step('start_conflict_blocked', blockedStart.value?.status === 'BLOCKED' ? 'PASS' : 'FAIL', JSON.stringify({ status: blockedStart.value?.status, code: blockedStart.value?.code }))
  result.migrated = { start: blockedStart.value?.status ?? null, code: blockedStart.value?.code ?? null }
  for (const child of started.slice(-1)) {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
  const stopMigrated = stop(migrated)
  step('stop_migrated', stopMigrated.exit === 0 || stopMigrated.exit === 2 ? 'PASS' : 'FAIL', JSON.stringify({ exit: stopMigrated.exit, status: stopMigrated.value?.status }))
  await portsClosed([migratedPort, migratedApiPort])

  result.ok = result.steps.every((item) => item.status === 'PASS')
} catch (error) {
  step('exception', 'FAIL', error.message)
} finally {
  for (const r of [first, migrated]) {
    try { spawnSync(process.execPath, [launcher, 'stop', '--json', ...rootArgs(r)], { cwd: w, encoding: 'utf8', timeout: 20_000 }) } catch { /* best effort */ }
  }
  for (const child of started) {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
}
console.log(JSON.stringify(result))
