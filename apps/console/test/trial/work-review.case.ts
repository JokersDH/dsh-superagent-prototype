import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DecisionPage, WorkCompletionHistory, WorkEvidence, WorkView, WorkVerificationStatus } from '@personal-agent/contracts'
import {
  trialCompletionHistoryAdmission, trialCompletionHistoryMerge, trialDecisionRows, trialReviewSnapshot,
} from '../../src/trial/work-review.ts'

const contract = { workId: 'work-1', revision: 2, digest: 'a'.repeat(64), scope: { projectId: 'project-atlas' } }
const verificationRow = (id: string) => ({ kind: 'verifications' as const, id, ticketId: 'ticket-1', assignmentId: 'assignment-1',
  generation: 1, artifactDigest: 'b'.repeat(64), at: '2026-11-16T00:00:00.000Z', criteriaDigest: 'c'.repeat(64) })
const completion = (over: Partial<WorkCompletionHistory> = {}): WorkCompletionHistory => ({
  protocol: 'work-completion-history/1', workId: 'work-1', projectId: 'project-atlas', currentContract: contract,
  kind: 'verifications', observedAt: '2026-11-16T00:10:00.000Z', mode: 'live_keyset', authorization: 'none',
  status: 'ok', reason: null, limit: 10, returned: 1, available: 3, entries: [verificationRow('verify-1')],
  hasMore: false, coverage: 'complete', maxBytes: 131072, ...over,
} as WorkCompletionHistory)
const scope = { workId: 'work-1', projectId: 'project-atlas', kind: 'verifications' as const, revision: 2 }
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

test('classified history accepts exact work/project/kind and keeps source totals', () => {
  const admitted = trialCompletionHistoryAdmission(completion({ available: 7 }), scope)
  assert.equal(admitted.ok, true)
  if (admitted.ok) {
    assert.equal(admitted.page.kind, 'verifications')
    assert.equal(admitted.page.available, 7)
    assert.equal(admitted.page.coverage, 'complete')
    assert.equal(admitted.page.entries.length, 1)
  }
})

test('classified history refuses foreign work/project/kind and a changed current contract', () => {
  const work = trialCompletionHistoryAdmission(completion({ workId: 'work-2' }), scope)
  assert.equal(!work.ok && work.reason, 'foreign_work')
  const project = trialCompletionHistoryAdmission(completion({ projectId: 'project-beta' }), scope)
  assert.equal(!project.ok && project.reason, 'foreign_project')
  const kind = trialCompletionHistoryAdmission(completion(), { ...scope, kind: 'contracts' })
  assert.equal(!kind.ok && kind.reason, 'kind_mismatch')
  const stale = trialCompletionHistoryAdmission(completion(), { ...scope, revision: 3 })
  assert.equal(!stale.ok && stale.reason, 'stale_contract')
})

test('blocked oversized history is not drawn as a complete empty page', () => {
  const blocked = trialCompletionHistoryAdmission(completion({ status: 'blocked', reason: 'entry_too_large', returned: 0, entries: [], available: 0, hasMore: true, coverage: 'partial' }), scope)
  assert.equal(!blocked.ok && blocked.reason, 'blocked')
})

test('classified history refuses duplicate rows and inconsistent continuation', () => {
  const duplicate = completion({ returned: 2, available: 2, entries: [verificationRow('verify-1'), verificationRow('verify-1')] })
  assert.equal(!trialCompletionHistoryAdmission(duplicate, scope).ok, true)
  const cursor = completion({ hasMore: true, coverage: 'partial' })
  assert.equal(!trialCompletionHistoryAdmission(cursor, scope).ok, true)
})

test('classified history merge rejects overlap, kind drift and contract drift', () => {
  const first = trialCompletionHistoryAdmission(completion(), scope)
  assert.equal(first.ok, true)
  if (!first.ok) return
  const merged = trialCompletionHistoryMerge(first.page, completion({ entries: [verificationRow('verify-2')] }), scope)
  assert.equal(merged.ok, true)
  if (merged.ok) assert.equal(merged.page.entries.length, 2)
  const overlap = trialCompletionHistoryMerge(first.page, completion({ entries: [verificationRow('verify-1')] }), scope)
  assert.equal(!overlap.ok && overlap.reason, 'duplicate_entry')
  const kind = trialCompletionHistoryMerge(first.page, completion({ kind: 'acceptances', entries: [{ kind: 'acceptances', id: 'a',
    ticketId: 't', assignmentId: 'a', generation: 1, artifactDigest: 'd'.repeat(64), at: '2026-11-16T00:00:00.000Z', criterionCount: 1 }] }), { ...scope, kind: 'acceptances' })
  assert.equal(!kind.ok && kind.reason, 'kind_mismatch')
  const stale = trialCompletionHistoryMerge(first.page, completion({ currentContract: { ...contract, revision: 3 } }), scope)
  assert.equal(!stale.ok && stale.reason, 'stale_contract')
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
