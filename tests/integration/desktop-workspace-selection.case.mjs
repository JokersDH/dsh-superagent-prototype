import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

const wrapper = readFileSync(new URL('../../tools/bootstrap/personal-preview-launcher.mjs', import.meta.url), 'utf8')
const swift = readFileSync(new URL('../../tools/bootstrap/macos-app/Launcher.swift', import.meta.url), 'utf8')
const sha = value => createHash('sha256').update(value).digest('hex')

function fixture(t, { receiverSource = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pa-desktop-selection-')), engine = join(root, 'engine'), home = join(root, 'home')
  for (const path of [engine, home, join(engine, 'runtime'), join(engine, 'runtime/bin'), join(engine, 'install'), join(engine, 'install/bin')])
    mkdirSync(path, { mode: 0o700 })
  const calls = join(root, 'cli-calls.jsonl'), runner = join(engine, 'personal-preview-launcher.mjs')
  const fakeNode = Buffer.from('private fixture runtime identity'), license = Buffer.from('fixture license')
  const install = Buffer.from(JSON.stringify({ buildId: '1234567890abcdef', source: { commit: 'a'.repeat(40) } }))
  writeFileSync(join(engine, 'runtime/bin/node'), fakeNode, { mode: 0o700 })
  writeFileSync(join(engine, 'runtime/LICENSE'), license)
  writeFileSync(join(engine, 'install/install.json'), install)
  writeFileSync(join(engine, 'preview-manifest.json'), JSON.stringify({
    protocol: 'personal-agent-preview/1', launcherProtocol: 'personal-agent-preview-launcher/1',
    inner: { buildId: '1234567890abcdef', source: 'a'.repeat(40), installManifestSha256: sha(install) },
    runtime: { version: process.versions.node, abi: process.versions.modules, sha256: sha(fakeNode), licenseSha256: sha(license) },
  }))
  writeFileSync(runner, wrapper)
  const appRoot = join(engine, 'install/app'), lib = join(appRoot, 'apps/launcher/lib')
  mkdirSync(lib, { recursive: true, mode: 0o700 }); writeFileSync(join(appRoot, 'package.json'), '{"type":"module"}')
  const receiverHelper = new URL('../../apps/launcher/lib/inspected-startup.mjs', import.meta.url)
  if (existsSync(receiverHelper)) {
    writeFileSync(join(lib, 'inspected-startup.mjs'), readFileSync(receiverHelper))
    writeFileSync(join(lib, 'recovery.mjs'), readFileSync(new URL('../../apps/launcher/lib/recovery.mjs', import.meta.url)))
  }
  if (receiverSource !== null) {
    const product = join(appRoot, 'apps/coordinator/product'); mkdirSync(product, { recursive: true })
    writeFileSync(join(product, 'inspected-startup.ts'), receiverSource)
  }
  const cli = '#!' + process.execPath + '\n' +
    'const fs=require("node:fs");const args=process.argv.slice(2);' +
    'fs.appendFileSync(' + JSON.stringify(calls) + ',JSON.stringify({args,data:process.env.PA_DATA_ROOT,config:process.env.PA_CONFIG_ROOT,target:process.env.PA_TARGET_DATA_ROOT})+"\\n");' +
    'if(args[0]==="first-run"){console.log(JSON.stringify({status:"OK"}));process.exit(0)}' +
    'if(args[0]==="status"){console.log(JSON.stringify({status:"STOPPED"}));process.exit(2)}' +
    'if(args[0]==="doctor"){console.log(JSON.stringify({status:"DEGRADED",checks:[{id:"executor_codex",status:"WARN",detail:{available:false,authPresent:false,version:"codex-cli unknown"}}]}));process.exit(1)}' +
    'console.log(JSON.stringify({status:"BLOCKED",code:"fixture_original_start_authorization_required"}));process.exit(2);\n'
  writeFileSync(join(engine, 'install/bin/pa'), cli, { mode: 0o700 })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = (target, args = ['start', '--discussion-only', '--port', '62011', '--api-port', '62012']) => spawnSync(process.execPath, [runner, ...args], {
    cwd: engine, env: { ...process.env, HOME: home, PA_DESKTOP_APP: '1', PA_TARGET_DATA_ROOT: target,
      PA_MODEL_CONFIG: join(root, 'never-saved-model.json') }, encoding: 'utf8', timeout: 5000,
  })
  const callsRead = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
  return { root, engine, home, run, callsRead }
}
const supported = process.platform === 'darwin' && process.arch === 'arm64'

test('actual wrapper refuses a private directory without prepared target material before any CLI call', { skip: !supported }, t => {
  const h = fixture(t), target = join(h.root, 'existing private target')
  mkdirSync(target, { mode: 0o700 }); writeFileSync(join(target, 'keep.txt'), 'unchanged')
  const before = readdirSync(target)
  const result = h.run(target)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /recovery|恢复来源|已准备/u)
  assert.deepEqual(h.callsRead(), [])
  assert.deepEqual(readdirSync(target), before)
  assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'unchanged')
})

test('actual wrapper forwards selected prepared target to original start, whose refusal remains a refusal', { skip: !supported }, t => {
  const h = fixture(t), target = join(h.root, 'prepared target with spaces')
  mkdirSync(target, { mode: 0o700 })
  writeFileSync(join(target, 'recovery-target.json'), '{"fixture":"not-an-execution-grant"}', { mode: 0o600 })
  writeFileSync(join(target, 'state.sqlite'), 'fixture bytes retained', { mode: 0o600 })
  const before = readdirSync(target), original = readFileSync(join(target, 'state.sqlite'))
  const result = h.run(target), calls = h.callsRead()
  assert.equal(result.status, 2)
  assert.match(result.stdout, /fixture_original_start_authorization_required/)
  assert.deepEqual(calls.map(call => call.args[0]), ['first-run', 'status', 'start'])
  assert.ok(calls.every(call => call.data === target && call.target === target))
  assert.equal(calls[2].args.includes('--discussion-only'), true)
  assert.deepEqual(readdirSync(target), before)
  assert.deepEqual(readFileSync(join(target, 'state.sqlite')), original)
})

test('actual wrapper never follows a selected root or marker symlink', { skip: !supported }, t => {
  const h = fixture(t), target = join(h.root, 'target'), alias = join(h.root, 'alias')
  mkdirSync(target, { mode: 0o700 }); symlinkSync(target, alias, 'dir')
  assert.equal(h.run(alias).status, 1)
  const borrowed = join(h.root, 'borrowed.json'); writeFileSync(borrowed, '{}', { mode: 0o600 })
  symlinkSync(borrowed, join(target, 'recovery-target.json'))
  assert.equal(h.run(target).status, 1)
  assert.deepEqual(h.callsRead(), [])
  assert.equal(readFileSync(borrowed, 'utf8'), '{}')
})

test('actual wrapper can forward a restored readonly source and preserves its restore marker', { skip: !supported }, t => {
  const h = fixture(t, { receiverSource: "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='inspected-native-startup/1'; export function prepareInspectedPersonalStartup(){}" })
  const target = join(h.root, 'restored source'); mkdirSync(target, { mode: 0o700 })
  const marker = join(target, 'restore-report.json'), body = '{"protocol":"personal-restore/1","fixture":"readonly source"}'
  writeFileSync(marker, body, { mode: 0o600 })
  const result = h.run(target, ['start', '--port', '62011', '--api-port', '62012'])
  assert.equal(result.status, 2)
  const calls = h.callsRead(), start = calls.find(call => call.args[0] === 'start')
  assert.ok(start)
  assert.equal(start.data, target)
  assert.equal(start.args.includes('--discussion-only'), true, 'the normal inspected receiver never overrides the original recovery-readonly entry')
  assert.deepEqual(readdirSync(target), ['restore-report.json'])
  assert.equal(readFileSync(marker, 'utf8'), body)
})

test('actual wrapper reaches the blocked-capable receiver without silently adding operator-disabled mode', { skip: !supported }, t => {
  const h = fixture(t, { receiverSource: "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='inspected-native-startup/1'; export function prepareInspectedPersonalStartup(){ throw new Error('feature detection must not invoke native startup') }" })
  const target = join(h.root, 'prepared receiver target'); mkdirSync(target, { mode: 0o700 })
  writeFileSync(join(target, 'recovery-target.json'), '{}', { mode: 0o600 })
  const result = h.run(target, ['start', '--port', '62011', '--api-port', '62012'])
  assert.equal(result.status, 2)
  const starts = h.callsRead().filter(call => call.args[0] === 'start')
  assert.equal(starts.length, 1)
  assert.equal(starts[0].args.includes('--discussion-only'), false, 'backend must own its probe/receipt gate, not operator_disabled')
  assert.match(result.stdout, /fixture_original_start_authorization_required/)
})

test('legacy or wrong receiver marker preserves discussion fallback while explicit discussion-only stays explicit', { skip: !supported }, t => {
  for (const receiverSource of [null, "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='other/1'; export function prepareInspectedPersonalStartup(){}", "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='inspected-native-startup/1'; export const prepareInspectedPersonalStartup=true"]) {
    const h = fixture(t, { receiverSource }), target = join(h.root, 'legacy target'); mkdirSync(target, { mode: 0o700 })
    writeFileSync(join(target, 'recovery-target.json'), '{}', { mode: 0o600 })
    const result = h.run(target, ['start', '--port', '62011', '--api-port', '62012'])
    assert.equal(result.status, 2)
    const start = h.callsRead().find(call => call.args[0] === 'start')
    assert.equal(start.args.includes('--discussion-only'), true)
  }
  const h = fixture(t, { receiverSource: "export const INSPECTED_NATIVE_STARTUP_PROTOCOL='inspected-native-startup/1'; export function prepareInspectedPersonalStartup(){}" })
  const target = join(h.root, 'explicit target'); mkdirSync(target, { mode: 0o700 }); writeFileSync(join(target, 'recovery-target.json'), '{}', { mode: 0o600 })
  h.run(target)
  assert.equal(h.callsRead().find(call => call.args[0] === 'start').args.includes('--discussion-only'), true)
})

test('actual Swift workspace state rejects stale callbacks, concurrent switches and unconfirmed stops', { skip: !supported, timeout: 60000 }, t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-desktop-swift-state-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const assertions = `
func demand(_ condition: @autoclosure () -> Bool, _ label: String) {
    if !condition() { fatalError(label) }
}
var first = DesktopWorkspaceSession()
let a = first.beginLaunch()!
demand(!first.canSelectWorkspace, "starting service blocks selecting a workspace")
demand(first.beginStop() == nil, "cannot issue a parallel stop before startup resolves")
let old = URL(string: "http://127.0.0.1:62111")!
demand(first.consume("Workbench: http://127.0.0.1:62111\\n", generation: a) == old, "current output is parsed")
demand(first.markReady(old, generation: a), "current original status verified")
demand(!first.canSelectWorkspace, "a ready reused service blocks selection even if short launcher exited")
let stopped = first.beginStop()!
demand(!first.canSelectWorkspace, "stop is pending")
demand(first.consume("Workbench: http://127.0.0.1:62112\\n", generation: a) == nil, "old launch callback cannot alter stop")
demand(!first.completeStop(generation: stopped, confirmed: false), "unknown stop not confirmed")
demand(first.workbench == old && !first.canSelectWorkspace, "unknown retains old selection and URL but never switches")
let retry = first.beginStop()!
demand(first.completeStop(generation: retry, confirmed: true), "original successful normal stop")
demand(first.canSelectWorkspace, "selection allowed only after confirmed stop")
let b = first.beginLaunch()!
demand(b != a && first.output.isEmpty, "per-launch output is cleared")
demand(first.consume("Workbench: http://127.0.0.1:62111\\n", generation: a) == nil, "queued old callbacks ignored after new launch")
demand(first.consume("Workbench: http://127.0.0.1:621", generation: b) == nil, "partial stdout line cannot trigger early URL validation")
let current = first.consume("14\\n", generation: b)
demand(current?.port == 62114, "complete stdout line resumes after split port")
let newest = first.consume("Workbench: http://127.0.0.1:62115\\n", generation: b)
demand(newest?.port == 62115, "latest current-launch entry replaces first-match accumulation")
demand(!first.markReady(old, generation: a), "old verification cannot enable new root")
first.markUnknown(generation: a)
demand(first.phase == .starting, "old failure callback cannot invalidate current launch")
let expected = URL(fileURLWithPath: "/private/fixture/current")
func status(_ root: String, _ console: String, _ state: String = "RUNNING", _ ok: Bool = true) -> Data {
    return try! JSONSerialization.data(withJSONObject: ["status": state, "roots": ["data": root],
        "instance": ["state": root, "consoleURL": console], "checks": [["id": "original", "ok": ok]]])
}
demand(desktopVerifiedWorkbench(status(expected.path, current!.absoluteString), expectedRoot: expected, candidate: current) == current, "URL bound to current root and original verified status")
demand(desktopVerifiedWorkbench(status("/private/fixture/other", current!.absoluteString), expectedRoot: expected, candidate: current) == nil, "wrong selected root rejected")
demand(desktopVerifiedWorkbench(status(expected.path, old.absoluteString), expectedRoot: expected, candidate: current) == nil, "old URL from another launch rejected")
demand(desktopVerifiedWorkbench(status(expected.path, current!.absoluteString, "UNVERIFIED"), expectedRoot: expected, candidate: current) == nil, "unknown status rejected")
demand(desktopVerifiedWorkbench(status(expected.path, current!.absoluteString, "RUNNING", false), expectedRoot: expected, candidate: current) == nil, "failed original checks rejected")
let stopPass = Data("{\\"ok\\":true,\\"status\\":\\"STOPPED\\"}".utf8)
let stopUnknown = Data("{\\"ok\\":false,\\"status\\":\\"UNKNOWN\\"}".utf8)
demand(desktopConfirmedStop(stopPass, exitStatus: 0), "original STOPPED accepted")
demand(!desktopConfirmedStop(stopUnknown, exitStatus: 0), "exit zero alone never clears unknown")
demand(!desktopConfirmedStop(stopPass, exitStatus: 1), "nonzero stop never accepted")
func stopBody(_ patch: [String: Any]) -> Data {
    var body: [String: Any] = ["ok": true, "status": "STOPPED"]
    patch.forEach { body[$0.key] = $0.value }
    return try! JSONSerialization.data(withJSONObject: body)
}
demand(!desktopConfirmedStop(stopBody(["stillAlive": true]), exitStatus: 0), "claimed STOPPED with live resources is unknown")
demand(!desktopConfirmedStop(stopBody(["stopped": false]), exitStatus: 0), "claimed STOPPED with stopped false is unknown")
demand(!desktopConfirmedStop(stopBody(["stillAlive": "false"]), exitStatus: 0), "string liveness cannot stand in for false")
demand(!desktopConfirmedStop(stopBody(["stillAlive": 0]), exitStatus: 0), "numeric zero is not a boolean liveness observation")
demand(!desktopConfirmedStop(stopBody(["stopped": 1]), exitStatus: 0), "numeric one is not a boolean stop proof")
demand(!desktopConfirmedStop(stopBody(["stopped": NSNull()]), exitStatus: 0), "null stop observation is unknown")
demand(!desktopConfirmedStop(stopBody(["instanceRecordRemoved": false]), exitStatus: 0), "unremoved record does not permit switching roots")
demand(desktopConfirmedStop(stopBody(["stopped": true, "stillAlive": false]), exitStatus: 0), "ordinary confirmed stop remains accepted")
demand(!desktopConfirmedStop(stopBody(["status": "STOPPED_ORPHAN"]), exitStatus: 0), "orphan response needs its original resource proof booleans")
demand(desktopConfirmedStop(stopBody(["status": "STOPPED_ORPHAN", "stopped": true, "stillAlive": false, "instanceRecordRemoved": true]), exitStatus: 0), "original confirmed orphan stop accepted")
demand(!desktopConfirmedStop(stopBody(["status": "STALE_RECORD_CLEANED", "instanceRecordRemoved": "true"]), exitStatus: 0), "stale cleanup with non-boolean removal stays unknown")
demand(desktopConfirmedStop(stopBody(["status": "STALE_RECORD_CLEANED", "instanceRecordRemoved": true]), exitStatus: 0), "original positive stale cleanup accepted")
print("PASS actual desktop workspace session and original status/stop decisions")
`
  const file = join(root, 'WorkspaceSelection.swift'), binary = join(root, 'workspace-test')
  writeFileSync(file, swift + '\n' + assertions)
  const build = spawnSync('xcrun', ['swiftc', '-D', 'DESKTOP_WORKSPACE_SELECTION_TESTS', file, '-o', binary], { encoding: 'utf8', timeout: 45000 })
  assert.equal(build.status, 0, build.stderr)
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PASS actual desktop workspace session/)
})
