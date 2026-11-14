import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createBundle, restoreBundle } from '../../../packages/portability/src/index.ts'
import { buildPersonalChain, projectId } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const driver = join(repoRoot, 'packages/context/tools/personal-review-driver.mjs')
const packageTar = process.env.PA_WAVE26_PACKAGE ?? '/Users/hh/Desktop/joker/pa-artifacts/wave25-target/wave25-target-a826b5e.tar.gz'
const expectedTarSha = 'd3e79749426c796085895abc73d76c4b26cd48427d8e6f748155bec00a103f3c'
const expectedSource = 'a826b5e7c8843c28a527567ac33955ff061f85dc'
const expectedBuild = 'fefd93219cea0d4a'

async function availablePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

test('the current a826 package runs readiness plus manifest-driven v1/v2 restored data read-only', { timeout: 600000 }, async (t) => {
  if (!existsSync(packageTar)) { t.diagnostic(`NOT_REACHED: package missing at ${packageTar}`); return }
  assert.equal(createHash('sha256').update(readFileSync(packageTar)).digest('hex'), expectedTarSha)
  const root = mkdtempSync(join(tmpdir(), 'pa-wave26-current-package-'))
  const installDir = join(root, 'install')
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  mkdirSync(installDir, { recursive: true })
  execFileSync('tar', ['-xzf', packageTar, '-C', installDir])
  const installRoot = join(installDir, 'install')
  const install = JSON.parse(readFileSync(join(installRoot, 'install.json'), 'utf8'))
  assert.equal(install.source.commit, expectedSource)
  assert.equal(install.buildId, expectedBuild)
  assert.equal(install.producer.productSchema, 18)
  const app = join(installRoot, 'app'), pa = join(app, 'apps/launcher/bin/pa.mjs')
  const staging = join(root, 'staging')
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  const restoreViaBundle = async (snapshot: { destination: string }, target: string) => {
    const stage = join(root, `stage-${target.split('/').at(-1)}`)
    mkdirSync(stage, { recursive: true, mode: 0o700 })
    copyFileSync(join(snapshot.destination, 'product.sqlite'), join(stage, 'state.sqlite'))
    execFileSync('chmod', ['600', join(stage, 'state.sqlite')])
    cpSync(join(snapshot.destination, 'artifacts'), join(stage, 'artifacts'), { recursive: true })
    const bundle = join(root, `${target.split('/').at(-1)}.pa-backup`)
    await createBundle({ stateDir: stage, outputPath: bundle, stagingRoot: staging })
    return restoreBundle({ bundlePath: bundle, targetStateDir: target, stagingRoot: staging })
  }
  const restoredV1 = join(root, 'restored-v1'), restoredV2 = join(root, 'restored-v2')
  await restoreViaBundle(chain.v1, restoredV1)
  await restoreViaBundle(chain.v2, restoredV2)
  const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
  const aModule = join(aWorktree, 'packages/workflows/src/data-manifest.ts')
  const aHead = execFileSync('git', ['-C', aWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const baseExpectation = { sourceSha: aHead, snapshotFormat: 1, dataRoot: chain.source,
    ticketId: chain.ticketId, assignmentId: chain.assignmentId, attemptId: chain.attemptId, fenceEpoch: chain.fenceEpoch,
    contract: chain.contract, questionId: chain.question.id, answerId: chain.answerId,
    requiredCommandIds: ['w22-work', 'w22-answer'], requiredDispatch: [chain.dispatchWindows.written, chain.dispatchWindows.unknown],
    requiredDeliveryTargets: [chain.deliveryTargetId] }
  const expectationV1 = join(root, 'expectation-v1.json'), expectationV2 = join(root, 'expectation-v2.json')
  writeFileSync(expectationV1, JSON.stringify(baseExpectation, null, 2))
  writeFileSync(expectationV2, JSON.stringify({ ...baseExpectation, snapshotFormat: 2 }, null, 2))
  const roots = { config: join(installRoot, 'var/config'), cache: join(installRoot, 'var/cache'), logs: join(installRoot, 'var/logs'), workspace: join(installRoot, 'var/workspaces') }
  const env = { ...process.env, PA_MODEL_CONFIG: chain.model.file }
  const rootArgs = ['--install', app, '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const firstRun = execFileSync(process.execPath, [pa, 'first-run', '--json', ...rootArgs], { encoding: 'utf8', env })
  assert.equal(JSON.parse(firstRun.trim()).status, 'OK')
  const run = async (state: string, format: 'v1' | 'v2', expectation: string) => {
    const stdout = execFileSync(process.execPath, [driver, '--dialect', 'package', '--pa-entry', pa, '--install', app,
      '--state', state, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(await availablePort()), '--api-port', String(await availablePort()), '--model-config', chain.model.file,
      '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
      '--a-worktree', aWorktree, '--a-module', aModule, '--manifest-db', join(chain.source, 'state.sqlite'),
      '--manifest-expectation', expectation, '--manifest-output', join(root, `${format}-manifest.json`),
      '--root-map', `${chain.source}=${state}`, '--expect-readiness', 'present'], { encoding: 'utf8', timeout: 300000 })
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
  }
  for (const [state, format, expectation] of [[restoredV1, 'v1', expectationV1], [restoredV2, 'v2', expectationV2]] as const) {
    const result = await run(state, format, expectation)
    assert.equal(result.status, 'verified-flow', `${format}: ${JSON.stringify(result.failure)}`)
    assert.equal(result.verified, true)
    assert.equal(result.identity.bound, true)
    assert.equal(result.data.manifest?.subject.snapshotFormat, format === 'v1' ? 1 : 2)
    assert.equal(result.data.manifest?.roots.to, realpathSync(state))
    assert.equal(result.data.targetProof?.subjectMatches, true)
    assert.equal(result.data.sources?.state, 'verified')
    assert.equal(result.data.work?.phase, 'delivered')
    assert.deepEqual(result.data.delivery?.statuses, ['native_applied'])
    assert.equal(result.data.chat, 422)
    assert.equal(result.data.candidatePrepare, 422)
    assert.equal(result.data.readiness?.authorization, 'none')
    assert.equal(result.data.readiness?.startupMode, 'recovery_readonly')
    assert.equal(result.data.readiness?.development, 'readonly')
    assert.ok(['not_configured', 'unknown', 'provider_error'].includes(result.data.readiness?.discussion))
    assert.equal(result.cleanup.stopped, true)
    let statusText
    try { statusText = execFileSync(process.execPath, [pa, 'status', '--json', ...rootArgs, '--state', state], { encoding: 'utf8', env }) }
    catch (error) { statusText = String((error as { stdout?: string }).stdout ?? '') }
    const trimmed = statusText.trim()
    const status = JSON.parse(trimmed.startsWith('{') ? trimmed : trimmed.slice(trimmed.indexOf('{')))
    assert.equal(status.status, 'STOPPED')
  }
  // The package predates main's F App integration; record the honest capability boundary.
  const assets = readFileSync(join(app, 'apps/console/dist/index.html'), 'utf8')
  assert.equal(assets.includes('<div id="root">'), true)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
