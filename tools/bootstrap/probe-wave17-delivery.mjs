import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'

if (process.argv.length !== 4 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node --experimental-test-module-mocks tools/bootstrap/probe-wave17-delivery.mjs <D-root> <verified-frozen-install>')
}
const candidateRoot = resolve(process.argv[2])
const frozen = resolve(process.argv[3])
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const source = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const manifest = JSON.parse(readFileSync(join(frozen, 'install.json'), 'utf8'))
const root = mkdtempSync('/tmp/pa-wave17-delivery-')
const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(root, key)]))
for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })

const instanceURL = pathToFileURL(join(candidateRoot, 'apps/launcher/lib/instance.mjs')).href
const instance = await import(instanceURL)
const parent = 912345
const child = 912346
const uid = process.getuid?.() ?? 501
const operationId = 'independent-parent-operation'
const command = `node trusted-parent --config-root ${roots.config} --data-root ${roots.data}`
const childCommand = `node unrelated-child --state ${roots.data}`
const journalSpawn = { pid: parent, processStart: 'parent-start', uid, command, configRoot: roots.config, dataRoot: roots.data, operationId }
let includeChild = false
const live = new Set()
const signals = []
const uidReads = []
const startReads = []
const guard = pid => assert([parent, child].includes(pid), 'Only fake probe PIDs may be observed or signalled')
const commandFor = pid => pid === parent ? command : childCommand
const startFor = pid => pid === parent ? 'parent-start' : 'different-child-start'
const reset = () => {
  includeChild = false
  live.clear()
  live.add(parent)
  signals.length = 0
  uidReads.length = 0
  startReads.length = 0
}
const noProcess = () => { throw new Error('This probe must not launch or inspect a real OS process') }
const noVerification = async () => ({ ok: false, checks: [], failures: ['unregistered'] })

// Parent and child have the same UID; only the parent has a registered, complete birth identity.
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
    guard(pid)
    if (args.includes('stat=')) return { status: 0, stdout: live.has(pid) ? 'S' : '' }
    if (args.includes('command=')) return { status: 0, stdout: commandFor(pid) }
    throw new Error(`Unmocked process observation: ${JSON.stringify(args)}`)
  },
} })
mock.module(instanceURL, { namedExports: {
  ...instance,
  readInstanceRecord: () => null,
  verifyInstance: noVerification,
  verifyCoordinatorProcess: noVerification,
  processUid: async pid => { guard(pid); uidReads.push(pid); return uid },
  processStart: async pid => { guard(pid); startReads.push(pid); return startFor(pid) },
  processAlive: async pid => { guard(pid); return live.has(pid) },
  processCommand: async pid => { guard(pid); return commandFor(pid) },
  captureProcessFacts: async pid => { guard(pid); return { uid, processStart: startFor(pid) } },
  listenersOnPort: async () => ({ supported: true, pids: [] }),
  stopProcess: async pid => {
    guard(pid)
    process.kill(pid, 'SIGTERM')
    return { stopped: !live.has(pid), stillAlive: live.has(pid), code: null }
  },
} })
const originalKill = process.kill
process.kill = (pid, signal) => {
  guard(pid)
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

  if (positive) {
    reset()
    includeChild = true
    live.add(child)
    result = await stopRegisteredResources({ roots, journalSpawn, operationId })
    const childSignalled = signals.some(value => value.pid === child)
    cases.push({ id: 'UNREGISTERED_SAME_UID_CHILD', ...result, signals: [...signals], uidReads: [...uidReads], startReads: [...startReads],
      childCommand, childHasIndependentBirth: false,
      expected: 'Child lacks independent start/argv/root/install/operation identity; no child signal and no proven stop',
      status: result.proven === false && !childSignalled && live.has(child) ? 'PASS' : 'FAIL' })

    reset()
    includeChild = true
    live.add(child)
    const journalPath = join(roots.config, 'install-switch.json')
    const pointerPath = join(roots.config, 'release.json')
    writeFileSync(journalPath, JSON.stringify({ status: 'target_stop_unproven', operationId, to: { installDir: frozen }, mode: 'fixture', access: 'local-development', spawn: journalSpawn }), { mode: 0o600 })
    writeFileSync(join(roots.config, 'release.previous.json'), readFileSync(join(frozen, 'var/config/release.json')), { mode: 0o600 })
    const pointerExistedBefore = existsSync(pointerPath)
    result = await recoverSwitch({ installRoot: join(frozen, 'app'), roots })
    const journalStatus = JSON.parse(readFileSync(journalPath, 'utf8')).status
    const pointerExistsAfter = existsSync(pointerPath)
    cases.push({ id: 'ACTUAL_RECOVER_UNREGISTERED_SAME_UID_CHILD', result: result.status, journal: journalStatus,
      signals: [...signals], uidReads: [...uidReads], startReads: [...startReads], childStillAlive: live.has(child),
      pointerExistedBefore, pointerExistsAfter,
      expected: 'Recovery stays BLOCKED without child signals or pointer change while child identity is unproven',
      status: result.status === 'BLOCKED' && journalStatus === 'target_stop_unproven' && !signals.some(value => value.pid === child) && live.has(child) && pointerExistsAfter === pointerExistedBefore ? 'PASS' : 'FAIL' })
  } else {
    for (const id of ['UNREGISTERED_SAME_UID_CHILD', 'ACTUAL_RECOVER_UNREGISTERED_SAME_UID_CHILD']) {
      cases.push({ id, status: 'NOT_TESTED', reason: 'The unchanged complete parent positive control did not pass' })
    }
  }
} finally {
  process.kill = originalKill
  mock.restoreAll()
  rmSync(root, { recursive: true, force: true })
}

const report = { protocol: 'wave17-d-admission/1', source, candidateRoot,
  frozen: { root: frozen, source: manifest.source, buildId: manifest.buildId, schema: manifest.producer?.productSchema },
  cases, passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  notTested: cases.filter(value => value.status === 'NOT_TESTED').length,
  actualOsScans: 0, actualOsSignals: 0, actualProcessesSpawned: 0, vendorSends: 0, nativeTurns: 0,
  scope: 'Complete parent positive plus same-UID child helper and actual recover negatives; all identity/inventory/signals mocked, verified frozen input readonly, no live lifecycle admission' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.notTested ? 1 : 0
