import assert from 'node:assert/strict'
import * as cp from 'node:child_process'
import { mock } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = resolve(process.argv[2] ?? ''), frozen = resolve(process.argv[3] ?? '')
if(!process.argv[2] || !process.argv[3] || process.argv.length !== 4) throw new Error('Usage: node --experimental-test-module-mocks tools/bootstrap/probe-wave13-delivery.mjs <D-root> <verified-install-root>')
const source = cp.execFileSync('git',['rev-parse','HEAD'],{cwd:candidate,encoding:'utf8'}).trim()
const root = mkdtempSync('/tmp/pa-wave13-ownership-')
const instanceUrl = pathToFileURL(join(candidate, 'apps/launcher/lib/instance.mjs')).href
const instance = await import(instanceUrl)
const fakePid = 912345
let fakeAlive = true
let scanFails = false
let record = null
let verify = false
const signals = []
const roots = Object.fromEntries(['install', 'config', 'data', 'cache', 'logs', 'workspace'].map(k => [k, join(root, 'scope', k)]))
for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 })
const fakeCommand = `node worker --state ${roots.data}`
mock.module('node:child_process', { namedExports: { ...cp, spawnSync(file, args) {
  assert.equal(file, 'ps', 'No process launch or external mutation is allowed')
  if (args[0] === '-axo') return { status: scanFails ? 1 : 0, stdout: scanFails ? '' : `${fakePid} 1\n`, stderr: scanFails ? 'inventory failed' : '' }
  if (args.includes('command=')) return { status: 0, stdout: fakeCommand }
  if (args.includes('stat=')) return { status: 0, stdout: fakeAlive ? 'S' : '' }
  throw Error(`unexpected args ${JSON.stringify(args)}`)
} } })
mock.module(instanceUrl, { namedExports: { ...instance,
  readInstanceRecord: () => record,
  verifyInstance: async () => ({ ok: verify, checks: [], failures: [] }),
  processAlive: async pid => pid === fakePid && fakeAlive,
  processStart: async () => 'new-start',
} })
const originalKill = process.kill
process.kill = (pid, signal) => {
  assert.equal(pid, fakePid, 'Never signal or inspect a real OS PID')
  if (signal === 0) { if (!fakeAlive) throw Object.assign(Error('gone'), { code: 'ESRCH' }); return true }
  signals.push({ pid, signal }); fakeAlive = false; return true
}
const out = []
const reset = () => { fakeAlive = true; signals.length = 0; record = null; verify = false; scanFails = false }
try {
  const { stopRegisteredResources, recoverSwitch } = await import(pathToFileURL(join(candidate, 'apps/launcher/lib/upgrade.mjs')).href)
  const baseRecord = { pid: fakePid + 1, processStart: 'old-start', apiPid: fakePid, apiProcessStart: 'old-start', consolePid: fakePid + 1,
    configRoot: roots.config, state: roots.data, install: roots.install, mode: 'fixture', access: 'local-development' }
  reset()
  const stale = await stopRegisteredResources({ roots, record: baseRecord })
  out.push({ id: 'RECORD_PID_REUSED_SAME_STATE', signals: [...signals], ...stale, expected: 'No signals; UNKNOWN start identity' })
  reset()
  const missing = await stopRegisteredResources({ roots, journalSpawn: { pid: fakePid } })
  out.push({ id: 'JOURNAL_SPAWN_START_MISSING', signals: [...signals], ...missing, expected: 'No signals; UNKNOWN missing spawn identity' })
  reset()
  const reused = await stopRegisteredResources({ roots, spawnedPid: fakePid, spawnedStart: 'old-start' })
  out.push({ id: 'SPAWN_PID_REUSED_EMPTY_PROOF', signals: [...signals], ...reused, expected: 'proven=false' })
  reset(); scanFails = true
  const scanner = await stopRegisteredResources({ roots })
  out.push({ id: 'SCANNER_FAILURE_EMPTY_PROOF', signals: [...signals], ...scanner, expected: 'proven=false; scanner UNKNOWN' })
  reset()
  const manifest = JSON.parse(readFileSync(join(frozen, 'install.json')))
  record = { ...baseRecord, buildId: manifest.buildId, install: join(frozen, 'app'), apiURL: 'http://127.0.0.1:65002' }
  verify = true
  writeFileSync(join(roots.config, 'install-switch.json'), JSON.stringify({ status: 'starting', to: { installDir: frozen }, mode: 'fixture', access: 'local-development' }), { mode: 0o600 })
  const wrong = await recoverSwitch({ installRoot: roots.install, roots })
  out.push({ id: 'RECOVER_WRONG_REQUESTED_INSTALL', result: wrong, journal: JSON.parse(readFileSync(join(roots.config, 'install-switch.json'))).status,
    expected: 'BLOCKED requested_root_mismatch; journal unchanged', installRequested: roots.install, recordedInstall: record.install })
  reset()
  record = { ...baseRecord, buildId: manifest.buildId }
  writeFileSync(join(roots.config, 'install-switch.json'), JSON.stringify({ status: 'target_stop_unproven', to: { installDir: frozen }, mode: 'fixture', access: 'local-development' }), { mode: 0o600 })
  writeFileSync(join(roots.config, 'release.previous.json'), readFileSync(join(frozen, 'var/config/release.json')), { mode: 0o600 })
  const actual = await recoverSwitch({ installRoot: roots.install, roots })
  out.push({ id: 'RECOVER_REUSED_API_RECORD', signals: [...signals], result: actual.status, journal: JSON.parse(readFileSync(join(roots.config, 'install-switch.json'))).status,
    expected: 'No signals; BLOCKED unknown start identity' })
} finally { process.kill = originalKill; mock.restoreAll() }
const rules = {
  RECORD_PID_REUSED_SAME_STATE: value => !value.signals.length && value.proven === false,
  JOURNAL_SPAWN_START_MISSING: value => !value.signals.length && value.proven === false,
  SPAWN_PID_REUSED_EMPTY_PROOF: value => value.proven === false,
  SCANNER_FAILURE_EMPTY_PROOF: value => value.proven === false,
  RECOVER_WRONG_REQUESTED_INSTALL: value => value.result.status !== 'RECOVERED' && value.journal === 'starting',
  RECOVER_REUSED_API_RECORD: value => !value.signals.length && value.result !== 'REVERTED',
}
const cases=out.map(value=>({...value,verdict:rules[value.id](value)?'PASS':'FAIL'}))
const report={source,cases,passed:cases.filter(v=>v.verdict==='PASS').length,failed:cases.filter(v=>v.verdict==='FAIL').length,actualOsScans:0,actualOsSignals:0,realModelTurns:0,nativeTurnStarts:0,scope:'pure mocked inventory and signals; own temporary roots; frozen input readonly'}
const output=process.env.PA_ADMISSION_REPORT?resolve(process.env.PA_ADMISSION_REPORT):join(resolve(dirname(fileURLToPath(import.meta.url)),'../..'),'reports/releases/wave13-admission/delivery.json')
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));rmSync(root,{recursive:true,force:true});process.exitCode=report.failed?1:0
