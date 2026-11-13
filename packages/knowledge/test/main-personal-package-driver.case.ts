import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { buildPersonalChain, projectId, restoreSnapshot } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const driver = join(repoRoot, 'packages/context/tools/personal-review-driver.mjs')
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

test('one parameterized package driver reviews both v1 and v2 restored roots through the standard entry', { timeout: 300000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave22-driver-'))
  const chain = await buildPersonalChain(root)
  const restoredV1 = join(root, 'restored-v1'), restoredV2 = join(root, 'restored-v2')
  restoreSnapshot(chain.v1, restoredV1)
  restoreSnapshot(chain.v2, restoredV2)
  t.after(async () => {
    await chain.model.close()
    rmSync(root, { recursive: true, force: true })
  })
  const entryHashes = {
    review: sha256(join(repoRoot, 'tools/dev/review-restored.mjs')),
    start: sha256(join(repoRoot, 'tools/dev/start.mjs')),
    demo: sha256(join(repoRoot, 'apps/coordinator/product/demo.ts')),
    restoredReview: sha256(join(repoRoot, 'apps/coordinator/product/restored-review.ts')),
  }
  const run = (state: string, format: 'v1' | 'v2', ports: { console: number; api: number }) => {
    const stdout = execFileSync(process.execPath, [driver,
      '--install', repoRoot, '--state', state, '--project', projectId, '--allow-path', 'src/',
      '--console-port', String(ports.console), '--api-port', String(ports.api),
      '--model-config', chain.model.file, '--format', format,
      '--work', chain.workId, '--question', chain.question.id, '--candidate-message', chain.sourceMessageId,
    ], { encoding: 'utf8', timeout: 240000 })
    return JSON.parse(stdout) as {
      protocol: string; status: string; format: string; sourceOnly: boolean; packageSubject: string | null
      entries: Record<string, { path: string; sha256: string | null }>
      review: { file: string; sha256: string; mode: number; startupAvailable: boolean }
      health: { mode: string; startupMode: string; restoredReviewDigest: string | null }
      sources: { messageId: string; state: string; defaultHasScopeReview: boolean; diagnostic: { protocol: string; reasons: string[]; partial: boolean; withheldSourceCount: number; authorization: string } | null } | null
      history: { conversationId: string | null; entries: number }
      work: { phase: string | null } | null
      delivery: string[] | null
      refused: Record<string, number>
    }
  }

  const v1 = run(restoredV1, 'v1', { console: await availablePort(), api: await availablePort() })
  assert.equal(v1.protocol, 'personal-review-driver/1')
  assert.equal(v1.status, 'ok')
  assert.equal(v1.format, 'v1')
  assert.equal(v1.sourceOnly, true)
  assert.equal(v1.packageSubject, null)
  assert.equal(v1.entries.review!.sha256, entryHashes.review)
  assert.equal(v1.entries.start!.sha256, entryHashes.start)
  assert.equal(v1.entries.demo!.sha256, entryHashes.demo)
  assert.equal(v1.entries.restoredReview!.sha256, entryHashes.restoredReview)
  assert.equal(v1.review.mode, 0o600)
  assert.equal(v1.review.startupAvailable, false)
  assert.match(v1.review.sha256, /^[a-f0-9]{64}$/)
  assert.equal(v1.health.mode, 'personal')
  assert.equal(v1.health.startupMode, 'recovery_readonly')
  assert.match(v1.health.restoredReviewDigest ?? '', /^[a-f0-9]{64}$/)
  assert.ok(v1.sources)
  assert.equal(v1.sources!.state, 'verified')
  assert.equal(v1.sources!.defaultHasScopeReview, false)
  assert.equal(v1.sources!.messageId, chain.contextMessageId)
  assert.deepEqual(v1.sources!.diagnostic, { protocol: 'context-scope-review/1', reasons: [], partial: false, withheldSourceCount: 0, authorization: 'none' })
  assert.equal(v1.history.entries, 1)
  assert.equal(v1.work?.phase, 'delivered')
  assert.deepEqual(v1.delivery, ['native_applied'])
  assert.equal(v1.refused.candidates, 200)
  assert.equal(v1.refused.candidatePrepare, 422)
  assert.equal(v1.refused.chat, 422)

  const v2 = run(restoredV2, 'v2', { console: await availablePort(), api: await availablePort() })
  assert.equal(v2.format, 'v2')
  assert.equal(v2.entries.start!.sha256, entryHashes.start)
  assert.equal(v2.health.mode, 'personal')
  assert.equal(v2.health.startupMode, 'recovery_readonly')
  assert.equal(v2.sources!.state, 'verified')
  assert.deepEqual(v2.sources!.diagnostic, { protocol: 'context-scope-review/1', reasons: [], partial: false, withheldSourceCount: 0, authorization: 'none' })
  assert.equal(v2.work?.phase, 'delivered')
  assert.deepEqual(v2.delivery, ['native_applied'])
  assert.equal(v2.refused.candidatePrepare, 422)
  assert.notEqual(v1.review.file, v2.review.file)
  assert.notEqual(v1.review.sha256, v2.review.sha256)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
