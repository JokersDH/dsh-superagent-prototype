import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { buildPersonalChain, conversationId, principal, projectId, reviewScope } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tool = join(repoRoot, 'packages/context/tools/wave31-completion-history.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'

function read(database: string, workId: string, extra: string[] = []): Record<string, any> {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tool,
    '--a-worktree', aWorktree, '--db', database, '--work', workId, '--project', projectId, ...extra], { encoding: 'utf8', timeout: 60000 })
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, any>
  parsed.exitCode = result.status
  return parsed
}

test('one Work browses history, evidence, frozen source and revocation from the same original facts', { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-browse-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const database = join(chain.source, 'state.sqlite')
  const baseline = read(database, chain.workId)
  const baseReview = baseline.completion.reviews[0]
  const storage = await import(pathToFileURL(join(aWorktree, 'packages/storage/src/index.ts')).href)
  const evidence = await import(pathToFileURL(join(aWorktree, 'packages/verification/src/evidence.ts')).href)
  const { ProductStore } = await import('@personal-agent/storage')
  const store = new ProductStore({ path: database })
  const attemptId = 'w31-browse-second-attempt'
  const artifactDigest = createHash('sha256').update('w31-browse-artifact').digest('hex')
  const verification = { ...baseReview.verification, id: 'w31-browse-verification', candidateGeneration: 2, artifactDigest }
  const proposal = { ...baseReview.proposal, verificationId: verification.id, candidateGeneration: 2, artifactDigest }
  const commandId = storage.productReviewCommandId(proposal)
  try {
    const original = store.bindings.binding(chain.attemptId) as Record<string, any>
    store.bindings.record({ ...original, attemptId, fenceEpoch: chain.fenceEpoch + 1, state: 'active' } as never)
    new evidence.CompletionEvidenceStore(store as never).recordVerification(verification)
    store.commands.record(commandId, createHash('sha256').update('w31-browse-receipt').digest('hex'), () => ({
      artifactIds: ['w31-browse-artifact'], attemptId, proposal, verification }))
    store.bindings.setCurrent(chain.ticketId, attemptId)
  } finally { store.close() }

  const history = read(database, chain.workId, ['--limit', '10'])
  assert.equal(history.status, 'ok')
  assert.equal(history.completion.reviews.length, 2)
  assert.equal(history.window.totalKnown, true)
  assert.equal(history.coverage.reviews.state, 'complete')
  const currentReview = history.completion.reviews.find((review: { currentLink: string }) => review.currentLink === 'current_attempt')
  const oldReview = history.completion.reviews.find((review: { currentLink: string }) => review.currentLink === 'historical_attempt')
  assert.ok(currentReview)
  assert.ok(oldReview)
  assert.equal(currentReview!.commandId, commandId)
  assert.equal(oldReview!.commandId, baseReview.commandId)
  assert.equal(oldReview!.proposal.verificationId, baseReview.verification.id)

  const runtime = createProductRuntime({ store: new ProductStore({ path: database }), principal,
    projects: [{ id: projectId, scope: reviewScope }], actionSecret: Buffer.alloc(32, 121), stateRoot: chain.source,
    scratchProject: chain.scratch, executionUnavailable: 'operator_disabled' })
  const apiToken = 'a'.repeat(64), headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
  const app = createLocalHttpApp({ application: runtime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: runtime.read, operations: runtime.operations })
  runtime.start()
  try {
    const evidenceResponse = await app.request(`/v1/works/${chain.workId}/evidence`, { headers })
    assert.equal(evidenceResponse.status, 200)
    const workEvidence = (await evidenceResponse.json()) as Record<string, any>
    assert.equal(workEvidence.workId, chain.workId)
    assert.equal(workEvidence.outcomes.every((outcome: { attempt: { contract: { workId: string } } }) =>
      outcome.attempt.contract.workId === chain.workId), true)

    const firstPage = (await (await app.request(`/v1/works/${chain.workId}/evidence/history?limit=1`, { headers })).json()) as Record<string, any>
    assert.equal(firstPage.workId, chain.workId)
    assert.equal(['complete', 'caller_limit'].includes(firstPage.window), true)
    assert.equal(firstPage.hasMore, firstPage.nextCursor !== undefined)
    const fullPage = (await (await app.request(`/v1/works/${chain.workId}/evidence/history?limit=100`, { headers })).json()) as Record<string, any>
    if (firstPage.nextCursor) {
      const secondPage = (await (await app.request(`/v1/works/${chain.workId}/evidence/history?limit=100&cursor=${encodeURIComponent(firstPage.nextCursor)}`, { headers })).json()) as Record<string, any>
      assert.equal(secondPage.workId, chain.workId)
      assert.equal(Array.isArray(secondPage.entries), true)
    }
    assert.equal(fullPage.entries.length >= firstPage.entries.length, true)

    const frozen = (await (await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context`, { headers })).json()) as Record<string, any>
    assert.equal(frozen.bundleDigest, chain.frozenDigest)
    const sources = (await (await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context/sources`, { headers })).json()) as Record<string, any>
    const frozenIds = new Set((frozen.sources as { sourceId: string }[]).map((source) => source.sourceId))
    assert.equal(frozenIds.size > 0, true)
    const listedIds = new Set(((sources.sources ?? sources.items ?? []) as { sourceId: string }[]).map((source) => source.sourceId))
    for (const id of frozenIds) assert.equal(listedIds.has(String(id)), true)

    // A decision recorded and revoked through the current commands leaves history bytes untouched.
    const prepared = (await (await app.request('/v1/decisions/prepare', { method: 'POST', headers,
      body: JSON.stringify({ projectId, conversationId, sourceMessageId: chain.sourceMessageId,
        content: '保留错误码。', scope: reviewScope }) })).json()) as Record<string, any>
    assert.equal(prepared.protocol, 'decision-preview/1')
    const recorded = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers,
      body: JSON.stringify({ kind: 'record_decision', commandId: 'w31-browse-decision', projectId, conversationId,
        token: prepared.token }) })).json()) as Record<string, any>
    assert.equal(recorded.status, 'recorded')
    const revoked = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers,
      body: JSON.stringify({ kind: 'revoke_decision', commandId: 'w31-browse-revoke', projectId, conversationId,
        decisionId: prepared.decision.id, expectedVersion: 1 }) })).json()) as Record<string, any>
    assert.equal(revoked.status, 'recorded')
    const historyAfter = read(database, chain.workId, ['--limit', '10'])
    assert.deepEqual(historyAfter.completion.reviews.map((review: { commandId: string }) => review.commandId),
      history.completion.reviews.map((review: { commandId: string }) => review.commandId))
    const frozenAfter = (await (await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context`, { headers })).json()) as Record<string, any>
    assert.equal(frozenAfter.bundleDigest, frozen.bundleDigest)
  } finally { await runtime.close().catch(() => undefined) }

  assert.equal(chain.model.requests.length, chain.modelCalls)
})
