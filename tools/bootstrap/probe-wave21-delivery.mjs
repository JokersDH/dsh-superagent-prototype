import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import * as net from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'

if (process.argv.length !== 3 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node --experimental-test-module-mocks tools/bootstrap/probe-wave21-delivery.mjs <D-root>')
}
const candidateRoot = resolve(process.argv[2])
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const source = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const moduleURL = name => pathToFileURL(join(candidateRoot, 'apps/launcher/lib', `${name}.mjs`)).href
const root = mkdtempSync('/tmp/pa-wave21-start-reuse-')
const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(root, key)]))
for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
for (const key of Object.keys(roots)) roots[key] = realpathSync(roots[key])
const reviewFile = join(root, 'review.json')
writeFileSync(reviewFile, '{}', { mode: 0o600 })
const release = { buildId: 'independently-matched-existing-instance', producer: { node: process.versions.node, productSchema: 18 }, build: { consoleRoot: 'console' } }
const [config, instance, lock, recovery, releaseModule, diagnostics, daemon] = await Promise.all(
  ['config', 'instance', 'start-lock', 'recovery', 'release', 'diagnostics', 'daemon'].map(name => import(moduleURL(name))),
)
const noOperation = () => { throw new Error('No actual process or network operation is allowed') }
const record = {
  install: roots.install, state: roots.data, configRoot: roots.config, mode: 'personal', access: 'local-development',
  buildId: release.buildId, startupMode: 'recovery_readonly', consoleURL: 'http://127.0.0.1:45001', apiURL: 'http://127.0.0.1:45002',
  pid: 912345, apiPid: 912346, consolePid: 912345, processStart: 'existing-start', apiProcessStart: 'existing-api-start',
  apiArgv: ['node', 'demo.ts', '--startup-mode', 'recovery_readonly'],
}
const originalKill = process.kill
const cases = []
try {
  mock.module('node:child_process', { namedExports: { ...childProcess,
    spawn: noOperation, spawnSync: noOperation, execFile: noOperation, execFileSync: noOperation, exec: noOperation, execSync: noOperation } })
  mock.module('node:net', { namedExports: { ...net, createServer: noOperation } })
  mock.module(moduleURL('config'), { namedExports: { ...config, readLauncherConfig: () => ({}) } })
  mock.module(moduleURL('instance'), { namedExports: { ...instance,
    readInstanceRecord: () => record, verifyInstance: async () => ({ ok: true, checks: [], failures: [] }),
    captureProcessFacts: noOperation, processStart: noOperation, processUid: noOperation,
    processAlive: noOperation, processCommand: noOperation, listenersOnPort: noOperation,
    writeInstanceRecord: noOperation, removeInstanceRecord: noOperation, stopProcess: noOperation,
  } })
  mock.module(moduleURL('start-lock'), { namedExports: { ...lock, acquireStartLock: async () => ({ release() {} }) } })
  mock.module(moduleURL('recovery'), { namedExports: { ...recovery,
    expectedStartupMode: () => 'recovery_readonly', recoverySummary: () => ({ markerPresent: true }) } })
  mock.module(moduleURL('release'), { namedExports: { ...releaseModule,
    readRelease: () => ({ release }), verifyReleaseArtifacts: () => ({ ok: true }), consoleIndexPath: () => root,
    statFile: () => ({ isFile: () => true }), verifyConsoleBuild: () => ({ ok: true }), verifyRuntimeDependencies: () => ({ ok: true }),
  } })
  mock.module(moduleURL('diagnostics'), { namedExports: { ...diagnostics,
    probeRuntime: () => ({ ok: true }), probeAuthorExecutor: noOperation } })
  mock.module(moduleURL('daemon'), { namedExports: { ...daemon, spawnDaemon: noOperation } })
  process.kill = noOperation
  const { startInstance } = await import(moduleURL('start'))
  const options = { port: '45001', 'api-port': '45002', 'discussion-only': true }
  let result = await startInstance({ installRoot: roots.install, roots, values: options, log() {} })
  const positive = result.ok === true && result.reused === true
  cases.push({ id: 'EXACT_EXISTING_UNBOUND_REUSE_POSITIVE', ok: result.ok, reused: result.reused, status: positive ? 'PASS' : 'FAIL' })
  if (positive) {
    result = await startInstance({ installRoot: roots.install, roots,
      values: { ...options, 'review-restored-scope': reviewFile }, log() {} })
    cases.push({ id: 'EXPLICIT_REVIEW_REQUEST_REUSES_UNBOUND_DAEMON', ok: result.ok, reused: result.reused, code: result.code,
      existingApiArgv: record.apiArgv,
      reviewFileKind: 'Private regular file only; actual signature validation belongs to a newly started main consumer, which must not be silently skipped',
      expected: 'Reject changed review selection or actually start/apply it; do not report reuse of a daemon that never consumed the explicit file',
      status: result.reused !== true ? 'PASS' : 'FAIL' })
  } else {
    cases.push({ id: 'EXPLICIT_REVIEW_REQUEST_REUSES_UNBOUND_DAEMON', status: 'BLOCKED_BY_CONTROL', reason: 'Exact existing-instance positive failed' })
  }
} finally {
  process.kill = originalKill
  mock.restoreAll()
  rmSync(root, { recursive: true, force: true })
}
const report = { protocol: 'wave21-launcher-review-reuse-admission/1', candidateRoot, source, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  blockedByControl: cases.some(value => value.status === 'BLOCKED_BY_CONTROL'),
  actualOsScans: 0, actualOsSignals: 0, candidateProcessesStarted: 0, networkListenersStarted: 0, vendorSends: 0, nativeTurns: 0,
  scope: 'Actual launcher startInstance existing-record path with complete mocked admission/identity control; one explicit review option changes, no live process or signature authority created' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.blockedByControl ? 1 : 0
