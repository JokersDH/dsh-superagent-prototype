import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createBundle, restoreBundle } from '../../../packages/portability/src/index.ts'
import { buildPersonalChain, projectId } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const driver = join(repoRoot, 'packages/context/tools/personal-review-driver.mjs')
const reviewTool = join(repoRoot, 'tools/dev/review-restored.mjs')

async function availablePort(): Promise<number> {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

test('default v1 and explicit v2 snapshots are each restored through the real bundle path and reviewed', { timeout: 300000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave24-restore-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const snapshots = [
    { format: 'v1', snapshot: chain.v1 },
    { format: 'v2', snapshot: chain.v2 },
  ] as const
  const restoredFingerprints: string[] = []
  for (const { format, snapshot } of snapshots) {
    const snapshotDir = snapshot.destination
    const stage = join(root, `stage-${format}`)
    mkdirSync(stage, { recursive: true, mode: 0o700 })
    mkdirSync(join(root, 'staging'), { recursive: true, mode: 0o700 })
    mkdirSync(join(root, 'staging-restore'), { recursive: true, mode: 0o700 })
    copyFileSync(join(snapshotDir, 'product.sqlite'), join(stage, 'state.sqlite'))
    execFileSync('chmod', ['600', join(stage, 'state.sqlite')])
    cpSync(join(snapshotDir, 'artifacts'), join(stage, 'artifacts'), { recursive: true })
    const bundle = join(root, `${format}.pa-backup`)
    const created = await createBundle({ stateDir: stage, outputPath: bundle, stagingRoot: join(root, 'staging') })
    assert.equal(created.manifest.format, 'pa-backup')
    assert.equal(created.manifest.formatVersion, 1)
    const target = join(root, `restored-${format}`)
    const restored = await restoreBundle({ bundlePath: bundle, targetStateDir: target, stagingRoot: join(root, 'staging-restore') })
    assert.equal(restored.report.protocol, 'personal-restore/1')
    assert.equal(restored.reportPath, join(target, 'restore-report.json'))
    assert.equal(statSync(restored.reportPath).mode & 0o777, 0o600)

    // The restored bytes are the snapshot subject, not a re-labeled format.
    const snapshotStore = new ProductStore({ path: join(stage, 'state.sqlite') })
    const snapshotFingerprint = snapshotStore.workflows.recoverySource.inspect().sourceFingerprint
    const snapshotWorks = snapshotStore.product.works.listByProject(projectId).length
    const snapshotHeld = snapshotStore.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length
    snapshotStore.close()
    const restoredStore = new ProductStore({ path: join(target, 'state.sqlite') })
    const restoredFingerprint = restoredStore.workflows.recoverySource.inspect().sourceFingerprint
    assert.ok(restoredFingerprint)
    assert.equal(restoredFingerprint, snapshotFingerprint)
    assert.equal(restoredStore.product.works.listByProject(projectId).length, snapshotWorks)
    assert.equal(restoredStore.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, snapshotHeld)
    const deliveries = restoredStore.answers.deliveries(chain.answerId)
    assert.equal(deliveries.some((entry) => entry.status === 'native_applied'), true)
    restoredStore.close()
    restoredFingerprints.push(restoredFingerprint)

    const review = join(root, `${format}-selection.json`)
    execFileSync(process.execPath, [reviewTool, '--state', target, '--project', projectId, '--allow-path', 'src/', '--output', review], { encoding: 'utf8' })
    const stdout = execFileSync(process.execPath, [driver,
      '--install', repoRoot, '--state', target, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(await availablePort()), '--api-port', String(await availablePort()),
      '--model-config', chain.model.file, '--format', format,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
    ], { encoding: 'utf8', timeout: 240000 })
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
    assert.equal(result.status, 'verified-flow', `${format}: ${JSON.stringify(result.failure)}`)
    assert.equal(result.verified, true)
    assert.equal(result.identity.bound, true)
    assert.equal(result.data.sources?.state, 'verified')
    assert.equal(result.data.work?.phase, 'delivered')
    assert.deepEqual(result.data.delivery?.statuses, ['native_applied'])
    assert.equal(result.data.chat, 422)
    assert.equal(result.data.candidatePrepare, 422)
    assert.equal(result.cleanup.stopped, true)
  }
  // Both formats carry the same real subject; the formats, roots and consents differ, not the data identity.
  assert.equal(restoredFingerprints[0], restoredFingerprints[1])
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
