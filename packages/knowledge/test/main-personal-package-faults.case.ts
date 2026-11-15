import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildPersonalChain, projectId, restoreSnapshotWithA } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const driver = join(repoRoot, 'packages/context/tools/personal-review-driver.mjs')
const packageTar = process.env.PA_WAVE31_PACKAGE ?? '/Users/hh/Desktop/joker/pa-artifacts/wave31-target/wave31-target-4dcd28f.tar.gz'
const expectedTarSha = '405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6'
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'

async function availablePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

test('a wrong target proof fails bounded before start and leaves only owned diagnostics', { timeout: 300000 }, async (t) => {
  if (!existsSync(packageTar)) { t.diagnostic(`NOT_REACHED: package missing at ${packageTar}`); return }
  assert.equal(createHash('sha256').update(readFileSync(packageTar)).digest('hex'), expectedTarSha)
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-faults-'))
  const installDir = join(root, 'install')
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  mkdirSync(installDir, { recursive: true })
  execFileSync('tar', ['-xzf', packageTar, '-C', installDir])
  const installRoot = join(installDir, 'install'), app = join(installRoot, 'app'), pa = join(app, 'apps/launcher/bin/pa.mjs')
  const aModule = join(aWorktree, 'packages/workflows/src/data-manifest.ts')
  const aHead = execFileSync('git', ['-C', aWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const expectation = join(root, 'expectation.json')
  writeFileSync(expectation, JSON.stringify({ sourceSha: aHead, snapshotFormat: 1, dataRoot: chain.source,
    ticketId: chain.ticketId, assignmentId: chain.assignmentId, attemptId: chain.attemptId, fenceEpoch: chain.fenceEpoch,
    contract: chain.contract, questionId: chain.question.id, answerId: chain.answerId,
    requiredCommandIds: ['w22-work', 'w22-answer'], requiredDispatch: [chain.dispatchWindows.written, chain.dispatchWindows.unknown],
    requiredDeliveryTargets: [chain.deliveryTargetId] }, null, 2))
  const restored = join(root, 'restored')
  const restore = await restoreSnapshotWithA(aWorktree, chain.v1.destination, restored, chain.source)
  const artifacts = join(root, 'artifacts.json')
  writeFileSync(artifacts, JSON.stringify(restore.artifacts), { mode: 0o600 })
  const roots = { config: join(installRoot, 'var/config'), cache: join(installRoot, 'var/cache'), logs: join(installRoot, 'var/logs'), workspace: join(installRoot, 'var/workspaces') }
  const env = { ...process.env, PA_MODEL_CONFIG: chain.model.file }
  const rootArgs = ['--install', app, '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  execFileSync(process.execPath, [pa, 'first-run', '--json', ...rootArgs], { encoding: 'utf8', env })

  const run = async (targetDigest: string) => {
    const result = spawnSync(process.execPath, [driver, '--dialect', 'package', '--pa-entry', pa, '--install', app,
      '--state', restored, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(await availablePort()), '--api-port', String(await availablePort()), '--model-config', chain.model.file,
      '--config-root', roots.config, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
      '--a-worktree', aWorktree, '--a-module', aModule, '--manifest-db', join(chain.source, 'state.sqlite'),
      '--manifest-expectation', expectation, '--manifest-output', join(root, 'manifest.json'),
      '--root-map', `${chain.source}=${restored}`, '--expect-readiness', 'present',
      '--target-protocol', restore.protocol, '--target-snapshot-digest', targetDigest, '--target-content-digest', restore.contentDigest,
      '--target-artifacts', artifacts, '--target-source-root', chain.source], { encoding: 'utf8', timeout: 180000, env })
    const last = String(result.stdout ?? '').trim().split('\n').at(-1) ?? '{}'
    return { exitCode: result.status, output: JSON.parse(last) as Record<string, any> }
  }

  const wrongDigest = await run('f'.repeat(64))
  assert.equal(wrongDigest.exitCode, 1, JSON.stringify(wrongDigest.output))
  assert.equal(wrongDigest.output.status, 'failed')
  assert.equal(typeof wrongDigest.output.failure?.code, 'string')

  // No package instance is left running for the wrong-proof attempt; only owned diagnostics remain.
  let statusText = ''
  try { statusText = execFileSync(process.execPath, [pa, 'status', '--json', ...rootArgs, '--state', restored], { encoding: 'utf8', env }) }
  catch (error) { statusText = String((error as { stdout?: string }).stdout ?? '') }
  const trimmed = statusText.trim(), status = JSON.parse(trimmed.startsWith('{') ? trimmed : trimmed.slice(trimmed.indexOf('{')))
  assert.equal(status.status, 'STOPPED')
  assert.equal(existsSync(join(root, 'manifest.json')), true)
  assert.equal(existsSync(roots.logs), true)
  assert.equal(readdirSync(restored).includes('state.sqlite'), true)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
