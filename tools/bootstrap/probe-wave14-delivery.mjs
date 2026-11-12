import assert from 'node:assert/strict'
import * as cp from 'node:child_process'
import { mock } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (process.argv.length !== 4) throw new Error('Usage: node --experimental-test-module-mocks tools/bootstrap/probe-wave14-delivery.mjs <D-root> <verified-frozen-install>')
const root = mkdtempSync('/tmp/pa-wave14-ownership-'), candidate = resolve(process.argv[2]), frozen = resolve(process.argv[3])
const source = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
const moduleUrl = pathToFileURL(join(candidate, 'apps/launcher/lib/instance.mjs')).href
const instance = await import(moduleUrl)
const pid = 912345, deadPid = 912346
const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(k => [k, join(root, 'new-mock', k)]))
for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
let live = true, statFails = false, malformed = false, fakeRecord = null, verify = false
const signals = [], calls = []
mock.module('node:child_process', { namedExports: { ...cp,
  spawn() { throw Error('No actual process may be launched') },
  spawnSync(file, argv) {
    assert.equal(file, 'ps'); calls.push(argv)
    if (argv[0] === '-axo') return { status: 0, stdout: malformed ? 'unreadable pid parent\n' : `${pid} 1\n` }
    if (argv.includes('stat=')) return { status: statFails ? 1 : 0, stdout: statFails ? '' : live ? 'S' : '' }
    if (argv.includes('command=')) return { status: 0, stdout: `node unrelated-worker --state ${roots.data}` }
    if (argv.includes('uid=')) return { status: 0, stdout: '123' }
    throw Error(`Unexpected mock ps ${JSON.stringify(argv)}`)
  },
} })
mock.module(moduleUrl, { namedExports: { ...instance,
  readInstanceRecord: () => fakeRecord,
  verifyInstance: async () => ({ ok: verify, checks: [], failures: [] }),
  verifyCoordinatorProcess: async () => ({ ok: false, checks: [], failures: ['wrong_uid_argv_operation'] }),
  processAlive: async value => value === pid && live,
  processStart: async () => 'same-start',
} })
const originalKill = process.kill
process.kill = (value, signal) => {
  assert([pid, deadPid].includes(value), 'Never touch an actual OS PID')
  if (value === deadPid || !live) throw Object.assign(Error('gone'), { code: 'ESRCH' })
  if (signal !== 0) { signals.push({ pid: value, signal }); live = false }
  return true
}
const results = []
const reset = () => { live = true; statFails = false; malformed = false; fakeRecord = null; verify = false; signals.length = 0; calls.length = 0 }
const record = () => ({ pid: deadPid, processStart: 'dead-start', apiPid: pid, apiProcessStart: 'same-start', apiUid: 456,
  consolePid: deadPid, configRoot: roots.config, state: roots.data, install: join(frozen, 'app'), mode: 'fixture', access: 'local-development',
  operationId: 'foreign-operation', apiArgv: ['node', 'different-script'] })
try {
  const { stopRegisteredResources, recoverSwitch } = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/upgrade.mjs')).href)
  const manifest = JSON.parse(readFileSync(join(frozen, 'install.json')))
  reset()
  const a = await stopRegisteredResources({ roots, record: record() })
  results.push({ id: 'SAME_START_WRONG_UID_ARGV_OPERATION', ...a, signals: [...signals], uidQueried: calls.some(args => args.includes('uid=')), expected: 'No signal; identity mismatch' })
  reset()
  const b = await stopRegisteredResources({ roots, journalSpawn: { pid, processStart: 'same-start', uid: 456, configRoot: '/foreign/config', dataRoot: '/foreign/data', operationId: 'foreign-operation' } })
  results.push({ id: 'JOURNAL_SCOPE_UID_OPERATION_IGNORED', ...b, signals: [...signals], expected: 'No signal; foreign journal identity' })
  reset(); statFails = true
  const c = await stopRegisteredResources({ roots, record: record() })
  results.push({ id: 'PER_PID_STAT_FAILURE_EMPTY_PROOF', ...c, signals: [...signals], expected: 'proven=false; per-PID status UNKNOWN' })
  reset(); malformed = true
  const d = await stopRegisteredResources({ roots })
  results.push({ id: 'MALFORMED_INVENTORY_EMPTY_PROOF', ...d, signals: [...signals], expected: 'proven=false; malformed inventory UNKNOWN' })
  reset()
  fakeRecord = { ...record(), pid, processStart: 'same-start', install: dirname(frozen), buildId: manifest.buildId, apiURL: 'http://127.0.0.1:65002' }
  verify = true
  writeFileSync(join(roots.config, 'install-switch.json'), JSON.stringify({ status: 'starting', to: { installDir: frozen }, mode: 'fixture', access: 'local-development' }), { mode: 0o600 })
  const e = await recoverSwitch({ installRoot: dirname(frozen), roots: { ...roots, install: dirname(frozen) } })
  results.push({ id: 'INSTALL_DIR_PARENT_ACCEPTED_AS_ROLE', result: e.status, journal: JSON.parse(readFileSync(join(roots.config, 'install-switch.json'))).status,
    requested: dirname(frozen), actualTarget: frozen, expected: 'BLOCKED; parent of installDir is not old/new install' })
  reset()
  fakeRecord = { ...record(), buildId: manifest.buildId }
  writeFileSync(join(roots.config, 'install-switch.json'), JSON.stringify({ status: 'target_stop_unproven', from: { installRoot: join(frozen, 'app') }, to: { installDir: frozen }, mode: 'fixture', access: 'local-development' }), { mode: 0o600 })
  writeFileSync(join(roots.config, 'release.previous.json'), readFileSync(join(frozen, 'var/config/release.json')), { mode: 0o600 })
  const f = await recoverSwitch({ installRoot: join(frozen, 'app'), roots: { ...roots, install: join(frozen, 'app') } })
  results.push({ id: 'ACTUAL_RECOVER_WRONG_UID_ARGV_OPERATION', result: f.status, signals: [...signals], journal: JSON.parse(readFileSync(join(roots.config, 'install-switch.json'))).status,
    expected: 'No signal; BLOCKED by failed coordinator identity' })
} finally { process.kill = originalKill; mock.restoreAll() }
const cases = results.map((item, index) => ({ ...item, status: (index === 4 ? item.result === 'BLOCKED' && item.journal === 'starting' : index === 2 || index === 3 ? item.proven === false && item.signals.length === 0 : index === 5 ? item.signals.length === 0 && item.result === 'BLOCKED' : item.signals.length === 0 && item.proven === false) ? 'PASS' : 'FAIL' }))
const report = { protocol: 'wave14-d-admission/1', source, cases, passed: cases.filter(item => item.status === 'PASS').length, failed: cases.filter(item => item.status === 'FAIL').length,
  actualOsScans: 0, actualOsSignals: 0, actualProcessesSpawned: 0, realModelTurns: 0, nativeTurns: 0,
  scope: 'Pure mock identity/inventory/signals and recover entrypoints; verified frozen input readonly; no live stop/install matrix' }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave14-admission/delivery.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
rmSync(root, { recursive: true, force: true })
process.exitCode = report.failed ? 1 : 0
