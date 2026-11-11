import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkEvidenceHistoryQuerySchema, WorkEvidenceHistorySchema } from '../src/index.ts'
test('evidence continuation and bounded coverage cannot be relabelled as complete', () => {
  const page = { protocol: 'work-evidence-history/1', workId: 'work', contract: { workId: 'work', revision: 1, digest: 'a'.repeat(64) },
    observedAt: '2026-11-11T00:00:00.000Z', entries: [], hasMore: false, window: 'complete', sourcesCapped: [] }
  assert.equal(WorkEvidenceHistorySchema.safeParse(page).success, true)
  for (const change of [{ hasMore: true }, { window: 'storage_cap' }, { sourcesCapped: ['outcomes'] }, { contract: { ...page.contract, workId: 'other' } }])
    assert.equal(WorkEvidenceHistorySchema.safeParse({ ...page, ...change }).success, false)
  assert.equal(WorkEvidenceHistoryQuerySchema.safeParse({ limit: 101 }).success, false)
  assert.equal(WorkEvidenceHistoryQuerySchema.safeParse({ projectId: 'foreign' }).success, false)
})
