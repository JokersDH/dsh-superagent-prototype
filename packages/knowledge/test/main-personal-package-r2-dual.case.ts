import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { buildPersonalChain, projectId, restoreSnapshotWithA } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const historyTool = join(repoRoot, 'packages/context/tools/wave30-completion-history.mjs')
const driver = join(repoRoot, 'packages/context/tools/personal-review-driver.mjs')
const packageTar = process.env.PA_WAVE31_PACKAGE ?? '/Users/hh/Desktop/joker/pa-artifacts/wave31-target/wave31-target-4dcd28f.tar.gz'
const expectedTarSha = process.env.PA_WAVE31_PACKAGE_SHA ?? '405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6'
const expectedSource = 'c0a1f8975232b6397dfaf92d31ac5682df2dab36'
const expectedBuild = '4dcd28f758bbb265'

async function availablePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

test('the R2 4dcd28f package runs readiness plus manifest-driven v1/v2 restored data read-only and rejects target-only drift', { timeout: 600000 }, async (t) => {
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
  assert.equal(existsSync(join(app, 'packages/project-recipes/dist/index.js')), true)
  assert.equal(existsSync(join(app, 'apps/coordinator/product/project-recipes.ts')), true)
  assert.equal(existsSync(join(app, 'apps/coordinator/product/usage-observation.ts')), true)
  const consoleBundle = (await import('node:fs')).readdirSync(join(app, 'apps/console/dist/assets')).filter((name: string) => name.endsWith('.js'))
  const consoleText = consoleBundle.map((name: string) => readFileSync(join(app, 'apps/console/dist/assets', name), 'utf8')).join('\n')
  t.diagnostic(`console validation mentions window: ${consoleText.includes('观察窗口')}`)
  t.diagnostic(`console hardcodes a 30-day selector: ${consoleText.includes('近 30 天') || consoleText.includes('近30天')}`)
  assert.equal(consoleText.includes('usage-observation/1') || consoleText.includes('/v1/insights'), true)
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
  const restoredV1 = join(root, 'restored-v1'), restoredV2 = join(root, 'restored-v2')
  const restoreV1 = await restoreSnapshotWithA(aWorktree, chain.v1.destination, restoredV1, chain.source)
  const restoreV2 = await restoreSnapshotWithA(aWorktree, chain.v2.destination, restoredV2, chain.source)
  const targetArgsFor = (restore: { protocol: string; snapshotDigest: string; contentDigest: string; artifacts: unknown }, name: string) => {
    const artifacts = join(root, name)
    writeFileSync(artifacts, JSON.stringify(restore.artifacts), { mode: 0o600 })
    return ['--target-protocol', restore.protocol, '--target-snapshot-digest', restore.snapshotDigest,
      '--target-content-digest', restore.contentDigest, '--target-artifacts', artifacts, '--target-source-root', chain.source]
  }
  const targetArgsV1 = targetArgsFor(restoreV1, 'target-artifacts-v1.json')
  const targetArgsV2 = targetArgsFor(restoreV2, 'target-artifacts-v2.json')
  const roots = { config: join(installRoot, 'var/config'), cache: join(installRoot, 'var/cache'), logs: join(installRoot, 'var/logs'), workspace: join(installRoot, 'var/workspaces') }
  const env = { ...process.env, PA_MODEL_CONFIG: chain.model.file }
  const rootArgs = ['--install', app, '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const firstRun = execFileSync(process.execPath, [pa, 'first-run', '--json', ...rootArgs], { encoding: 'utf8', env })
  assert.equal(JSON.parse(firstRun.trim()).status, 'OK')
  const run = async (state: string, format: 'v1' | 'v2', expectation: string, targetArgs: string[]) => {
    const stdout = execFileSync(process.execPath, [driver, '--dialect', 'package', '--pa-entry', pa, '--install', app,
      '--state', state, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(await availablePort()), '--api-port', String(await availablePort()), '--model-config', chain.model.file,
      '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
      '--a-worktree', aWorktree, '--a-module', aModule, '--manifest-db', join(chain.source, 'state.sqlite'),
      '--manifest-expectation', expectation, '--manifest-output', join(root, `${format}-manifest.json`),
      '--root-map', `${chain.source}=${state}`, '--expect-readiness', 'present', ...targetArgs], { encoding: 'utf8', timeout: 300000 })
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
  }
  for (const [state, format, expectation, targetArgs] of [[restoredV1, 'v1', expectationV1, targetArgsV1], [restoredV2, 'v2', expectationV2, targetArgsV2]] as const) {
    const result = await run(state, format, expectation, [...targetArgs])
    assert.equal(result.status, 'verified-flow', `${format}: ${JSON.stringify(result.failure)}`)
    assert.equal(result.verified, true)
    assert.equal(result.identity.bound, true)
    assert.equal(result.data.manifest?.subject.snapshotFormat, format === 'v1' ? 1 : 2)
    assert.equal(result.data.manifest?.roots.to, realpathSync(state))
    assert.equal(result.data.targetProof?.subjectMatches, true)
    assert.equal(result.data.targetProof?.verification?.basis, 'independent')
    assert.equal(result.data.targetProof?.verification?.content?.complete, true)
    assert.deepEqual(result.data.targetProof?.allowed, ['subject.dataRoot'])
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
    const facts = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', historyTool,
      '--a-worktree', aWorktree, '--db', join(state, 'state.sqlite'), '--work', chain.workId, '--project', projectId],
    { encoding: 'utf8', timeout: 60000 }).trim().split('\n').at(-1)!) as Record<string, any>
    assert.equal(facts.status, 'ok')
    assert.equal(facts.completion.reviews.length, 1)
    assert.equal(facts.completion.reviews[0].canonical, true)
    assert.equal(facts.completion.verifications[0].id, chain.completionFacts.verificationId)
    assert.equal(facts.completion.acceptances.length >= 1, true)
    let statusText
    try { statusText = execFileSync(process.execPath, [pa, 'status', '--json', ...rootArgs, '--state', state], { encoding: 'utf8', env }) }
    catch (error) { statusText = String((error as { stdout?: string }).stdout ?? '') }
    const trimmed = statusText.trim()
    const status = JSON.parse(trimmed.startsWith('{') ? trimmed : trimmed.slice(trimmed.indexOf('{')))
    assert.equal(status.status, 'STOPPED')
  }
  // A target-only legal message changes the subject even though the root path mapping matches.
  const driftRoot = join(root, 'restored-drift')
  await restoreSnapshotWithA(aWorktree, chain.v1.destination, driftRoot, chain.source)
  const driftStore = new ProductStore({ path: join(driftRoot, 'state.sqlite') })
  try {
    driftStore.product.messages.append({ id: 'w31-drift-user-message', projectId, conversationId: 'wave22-conversation', role: 'user',
      provenance: 'trusted_user', text: '目标端合法但不在原 subject 的消息', sourceRefs: [], createdAt: new Date().toISOString() })
  } finally { driftStore.close() }
  let driftResult: Record<string, any>
  try {
    const stdout = execFileSync(process.execPath, [driver, '--dialect', 'package', '--pa-entry', pa, '--install', app,
      '--state', driftRoot, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(await availablePort()), '--api-port', String(await availablePort()), '--model-config', chain.model.file,
      '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
      '--a-worktree', aWorktree, '--a-module', aModule, '--manifest-db', join(chain.source, 'state.sqlite'),
      '--manifest-expectation', expectationV1, '--manifest-output', join(root, 'drift-manifest.json'),
      '--root-map', `${chain.source}=${driftRoot}`, '--expect-readiness', 'present', ...targetArgsV1], { encoding: 'utf8', timeout: 300000 })
    driftResult = JSON.parse(stdout.trim().split('\n').at(-1)!)
  } catch (error) {
    const stdout = String((error as { stdout?: string }).stdout ?? '').trim().split('\n').at(-1)
    driftResult = JSON.parse(stdout ?? '{}')
  }
  assert.equal(driftResult.status, 'failed', JSON.stringify(driftResult))
  assert.equal(driftResult.failure?.code, 'target_subject_mismatch', JSON.stringify(driftResult.failure))

  // Record the honest capability boundary for the packaged console.
  const assets = readFileSync(join(app, 'apps/console/dist/index.html'), 'utf8')
  assert.equal(assets.includes('<div id="root">'), true)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
