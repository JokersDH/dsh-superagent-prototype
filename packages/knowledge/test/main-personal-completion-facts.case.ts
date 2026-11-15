import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { buildPersonalChain, projectId, restoreSnapshotWithA } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tool = join(repoRoot, 'packages/context/tools/wave29-completion-facts.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'

function readFacts(database: string, workId: string) {
  const stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tool,
    '--a-worktree', aWorktree, '--db', database, '--work', workId, '--project', projectId], { encoding: 'utf8', timeout: 60000 })
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, any>
}

test('A strict completion facts classify canonical reviews and never turn raw receipts into current/accepted', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave29-facts-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const source = readFacts(join(chain.source, 'state.sqlite'), chain.workId)
  assert.equal(source.status, 'ok')
  assert.equal(source.authorityState, 'current')
  assert.equal(source.contract.workId, chain.workId)
  assert.equal(source.completion.reviews.length, 1)
  assert.equal(source.completion.unclassifiedReviews.length, 0)
  assert.equal(source.completion.reviews[0].canonical, true)
  assert.equal(source.completion.reviews[0].proposal.ticketId, chain.ticketId)
  assert.equal(source.completion.reviews[0].proposal.assignmentId, chain.assignmentId)
  assert.equal(source.completion.verifications.length, 1)
  assert.equal(source.completion.acceptances.length, 1)

  const restored = join(root, 'restored-facts')
  await restoreSnapshotWithA(aWorktree, chain.v1.destination, restored, chain.source)
  const restoredFacts = readFacts(join(restored, 'state.sqlite'), chain.workId)
  assert.equal(restoredFacts.completion.reviews[0].commandId, source.completion.reviews[0].commandId)
  assert.equal(restoredFacts.completion.verifications[0].id, source.completion.verifications[0].id)
  assert.equal(restoredFacts.completion.acceptances[0].id, source.completion.acceptances[0].id)

  // A raw receipt with a plausible ticketId is classified as unclassified, not as a review/current/accepted.
  const rawRoot = join(root, 'raw-receipt')
  mkdirSync(rawRoot, { recursive: true, mode: 0o700 })
  cpSync(join(restored, 'state.sqlite'), join(rawRoot, 'state.sqlite'))
  const raw = new ProductStore({ path: join(rawRoot, 'state.sqlite') })
  try {
    raw.commands.record('raw-review-receipt', 'a'.repeat(64), () => ({
      proposal: { ticketId: chain.ticketId, assignmentId: chain.assignmentId,
        contract: { ...chain.contract, digest: 'f'.repeat(64) }, candidateGeneration: 1 },
      verification: {}, artifactIds: [],
    }))
  } finally { raw.close() }

  const rawFacts = readFacts(join(rawRoot, 'state.sqlite'), chain.workId)
  assert.equal(rawFacts.completion.reviews.length, 1)
  // The raw receipt is not derived from a verified completion record, so it can never become a review/current/accepted.
  assert.equal(rawFacts.completion.reviews.some((entry: { commandId: string }) => entry.commandId === 'raw-review-receipt'), false)
  assert.equal(rawFacts.completion.reviews.length, source.completion.reviews.length)
  assert.equal(rawFacts.completion.reviews[0].canonical, true)
  assert.equal(rawFacts.completion.verifications.length, source.completion.verifications.length)
  assert.equal(rawFacts.completion.acceptances.length, source.completion.acceptances.length)
})
