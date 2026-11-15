import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { buildPersonalChain, principal, projectId, reviewScope } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tool = join(repoRoot, 'packages/context/tools/wave31-completion-history.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'

function read(database: string, workId: string, extra: string[] = [], project = projectId): Record<string, any> {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tool,
    '--a-worktree', aWorktree, '--db', database, '--work', workId, '--project', project, ...extra], { encoding: 'utf8', timeout: 60000 })
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, any>
  parsed.exitCode = result.status
  return parsed
}

test('multi-attempt history pages without loss or duplication and keeps the old review after the epoch moves', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-paging-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const database = join(chain.source, 'state.sqlite')
  const baseline = read(database, chain.workId)
  const baseReview = baseline.completion.reviews[0]

  const storage = await import(pathToFileURL(join(aWorktree, 'packages/storage/src/index.ts')).href)
  const evidence = await import(pathToFileURL(join(aWorktree, 'packages/verification/src/evidence.ts')).href)
  const store = new storage.ProductStore({ path: database })
  const attemptId = 'w31-second-attempt'
  const artifactDigest = createHash('sha256').update('w31-second-artifact').digest('hex')
  const verification = { ...baseReview.verification, id: 'w31-second-verification', candidateGeneration: 2, artifactDigest }
  const proposal = { ...baseReview.proposal, verificationId: verification.id, candidateGeneration: 2, artifactDigest }
  const commandId = storage.productReviewCommandId(proposal)
  try {
    const original = store.bindings.binding(chain.attemptId) as Record<string, any> | undefined
    store.bindings.record({ ...original, attemptId, fenceEpoch: chain.fenceEpoch + 1, state: 'active' } as never)
    new evidence.CompletionEvidenceStore(store).recordVerification(verification)
    store.commands.record(commandId, createHash('sha256').update('w31-second-receipt').digest('hex'), () => ({
      artifactIds: ['w31-second-artifact'], attemptId, proposal, verification,
    }))
    store.bindings.setCurrent(chain.ticketId, attemptId)
  } finally { store.close() }

  const first = read(database, chain.workId, ['--limit', '1'])
  assert.equal(first.status, 'ok')
  assert.equal(first.coverage.reviews.state, 'truncated_local')
  assert.equal(first.completion.reviews.length, 1)
  assert.equal(first.window.nextOffset, 1)
  const second = read(database, chain.workId, ['--limit', '1', '--offset', '1'])
  assert.equal(second.completion.reviews.length, 1)
  assert.equal(second.window.nextOffset, undefined)
  const third = read(database, chain.workId, ['--limit', '1', '--offset', '2'])
  assert.equal(third.completion.reviews.length, 0)
  assert.equal(third.window.nextOffset, undefined)
  assert.equal(third.coverage.reviews.truncated, false)
  assert.equal(third.coverage.reviews.available, 2)

  const ids = [...first.completion.reviews, ...second.completion.reviews].map((review: { commandId: string }) => review.commandId)
  assert.equal(new Set(ids).size, 2)
  assert.equal(ids.includes(commandId), true)
  const all = read(database, chain.workId, ['--limit', '10'])
  assert.equal(all.completion.reviews.length, 2)
  assert.equal(all.window.totalKnown, true)
  const newest = all.completion.reviews[0]
  const oldest = all.completion.reviews[1]
  assert.equal(newest.commandId, commandId)
  assert.equal(newest.currentLink, 'current_attempt')
  assert.equal(newest.canonical, true)
  assert.equal(oldest.commandId, baseReview.commandId)
  assert.equal(oldest.currentLink, 'historical_attempt')
  assert.equal(oldest.canonical, true)
  assert.equal(oldest.currentEligibility, 'historical_only')
  assert.equal(oldest.attemptId, chain.attemptId)

  // The same original Work/frozen source is readable through current main evidence and source audit.
  const runtime = createProductRuntime({ store: new ProductStore({ path: database }), principal,
    projects: [{ id: projectId, scope: reviewScope }], actionSecret: Buffer.alloc(32, 121), stateRoot: chain.source,
    scratchProject: chain.scratch, executionUnavailable: 'operator_disabled' })
  const apiToken = 'a'.repeat(64), headers = { authorization: `Bearer ${apiToken}` }
  const app = createLocalHttpApp({ application: runtime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: runtime.read, operations: runtime.operations })
  runtime.start()
  try {
    const evidenceResponse = await app.request(`/v1/works/${chain.workId}/evidence`, { headers })
    assert.equal(evidenceResponse.status, 200)
    const workEvidence = (await evidenceResponse.json()) as Record<string, any>
    assert.equal(workEvidence.workId, chain.workId)
    const contextResponse = await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context`, { headers })
    assert.equal(contextResponse.status, 200)
    const frozen = (await contextResponse.json()) as Record<string, any>
    assert.equal(frozen.bundleDigest, chain.frozenDigest)
    assert.equal(frozen.scope.projectId, projectId)
    assert.deepEqual(frozen.scope.allowedPaths, reviewScope.allowedPaths)
    const sourcesResponse = await app.request(`/v1/messages/${encodeURIComponent(chain.contextMessageId)}/context/sources`, { headers })
    assert.equal(sourcesResponse.status, 200)
    const foreignSource = await app.request(`/v1/messages/${encodeURIComponent(chain.sourceMessageId)}/context/sources`, { headers })
    assert.equal(foreignSource.status, 404)
  } finally { await runtime.close().catch(() => undefined) }

  // Wrong project cannot read the Work, and paging reads add no model/verification/acceptance work.
  const foreign = read(database, chain.workId, [], 'another-project')
  assert.equal(foreign.status, 'missing')
  assert.equal(foreign.exitCode, 1)
  assert.equal(all.completion.verifications.length, 2)
  assert.equal(all.completion.acceptances.length, 1)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
