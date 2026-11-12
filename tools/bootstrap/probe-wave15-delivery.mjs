import assert from 'node:assert/strict'
import * as cp from 'node:child_process'
import { mock } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.argv.length !== 4) throw new Error('Usage: node --experimental-test-module-mocks tools/bootstrap/probe-wave15-delivery.mjs <D-root> <verified-frozen-install>')
const candidate = resolve(process.argv[2]), frozen = resolve(process.argv[3]), root = mkdtempSync('/tmp/pa-wave15-identity-')
const source = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
const moduleURL = pathToFileURL(join(candidate, 'apps/launcher/lib/instance.mjs')).href, instance = await import(moduleURL)
const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(root, key)]))
for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
const pid = 912345, signals = [], operationId = 'probe-owned-operation'
const argv = [process.execPath, join(frozen, 'app/apps/launcher/bin/pa.mjs'), 'start', '--data-root', roots.data, '--config-root', roots.config, '--operation-id', operationId]
let live = true, statFailed = false, failAfterSignal = false, completeIdentity = false
mock.module('node:child_process', { namedExports: { ...cp,
  spawn() { throw new Error('This probe must not launch a process') },
  spawnSync(file, args) {
    assert.equal(file, 'ps')
    if (args[0] === '-axo') return { status: 0, stdout: `${pid} 1\n` }
    if (args.includes('stat=')) return { status: statFailed ? 1 : 0, stdout: statFailed ? '' : live ? 'S' : '' }
    if (args.includes('command=')) return { status: 0, stdout: completeIdentity ? argv.join(' ') : `node unrelated-worker --state ${roots.data}` }
    throw new Error(`Unmocked process observation: ${JSON.stringify(args)}`)
  },
} })
mock.module(moduleURL, { namedExports: { ...instance,
  readInstanceRecord: () => null,
  verifyInstance: async () => ({ ok: completeIdentity, checks: [], failures: completeIdentity ? [] : ['foreign'] }),
  verifyCoordinatorProcess: async () => ({ ok: completeIdentity, checks: [], failures: completeIdentity ? [] : ['foreign'] }),
  processStart: async () => 'same-start', processUid: async () => process.getuid(), processAlive: async () => live,
} })
const originalKill = process.kill
process.kill = (value, signal) => {
  assert.equal(value, pid, 'Never signal any OS process')
  if (!live) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
  if (signal !== 0) { signals.push({ pid: value, signal }); if (failAfterSignal) statFailed = true; else live = false }
  return true
}
const reset = () => { live = true; statFailed = false; failAfterSignal = false; completeIdentity = false; signals.length = 0 }
const observations = []
try {
  const { stopRegisteredResources, recoverSwitch } = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/upgrade.mjs')).href)
  const productionSpawn = { pid, processStart: 'same-start', startedAt: new Date().toISOString() }
  const completeSpawn = { ...productionSpawn, uid: process.getuid(), argv, configRoot: roots.config, dataRoot: roots.data, operationId }
  reset()
  let value = await stopRegisteredResources({ roots, journalSpawn: productionSpawn })
  observations.push({ id: 'ACTUAL_JOURNAL_MISSING_ARGV_ROOT_OPERATION', ...value, signals: [...signals],
    status: value.proven === false && signals.length === 0 ? 'PASS' : 'FAIL' })
  reset(); completeIdentity = true; failAfterSignal = true
  value = await stopRegisteredResources({ roots, journalSpawn: completeSpawn, operationId })
  const exercised = signals.some(item => item.signal === 'SIGTERM')
  observations.push({ id: 'POST_SIGNAL_STAT_UNKNOWN_IS_NOT_STOPPED', ...value, signals: [...signals], mockProcessStillAlive: live,
    positiveIdentityExercised: exercised, status: exercised && live && value.proven === false ? 'PASS' : 'FAIL' })
  reset()
  writeFileSync(join(roots.config, 'install-switch.json'), JSON.stringify({ status: 'target_stop_unproven', to: { installDir: frozen }, mode: 'fixture', access: 'local-development', spawn: productionSpawn }), { mode: 0o600 })
  writeFileSync(join(roots.config, 'release.previous.json'), readFileSync(join(frozen, 'var/config/release.json')), { mode: 0o600 })
  value = await recoverSwitch({ installRoot: join(frozen, 'app'), roots })
  observations.push({ id: 'ACTUAL_RECOVER_MISSING_RESOURCE_IDENTITY', result: value.status, signals: [...signals],
    journal: JSON.parse(readFileSync(join(roots.config, 'install-switch.json'))).status,
    status: value.status === 'BLOCKED' && signals.length === 0 ? 'PASS' : 'FAIL' })
  reset(); completeIdentity = true
  value = await stopRegisteredResources({ roots, journalSpawn: completeSpawn, operationId })
  observations.push({ id: 'COMPLETE_MOCK_IDENTITY_POSITIVE_CONTROL', ...value, signals: [...signals],
    status: value.proven === true && !live && signals.some(item => item.signal === 'SIGTERM') ? 'PASS' : 'FAIL' })
} finally { process.kill = originalKill; mock.restoreAll() }
const report = { protocol: 'wave15-d-admission/1', source, observations,
  passed: observations.filter(item => item.status === 'PASS').length, failed: observations.filter(item => item.status === 'FAIL').length,
  actualOsScans: 0, actualOsSignals: 0, actualProcessesSpawned: 0, realModelTurns: 0, nativeTurns: 0,
  scope: 'Fully mocked producer-shaped journal and post-signal tri-state with a complete positive identity control; no live lifecycle admission' }
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave15-admission/delivery.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
