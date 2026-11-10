import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RouteAdviceSchema, ReviewEvidenceSchema, ReviewReportSchema, ExecutionOutcomeSchema } from '../src/index.ts'

const profile = { profileId: 'profile-one', revision: 1, identityDigest: 'a'.repeat(64) }
const contract = { workId: 'work-one', revision: 1, digest: 'b'.repeat(64) }
const candidate = { ticketId: 'ticket-one', assignmentId: 'assignment-one', contract, candidateGeneration: 1 }
const advice = { protocol: 'route-advice/1', id: 'advice-one', projectId: 'project-one', sourceRef: 'source-one',
  taskContextDigest: 'c'.repeat(64), catalogRevision: 'd'.repeat(64), policyRevision: 'policy-one', eligibleProfileRefs: [profile],
  suggestedProfileRef: profile, excluded: [], basis: 'only_eligible', evidenceRefs: ['evidence-one'], reviewSuggested: false,
  createdAt: '2026-11-10T00:00:00.000Z', expiresAt: '2026-11-10T01:00:00.000Z' }

test('routing advice binds exact eligible identity and tells the truth about cold start', () => {
  assert.equal(RouteAdviceSchema.safeParse(advice).success, true)
  for (const change of [{ eligibleProfileRefs: [profile, profile] }, { suggestedProfileRef: { ...profile, revision: 2 } },
    { basis: 'measured_history' }, { basis: 'fixed_rule' }, { suggestedProfileRef: null },
    { excluded: [{ profileRef: profile, reason: 'not_admitted', evidenceRefs: [] }] }, { expiresAt: advice.createdAt }, { actor: 'forged' }, { command: 'begin' }])
    assert.equal(RouteAdviceSchema.safeParse({ ...advice, ...change }).success, false)
  assert.equal(RouteAdviceSchema.safeParse({ ...advice, basis: 'none_eligible', eligibleProfileRefs: [], suggestedProfileRef: null }).success, true)
})

test('review evidence cannot become the author assignment or carry an acceptance override', () => {
  const record = { protocol: 'review-evidence/1', id: 'review-one', projectId: 'project-one', subject: { candidate, artifactDigest: 'e'.repeat(64), baseCommit: 'f'.repeat(40), environmentRef: 'environment-one', checkPolicyRef: 'checks-one' },
    reviewerProfileRef: profile, reviewAttempt: { ticketId: 'review-ticket', assignmentId: 'review-assignment', attemptId: 'attempt-review', fenceEpoch: 1, contract: { ...contract, workId: 'review-work' } },
    inputDigest: '1'.repeat(64), reportDigest: '2'.repeat(64), reportArtifactRef: 'report-one', readOnlyProofRef: 'read-only-proof', evidenceRefs: [], layer: 'controlled', disposition: 'no_findings', observedAt: advice.createdAt }
  const attempt = record.reviewAttempt
  const valid = { ...record, reviewAttempt: attempt }
  assert.equal(ReviewEvidenceSchema.safeParse(valid).success, true)
  const { readOnlyProofRef: _, ...capsule } = valid
  assert.equal(ReviewEvidenceSchema.safeParse({ ...capsule, isolation: { kind: 'sealed_copy', proofRef: 'capsule-proof', capsuleManifestDigest: '3'.repeat(64) } }).success, true)
  assert.equal(ReviewEvidenceSchema.safeParse({ ...valid, isolation: { kind: 'sealed_copy', proofRef: 'capsule-proof', capsuleManifestDigest: '3'.repeat(64) } }).success, false)
  for (const change of [{ disposition: 'PASS' }, { humanAcceptanceRef: 'forged' }, { readOnlyProofRef: undefined },
    { reviewAttempt: { ...attempt, contract } }]) assert.equal(ReviewEvidenceSchema.safeParse({ ...valid, ...change }).success, false)
})

test('outcome observations retain unknown usage and require real acceptance references', () => {
  const record = { protocol: 'execution-outcome/1', id: 'outcome-one', projectId: 'project-one', attempt: { ticketId: candidate.ticketId,
    assignmentId: candidate.assignmentId, contract, attemptId: 'attempt-one', fenceEpoch: 1 }, profileRef: profile,
    acceptance: 'unknown', evidenceRefs: [], layer: 'controlled', usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: advice.createdAt }
  assert.equal(ExecutionOutcomeSchema.safeParse(record).success, true)
  assert.equal(ExecutionOutcomeSchema.safeParse({ ...record, acceptance: 'accepted' }).success, false)
  assert.equal(ExecutionOutcomeSchema.safeParse({ ...record, candidate: { ...candidate, assignmentId: 'another-assignment' } }).success, false)
})
test('review reports cannot turn findings into PASS or register executable tools', () => {
  const report = { protocol: 'review-report/1', subjectDigest: 'a'.repeat(64), disposition: 'no_findings', summary: 'No findings', findings: [], limitations: [] }
  assert.equal(ReviewReportSchema.safeParse(report).success, true)
  assert.equal(ReviewReportSchema.safeParse({ ...report, disposition: 'PASS' }).success, false)
  assert.equal(ReviewReportSchema.safeParse({ ...report, disposition: 'findings' }).success, false)
  assert.equal(ReviewReportSchema.safeParse({ ...report, command: '/bin/sh' }).success, false)
  assert.equal(ReviewReportSchema.safeParse({ ...report, disposition: 'findings', findings: [{ path: '../private', severity: 'high', claim: 'Bad path' }] }).success, false)
})
