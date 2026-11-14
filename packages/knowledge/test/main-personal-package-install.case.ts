import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createBundle, restoreBundle } from '../../../packages/portability/src/index.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { buildPersonalChain, projectId } from './helpers/personal-chain.ts'

import { fileURLToPath } from 'node:url'
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const packageTar = process.env.PA_WAVE24_PACKAGE ??
  '/Users/hh/Desktop/joker/pa-artifacts/wave23-target/wave23-target-0ede11d.tar.gz'
const expectedTarSha = 'd039889767cb63902ed5e00d02547c441aa2313ce79555d90747e9a0b1fabf21'
const expectedSource = '0ede11d0a46f377e90657c78b001357c98d4f5e7'

async function availablePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 120000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Package check timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 100))
  }
}

test('the exact frozen package truly starts, reuses and stops through the single descriptor', { timeout: 600000 }, async (t) => {
  if (!existsSync(packageTar)) {
    t.diagnostic(`NOT_REACHED: exact package missing at ${packageTar}`)
    return
  }
  assert.equal(createHash('sha256').update(readFileSync(packageTar)).digest('hex'), expectedTarSha)
  const root = mkdtempSync(join(tmpdir(), 'pa-wave24-package-'))
  const install = join(root, 'install')
  const chain = await buildPersonalChain(root)
  const staging = join(root, 'staging')
  const restoreViaBundle = async (snapshot: { destination: string }, target: string) => {
    mkdirSync(staging, { recursive: true, mode: 0o700 })
    const stage = join(root, `stage-${target.split('/').at(-1)}`)
    mkdirSync(stage, { recursive: true, mode: 0o700 })
    copyFileSync(join(snapshot.destination, 'product.sqlite'), join(stage, 'state.sqlite'))
    execFileSync('chmod', ['600', join(stage, 'state.sqlite')])
    cpSync(join(snapshot.destination, 'artifacts'), join(stage, 'artifacts'), { recursive: true })
    const bundle = join(root, `${target.split('/').at(-1)}.pa-backup`)
    await createBundle({ stateDir: stage, outputPath: bundle, stagingRoot: staging })
    return restoreBundle({ bundlePath: bundle, targetStateDir: target, stagingRoot: staging })
  }
  const restored = join(root, 'restored')
  await restoreViaBundle(chain.v1, restored)
  const restoredV2 = join(root, 'restored-v2')
  await restoreViaBundle(chain.v2, restoredV2)
  const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
  const aModule = join(aWorktree, 'packages/workflows/src/data-manifest.ts')
  const aHead = execFileSync('git', ['-C', aWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const expectation = join(root, 'expectation.json')
  writeFileSync(expectation, JSON.stringify({ sourceSha: aHead, snapshotFormat: 1, dataRoot: chain.source,
    ticketId: chain.ticketId, assignmentId: chain.assignmentId, attemptId: chain.attemptId, fenceEpoch: chain.fenceEpoch,
    contract: chain.contract, questionId: chain.question.id, answerId: chain.answerId,
    requiredCommandIds: ['w22-work', 'w22-answer'], requiredDispatch: [chain.dispatchWindows.written, chain.dispatchWindows.unknown],
    requiredDeliveryTargets: [chain.deliveryTargetId] }, null, 2))
  const expectationV2 = join(root, 'expectation-v2.json')
  writeFileSync(expectationV2, JSON.stringify({ ...JSON.parse(readFileSync(expectation, 'utf8')), snapshotFormat: 2 }, null, 2))
  const manifestOutput = join(root, 'manifest.json')
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  execFileSync('mkdir', ['-p', install])
  execFileSync('tar', ['-xzf', packageTar, '-C', install])
  const installRoot = join(install, 'install')
  const app = join(installRoot, 'app')
  const pa = join(app, 'apps/launcher/bin/pa.mjs')
  assert.equal(JSON.parse(readFileSync(join(installRoot, 'install.json'), 'utf8')).source.commit, expectedSource)
  assert.equal(statSync(pa).isFile(), true)
  const roots = {
    config: join(installRoot, 'var/config'), data: join(installRoot, 'var/data'), cache: join(installRoot, 'var/cache'),
    logs: join(installRoot, 'var/logs'), workspace: join(installRoot, 'var/workspaces'),
  }
  const env = { ...process.env, PA_MODEL_CONFIG: chain.model.file }
  const parseJson = (text: string): Record<string, any> => {
    const trimmed = text.trim()
    try { return JSON.parse(trimmed) } catch { /* find the first object */ }
    const start = trimmed.indexOf('{')
    if (start < 0) throw new Error(`No JSON in pa output: ${trimmed.slice(-500)}`)
    return JSON.parse(trimmed.slice(start))
  }
  const paRaw = (args: string[], timeout = 120000) => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [pa, ...args,
        '--install', app, '--config-root', roots.config, '--cache-root', roots.cache,
        '--logs-root', roots.logs, '--workspace-root', roots.workspace], { encoding: 'utf8', timeout, env }) }
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string }
      return { code: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '') }
    }
  }
  const paCall = (args: string[], timeout = 120000) => {
    const result = paRaw(args, timeout)
    if (!result.stdout) throw new Error(`pa ${args[0]} produced no JSON: ${result.stderr}`)
    return parseJson(result.stdout)
  }
  const firstRun = paCall(['first-run', '--json'])
  assert.equal(firstRun.status, 'OK', JSON.stringify(firstRun))
  assert.equal(paCall(['status', '--json']).status, 'STOPPED')

  const driver = new URL('../../context/tools/personal-review-driver.mjs', import.meta.url).pathname
  const driverCall = (extra: string[], ports: { console: number; api: number }, stateRoot = restored, format = 'v1', manifestExpectation = expectation) => {
    const stdout = execFileSync(process.execPath, [driver,
      '--dialect', 'package', '--pa-entry', pa, '--install', app, '--state', stateRoot, '--project', projectId,
      '--allow-path', 'src/', '--console-port', String(ports.console), '--api-port', String(ports.api),
      '--model-config', chain.model.file, '--config-root', roots.config,
      '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
      '--format', format, '--a-worktree', aWorktree, '--a-module', aModule, '--manifest-db', join(chain.source, 'state.sqlite'),
      '--manifest-expectation', manifestExpectation, '--manifest-output', manifestOutput, '--root-map', `${chain.source}=${stateRoot}`,
      '--replay-context-token', chain.contextToken, '--replay-confirm-token', chain.confirmToken,
      ...extra], { encoding: 'utf8', timeout: 300000 })
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
  }

  // Real package start + read-only flow + verified stop through the same executed descriptor.
  const ports = { console: await availablePort(), api: await availablePort() }
  const first = driverCall([], ports)
  assert.equal(first.status, 'verified-flow', JSON.stringify(first.failure))
  assert.equal(first.verified, true)
  assert.equal(first.dialect, 'package')
  assert.equal(first.sourceOnly, false)
  assert.equal(first.descriptor.entry, pa)
  assert.equal(first.entries.review.sha256, first.descriptor.sha256)
  assert.equal(first.identity.bound, true)
  assert.equal(typeof first.identity.recordPid, 'number')
  assert.equal(typeof first.identity.instanceProcessStart, 'string')
  assert.equal(typeof first.identity.instanceApiPid, 'number')
  assert.equal(first.identity.actualHealthDigest, first.identity.requestedDigest)
  assert.equal(first.data.sources?.state, 'verified')
  assert.equal(first.data.work?.phase, 'delivered')
  assert.deepEqual(first.data.delivery?.statuses, ['native_applied'])
  assert.equal(first.data.chat, 422)
  assert.equal(first.data.candidatePrepare, 422)
  assert.equal(first.data.replay?.contextToken, 422)
  assert.equal(first.data.replay?.confirmToken, 422)
  assert.equal(first.data.manifest?.protocol, 'wave24-data-manifest/1')
  assert.equal(first.data.manifest?.subject.contract.workId, chain.workId)
  assert.equal(first.data.manifest?.question.id, chain.question.id)
  assert.equal(first.data.manifest?.answer.id, chain.answerId)
  assert.deepEqual(first.data.manifest?.coverage, { commands: 'complete', dispatch: 'complete', observations: 'complete', deliveries: 'complete', payloads: 'complete' })
  assert.equal(first.data.manifest?.roots.from, realpathSync(chain.source))
  assert.equal(first.data.manifest?.roots.to, realpathSync(restored))
  assert.equal(first.data.work?.id, chain.workId)
  assert.equal(first.data.targetProof?.subjectMatches, true)
  assert.equal(first.data.targetProof?.fingerprintRelation, 'exact')
  assert.equal(first.data.targetProof?.artifacts?.total > 0, true)
  assert.equal(first.cleanup.owned, true)
  assert.equal(first.cleanup.stopped, true)
  assert.equal(first.cleanup.detail, 'pa-stop-verified')
  assert.equal(paCall(['status', '--json']).status, 'STOPPED')
  // The same exact package consumes the second real restore of the explicit v2 snapshot.
  const v2Ports = { console: await availablePort(), api: await availablePort() }
  const v2 = driverCall([], v2Ports, restoredV2, 'v2', expectationV2)
  assert.equal(v2.status, 'verified-flow', JSON.stringify(v2.failure))
  assert.equal(v2.verified, true)
  assert.equal(v2.identity.bound, true)
  assert.equal(v2.data.manifest?.roots.to, realpathSync(restoredV2))
  assert.equal(v2.data.manifest?.subject.snapshotFormat, 2)
  assert.equal(v2.data.sources?.state, 'verified')
  assert.equal(v2.data.work?.phase, 'delivered')
  assert.deepEqual(v2.data.delivery?.statuses, ['native_applied'])
  assert.equal(v2.data.replay?.contextToken, 422)
  assert.equal(paCall(['status', '--json', '--state', restoredV2]).status, 'STOPPED')

  // A legal narrow selection on the same package keeps the original body gate and explains withholding.
  const narrowFile = join(root, 'package-narrow.json')
  paCall(['review-restored', '--json', '--state', restored, '--project', projectId, '--allow-path', 'src/narrow/', '--out', narrowFile])
  const narrow = driverCall(['--review-file', narrowFile, '--expect-source-state', 'scope_changed', '--expect-candidates', 'none',
    '--expect-reason', 'selection_narrowed'], { console: await availablePort(), api: await availablePort() })
  assert.equal(narrow.status, 'verified-flow', JSON.stringify(narrow.failure))
  assert.equal(narrow.verified, true)
  assert.equal(narrow.data.sources?.state, 'scope_changed')
  assert.equal(narrow.data.sources?.diagnostic?.partial, true)
  assert.ok((narrow.data.sources?.diagnostic?.withheldSourceCount ?? 0) > 0)
  assert.ok((narrow.data.sources?.diagnostic?.withheldSourceCount ?? 0) <= 64)
  assert.ok((narrow.data.sources?.diagnostic?.reasons ?? []).includes('selection_narrowed'))
  assert.equal(narrow.data.candidatePrepare, undefined)
  assert.equal(narrow.data.chat, 422)
  assert.equal(narrow.data.replay?.contextToken, 422)
  assert.equal(paCall(['status', '--json', '--state', restored]).status, 'STOPPED')

  // A target-only legal user message changes the subject even though the root path mapping matches.
  const driftRoot = join(root, 'restored-drift')
  mkdirSync(driftRoot, { recursive: true, mode: 0o700 })
  cpSync(restored, driftRoot, { recursive: true })
  writeFileSync(join(driftRoot, 'restore-report.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(driftRoot, 'restore-report.json'), 'utf8')), targetPath: driftRoot }), { mode: 0o600 })
  const driftStore = new ProductStore({ path: join(driftRoot, 'state.sqlite') })
  try {
    driftStore.product.messages.append({ id: 'drift-user-message', projectId, conversationId: 'wave22-conversation', role: 'user',
      provenance: 'trusted_user', text: '合法但不在原 subject 中的消息', sourceRefs: [], createdAt: new Date().toISOString() })
  } finally { driftStore.close() }
  const driftDriver = async (stateRoot: string) => {
    try {
      execFileSync(process.execPath, [driver, '--dialect', 'source', '--install', repoRoot, '--state', stateRoot, '--project', projectId,
        '--allow-path', 'src/', '--console-port', String(await availablePort()), '--api-port', String(await availablePort()),
        '--model-config', chain.model.file,
        '--a-worktree', aWorktree, '--a-module', aModule, '--manifest-db', join(chain.source, 'state.sqlite'),
        '--manifest-expectation', expectation, '--manifest-output', join(root, 'drift-manifest.json'),
        '--root-map', `${chain.source}=${stateRoot}`], { encoding: 'utf8', timeout: 120000 })
      return null
    } catch (error) {
      const stdout = String((error as { stdout?: string }).stdout ?? '').trim().split('\n').at(-1)
      return JSON.parse(stdout ?? '{}')
    }
  }
  // 1) extra legal message
  const messageDrift = await driftDriver(driftRoot)
  assert.equal(messageDrift?.status, 'failed')
  assert.equal(messageDrift?.failure?.code, 'target_subject_mismatch', JSON.stringify(messageDrift?.failure))

  // 2) same metadata but replaced artifact bytes
  const artifactRoot = join(root, 'restored-artifact-drift')
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 })
  cpSync(restored, artifactRoot, { recursive: true })
  writeFileSync(join(artifactRoot, 'restore-report.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(artifactRoot, 'restore-report.json'), 'utf8')), targetPath: artifactRoot }), { mode: 0o600 })
  const artifactFile = join(artifactRoot, 'artifacts', chain.frozenDigest)
  const artifactBytes = readFileSync(artifactFile)
  artifactBytes[0] = artifactBytes[0]! ^ 0xff
  writeFileSync(artifactFile, artifactBytes, { mode: statSync(artifactFile).mode & 0o777 })
  const artifactDrift = await driftDriver(artifactRoot)
  assert.equal(artifactDrift?.status, 'failed')
  assert.equal(artifactDrift?.failure?.code, 'target_subject_mismatch')

  // A legitimate same-selection reuse keeps the original launcher and read selection.
  const reuseFile = join(root, 'reuse-selection.json')
  paCall(['review-restored', '--json', '--state', restored, '--project', projectId, '--allow-path', 'src/', '--out', reuseFile])
  const reusedPorts = { console: await availablePort(), api: await availablePort() }
  const supervisor = spawn(process.execPath, [pa, 'start', ...['--install', app, '--config-root', roots.config,
    '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace],
    '--json', '--state', restored, '--port', String(reusedPorts.console), '--api-port', String(reusedPorts.api),
    '--discussion-only', '--review-restored-scope', reuseFile], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] } as never)
  let supervisorLog = ''
  ;(supervisor.stdout as NodeJS.ReadableStream).on('data', (bytes) => { supervisorLog += bytes })
  ;(supervisor.stderr as NodeJS.ReadableStream).on('data', (bytes) => { supervisorLog += bytes })
  t.after(() => { if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL') })
  const running = await until(() => {
    const line = supervisorLog.split('\n').reverse().find((value) => value.trim().startsWith('{'))
    if (!line) return null
    try { return JSON.parse(line) as Record<string, any> } catch { return null }
  }, (value) => value?.status === 'RUNNING')
  assert.equal(running!.status, 'RUNNING')
  const statusRunning = paCall(['status', '--json', '--state', restored])
  const pid = statusRunning.instance.pid as number
  const api = `http://127.0.0.1:${reusedPorts.api}`
  const health = await until(async () => { try { return (await fetch(`${api}/v1/health`)).json() } catch { return null } }, (value) => value?.mode === 'personal')
  assert.equal(health.startupMode, 'recovery_readonly')
  const apiKey = readFileSync(join(restored, 'api.key'), 'utf8').trim()
  const sources = await (await fetch(`${api}/v1/messages/${chain.contextMessageId}/context/sources?scopeReview=1`, {
    headers: { authorization: `Bearer ${apiKey}` } })).json()
  assert.equal(sources.state, 'verified')
  const reused = driverCall(['--review-file', reuseFile, '--reuse'], reusedPorts)
  assert.equal(reused.status, 'reused', JSON.stringify(reused.failure))
  assert.equal(reused.verified, true)
  assert.equal(reused.identity.recordPid, pid)
  assert.equal(reused.cleanup.owned, false)
  assert.equal(reused.cleanup.detail, 'reused-left-running')
  assert.equal(paCall(['status', '--json', '--state', restored]).instance.pid, pid)
  // A different valid selection cannot reuse or replace the original instance.
  const different = join(root, 'different-selection.json')
  paCall(['review-restored', '--json', '--state', restored, '--project', projectId, '--allow-path', 'src/narrow/', '--out', different])
  const refusedRaw = paRaw(['start', '--state', restored, '--port', String(await availablePort()),
    '--api-port', String(await availablePort()), '--discussion-only', '--review-restored-scope', different, '--json'])
  assert.notEqual(refusedRaw.code, 0)
  const refusedJson = parseJson(refusedRaw.stdout)
  assert.equal(refusedJson.status, 'BLOCKED')
  assert.match(String(refusedJson.code), /review|selection|reused|requested/)
  assert.equal(paCall(['status', '--json', '--state', restored]).instance.pid, pid)
  // Missing selection is refused without touching the live instance.
  const missingRaw = paRaw(['start', '--state', restored, '--port', String(await availablePort()),
    '--api-port', String(await availablePort()), '--discussion-only', '--json'])
  assert.notEqual(missingRaw.code, 0)
  const missingJson = parseJson(missingRaw.stdout)
  assert.equal(missingJson.status, 'BLOCKED')
  assert.equal(paCall(['status', '--json', '--state', restored]).instance.pid, pid)
  // The probe-owned package instance is stopped through its verified identity.
  const stopped = paCall(['stop', '--json', '--state', restored])
  await until(() => supervisor.exitCode !== null || supervisor.signalCode !== null, (done) => done, 15000)
  assert.equal(stopped.status, 'STOPPED')
  assert.equal(paCall(['status', '--json']).status, 'STOPPED')
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
