import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mock } from 'node:test'
const candidate = resolve(process.argv[2] ?? '')
const frozen = resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3] || process.argv.length !== 4) throw new Error('Usage: node --experimental-test-module-mocks tools/bootstrap/probe-wave12-delivery.mjs <D-root> <unpacked-install-root>')
const source = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:candidate, encoding:'utf8'}).trim()
const { stopInstance } = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/stop.mjs')).href)
const instanceModule = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/instance.mjs')).href)
const { captureProcessFacts, processAlive, writeInstanceRecord } = instanceModule

const root = realpathSync(mkdtempSync('/tmp/pa-wave12-delivery-'))
const install = join(root, 'install')
const script = join(install, 'apps/coordinator/product/demo.ts')
mkdirSync(dirname(script), {recursive:true, mode:0o700})
writeFileSync(script, 'import {createServer} from "node:http"; const server=createServer((req,res)=>res.end("owned probe")); server.listen(0,"127.0.0.1",()=>process.send({port:server.address().port}));')
const children = []
const observations = []
async function ownApi(name) {
  const base = join(root, name)
  const roots = Object.fromEntries(['config', 'data', 'logs', 'cache', 'workspace'].map(key => [key, join(base, key)]))
  roots.install = install
  for (const path of Object.values(roots)) { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700) }
  const argv = [script, '--state', roots.data]
  const child = spawn(process.execPath, argv, { cwd: install, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  children.push(child)
  const [{ port }] = await once(child, 'message')
  const facts = await captureProcessFacts(child.pid)
  const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  await once(dead, 'exit')
  const record = {
    protocol: 'personal-product-instance/1', pid: dead.pid, processStart: 'exited-owned-launcher',
    apiPid: child.pid, consolePid: dead.pid, apiURL: `http://127.0.0.1:${port}`, consoleURL: 'http://127.0.0.1:65001',
    state: roots.data, install, buildId: 'wave12-audit-owned', mode: 'fixture', access: 'local-development', startupMode: 'normal',
    apiArgv: [process.execPath, ...argv], apiProcessStart: facts.processStart, apiUid: facts.uid, startedAt: new Date().toISOString(),
  }
  writeInstanceRecord(roots.config, record)
  return { roots, record, child }
}

try {
  const matching = await ownApi('matching')
  const result = await stopInstance({ roots: matching.roots, timeoutMs: 2000 })
  assert.equal(result.status, 'STOPPED_ORPHAN')
  observations.push({ id: 'MATCHING_STATE_POSITIVE', status: result.status, apiAlive: await processAlive(matching.child.pid) })

  const wrongData = await ownApi('wrong-data')
  const otherData = join(root, 'other-data')
  mkdirSync(otherData, { mode: 0o700, recursive: true })
  const denied = await stopInstance({ roots: { ...wrongData.roots, data: otherData }, timeoutMs: 2000 })
  assert.equal(denied.code, 'requested_root_mismatch')
  assert.equal(await processAlive(wrongData.child.pid), true)
  assert.equal(existsSync(join(wrongData.roots.config, 'instance.json')), true)
  observations.push({ id: 'REQUESTED_DATA_ROOT_CLOSED', code: denied.code, apiAlive: true, recordPreserved: true })

  const wrongInstall = await ownApi('wrong-install')
  const otherInstall = join(root, 'other-install')
  mkdirSync(otherInstall, { mode: 0o700, recursive: true })
  const installResult = await stopInstance({ roots: { ...wrongInstall.roots, install: otherInstall }, timeoutMs: 2000 })
  observations.push({ id: 'REQUESTED_INSTALL_ROOT_BYPASS', status: installResult.status, apiStopped: !(await processAlive(wrongInstall.child.pid)), recordRemoved: !existsSync(join(wrongInstall.roots.config, 'instance.json')) })

  const wrongConfig = await ownApi('wrong-config')
  const otherConfig = join(root, 'other-config')
  mkdirSync(otherConfig, { mode: 0o700, recursive: true })
  writeInstanceRecord(otherConfig, wrongConfig.record)
  const configResult = await stopInstance({ roots: { ...wrongConfig.roots, config: otherConfig }, timeoutMs: 2000 })
  observations.push({ id: 'COPIED_RECORD_CONFIG_ROOT_BYPASS', status: configResult.status, apiStopped: !(await processAlive(wrongConfig.child.pid)), originalRecordPreserved: existsSync(join(wrongConfig.roots.config, 'instance.json')) })
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
}

const fakePid = 912345
const stateA = join(root, 'mock', 'state-a')
const stateB = join(root, 'mock', 'state-b')
const sharedCache = join(root, 'mock', 'shared-cache')
const fakeCommand = `node fake-coordinator --state ${stateB} --cache-root ${sharedCache}`
const mockCalls = []
let fakeAlive = true
mock.module('node:child_process', {
  namedExports: {
    ...childProcess,
    spawnSync(file, argv) {
      mockCalls.push({ file, argv })
      assert.equal(file, 'ps')
      if (argv[0] === '-axo') return { status: 0, stdout: `${fakePid} 1\n` }
      if (argv.includes('command=')) return { status: 0, stdout: fakeCommand }
      if (argv.includes('stat=')) return { status: 0, stdout: fakeAlive ? 'S' : '' }
      throw new Error(`Unexpected mocked command ${JSON.stringify(argv)}`)
    },
  },
})
const originalKill = process.kill
const mockedSignals = []
let fakeRecord = null
mock.module(join(candidate, 'apps/launcher/lib/instance.mjs'), {
  namedExports: {
    ...instanceModule,
    readInstanceRecord: () => fakeRecord,
    verifyInstance: async () => ({ ok: true, checks: [], failures: [] }),
    processAlive: async () => true,
    processStart: async () => 'mock-owned-start',
  },
})
process.kill = (pid, signal) => {
  assert.equal(pid, fakePid, 'the mock must never reach any OS process')
  if (signal === 0) { if (!fakeAlive) throw Object.assign(new Error('not alive'), { code: 'ESRCH' }); return true }
  mockedSignals.push({ pid, signal })
  fakeAlive = false
  return true
}
try {
  const { accountRegisteredResources, stopRegisteredResources, recoverSwitch } = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/upgrade.mjs')).href)
  const roots = { install, config: join(root, 'mock', 'config-a'), data: stateA, cache: sharedCache, logs: join(root, 'mock', 'logs-a'), workspace: join(root, 'mock', 'workspace-a') }
  const args = { roots, target: null, record: null }
  const accounted = await accountRegisteredResources(args)
  const stopped = await stopRegisteredResources(args)
  observations.push({ id: 'UNREGISTERED_OTHER_STATE_SHARED_CACHE_CLAIMED', owned: accounted.owned, consideredRegistered: accounted.considered, mockedSignals, proven: stopped.proven, actualOsScans: 0, actualOsSignals: 0 })

  const manifest = JSON.parse(readFileSync(join(frozen, 'install.json'), 'utf8'))
  mkdirSync(roots.config, { recursive: true, mode: 0o700 })
  fakeRecord = { pid: fakePid, state: stateB, install: join(frozen, 'app'), buildId: manifest.buildId, mode: 'fixture', access: 'local-development', apiURL: 'http://127.0.0.1:65002' }
  writeFileSync(join(roots.config, 'install-switch.json'), JSON.stringify({ status: 'starting', to: { installDir: frozen }, mode: 'fixture', access: 'local-development' }), { mode: 0o600 })
  const recovered = await recoverSwitch({ installRoot: join(frozen, 'app'), roots })
  const journal = JSON.parse(readFileSync(join(roots.config, 'install-switch.json'), 'utf8'))
  observations.push({ id: 'RECOVER_STARTING_REQUESTED_DATA_SCOPE_BYPASS', requestedData: stateA, recordedData: stateB, status: recovered.status, journalStatus: journal.status, instanceVerification: 'mocked-valid-other-state', realTargetByteValidation: true, actualOsScans: 0, actualOsSignals: 0 })
} finally {
  process.kill = originalKill
  mock.restoreAll()
}
const rules = {
  MATCHING_STATE_POSITIVE: value => value.apiAlive === false,
  REQUESTED_DATA_ROOT_CLOSED: value => value.apiAlive === true && value.recordPreserved,
  REQUESTED_INSTALL_ROOT_BYPASS: value => !value.apiStopped && !value.recordRemoved,
  COPIED_RECORD_CONFIG_ROOT_BYPASS: value => !value.apiStopped,
  UNREGISTERED_OTHER_STATE_SHARED_CACHE_CLAIMED: value => !value.owned.length && !value.mockedSignals.length,
  RECOVER_STARTING_REQUESTED_DATA_SCOPE_BYPASS: value => value.status !== 'RECOVERED' && value.journalStatus !== 'confirmed',
}
const cases = observations.map(value => ({...value, verdict: rules[value.id](value) ? 'PASS' : 'FAIL'}))
const report = {dHead: source, frozen, cases, passed: cases.filter(v=>v.verdict==='PASS').length, failed: cases.filter(v=>v.verdict==='FAIL').length, modelCalls:0, nativeTurns:0, userServicesTouched:false}
const output=process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'reports/releases/wave12-admission/delivery.json')
mkdirSync(dirname(output),{recursive:true}); writeFileSync(output, JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
rmSync(root,{recursive:true,force:true})
process.exitCode=report.failed ? 1 : 0
