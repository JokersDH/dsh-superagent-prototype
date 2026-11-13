import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'

if (process.argv.length !== 4 || !process.env.PA_ADMISSION_REPORT) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-output> node --experimental-test-module-mocks tools/bootstrap/probe-wave16-delivery.mjs <D-root> <verified-frozen-install>')
}
const candidateRoot = resolve(process.argv[2])
const frozen = resolve(process.argv[3])
const output = resolve(process.env.PA_ADMISSION_REPORT)
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const source = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const frozenManifest = JSON.parse(readFileSync(join(frozen, 'install.json'), 'utf8'))
const root = mkdtempSync('/tmp/pa-wave16-delivery-')
const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(root, key)]))
for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })

const instanceURL = pathToFileURL(join(candidateRoot, 'apps/launcher/lib/instance.mjs')).href
const instance = await import(instanceURL)
const parent = 912345
const child = 912346
const uid = process.getuid?.() ?? 501
const operationId = 'independently-owned-parent-operation'
const command = `node trusted-parent --config-root ${roots.config} --data-root ${roots.data}`
const journalSpawn = { pid: parent, processStart: 'parent-start', uid, command, configRoot: roots.config, dataRoot: roots.data, operationId }
let includeChild = false
let unknown = false
const live = new Set()
const signals = []
const uidReads = []
const commandFor = pid => pid === parent ? command : `node foreign-child --state ${roots.data}`
const ensureFakePid = pid => assert([parent, child].includes(pid), 'Only fake probe PIDs may be observed or signalled')
const reset = () => {
  includeChild = false
  unknown = false
  live.clear()
  live.add(parent)
  signals.length = 0
  uidReads.length = 0
}
const noProcess = () => { throw new Error('This probe must not launch or inspect a real OS process') }
const failedVerification = async () => ({ ok: false, checks: [], failures: ['unregistered_resource'] })

// All candidate identity reads are injected, including processUid added after the older probes.
mock.module('node:child_process', { namedExports: {
  ...childProcess,
  spawn: noProcess,
  execFile: noProcess,
  execFileSync: noProcess,
  exec: noProcess,
  execSync: noProcess,
  spawnSync(file, args) {
    assert.equal(file, 'ps')
    if (args[0] === '-axo') return { status: 0, stdout: `${parent} 1\n${includeChild ? `${child} ${parent}\n` : ''}` }
    const pid = Number(args[args.indexOf('-p') + 1])
    ensureFakePid(pid)
    if (args.includes('stat=')) return { status: unknown ? 1 : 0, stdout: unknown ? '' : live.has(pid) ? 'S' : '' }
    if (args.includes('command=')) return { status: 0, stdout: commandFor(pid) }
    throw new Error(`Unmocked process observation: ${JSON.stringify(args)}`)
  },
} })
mock.module(instanceURL, { namedExports: {
  ...instance,
  readInstanceRecord: () => null,
  verifyInstance: failedVerification,
  verifyCoordinatorProcess: failedVerification,
  processStart: async pid => { ensureFakePid(pid); return pid === parent ? 'parent-start' : 'foreign-child-start' },
  processUid: async pid => { ensureFakePid(pid); uidReads.push(pid); return pid === parent ? uid : uid + 1000 },
  processAlive: async pid => { ensureFakePid(pid); return live.has(pid) },
  processCommand: async pid => { ensureFakePid(pid); return commandFor(pid) },
  captureProcessFacts: async pid => {
    ensureFakePid(pid)
    return { processStart: pid === parent ? 'parent-start' : 'foreign-child-start', uid: pid === parent ? uid : uid + 1000 }
  },
  listenersOnPort: async () => ({ supported: true, pids: [] }),
  stopProcess: async pid => {
    ensureFakePid(pid)
    process.kill(pid, 'SIGTERM')
    return { stopped: !live.has(pid), stillAlive: live.has(pid), code: null }
  },
} })
const originalKill = process.kill
process.kill = (pid, signal) => {
  ensureFakePid(pid)
  if (!live.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
  if (signal !== 0) {
    signals.push({ pid, signal })
    live.delete(pid)
  }
  return true
}

const cases = []
try {
  const { stopRegisteredResources, recoverSwitch } = await import(pathToFileURL(join(candidateRoot, 'apps/launcher/lib/upgrade.mjs')).href)
  reset()
  let result = await stopRegisteredResources({ roots, journalSpawn, operationId })
  const positive = result.proven === true && signals.length === 1 && signals[0].pid === parent && signals[0].signal === 'SIGTERM' && !live.has(parent)
  cases.push({ id: 'COMPLETE_PARENT_POSITIVE', ...result, signals: [...signals], status: positive ? 'PASS' : 'FAIL' })

  reset()
  includeChild = true
  live.add(child)
  result = await stopRegisteredResources({ roots, journalSpawn, operationId })
  const childStopped = signals.some(value => value.pid === child)
  cases.push({ id: 'FOREIGN_UID_UNREGISTERED_CHILD_INHERITS_PARENT', ...result, signals: [...signals], uidReads: [...uidReads],
    foreignChildUid: uid + 1000, expected: 'Child stays UNKNOWN, receives no signal, and stop is unproven',
    status: positive && result.proven === false && !childStopped && live.has(child) ? 'PASS' : 'FAIL' })

  reset()
  unknown = true
  result = await stopRegisteredResources({ roots })
  cases.push({ id: 'DISCOVERED_STATUS_UNKNOWN_EMPTY_PROOF', ...result, signals: [...signals],
    expected: 'A discovered process with unreadable status prevents a proven empty set',
    status: positive && result.proven === false && signals.length === 0 ? 'PASS' : 'FAIL' })

  reset()
  unknown = true
  const journalPath = join(roots.config, 'install-switch.json')
  const pointerPath = join(roots.config, 'release.json')
  writeFileSync(journalPath, JSON.stringify({ status: 'target_stop_unproven', operationId, to: { installDir: frozen }, mode: 'fixture', access: 'local-development' }), { mode: 0o600 })
  writeFileSync(join(roots.config, 'release.previous.json'), readFileSync(join(frozen, 'var/config/release.json')), { mode: 0o600 })
  const pointerExistedBefore = existsSync(pointerPath)
  result = await recoverSwitch({ installRoot: join(frozen, 'app'), roots })
  const journalStatus = JSON.parse(readFileSync(journalPath, 'utf8')).status
  const pointerExistsAfter = existsSync(pointerPath)
  cases.push({ id: 'RECOVER_UNKNOWN_DISCOVERED_WRITER', result: result.status, journal: journalStatus,
    signals: [...signals], mockWriterStillAlive: live.has(parent), pointerExistedBefore, pointerExistsAfter,
    expected: 'Recovery is BLOCKED without a pointer change while the discovered writer is UNKNOWN',
    status: positive && result.status === 'BLOCKED' && journalStatus === 'target_stop_unproven' && signals.length === 0 && live.has(parent) && pointerExistsAfter === pointerExistedBefore ? 'PASS' : 'FAIL' })
} finally {
  process.kill = originalKill
  mock.restoreAll()
  rmSync(root, { recursive: true, force: true })
}

const report = { protocol: 'wave16-d-admission/1', source, candidateRoot,
  frozen: { root: frozen, source: frozenManifest.source, buildId: frozenManifest.buildId, schema: frozenManifest.producer?.productSchema },
  cases, passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  actualOsScans: 0, actualOsSignals: 0, actualProcessesSpawned: 0, realModelTurns: 0, nativeTurns: 0,
  scope: 'Complete parent positive plus child ownership, discovered UNKNOWN and actual recovery; all identity/inventory/signals mocked, verified frozen input readonly, no live lifecycle admission' }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
