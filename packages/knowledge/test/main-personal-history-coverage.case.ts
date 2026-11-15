import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { buildPersonalChain, projectId } from './helpers/personal-chain.ts'

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

test('history coverage composes A per-ticket caps with the local window instead of calling a truncated source complete', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-coverage-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const database = join(chain.source, 'state.sqlite')
  const baseline = read(database, chain.workId)
  assert.equal(baseline.protocol, 'wave31-completion-history/1')
  assert.equal(baseline.status, 'ok')
  assert.equal(baseline.completion.reviews.length, 1)
  assert.equal(baseline.coverage.reviews.state, 'complete')
  assert.equal(baseline.coverage.reviews.availableKnown, true)
  assert.equal(baseline.coverage.reviews.available, 1)
  assert.equal(baseline.source.coverage.reviews, 'complete')
  assert.equal(baseline.source.limits.perTicket, 50)
  assert.equal(baseline.window.totalKnown, true)

  // A local window below a complete source is bounded locally and names the next offset.
  const local = read(database, chain.workId, ['--limit', '0'])
  assert.equal(local.coverage.reviews.state, 'truncated_local')
  assert.equal(local.coverage.reviews.returned, 0)
  assert.equal(local.coverage.reviews.available, 1)
  assert.equal(local.coverage.reviews.truncated, true)
  const beyond = read(database, chain.workId, ['--offset', '5'])
  assert.equal(beyond.completion.reviews.length, 0)
  assert.match(String(beyond.note), /not proof of no history/)

  // A's own per-ticket cap (50) is reported as a truncated source, not as a complete history.
  const storage = await import(pathToFileURL(join(aWorktree, 'packages/storage/src/index.ts')).href)
  const evidence = await import(pathToFileURL(join(aWorktree, 'packages/verification/src/evidence.ts')).href)
  const store = new storage.ProductStore({ path: database })
  try {
    const writer = new evidence.CompletionEvidenceStore(store)
    const template = baseline.completion.verifications[0]
    for (let index = 0; index < 51; index += 1) {
      writer.recordVerification({
        id: `w31-extra-${index}`, ticketId: chain.ticketId, assignmentId: chain.assignmentId,
        candidateGeneration: 100 + index, contract: chain.contract,
        artifactDigest: createHash('sha256').update(`w31-${index}`).digest('hex'),
        criteriaDigest: template.criteriaDigest, environmentRef: template.environmentRef,
        verifierIdentityRef: template.verifierIdentityRef,
        results: template.results,
      })
    }
  } finally { store.close() }

  const capped = read(database, chain.workId, ['--limit', '1000'])
  assert.equal(capped.source.coverage.verifications, 'truncated')
  assert.equal(capped.coverage.verifications.state, 'truncated_source')
  assert.equal(capped.coverage.verifications.availableKnown, false)
  assert.equal(capped.coverage.verifications.available, null)
  assert.equal(capped.coverage.verifications.returned, 50)
  assert.equal(capped.coverage.verifications.truncated, true)
  assert.equal(capped.coverage.reviews.state, 'truncated_source')
  assert.equal(capped.coverage.unclassifiedReviews.state, 'truncated_source')
  assert.equal(capped.window.totalKnown, false)
  // The capped slice may legitimately omit the reviewed verification; the truncated state is
  // what prevents a caller from reading an empty page as a complete no-history answer.
  assert.equal(capped.completion.reviews.length <= 1, true)
  assert.equal(capped.coverage.reviews.returned, capped.completion.reviews.length)

  // A wider local limit cannot turn a truncated source into a complete one, and zero still says why it is empty.
  const cappedWide = read(database, chain.workId, ['--limit', '5000'])
  assert.equal(cappedWide.coverage.verifications.state, 'truncated_source')
  const cappedZero = read(database, chain.workId, ['--limit', '0'])
  assert.equal(cappedZero.coverage.reviews.state, 'truncated_source')
  assert.equal(cappedZero.coverage.reviews.returned, 0)
  assert.equal(cappedZero.coverage.reviews.availableKnown, false)

  // Reading coverage adds no model call; acceptances remain the original one.
  assert.equal(capped.coverage.acceptances.state, 'complete')
  assert.equal(capped.coverage.acceptances.returned, 1)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
