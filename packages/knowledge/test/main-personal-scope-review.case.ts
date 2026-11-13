import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { explainRestoredReviewScope } from '@personal-agent/context'
import { localCredentials } from '../../../apps/coordinator/http/local-state.ts'
import { restoredReviewIdentity } from '../../../apps/coordinator/product/restored-review.ts'
import { buildPersonalChain, projectId, restoreSnapshot } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const reviewTool = join(repoRoot, 'tools/dev/review-restored.mjs')
const demoEntry = join(repoRoot, 'apps/coordinator/product/demo.ts')

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Scope review condition timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

function review(state: string, output: string, allowed: string[], excluded: string[] = []) {
  execFileSync(process.execPath, [reviewTool, '--state', state, '--project', projectId,
    ...allowed.flatMap((path) => ['--allow-path', path]), ...excluded.flatMap((path) => ['--exclude-path', path]), '--output', output], { encoding: 'utf8' })
  return output
}

test('actual personal scope diagnostics explain narrow, exclusion, validity and missing frozen sources without widening', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave22-diagnostics-'))
  const chain = await buildPersonalChain(root, { expiresAt: '2099-01-01T00:00:00.000Z' })
  const restored = join(root, 'restored')
  const missing = join(root, 'restored-missing')
  restoreSnapshot(chain.v1, restored)
  const credential = localCredentials(restored)
  const apiKey = credential('api.key')
  let child: ReturnType<typeof spawn> | undefined
  let output = ''
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await chain.model.close()
    rmSync(root, { recursive: true, force: true })
  })
  const port = await availablePort()
  const api = `http://127.0.0.1:${port}`
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit')
    const timer = setTimeout(() => child!.kill('SIGKILL'), 8000)
    child.kill('SIGTERM')
    try { await done } finally { clearTimeout(timer) }
    child = undefined
  }
  cleanups.push(stop)
  const start = async (state: string, file: string) => {
    output = ''
    child = spawn(process.execPath, [demoEntry, '--state', state, '--port', String(port), '--discussion-only', '--assistant', '--review-restored-scope', file], {
      cwd: repoRoot, env: { ...process.env, PA_MODEL_CONFIG: chain.model.file }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', (bytes) => { output += bytes })
    child.stderr!.on('data', (bytes) => { output += bytes })
    await until(async () => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(output.slice(-4000))
      try { return (await fetch(`${api}/v1/health`)).ok } catch { return false }
    }, (healthy) => healthy)
  }
  const wide = review(restored, join(root, 'wide.json'), ['src/'])
  const get = async (path: string) => (await fetch(`${api}${path}`, { headers })).json()
  const status = async (path: string, body: unknown) => (await fetch(`${api}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })).status

  // Wide review: default shape stays exactly the old one; the opt-in only adds bounded explanation.
  await start(restored, wide)
  const health = await get('/v1/health')
  assert.equal(health.restoredReviewDigest, restoredReviewIdentity(wide))
  const ordinary = await get(`/v1/messages/${chain.contextMessageId}/context/sources`)
  assert.equal(ordinary.state, 'verified')
  assert.equal('scopeReview' in ordinary, false)
  assert.ok((ordinary.sources as { content: string }[]).some((source) => source.content.includes('保留')))
  assert.equal(JSON.stringify(ordinary).includes('readable'), false)
  const reviewed = await get(`/v1/messages/${chain.contextMessageId}/context/sources?scopeReview=1`)
  const { scopeReview, ...withoutReview } = reviewed
  const withoutTimestamp = (value: Record<string, unknown>) => { const { observedAt, ...rest } = value; void observedAt; return rest }
  assert.deepEqual(withoutTimestamp(withoutReview), withoutTimestamp(ordinary))
  assert.deepEqual(scopeReview, { protocol: 'context-scope-review/1', reasons: ['selection_validity_changed'], partial: false,
    withheldSourceCount: 0, authorization: 'none' })
  assert.equal('readable' in scopeReview, false)
  assert.equal(JSON.stringify(scopeReview).includes('principal'), false)
  assert.ok(JSON.stringify(scopeReview).length < 4096)
  for (const suffix of ['?scopeReview=0', '?scopeReview=', '?scopeReview=1&scopeReview=1', '?scopeReview=1&grant=foreign', '?scopeReview=true'])
    assert.equal((await fetch(`${api}/v1/messages/${chain.contextMessageId}/context/sources${suffix}`, { headers })).status, 400, suffix)
  const candidates = await get(`/v1/messages/${chain.sourceMessageId}/candidates`)
  assert.equal((candidates.candidates as { payloadDigest: string }[])[0]!.payloadDigest, chain.reviewedCandidate.payloadDigest)
  assert.equal(candidates.executable, false)
  assert.equal((await get(`/v1/works/${chain.workId}`)).phase, 'delivered')
  assert.deepEqual((await get(`/v1/questions/${chain.question.id}/deliveries`)).map((entry: { status: string }) => entry.status), ['native_applied'])
  // The permission display is not ordinary model input, and the frozen body keeps its original digest.
  assert.equal((ordinary.sources as { content: string }[]).some((source) => source.content.includes('允许执行')), false)
  assert.equal((await get(`/v1/messages/${chain.contextMessageId}/context`)).bundleDigest, chain.frozenDigest)
  // Original receipts replay is refused without any provider call.
  const callsBefore = chain.modelCalls
  assert.equal(await status('/v1/proposals/commands', { kind: 'confirm_proposal', commandId: 'w22-confirm', projectId, conversationId: 'wave22-conversation', token: 'a.b' }), 422)
  assert.equal(await status('/v1/assistant/context/send', { commandId: 'w22-context', token: 'a.b' }), 422)
  assert.equal(await status('/v1/commands', { kind: 'chat', commandId: 'w22-review-chat', projectId, conversationId: 'wave22-conversation', text: 'x' }), 422)
  assert.equal(chain.model.requests.length, callsBefore)
  await stop()

  // Narrow and exclusion selections: authoritative state stays scope_changed with an empty body.
  const narrowFile = review(restored, join(root, 'narrow.json'), ['src/narrow/'])
  await start(restored, narrowFile)
  const narrow = await get(`/v1/messages/${chain.contextMessageId}/context/sources`)
  assert.equal(narrow.state, 'scope_changed')
  assert.deepEqual(narrow.sources, [])
  const narrowReview = await get(`/v1/messages/${chain.contextMessageId}/context/sources?scopeReview=1`)
  assert.deepEqual(narrowReview.sources, [])
  assert.equal(narrowReview.state, narrow.state)
  assert.equal(narrowReview.scopeReview.partial, true)
  assert.equal(narrowReview.scopeReview.withheldSourceCount, chain.frozenSourceIds.length)
  assert.ok(narrowReview.scopeReview.withheldSourceCount <= 64)
  assert.ok((narrowReview.scopeReview.reasons as string[]).includes('selection_narrowed'))
  assert.ok((narrowReview.scopeReview.reasons as string[]).includes('selection_validity_changed'))
  assert.equal(narrowReview.scopeReview.authorization, 'none')
  assert.equal('readable' in narrowReview.scopeReview, false)
  const unknownCounts = explainRestoredReviewScope({ bindingScope: chain.bindingScope, selection: narrowReview.binding.scope,
    sourcesState: 'scope_changed', frozenSourceIds: chain.frozenSourceIds })
  assert.deepEqual(unknownCounts.readable, { candidates: null, history: null, works: null, deliveries: null })
  assert.equal(unknownCounts.partial, true)
  const narrowCandidate = await get(`/v1/messages/${chain.sourceMessageId}/candidates`)
  assert.deepEqual(narrowCandidate.candidates, [])
  assert.equal((narrowCandidate.rejected as { reason: string }[])[0]?.reason, 'scope_escalation')
  assert.equal((await get(`/v1/works/${chain.workId}`)).phase, 'delivered')
  assert.deepEqual((await get(`/v1/questions/${chain.question.id}/deliveries`)).map((entry: { status: string }) => entry.status), ['native_applied'])
  assert.equal(await status('/v1/assistant/candidates/prepare', { messageId: chain.sourceMessageId, index: chain.reviewedCandidate.index, payloadDigest: chain.reviewedCandidate.payloadDigest }), 422)
  assert.equal(await status('/v1/context/preview', { projectId, conversationId: 'wave22-conversation', selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }), 422)
  await stop()

  const exclusionFile = review(restored, join(root, 'exclusion.json'), ['src/'], ['.git', 'src/secret/'])
  await start(restored, exclusionFile)
  const excluded = await get(`/v1/messages/${chain.contextMessageId}/context/sources?scopeReview=1`)
  assert.equal(excluded.state, 'scope_changed')
  assert.deepEqual(excluded.sources, [])
  assert.ok((excluded.scopeReview.reasons as string[]).includes('exclusion_added'))
  assert.equal(excluded.scopeReview.partial, true)
  assert.equal(excluded.scopeReview.withheldSourceCount, chain.frozenSourceIds.length)
  await stop()

  // A restored copy whose frozen artifact is gone is reported as missing, not partially sufficient.
  mkdirSync(missing, { recursive: true, mode: 0o700 })
  cpSync(restored, missing, { recursive: true })
  writeFileSync(join(missing, 'restore-report.json'), JSON.stringify({ protocol: 'personal-restore/1', targetPath: missing,
    database: { ...chain.v1.manifest.database }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const missingCredential = localCredentials(missing)
  const missingWide = join(root, 'missing-wide.json')
  execFileSync(process.execPath, [reviewTool, '--state', missing, '--project', projectId, '--allow-path', 'src/', '--output', missingWide], { encoding: 'utf8' })
  unlinkSync(join(missing, 'artifacts', chain.frozenDigest))
  await start(missing, missingWide)
  const missingSources = await get(`/v1/messages/${chain.contextMessageId}/context/sources`)
  assert.equal(missingSources.state, 'missing')
  assert.deepEqual(missingSources.sources, [])
  const missingReview = await get(`/v1/messages/${chain.contextMessageId}/context/sources?scopeReview=1`)
  assert.equal(missingReview.state, 'missing')
  assert.equal(missingReview.scopeReview.partial, true)
  assert.equal(missingReview.scopeReview.withheldSourceCount, 0)
  assert.equal(missingReview.scopeReview.authorization, 'none')
  assert.equal(await status('/v1/commands', { kind: 'chat', commandId: 'missing-chat', projectId, conversationId: 'wave22-conversation', text: 'x' }), 422)
  assert.equal(chain.model.requests.length, chain.modelCalls)
  assert.ok(missingCredential('api.key'))
  await stop()

  for (const target of [restored, missing]) {
    const store = new ProductStore({ path: join(target, 'state.sqlite') })
    try {
      assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 1)
      assert.equal(store.product.works.listByProject(projectId).length, 1)
    } finally { store.close() }
  }
  assert.equal(statSync(wide).mode & 0o077, 0)
})
