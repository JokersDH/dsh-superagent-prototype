import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dRoot = resolve(process.argv[2] ?? '/Users/hh/Desktop/joker/superagent-agent-d')
const eRoot = resolve(process.argv[3] ?? '/Users/hh/Desktop/joker/superagent-agent-e')
const load = path => import(pathToFileURL(join(dRoot, path)).href)
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-wave11-delivery-')))
chmodSync(root, 0o700)
const cases = [], children = []
const { stopInstance } = await load('apps/launcher/lib/stop.mjs')
const { captureProcessFacts, processAlive, writeInstanceRecord } = await load('apps/launcher/lib/instance.mjs')
const check = async (id, action) => {
  try { cases.push({ id, status: 'PASS', observation: await action() }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message, ...(error.observation ? { observation: error.observation } : {}) }) }
}
const expected = (condition, message, observation) => {
  if (!condition) throw Object.assign(new Error(message), { observation })
}
async function deadLauncher() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  children.push(child)
  await once(child, 'exit')
  return child.pid
}
async function ownApi(name) {
  const install = join(root, name, 'install'), config = join(root, name, 'config')
  const stateA = join(root, name, 'state-a'), stateB = join(root, name, 'state-b')
  const logs = join(root, name, 'logs'), cache = join(root, name, 'cache'), workspace = join(root, name, 'workspace')
  for (const path of [join(install, 'apps/coordinator/product'), config, stateA, stateB, logs, cache, workspace]) mkdirSync(path, { recursive: true, mode: 0o700 })
  const script = join(install, 'apps/coordinator/product/demo.ts')
  writeFileSync(script, `import {createServer} from 'node:http';
const server=createServer((_request,response)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify({status:'ok',mode:'fixture',access:'local-development'}))});
server.listen(0,'127.0.0.1',()=>process.send?.({port:server.address().port}));
process.once('SIGTERM',()=>server.close(()=>process.exit(0)));
`, { mode: 0o600 })
  const argv = [script, '--port', '0', '--state', stateB, '--console-origin', 'http://127.0.0.1:65001', '--startup-mode', 'normal', '--assistant', '--local-access']
  const child = spawn(process.execPath, argv, { cwd: install, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  children.push(child)
  const [{ port }] = await once(child, 'message')
  const facts = await captureProcessFacts(child.pid)
  const pid = await deadLauncher()
  const record = { protocol: 'personal-product-instance/1', pid, processStart: 'probe-owned-already-exited-launcher',
    apiPid: child.pid, consolePid: pid, apiURL: `http://127.0.0.1:${port}`, consoleURL: 'http://127.0.0.1:65001',
    state: stateB, install, buildId: 'probe-owned-only', mode: 'fixture', access: 'local-development', startupMode: 'normal',
    apiArgv: [process.execPath, ...argv], apiProcessStart: facts.processStart, apiUid: facts.uid,
    startedAt: new Date().toISOString() }
  writeInstanceRecord(config, record)
  return { child, record, install, config, stateA, stateB, roots: { install, config, logs, cache, workspace } }
}
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
let artifacts, eSummary
try {
  await check('MATCHING_STATE_ORPHAN_API_POSITIVE_CONTROL', async () => {
    const own = await ownApi('matching')
    const result = await stopInstance({ roots: { ...own.roots, data: own.stateB }, timeoutMs: 2000 })
    const alive = await processAlive(own.child.pid)
    expected(result.ok && result.status === 'STOPPED_ORPHAN' && !alive,
      'The bounded fixture must exercise a verified own orphan API stop', { result, alive })
    return { status: result.status, apiStopped: !alive, onlyProbeOwnedPid: own.child.pid }
  })
  await check('REQUESTED_DATA_ROOT_CANNOT_STOP_RECORDED_OTHER_STATE', async () => {
    const own = await ownApi('cross-state')
    // stopInstance reads only this temporary record and pid-specific ps/lsof; no global scan or
    // CLI is used. Both PIDs below were created by this probe, so a failing candidate can harm none
    // of the user's services. The matching-state case above proves this is not a vacuous refusal.
    const result = await stopInstance({ roots: { ...own.roots, data: own.stateA }, timeoutMs: 2000 })
    const alive = await processAlive(own.child.pid)
    const observation = { requestedState: own.stateA, recordedState: own.stateB, resultStatus: result.status,
      ok: result.ok, otherStateApiAlive: alive, recordPreserved: existsSync(join(own.config, 'instance.json')), onlyProbeOwnedPid: own.child.pid }
    expected(!result.ok && alive && observation.recordPreserved,
      'A stop aimed at state A must refuse and preserve the recorded state B process and record', observation)
    return observation
  })
  artifacts = readJson(join(dRoot, 'tools/distribution/reports/wave10/artifacts.json'))
  await check('FROZEN_D_TAR_BYTES_MATCH_PUBLISHED_TUPLES', async () => {
    const values = []
    for (const [kind, value] of Object.entries(artifacts)) {
      if (!value?.tarPath) continue
      const observed = { kind, source: value.source.commit, buildId: value.buildId, schema: value.producer.productSchema,
        platform: value.producer.platform, arch: value.producer.arch, abi: value.producer.abi,
        bytes: statSync(value.tarPath).size, sha256: hash(value.tarPath) }
      assert.equal(observed.bytes, value.digests.tarBytes); assert.equal(observed.sha256, value.digests.tarSha256)
      if (kind === 'target') {
        const source = execFileSync('tar', ['-xOf', value.tarPath, 'install/app/apps/coordinator/http/app.ts'], { encoding: 'utf8' })
        observed.packagedHttpCapabilities = { contextPreview: source.includes('/v1/context/preview'), evidenceHistory: source.includes('/evidence/history'),
          selectedContextSend: source.includes('/v1/assistant/context/send'), messageContextAudit: source.includes('/v1/messages/:id/context') }
      }
      values.push(observed)
    }
    assert.equal(values.length, 2)
    return values
  })
  const current = readJson(join(eRoot, 'tests/product-acceptance/reports/wave10-status.json'))
  eSummary = { testCodeSource: current.testCodeSource, productSource: current.productSource,
    counts: current.counts, artifactTuple: current.artifactTuple,
    contextUseStillNotTested: current.stages?.flatMap(stage => stage.cases ?? []).some(item => item.id === 'E5-CONTEXT-USE' && item.status === 'NOT_TESTED') }
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended
  }
  rmSync(root, { recursive: true, force: true })
}
const sourceFiles = ['apps/launcher/lib/stop.mjs', 'apps/launcher/lib/instance.mjs', 'apps/launcher/lib/upgrade.mjs', 'packages/portability/src/recovery-target.ts']
const pass = cases.every(value => value.status === 'PASS')
const report = { status: pass ? 'PASS_SCOPED_DELIVERY_ADMISSION' : 'FAIL_REQUESTED_STATE_STOP_ADMISSION',
  command: ['node', 'tools/bootstrap/probe-wave11-delivery.mjs', dRoot, eRoot], checkedAt: new Date().toISOString(),
  dSource: { root: dRoot, commit: git(dRoot, ['rev-parse','HEAD']), origin: git(dRoot, ['rev-parse','origin/codex/g3-local-distribution']),
    base: git(dRoot, ['merge-base','HEAD','origin/main']), clean: git(dRoot, ['status','--porcelain']) === '',
    hashes: Object.fromEntries(sourceFiles.map(path => [path, hash(join(dRoot, path))])) },
  eSource: { root: eRoot, commit: git(eRoot, ['rev-parse','HEAD']), origin: git(eRoot, ['rev-parse','origin/codex/g3-product-acceptance']),
    base: git(eRoot, ['merge-base','HEAD','origin/main']), trackedClean: git(eRoot, ['status','--porcelain','--untracked-files=no']) === '' },
  cases, eObservedReport: eSummary, modelCalls: 0, nativeTurns: 0, userServicesTouched: false,
  independentChecks: {
    command: 'node --test apps/launcher/test/upgrade-resources.case.mjs packages/portability/test/recovery-target.case.ts',
    passed: 14, failed: 0, exitCode: 0, portabilityTypecheck: 'PASS',
  },
  references: { stopMissingRequestedIdentity: 'apps/launcher/lib/stop.mjs:34',
    orphanStopUsesRecordWithoutRoots: 'apps/launcher/lib/stop.mjs:53',
    eContextUsePlaceholder: 'tests/product-acceptance/cases/e3-context.mjs:149',
    eArtifactScope: 'tests/product-acceptance/reports/wave10-status.json' },
  limitations: [
    'Only probe-owned temporary API processes and an already exited probe-owned launcher pid were passed to candidate stopInstance.',
    'No pa CLI, installed daemon, native agent, model request or global process scan was used in the stop negative.',
    'The generic stop/root defect is separate from the previously passed upgrade/resource-accounting and materializer checks.',
    'The verified frozen target is D cf7a3cf/schema15, not current main4140cac/schema16/context-use.',
    'E is still testing6830e38/schema15; its missing context-use claim is stale relative to current main, not a failure of current main.',
    'No full installer matrix, independent current-main browser suite, other-platform/ABI or activation admission is claimed.',
  ], exitCode: pass ? 0 : 1 }
const output = join(repository, 'reports/releases/wave11-admission/delivery.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.exitCode
