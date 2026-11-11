import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AttemptRef, ExecutionProfileRef, ExecutionOutcome, ReviewReport, ReviewSubject, RouteAdvice, Scope } from '@personal-agent/contracts'
import {
  InMemoryRoutingEvidence,
  RoutingEvidenceConflict,
  adviseRoute,
  assembleReviewEvidence,
  assessReviewValidity,
  groupAttention,
  parseReviewReport,
  profileRefKey,
  rankAttention,
  reviewReportDigest,
  reviewSubjectDigest,
  validateAdviceForConfirmation,
} from '../src/index.ts'
import type { AttentionItem, ProfileFacts } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const profile = (id = 'codex-native', digest = 'a'.repeat(64)): ExecutionProfileRef => ({
  profileId: id,
  revision: 1,
  identityDigest: digest,
})
const profileFacts = (value: ExecutionProfileRef, admitted = true): ProfileFacts => ({
  ref: value,
  currentIdentityDigest: value.identityDigest,
  admitted,
  admissionLayer: admitted ? 'actual_native' : 'controlled',
  capabilities: [{ feature: 'code', proven: true, layer: 'actual_native', evidenceRefs: ['capability-1'] }],
  allowedScope: scope,
  budget: { available: true, evidenceRefs: ['budget-1'] },
  dataEgressAuthorized: true,
  evidenceRefs: ['admission-1'],
})

const subject = (generation = 3): ReviewSubject => ({
  candidate: {
    ticketId: 'ticket-author',
    assignmentId: 'assignment-author',
    contract: { workId: 'work-author', revision: 2, digest: 'a'.repeat(64) },
    candidateGeneration: generation,
  },
  artifactDigest: 'b'.repeat(64),
  baseCommit: 'c'.repeat(40),
  environmentRef: 'env-1',
  checkPolicyRef: 'check-1',
})
const attempt: AttemptRef = {
  ticketId: 'ticket-review',
  assignmentId: 'assignment-review',
  contract: { workId: 'work-review', revision: 1, digest: 'd'.repeat(64) },
  attemptId: 'attempt-review',
  fenceEpoch: 1,
}
const report = (value: ReviewSubject): ReviewReport => ({
  protocol: 'review-report/1',
  subjectDigest: reviewSubjectDigest(value),
  disposition: 'findings',
  summary: 'One issue found',
  findings: [{ path: 'src/app.ts', severity: 'high', claim: 'Bug' }],
  limitations: [],
})

test('attention ranking and grouping work across projects before any routing decision', () => {
  const items: AttentionItem[] = [
    {
      id: 'question-1',
      kind: 'question',
      category: 'permission',
      projectId: 'project-1',
      sourceRef: 'work-1',
      createdAt: NOW,
      waitingSince: NOW,
      actionable: true,
      businessDeadline: { at: '2026-11-11T00:00:00.000Z', sourceRef: 'contract-1' },
      version: 1,
    },
    {
      id: 'question-2',
      kind: 'question',
      category: 'clarification',
      projectId: 'project-2',
      sourceRef: 'work-2',
      createdAt: NOW,
      waitingSince: NOW,
      actionable: true,
      expiresAt: '2026-11-09T00:00:00.000Z',
      version: 1,
    },
  ]
  const ranked = rankAttention(items, { now: new Date(NOW) })
  assert.deepEqual(ranked.map((item) => item.id), ['question-1', 'question-2'])
  assert.equal(ranked[1]?.actionable, false)
  const groups = groupAttention(ranked)
  assert.equal(groups.length, 2)
  assert.equal(groups.find((group) => group.projectId === 'project-1')?.requiresPerTargetApproval, true)
})

test('advice is persisted, replayed and confirmed only against current facts', () => {
  const a = profile('profile-a')
  const b = profile('profile-b', 'b'.repeat(64))
  const adviceResult = adviseRoute({
    id: 'advice-1',
    projectId: 'project-1',
    sourceRef: 'source-1',
    taskContextDigest: 'a'.repeat(64),
    catalogRevision: 'b'.repeat(64),
    policyRevision: 'policy-1',
    eligibility: [
      { ref: a, eligible: true, reasons: [], evidenceRefs: ['evidence-a'], budgetUnknown: false },
      { ref: b, eligible: false, reasons: [{ code: 'evidence_missing', evidenceRefs: ['evidence-b'] }], evidenceRefs: ['evidence-b'], budgetUnknown: false },
    ],
    evidenceByProfile: { [profileRefKey(a)]: ['evidence-a'] },
    now: new Date(NOW),
  })
  assert.equal(adviceResult.kind, 'advice')
  if (adviceResult.kind !== 'advice') throw new Error('unreachable')
  const advice = adviceResult.advice
  const evidence = new InMemoryRoutingEvidence()
  assert.equal(evidence.advice.put(advice).replayed, false)
  assert.equal(evidence.advice.put(advice).replayed, true)
  assert.throws(() => evidence.advice.put({ ...advice, suggestedProfileRef: null, basis: 'none_eligible', eligibleProfileRefs: [] }), RoutingEvidenceConflict)

  const verdict = validateAdviceForConfirmation(advice, {
    now: new Date(NOW),
    projectId: 'project-1',
    taskContextDigest: 'a'.repeat(64),
    catalogRevision: 'b'.repeat(64),
    policyRevision: 'policy-1',
    projectScope: scope,
    profiles: [{ ref: a, admitted: true, allowedScope: scope, currentIdentityDigest: a.identityDigest }],
  })
  assert.equal(verdict.ok, true)
})

test('a frozen subject gets a structured review, persisted evidence and invalidation on change', () => {
  const reviewer = profile('reviewer', 'e'.repeat(64))
  const evidencePort = new InMemoryRoutingEvidence()
  const frozen = subject(3)
  const parsed = parseReviewReport(report(frozen))
  const validity = assessReviewValidity({
    now: new Date(NOW),
    subject: frozen,
    report: parsed,
    reportDigest: reviewReportDigest(parsed),
    inputDigest: '2'.repeat(64),
    currentInputDigest: '2'.repeat(64),
    current: {
      candidate: {
        ticketId: frozen.candidate.ticketId,
        assignmentId: frozen.candidate.assignmentId,
        contract: frozen.candidate.contract,
        candidateGeneration: frozen.candidate.candidateGeneration,
      },
      artifactDigest: frozen.artifactDigest,
      baseCommit: frozen.baseCommit,
      environmentRef: frozen.environmentRef,
      checkPolicyRef: frozen.checkPolicyRef,
    },
    reviewerProfileRef: reviewer,
    currentReviewerProfileRef: reviewer,
    reviewerAuthorizedForProject: true,
    reviewAttempt: attempt,
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    claimedLayer: 'controlled',
    trustedProducerLayer: 'controlled',
  })
  assert.equal(validity.state, 'current')
  assert.equal(validity.machinePass, false)

  const review = assembleReviewEvidence({
    id: 'review-1',
    projectId: 'project-1',
    subject: frozen,
    reviewerProfileRef: reviewer,
    reviewAttempt: attempt,
    inputDigest: '2'.repeat(64),
    report: parsed,
    reportArtifactRef: 'artifact-1',
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    evidenceRefs: ['evidence-1'],
    layer: 'controlled',
    observedAt: NOW,
  })
  assert.equal(evidencePort.reviews.put(review).replayed, false)
  assert.equal(evidencePort.reviews.put(review).replayed, true)
  assert.equal(evidencePort.reviews.list({ projectId: 'project-1', subject: frozen }).records.length, 1)

  const staleCandidate = assessReviewValidity({
    now: new Date(NOW),
    subject: frozen,
    report: parsed,
    reportDigest: reviewReportDigest(parsed),
    inputDigest: '2'.repeat(64),
    currentInputDigest: '2'.repeat(64),
    current: {
      candidate: {
        ticketId: frozen.candidate.ticketId,
        assignmentId: frozen.candidate.assignmentId,
        contract: frozen.candidate.contract,
        candidateGeneration: 4,
      },
      artifactDigest: frozen.artifactDigest,
      baseCommit: frozen.baseCommit,
      environmentRef: frozen.environmentRef,
      checkPolicyRef: frozen.checkPolicyRef,
    },
    reviewerProfileRef: reviewer,
    currentReviewerProfileRef: reviewer,
    reviewerAuthorizedForProject: true,
    reviewAttempt: attempt,
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    claimedLayer: 'controlled',
    trustedProducerLayer: 'controlled',
  })
  assert.equal(staleCandidate.state, 'stale')
  assert.ok(staleCandidate.reasons.some((reason) => reason.code === 'candidate_changed'))

  const staleProfile = assessReviewValidity({
    now: new Date(NOW),
    subject: frozen,
    report: parsed,
    reportDigest: reviewReportDigest(parsed),
    inputDigest: '2'.repeat(64),
    currentInputDigest: '2'.repeat(64),
    current: {
      candidate: {
        ticketId: frozen.candidate.ticketId,
        assignmentId: frozen.candidate.assignmentId,
        contract: frozen.candidate.contract,
        candidateGeneration: frozen.candidate.candidateGeneration,
      },
      artifactDigest: frozen.artifactDigest,
      baseCommit: frozen.baseCommit,
      environmentRef: frozen.environmentRef,
      checkPolicyRef: frozen.checkPolicyRef,
    },
    reviewerProfileRef: reviewer,
    currentReviewerProfileRef: { ...reviewer, identityDigest: '9'.repeat(64) },
    reviewerAuthorizedForProject: true,
    reviewAttempt: attempt,
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    claimedLayer: 'controlled',
    trustedProducerLayer: 'controlled',
  })
  assert.ok(staleProfile.reasons.some((reason) => reason.code === 'reviewer_identity_drift'))
})

test('outcomes persist append-only and list by exact profile', () => {
  const a = profile('profile-a')
  const outcome: ExecutionOutcome = {
    protocol: 'execution-outcome/1',
    id: 'outcome-1',
    projectId: 'project-1',
    attempt,
    profileRef: a,
    acceptance: 'not_requested',
    evidenceRefs: ['evidence-1'],
    layer: 'controlled',
    usage: { completeness: 'observed', inputTokens: 10, outputTokens: 5, evidenceRefs: ['usage-1'] },
    observedAt: NOW,
  }
  const port = new InMemoryRoutingEvidence()
  assert.equal(port.outcomes.put(outcome).replayed, false)
  assert.equal(port.outcomes.put(outcome).replayed, true)
  assert.equal(port.outcomes.list({ projectId: 'project-1', profile: a }).records.length, 1)
  assert.equal(port.outcomes.list({ projectId: 'project-1', profile: profile('profile-b') }).records.length, 0)
})
