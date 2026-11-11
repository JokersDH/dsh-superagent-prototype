import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionOutcome, ExecutionProfileRef, ReviewReport, ReviewSubject, RouteAdvice, Scope } from '@personal-agent/contracts'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'
import {
  adviseRoute,
  assembleReviewEvidence,
  assessReviewValidity,
  profileRefKey,
  reviewReportDigest,
  reviewSubjectDigest,
} from '../src/index.ts'

const NOW = '2026-11-11T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const profile = (id = 'codex-native', digest = 'a'.repeat(64)): ExecutionProfileRef => ({
  profileId: id,
  revision: 1,
  identityDigest: digest,
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pa-routing-real-'))
  const file = join(root, 'state.sqlite')
  let store = new ProductStore({ path: file })
  let ports = createWorkflowPorts(store)
  return {
    get store() {
      return store
    },
    get evidence() {
      return ports.routingEvidence
    },
    reopen() {
      store.close()
      store = new ProductStore({ path: file })
      ports = createWorkflowPorts(store)
    },
    cleanup() {
      store.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const adviceFor = (id: string, projectId = 'project-1'): RouteAdvice => {
  const ref = profile()
  const result = adviseRoute({
    id,
    projectId,
    sourceRef: 'source-1',
    taskContextDigest: 'c'.repeat(64),
    catalogRevision: 'd'.repeat(64),
    policyRevision: 'policy-1',
    eligibility: [{ ref, eligible: true, reasons: [], evidenceRefs: ['evidence-1'], budgetUnknown: false }],
    evidenceByProfile: { [profileRefKey(ref)]: ['evidence-1'] },
    now: new Date(NOW),
  })
  assert.equal(result.kind, 'advice')
  if (result.kind !== 'advice') throw new Error('unreachable')
  return result.advice
}

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
const attempt = {
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
const reviewFor = (id: string, value: ReviewSubject = subject(), projectId = 'project-1') =>
  assembleReviewEvidence({
    id,
    projectId,
    subject: value,
    reviewerProfileRef: profile('reviewer', 'e'.repeat(64)),
    reviewAttempt: attempt,
    inputDigest: '2'.repeat(64),
    report: report(value),
    reportArtifactRef: 'artifact-1',
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: 'f'.repeat(64) },
    evidenceRefs: ['evidence-1'],
    layer: 'controlled',
    observedAt: NOW,
  })
const outcomeFor = (id: string, projectId = 'project-1'): ExecutionOutcome => ({
  protocol: 'execution-outcome/1',
  id,
  projectId,
  attempt,
  profileRef: profile(),
  acceptance: 'not_requested',
  evidenceRefs: ['evidence-1'],
  layer: 'controlled',
  usage: { completeness: 'unknown', evidenceRefs: [] },
  observedAt: NOW,
})

test('real A port: advice put/replay/conflict, project scope and append-only history', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const advice = adviceFor('advice-1')
  assert.equal(fixture.evidence.advice.put(advice).replayed, false)
  assert.equal(fixture.evidence.advice.put(advice).replayed, true)
  assert.deepEqual(fixture.evidence.advice.get('advice-1'), advice)
  assert.equal(fixture.evidence.advice.list({ projectId: 'project-1' }).records.length, 1)
  assert.equal(fixture.evidence.advice.list({ projectId: 'project-2' }).records.length, 0)

  const changed = { ...advice, evidenceRefs: [...advice.evidenceRefs, 'extra-evidence'] }
  assert.throws(() => fixture.evidence.advice.put(changed), (error: unknown) =>
    error instanceof Error && /different body/.test(error.message))
  assert.deepEqual(fixture.evidence.advice.get('advice-1'), advice)

  fixture.reopen()
  assert.deepEqual(fixture.evidence.advice.get('advice-1'), advice)
  assert.equal(fixture.evidence.advice.put(advice).replayed, true)
})

test('real A port: reviews are filtered by exact subject and outcomes by exact profile', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const first = reviewFor('review-1', subject(3))
  const other = reviewFor('review-2', subject(4))
  assert.equal(fixture.evidence.reviews.put(first).replayed, false)
  assert.equal(fixture.evidence.reviews.put(first).replayed, true)
  fixture.evidence.reviews.put(other)
  assert.equal(fixture.evidence.reviews.list({ projectId: 'project-1' }).records.length, 2)
  assert.equal(fixture.evidence.reviews.list({ projectId: 'project-1', subject: subject(3) }).records.length, 1)
  assert.deepEqual(fixture.evidence.reviews.get('review-1'), first)

  const outcome = outcomeFor('outcome-1')
  fixture.evidence.outcomes.put(outcome)
  assert.equal(fixture.evidence.outcomes.put(outcome).replayed, true)
  assert.equal(fixture.evidence.outcomes.list({ projectId: 'project-1', profile: profile() }).records.length, 1)
  assert.equal(
    fixture.evidence.outcomes.list({ projectId: 'project-1', profile: profile('other', '9'.repeat(64)) }).records.length,
    0,
  )
  assert.throws(() => fixture.evidence.reviews.put({ ...first, disposition: 'no_findings' }), (error: unknown) =>
    error instanceof Error && /different body/.test(error.message))
})

test('real A port: a failed write rolls back and leaves no evidence row', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  fixture.store.db.exec(`CREATE TRIGGER reject_route_advice BEFORE INSERT ON route_advice
    WHEN NEW.id = 'advice-fail' BEGIN SELECT RAISE(ABORT, 'injected evidence failure'); END`)
  assert.throws(() => fixture.evidence.advice.put(adviceFor('advice-fail')))
  assert.equal(fixture.evidence.advice.get('advice-fail'), undefined)
  assert.equal(fixture.evidence.advice.list({ projectId: 'project-1' }).records.length, 0)
  fixture.store.db.exec('DROP TRIGGER reject_route_advice')
  assert.equal(fixture.evidence.advice.put(adviceFor('advice-fail')).replayed, false)
})

test('real A port: persisted review evidence goes stale when the candidate or profile drifts', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const frozen = subject(3)
  fixture.evidence.reviews.put(reviewFor('review-1', frozen))
  const persisted = fixture.evidence.reviews.get('review-1')
  assert.ok(persisted)

  const current = (generation: number, reviewerDigest = 'e'.repeat(64)) => ({
    now: new Date(NOW),
    subject: persisted.subject,
    report: report(frozen),
    reportDigest: reviewReportDigest(report(frozen)),
    inputDigest: persisted.inputDigest,
    currentInputDigest: persisted.inputDigest,
    current: {
      candidate: {
        ticketId: frozen.candidate.ticketId,
        assignmentId: frozen.candidate.assignmentId,
        contract: frozen.candidate.contract,
        candidateGeneration: generation,
      },
      artifactDigest: frozen.artifactDigest,
      baseCommit: frozen.baseCommit,
      environmentRef: frozen.environmentRef,
      checkPolicyRef: frozen.checkPolicyRef,
    },
    reviewerProfileRef: persisted.reviewerProfileRef,
    currentReviewerProfileRef: { ...persisted.reviewerProfileRef, identityDigest: reviewerDigest },
    reviewerAuthorizedForProject: true,
    reviewAttempt: attempt,
    ...(persisted.isolation === undefined ? {} : { isolation: persisted.isolation }),
    claimedLayer: persisted.layer,
    trustedProducerLayer: 'controlled' as const,
  })

  assert.equal(assessReviewValidity(current(3)).state, 'current')
  const drifted = assessReviewValidity(current(4))
  assert.equal(drifted.state, 'stale')
  assert.ok(drifted.reasons.some((reason) => reason.code === 'candidate_changed'))
  const profileDrift = assessReviewValidity(current(3, '9'.repeat(64)))
  assert.ok(profileDrift.reasons.some((reason) => reason.code === 'reviewer_identity_drift'))
  // The audit record is preserved either way.
  assert.deepEqual(fixture.evidence.reviews.get('review-1'), persisted)
})
