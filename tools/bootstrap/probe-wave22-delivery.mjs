import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import * as net from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'

if (process.argv.length !== 3 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node --experimental-test-module-mocks tools/bootstrap/probe-wave22-delivery.mjs <D-root>')
}
const candidateRoot = resolve(process.argv[2])
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const source = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const moduleURL = name => pathToFileURL(join(candidateRoot, 'apps/launcher/lib', `${name}.mjs`)).href
const reviewURL = pathToFileURL(join(candidateRoot, 'apps/coordinator/product/restored-review.ts')).href
const root = mkdtempSync('/tmp/pa-wave22-selection-')
const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(root, key)]))
for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
for (const key of Object.keys(roots)) roots[key] = realpathSync(roots[key])
const first = join(root, 'first.json')
const second = join(root, 'second.json')
writeFileSync(first, '{}', { mode: 0o600 })
writeFileSync(second, '{}', { mode: 0o600 })
const [config, instance, lock, recovery, releaseModule, diagnostics, daemon, http, review] = await Promise.all([
  ...['config', 'instance', 'start-lock', 'recovery', 'release', 'diagnostics', 'daemon', 'http-probe'].map(name => import(moduleURL(name))),
  import(reviewURL),
])
const noOperation = () => { throw new Error('No real process, signal or network operation is allowed') }
const release = { buildId: 'independent-existing', producer: { node: process.versions.node, productSchema: 18 }, build: { consoleRoot: 'console' } }
const record = { install: roots.install, state: roots.data, configRoot: roots.config, mode: 'personal', access: 'local-development',
  buildId: release.buildId, startupMode: 'recovery_readonly', consoleURL: 'http://127.0.0.1:45001', apiURL: 'http://127.0.0.1:45002',
  pid: 912345, apiPid: 912346, consolePid: 912345, processStart: 'parent-start', apiProcessStart: 'api-start', apiArgv: ['node', 'demo.ts'] }
let liveDigest = null
let healthReads = 0
let identityReads = []
const firstDigest = 'a'.repeat(64)
const secondDigest = 'b'.repeat(64)
const originalKill = process.kill
const cases = []
try {
  mock.module('node:child_process', { namedExports: { ...childProcess,
    spawn: noOperation, spawnSync: noOperation, execFile: noOperation, execFileSync: noOperation, exec: noOperation, execSync: noOperation } })
  mock.module('node:net', { namedExports: { ...net, createServer: noOperation } })
  mock.module(moduleURL('config'), { namedExports: { ...config, readLauncherConfig: () => ({}) } })
  mock.module(moduleURL('instance'), { namedExports: { ...instance, readInstanceRecord: () => record,
    verifyInstance: async () => ({ ok: true, checks: [], failures: [] }), captureProcessFacts: noOperation,
    processStart: noOperation, processUid: noOperation, processAlive: noOperation, processCommand: noOperation,
    listenersOnPort: noOperation, writeInstanceRecord: noOperation, removeInstanceRecord: noOperation, stopProcess: noOperation } })
  mock.module(moduleURL('start-lock'), { namedExports: { ...lock, acquireStartLock: async () => ({ release() {} }) } })
  mock.module(moduleURL('recovery'), { namedExports: { ...recovery, expectedStartupMode: () => 'recovery_readonly', recoverySummary: () => ({ markerPresent: true }) } })
  mock.module(moduleURL('release'), { namedExports: { ...releaseModule, readRelease: () => ({ release }),
    verifyReleaseArtifacts: () => ({ ok: true }), consoleIndexPath: () => root, statFile: () => ({ isFile: () => true }),
    verifyConsoleBuild: () => ({ ok: true }), verifyRuntimeDependencies: () => ({ ok: true }) } })
  mock.module(moduleURL('diagnostics'), { namedExports: { ...diagnostics, probeRuntime: () => ({ ok: true }), probeAuthorExecutor: noOperation } })
  mock.module(moduleURL('daemon'), { namedExports: { ...daemon, spawnDaemon: noOperation } })
  mock.module(moduleURL('http-probe'), { namedExports: { ...http, httpGet: async () => {
    healthReads++
    return { status: 200, body: { status: 'ok', mode: 'personal', startupMode: 'recovery_readonly', ...(liveDigest ? { restoredReviewDigest: liveDigest } : {}) } }
  } } })
  mock.module(reviewURL, { namedExports: { ...review, restoredReviewIdentity: file => {
    identityReads.push(file)
    assert([first, second].includes(file))
    return file === first ? firstDigest : secondDigest
  } } })
  process.kill = noOperation
  const { startInstance } = await import(moduleURL('start'))
  const base = { port: '45001', 'api-port': '45002', 'discussion-only': true }
  const run = async values => {
    healthReads = 0
    identityReads = []
    const value = await startInstance({ installRoot: roots.install, roots, values, log() {} })
    return { ok: value.ok, reused: value.reused, code: value.code, healthReads, identityReads: [...identityReads] }
  }
  let value = await run(base)
  const unboundPositive = value.ok === true && value.reused === true
  cases.push({ id: 'UNBOUND_MATCHING_POSITIVE', ...value, status: unboundPositive ? 'PASS' : 'FAIL' })
  value = await run({ ...base, 'review-restored-scope': first })
  cases.push({ id: 'UNBOUND_PLUS_SELECTION_REFUSED', ...value,
    status: unboundPositive && value.ok === false && value.code === 'restored_review_selection_mismatch' ? 'PASS' : 'FAIL' })
  liveDigest = firstDigest
  value = await run({ ...base, 'review-restored-scope': first })
  const selectionPositive = value.ok === true && value.reused === true && value.healthReads === 1
  cases.push({ id: 'SAME_SELECTION_POSITIVE', ...value, status: selectionPositive ? 'PASS' : 'FAIL' })
  for (const [id, request] of [
    ['DIFFERENT_SELECTION_REFUSED', { ...base, 'review-restored-scope': second }],
    ['NO_SELECTION_REFUSED_WHEN_BOUND', base],
    ['SELECTION_CHECK_BEFORE_PORT', { ...base, port: '45003', 'review-restored-scope': second }],
  ]) {
    value = await run(request)
    cases.push({ id, ...value, status: selectionPositive && value.ok === false && value.code === 'restored_review_selection_mismatch' ? 'PASS' : 'FAIL' })
  }
} finally {
  process.kill = originalKill
  mock.restoreAll()
  rmSync(root, { recursive: true, force: true })
}
const report = { protocol: 'wave22-launcher-selection-reuse-admission/1', candidateRoot, source, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  actualOsScans: 0, actualOsSignals: 0, candidateProcessesStarted: 0, networkListenersStarted: 0, vendorSends: 0, nativeTurns: 0,
  scope: 'Actual D startInstance caller with complete record/admission controls, main file identity and actual-health return independently mocked. Unbound/same-selection positives and four focal refusals; no live lifecycle or cryptographic signer claim.' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
