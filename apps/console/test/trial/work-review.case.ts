import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DecisionPage, WorkEvidence, WorkEvidenceHistory, WorkView, WorkVerificationStatus } from '@personal-agent/contracts'
import {
  trialDecisionRows, trialReviewSnapshot, trialWorkHistoryAdmission, trialWorkHistoryMerge,
} from '../../src/trial/work-review.ts'

const contract = { workId: 'work-1', revision: 2, digest: 'a'.repeat(64), scope: { projectId: 'project-atlas' } }
const entry = (kind: string, ref: string) => ({ at: '2026-11-16T00:00:00.000Z', kind, sourceRef: ref, detail: {} })
const history = (over: Partial<WorkEvidenceHistory> = {}): WorkEvidenceHistory => ({
  protocol: 'work-evidence-history/1', workId: 'work-1', contract, observedAt: '2026-11-16T00:10:00.000Z',
  entries: [entry('work.created', 'ref-1')], hasMore: false, window: 'complete', sourcesCapped: [], ...over,
} as WorkEvidenceHistory)
const work = (over: Partial<WorkView> = {}): WorkView => ({
  work: { id: 'work-1', projectId: 'project-atlas', conversationId: 'conv-1', title: 'Work', createdAt: '2026-11-16T00:00:00.000Z' },
  contract: { workId: 'work-1', revision: 2, digest: 'a'.repeat(64), scope: { projectId: 'project-atlas', allowedPaths: [], excludedPaths: [], externalActions: [] } },
  links: [], phase: 'delivered', coreSnapshotRef: 'core', openQuestionIds: [], artifactIds: ['artifact-1'], resourceStatus: 'quiescent',
  evidenceRefs: [], actions: { dispatchHold: { paused: false, revision: 0 as never }, available: ['accept_candidate'] as never }, ...over,
} as unknown as WorkView)
const verification = (over: Partial<WorkVerificationStatus> = {}): WorkVerificationStatus => ({
  protocol: 'work-verification/1', workId: 'work-1', state: 'finished', verificationId: 'verify-1', retryAvailable: false, ...over,
} as WorkVerificationStatus)
const evidence = (over: Partial<WorkEvidence> = {}): WorkEvidence => ({
  protocol: 'work-evidence/1', workId: 'work-1', projection: 'recorded', entries: [], outcomes: [], truncated: false, ...over,
} as WorkEvidence)

test('work history accepts the exact work/contract and keeps coverage', () => {
  const page = trialWorkHistoryAdmission(history({ window: 'storage_cap', sourcesCapped: ['source-1'] }), { workId: 'work-1', revision: 2 })
  assert.equal(page.ok, true)
  if (page.ok) {
    assert.equal(page.page.entries.length, 1)
    assert.equal(page.page.window, 'storage_cap')
    assert.deepEqual(page.page.sourcesCapped, ['source-1'])
  }
})

test('work history refuses foreign work and stale contract', () => {
  const foreign = trialWorkHistoryAdmission(history({ workId: 'work-2' }), { workId: 'work-1' })
  assert.equal(!foreign.ok && foreign.reason, 'foreign_work')
  const stale = trialWorkHistoryAdmission(history(), { workId: 'work-1', revision: 3 })
  assert.equal(!stale.ok && stale.reason, 'stale_contract')
})

test('work history refuses duplicate events and inconsistent continuation', () => {
  const duplicate = history({ entries: [entry('work.created', 'r'), entry('work.created', 'r')] })
  assert.equal(!trialWorkHistoryAdmission(duplicate, { workId: 'work-1' }).ok, true)
  const cursor = history({ hasMore: true })
  assert.equal(!trialWorkHistoryAdmission(cursor, { workId: 'work-1' }).ok, true)
})

test('work history merge rejects overlap and contract drift', () => {
  const first = trialWorkHistoryAdmission(history(), { workId: 'work-1' })
  assert.equal(first.ok, true)
  if (!first.ok) return
  const merged = trialWorkHistoryMerge(first.page, history({ entries: [entry('verification.recorded', 'r2')] }), { workId: 'work-1' })
  assert.equal(merged.ok, true)
  if (merged.ok) assert.equal(merged.page.entries.length, 2)
  const overlap = trialWorkHistoryMerge(first.page, history({ entries: [entry('work.created', 'ref-1')] }), { workId: 'work-1' })
  assert.equal(!overlap.ok && overlap.reason, 'duplicate_entry')
  const drifted = trialWorkHistoryMerge(first.page, history({ contract: { ...contract, revision: 3 } }), { workId: 'work-1' })
  assert.equal(!drifted.ok && drifted.reason, 'stale_contract')
})

const decision = (over: { status?: string; source?: string; expiresAt?: string; version?: number } = {}) => ({
  record: { decision: { id: 'decision-1', version: over.version ?? 1, content: '采用标准检查', authorityRef: 'auth', scope: { projectId: 'project-atlas', allowedPaths: ['src/'], excludedPaths: [], externalActions: [], ...(over.expiresAt ? { expiresAt: over.expiresAt } : {}) } },
    sourceMessageId: 'msg-1', sourceTextDigest: 'b'.repeat(64), conversationId: 'conv-1', actorRef: 'user', recordedAt: '2026-11-16T00:00:00.000Z' },
  sourceState: over.source ?? 'current', status: over.status ?? 'recorded',
})
const page = (rows: unknown[] = [decision()]): DecisionPage => ({ protocol: 'decision-catalog/1', decisions: rows, hasMore: false } as DecisionPage)

test('current recorded decisions are selectable references, never grants', () => {
  const result = trialDecisionRows(page(), 'project-atlas', Date.parse('2026-11-16T01:00:00.000Z'))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.rows[0]?.selectable, true)
  assert.equal(result.rows[0]?.statusLabel, '已记录')
})

test('revoked, superseded, expired and stale-source decisions are refused', () => {
  const now = Date.parse('2026-11-16T01:00:00.000Z')
  const rows = [
    decision({ status: 'revoked' }), decision({ status: 'superseded' }),
    decision({ expiresAt: '2026-11-16T00:30:00.000Z' }), decision({ source: 'missing' }),
    decision({ source: 'stale' }),
  ]
  const result = trialDecisionRows(page(rows), 'project-atlas', now)
  assert.equal(result.ok, true)
  if (!result.ok) return
  for (const row of result.rows) assert.equal(row.selectable, false)
  assert.deepEqual(result.rows.map(row => row.reason), ['revoked', 'superseded', 'expired', 'source_missing', 'source_stale'])
})

test('decision pages from another project or with a bad cursor are refused', () => {
  const foreign = trialDecisionRows(page([decision()]), 'project-beta')
  assert.equal(!foreign.ok && foreign.reason, 'foreign_project')
  const bad = trialDecisionRows({ protocol: 'decision-catalog/1', decisions: [], hasMore: true } as DecisionPage, 'project-atlas')
  assert.equal(!bad.ok && bad.reason, 'invalid_continuation')
})

test('review snapshot rejects foreign evidence and stale contracts', () => {
  const foreign = trialReviewSnapshot(work(), verification({ workId: 'work-2' }), undefined)
  assert.equal(!foreign.ok && foreign.reason, 'foreign_work')
  const stale = trialReviewSnapshot(work(), undefined, evidence({ outcomes: [{
    attempt: { contract: { ...contract, revision: 1 } },
  }] as never }))
  assert.equal(!stale.ok && stale.reason, 'stale_contract')
})

test('review snapshot keeps machine failure and missing acceptance explicit', () => {
  const blocked = trialReviewSnapshot(work(), verification({ state: 'blocked', failure: { id: 'failure-1', code: 'verification_failed', failureCount: 2 } }), evidence())
  assert.equal(blocked.ok, true)
  if (!blocked.ok) return
  assert.equal(blocked.snapshot.machineFailure, 'verification_failed')
  assert.equal(blocked.snapshot.acceptOffered, false)
  assert.ok(blocked.snapshot.blockers.some(item => item.includes('机器检查失败')))
  assert.equal(blocked.snapshot.acceptance, 'unobserved')
})

test('review snapshot offers acceptance only after a finished check and keeps it advisory', () => {
  const view = trialReviewSnapshot(work(), verification(), evidence())
  assert.equal(view.ok, true)
  if (!view.ok) return
  assert.equal(view.snapshot.acceptOffered, true)
  assert.equal(view.snapshot.acceptance, 'unobserved')
  assert.equal(view.snapshot.projection, 'recorded')
})
