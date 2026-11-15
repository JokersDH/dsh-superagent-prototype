import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { buildPersonalChain, projectId, restoreSnapshotWithA } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tool = join(repoRoot, 'packages/context/tools/wave30-completion-history.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'

function read(database: string, workId: string, limit?: number): Record<string, any> {
  const args = ['--experimental-strip-types', '--no-warnings', tool, '--a-worktree', aWorktree, '--db', database,
    '--work', workId, '--project', projectId]
  if (limit !== undefined) args.push('--limit', String(limit))
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000 })
  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, any>
  parsed.exitCode = result.status
  return parsed
}

test('A historical completion binding keeps old reviews readable while current eligibility stays with ProductCompletion', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave30-history-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const database = join(chain.source, 'state.sqlite')
  const source = read(database, chain.workId)
  assert.equal(source.protocol, 'wave30-completion-history/1')
  assert.equal(source.status, 'ok')
  assert.equal(source.authorityState, 'current')
  assert.equal(source.authorization, 'none')
  assert.equal(source.currentEligibility, 'delegated_to_ProductCompletion')
  assert.equal(source.contract.workId, chain.workId)
  assert.equal(source.completion.reviews.length, 1)
  assert.equal(source.completion.unclassifiedReviews.length, 0)
  const review = source.completion.reviews[0]
  assert.equal(review.canonical, true)
  assert.equal(review.historical, true)
  assert.equal(review.currentLink, 'current_attempt')
  assert.equal(review.currentEligibility, 'candidate_for_current')
  assert.equal(typeof review.bindingState, 'string')
  assert.equal(review.proposal.ticketId, chain.ticketId)
  assert.equal(review.proposal.assignmentId, chain.assignmentId)
  assert.equal(source.completion.verifications.length, 1)
  assert.equal(source.completion.acceptances.length, 1)
  assert.deepEqual(source.coverage.reviews, { state: 'complete', returned: 1, available: 1, limit: 64, truncated: false })
  const modelCalls = chain.model.requests.length

  // Same facts through A's official restore to a second root.
  const restored = join(root, 'restored-history')
  await restoreSnapshotWithA(aWorktree, chain.v1.destination, restored, chain.source)
  const restoredFacts = read(join(restored, 'state.sqlite'), chain.workId)
  assert.equal(restoredFacts.completion.reviews[0].commandId, review.commandId)
  assert.equal(restoredFacts.completion.reviews[0].currentLink, 'current_attempt')
  assert.equal(restoredFacts.completion.verifications[0].id, source.completion.verifications[0].id)
  assert.equal(restoredFacts.completion.acceptances[0].id, source.completion.acceptances[0].id)

  // A new epoch moves the ticket's current pointer; the old review stays historically valid but not current.
  const store = new ProductStore({ path: database })
  try {
    const original = store.bindings.binding<Record<string, any>>(chain.attemptId)
    assert.ok(original)
    const nextAttempt = 'w30-next-attempt'
    store.bindings.record({ ...original, attemptId: nextAttempt, fenceEpoch: chain.fenceEpoch + 1, state: 'active' } as never)
    store.bindings.setCurrent(chain.ticketId, nextAttempt)
    store.bindings.end(chain.attemptId)
    assert.throws(() => store.bindings.record({ ...original, attemptId: chain.attemptId, assignmentId: 'foreign-assignment' } as never),
      /different immutable binding identity/)
    assert.throws(() => store.bindings.setCurrent(chain.ticketId, chain.attemptId), /cannot become current/)
  } finally { store.close() }

  const afterEpoch = read(database, chain.workId)
  assert.equal(afterEpoch.completion.reviews.length, 1)
  const historical = afterEpoch.completion.reviews[0]
  assert.equal(historical.commandId, review.commandId)
  assert.equal(historical.canonical, true)
  assert.equal(historical.currentLink, 'historical_attempt')
  assert.equal(historical.bindingState, 'ended')
  assert.equal(historical.currentEligibility, 'historical_only')
  assert.equal(afterEpoch.completion.verifications[0].id, source.completion.verifications[0].id)
  assert.equal(afterEpoch.completion.acceptances[0].id, source.completion.acceptances[0].id)

  // Explicit bounded coverage never reports a complete history.
  const bounded = read(database, chain.workId, 0)
  assert.equal(bounded.completion.reviews.length, 0)
  assert.deepEqual(bounded.coverage.reviews, { state: 'bounded', returned: 0, available: 1, limit: 0, truncated: true })

  // Unknown Work is an explicit missing result, not an empty complete history.
  const missing = read(database, 'missing-work-id')
  assert.equal(missing.status, 'missing')
  assert.equal(missing.exitCode, 1)

  // Reading facts adds no model call, verification, acceptance or event.
  const finalState = read(database, chain.workId)
  assert.equal(finalState.completion.verifications.length, source.completion.verifications.length)
  assert.equal(finalState.completion.acceptances.length, source.completion.acceptances.length)
  assert.equal(chain.model.requests.length, modelCalls)
})
