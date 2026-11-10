import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AttemptRef, ExecutionProfileRef, ReviewReport, ReviewSubject } from '@personal-agent/contracts'
import {
  assembleReviewEvidence,
  assessReviewEvidence,
  assessReviewValidity,
  parseReviewReport,
  reviewReportDigest,
  reviewSubjectDigest,
  tryParseReviewReport,
  ReviewParseError,
} from '../src/index.ts'
import type { ReviewCurrentFacts } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const subjectFixture = (): ReviewSubject => ({
  candidate: {
    ticketId: 'ticket-author',
    assignmentId: 'assignment-author',
    contract: { workId: 'work-author', revision: 2, digest: 'a'.repeat(64) },
    candidateGeneration: 3,
  },
  artifactDigest: 'b'.repeat(64),
  baseCommit: 'c'.repeat(40),
  environmentRef: 'env-1',
  checkPolicyRef: 'check-1',
})
const reportFixture = (overrides: Partial<ReviewReport> = {}): ReviewReport => {
  const subject = subjectFixture()
  return {
    protocol: 'review-report/1',
    subjectDigest: reviewSubjectDigest(subject),
    disposition: 'findings',
    summary: 'One issue found',
    findings: [{ path: 'src/app.ts', line: 10, severity: 'high', claim: 'Bug', reproduction: 'run tests' }],
    limitations: [],
    ...overrides,
  }
}
const reviewer: ExecutionProfileRef = { profileId: 'reviewer', revision: 1, identityDigest: 'e'.repeat(64) }
const attempt: AttemptRef = {
  ticketId: 'ticket-review',
  assignmentId: 'assignment-review',
  contract: { workId: 'work-review', revision: 1, digest: 'd'.repeat(64) },
  attemptId: 'attempt-review',
  fenceEpoch: 1,
}
const currentFixture = (): ReviewCurrentFacts['current'] => ({
  candidate: {
    ticketId: 'ticket-author',
    assignmentId: 'assignment-author',
    contract: { workId: 'work-author', revision: 2, digest: 'a'.repeat(64) },
    candidateGeneration: 3,
  },
  artifactDigest: 'b'.repeat(64),
  baseCommit: 'c'.repeat(40),
  environmentRef: 'env-1',
  checkPolicyRef: 'check-1',
})
function facts(overrides: Partial<ReviewCurrentFacts> = {}, report: ReviewReport = reportFixture()): ReviewCurrentFacts {
  return {
    now: new Date(NOW),
    subject: subjectFixture(),
    report,
    reportDigest: reviewReportDigest(report),
    inputDigest: '2'.repeat(64),
    currentInputDigest: '2'.repeat(64),
    current: currentFixture(),
    reviewerProfileRef: reviewer,
    currentReviewerProfileRef: reviewer,
    reviewerAuthorizedForProject: true,
    reviewAttempt: attempt,
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    claimedLayer: 'controlled',
    trustedProducerLayer: 'controlled',
    ...overrides,
  }
}
const codes = (result: ReturnType<typeof assessReviewValidity>) => result.reasons.map((reason) => reason.code)
const withoutIsolation = (overrides: Partial<ReviewCurrentFacts> = {}): ReviewCurrentFacts => {
  const base = facts(overrides)
  if (overrides.isolation !== undefined) return base
  const { isolation: _isolation, ...rest } = base
  return rest
}

test('a matching current review is current but never a machine PASS or human acceptance', () => {
  const result = assessReviewValidity(facts())
  assert.equal(result.state, 'current')
  assert.equal(result.machinePass, false)
  assert.equal(result.humanAcceptance, false)
  assert.equal(result.findingsCount, 1)

  const clean = assessReviewValidity(
    facts({}, reportFixture({ disposition: 'no_findings', findings: [], summary: 'No issues found' })),
  )
  assert.equal(clean.state, 'current')
  assert.equal(clean.findingsCount, 0)
  assert.equal(clean.machinePass, false)
})

test('inconclusive reports are explicit and not a pass', () => {
  const result = assessReviewValidity(facts({}, reportFixture({ disposition: 'inconclusive', findings: [] })))
  assert.equal(result.state, 'inconclusive')
  assert.ok(codes(result).includes('report_inconclusive'))
  assert.equal(result.machinePass, false)
})

test('subject and candidate/artifact/contract/environment/check changes invalidate the review', () => {
  assert.ok(codes(assessReviewValidity(facts({}, reportFixture({ subjectDigest: '0'.repeat(64) })))).includes('subject_mismatch'))
  assert.ok(codes(assessReviewValidity(facts({ current: { ...currentFixture(), candidate: { ...currentFixture().candidate, candidateGeneration: 4 } } }))).includes('candidate_changed'))
  assert.ok(codes(assessReviewValidity(facts({ current: { ...currentFixture(), artifactDigest: '3'.repeat(64) } }))).includes('artifact_changed'))
  assert.ok(codes(assessReviewValidity(facts({ current: { ...currentFixture(), candidate: { ...currentFixture().candidate, contract: { ...currentFixture().candidate.contract, revision: 3 } } } }))).includes('contract_changed'))
  assert.ok(codes(assessReviewValidity(facts({ current: { ...currentFixture(), baseCommit: '4'.repeat(40) } }))).includes('base_changed'))
  assert.ok(codes(assessReviewValidity(facts({ current: { ...currentFixture(), environmentRef: 'env-2' } }))).includes('environment_changed'))
  assert.ok(codes(assessReviewValidity(facts({ current: { ...currentFixture(), checkPolicyRef: 'check-2' } }))).includes('check_policy_changed'))
})

test('mutated input, reviewer drift and author assignment reuse are rejected', () => {
  assert.ok(codes(assessReviewValidity(facts({ currentInputDigest: '5'.repeat(64) }))).includes('input_mutated'))
  assert.ok(codes(assessReviewValidity(facts({ currentReviewerProfileRef: { ...reviewer, revision: 2 } }))).includes('reviewer_identity_drift'))
  assert.ok(codes(assessReviewValidity(facts({ reviewerAuthorizedForProject: false }))).includes('reviewer_unauthorized'))
  assert.ok(
    codes(assessReviewValidity(facts({ reviewAttempt: { ...attempt, assignmentId: 'assignment-author' } }))).includes(
      'author_assignment_reused',
    ),
  )
})

test('sealed-copy and legacy readonly isolation proofs are validated separately', () => {
  assert.equal(assessReviewValidity(withoutIsolation()).state, 'missing')
  assert.ok(codes(assessReviewValidity(withoutIsolation())).includes('isolation_missing'))
  assert.ok(codes(assessReviewValidity(facts({ readOnlyProofRef: 'legacy-proof' }))).includes('isolation_missing'))
  assert.ok(
    codes(
      assessReviewValidity(
        facts({ isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'bad' } }),
      ),
    ).includes('isolation_invalid'),
  )
  const native = assessReviewValidity(
    withoutIsolation({ isolation: { kind: 'native_read_only', proofRef: 'proof-1' } }),
  )
  assert.equal(native.state, 'current')
  const legacy = assessReviewValidity(withoutIsolation({ readOnlyProofRef: 'legacy-proof' }))
  assert.equal(legacy.state, 'current')
})

test('the trusted producer layer cannot be claimed by the report', () => {
  assert.ok(codes(assessReviewValidity(facts({ claimedLayer: 'actual_native', trustedProducerLayer: 'controlled' }))).includes('layer_mismatch'))
  assert.equal(assessReviewValidity(facts({ trustedProducerLayer: 'operator_note' })).state, 'missing')
})

test('review reports parse strictly and never become executable text', () => {
  const parsed = parseReviewReport(reportFixture())
  assert.equal(parsed.protocol, 'review-report/1')
  assert.throws(() => parseReviewReport(reportFixture({ disposition: 'no_findings' })), ReviewParseError)
  assert.throws(() => parseReviewReport(reportFixture({ disposition: 'findings', findings: [] })), ReviewParseError)
  const bad = tryParseReviewReport({ protocol: 'review-report/1', subjectDigest: 'x' })
  assert.equal(bad.ok, false)
})

test('evidence assembly uses the report disposition and requires exactly one isolation proof', () => {
  const report = reportFixture()
  const evidence = assembleReviewEvidence({
    id: 'review-evidence-1',
    projectId: 'project-1',
    subject: subjectFixture(),
    reviewerProfileRef: reviewer,
    reviewAttempt: attempt,
    inputDigest: '2'.repeat(64),
    report,
    reportArtifactRef: 'artifact-1',
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    evidenceRefs: ['evidence-1'],
    layer: 'controlled',
    observedAt: NOW,
  })
  assert.equal(evidence.disposition, 'findings')
  assert.equal(Object.hasOwn(evidence, 'machinePass'), false)
  assert.equal(Object.hasOwn(evidence, 'humanAcceptance'), false)

  assert.throws(() =>
    assembleReviewEvidence({
      id: 'review-evidence-2',
      projectId: 'project-1',
      subject: subjectFixture(),
      reviewerProfileRef: reviewer,
      reviewAttempt: attempt,
      inputDigest: '2'.repeat(64),
      report,
      reportArtifactRef: 'artifact-1',
      evidenceRefs: ['evidence-1'],
      layer: 'controlled',
      observedAt: NOW,
    }),
  )
  assert.throws(() =>
    assembleReviewEvidence({
      id: 'review-evidence-3',
      projectId: 'project-1',
      subject: subjectFixture(),
      reviewerProfileRef: reviewer,
      reviewAttempt: { ...attempt, assignmentId: 'assignment-author' },
      inputDigest: '2'.repeat(64),
      report,
      reportArtifactRef: 'artifact-1',
      isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
      evidenceRefs: ['evidence-1'],
      layer: 'controlled',
      observedAt: NOW,
    }),
  )

  const assessed = assessReviewEvidence(evidence, report, {
    now: new Date(NOW),
    current: currentFixture(),
    currentInputDigest: '2'.repeat(64),
    currentReviewerProfileRef: reviewer,
    reviewerAuthorizedForProject: true,
    trustedProducerLayer: 'controlled',
  })
  assert.equal(assessed.state, 'current')
})
