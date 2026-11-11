import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkEvidenceSchema } from '../src/index.ts'
test('work evidence is bounded audit data and cannot claim execution authority', () => {
  const page = { protocol: 'work-evidence/1', workId: 'work-one', projection: 'not_in_window', entries: [], outcomes: [], truncated: true }
  assert.equal(WorkEvidenceSchema.safeParse(page).success, true)
  assert.equal(WorkEvidenceSchema.safeParse({ ...page, actor: 'forged' }).success, false)
  assert.equal(WorkEvidenceSchema.safeParse({ ...page, projection: 'verified_correct' }).success, false)
  assert.equal(WorkEvidenceSchema.safeParse({ ...page, entries: Array.from({ length: 501 }, () => ({ at: '2026-11-11T00:00:00.000Z', kind: 'work.created', sourceRef: 'work-one', detail: {} })) }).success, false)
})
