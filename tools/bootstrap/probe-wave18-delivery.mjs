import assert from 'node:assert/strict'
import * as childProcess from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mock } from 'node:test'

if (![3, 4].includes(process.argv.length) || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node --experimental-test-module-mocks tools/bootstrap/probe-wave18-delivery.mjs <verified-frozen-install> [old-verified-frozen-install]')
}
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function inspectFrozen(input) {
  const frozen = realpathSync(resolve(input))
  const manifest = JSON.parse(readFileSync(join(frozen, 'install.json'), 'utf8'))
  assert.equal(manifest.format, 'pa-install')
  const app = realpathSync(resolve(frozen, manifest.appRoot ?? 'app'))
  assert(app.startsWith(`${frozen}/`), 'Application root must remain inside the verified install')
  const modulePath = join(app, 'apps/launcher/lib/upgrade.mjs')
  assert(lstatSync(modulePath).isFile() && !lstatSync(modulePath).isSymbolicLink())
  const moduleSha256 = hash(readFileSync(modulePath))
  assert.equal(moduleSha256, manifest.files.find(value => value.path === relative(frozen, modulePath))?.sha256)

  const root = mkdtempSync('/tmp/pa-wave18-frozen-child-')
  const roots = Object.fromEntries(['install', 'config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(root, key)]))
  for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const parent = 912345
  const child = 912346
  const uid = process.getuid?.() ?? 501
  const operationId = 'frozen-byte-owned-operation'
  const parentCommand = `node trusted-parent --config-root ${roots.config} --data-root ${roots.data}`
  const childCommand = `node registered-child --state ${roots.data}`
  const parentIdentity = { pid: parent, processStart: 'parent-start', uid, command: parentCommand, configRoot: roots.config, dataRoot: roots.data, operationId }
  const childIdentity = { pid: child, processStart: 'child-start', uid, command: childCommand }
  let includeChild = false
  const live = new Set()
  const signals = []
  const startReads = []
  const guard = pid => assert([parent, child].includes(pid), 'Only fake probe PIDs may be observed or signalled')
  const startFor = pid => pid === parent ? 'parent-start' : 'child-start'
  const commandFor = pid => pid === parent ? parentCommand : childCommand
  const reset = () => {
    includeChild = false
    live.clear()
    live.add(parent)
    signals.length = 0
    startReads.length = 0
  }
  const noProcess = () => { throw new Error('This probe must not launch or inspect a real OS process') }
  const noVerification = async () => ({ ok: false, checks: [], failures: ['unregistered'] })
  const originalKill = process.kill
  const cases = []

  try {
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
    const instanceURL = pathToFileURL(join(app, 'apps/launcher/lib/instance.mjs')).href
    const instance = await import(instanceURL)
    mock.module(instanceURL, { namedExports: {
      ...instance,
      readInstanceRecord: () => null,
      verifyInstance: noVerification,
      verifyCoordinatorProcess: noVerification,
      processUid: async pid => { guard(pid); return uid },
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
    process.kill = (pid, signal) => {
      guard(pid)
      if (!live.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
      if (signal !== 0) {
        signals.push({ pid, signal })
        live.delete(pid)
      }
      return true
    }

    // The implementation is imported only from the verified package, never a source checkout.
    const { stopRegisteredResources, recoverSwitch } = await import(pathToFileURL(modulePath).href)
    reset()
    let result = await stopRegisteredResources({ roots, journalSpawn: parentIdentity, operationId })
    const positive = result.proven === true && signals.length === 1 && signals[0].pid === parent && !live.has(parent)
    cases.push({ id: 'COMPLETE_PARENT_POSITIVE', ...result, signals: [...signals], status: positive ? 'PASS' : 'FAIL' })

    if (positive) {
      reset()
      includeChild = true
      live.add(child)
      result = await stopRegisteredResources({ roots, journalSpawn: { ...parentIdentity, children: [childIdentity] }, operationId })
      cases.push({ id: 'COMPLETE_REGISTERED_CHILD_POSITIVE', ...result, signals: [...signals], startReads: [...startReads],
        status: result.proven === true && signals.some(value => value.pid === child) && !live.has(child) ? 'PASS' : 'FAIL' })

      reset()
      includeChild = true
      live.add(child)
      result = await stopRegisteredResources({ roots, journalSpawn: parentIdentity, operationId })
      cases.push({ id: 'UNREGISTERED_CHILD_NEGATIVE', ...result, signals: [...signals], startReads: [...startReads],
        status: result.proven === false && !signals.some(value => value.pid === child) && live.has(child) ? 'PASS' : 'FAIL' })

      reset()
      includeChild = true
      live.add(child)
      result = await stopRegisteredResources({ roots, journalSpawn: { ...parentIdentity, children: [{ ...childIdentity, processStart: 'stale-child-start' }] }, operationId })
      cases.push({ id: 'REGISTERED_WRONG_START_NEGATIVE', ...result, signals: [...signals], startReads: [...startReads],
        status: result.proven === false && !signals.some(value => value.pid === child) && live.has(child) ? 'PASS' : 'FAIL' })

      reset()
      includeChild = true
      live.add(child)
      const journalPath = join(roots.config, 'install-switch.json')
      const pointerPath = join(roots.config, 'release.json')
      writeFileSync(journalPath, JSON.stringify({ status: 'target_stop_unproven', operationId, to: { installDir: frozen }, mode: 'fixture', access: 'local-development', spawn: parentIdentity }), { mode: 0o600 })
      writeFileSync(join(roots.config, 'release.previous.json'), readFileSync(join(frozen, 'var/config/release.json')), { mode: 0o600 })
      result = await recoverSwitch({ installRoot: app, roots })
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')).status
      const pointerCreated = existsSync(pointerPath)
      cases.push({ id: 'ACTUAL_RECOVER_UNREGISTERED_CHILD', result: result.status, journal, signals: [...signals], pointerCreated,
        status: result.status === 'BLOCKED' && journal === 'target_stop_unproven' && !signals.some(value => value.pid === child) && live.has(child) && !pointerCreated ? 'PASS' : 'FAIL' })
    } else {
      for (const id of ['COMPLETE_REGISTERED_CHILD_POSITIVE', 'UNREGISTERED_CHILD_NEGATIVE', 'REGISTERED_WRONG_START_NEGATIVE', 'ACTUAL_RECOVER_UNREGISTERED_CHILD']) {
        cases.push({ id, status: 'NOT_TESTED', reason: 'Complete parent positive control did not pass' })
      }
    }
  } finally {
    process.kill = originalKill
    mock.restoreAll()
    rmSync(root, { recursive: true, force: true })
  }
  return { frozen, subject: { source: manifest.source.commit, buildId: manifest.buildId, schema: manifest.producer.productSchema },
    modulePath, moduleSha256, cases,
    passed: cases.filter(value => value.status === 'PASS').length,
    failed: cases.filter(value => value.status === 'FAIL').length,
    notTested: cases.filter(value => value.status === 'NOT_TESTED').length }
}

const installs = []
for (const input of process.argv.slice(2)) installs.push(await inspectFrozen(input))
const report = { protocol: 'wave18-frozen-delivery-admission/1', installs,
  passed: installs.reduce((sum, value) => sum + value.passed, 0),
  failed: installs.reduce((sum, value) => sum + value.failed, 0),
  notTested: installs.reduce((sum, value) => sum + value.notTested, 0),
  actualOsScans: 0, actualOsSignals: 0, candidateProcessesStarted: 0, vendorSends: 0, nativeTurns: 0,
  scope: 'Each verified immutable package is evaluated independently with full parent/registered-child positives and missing/wrong-start/helper/recover negatives; all candidate process operations mocked, no live lifecycle admission' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.notTested ? 1 : 0
