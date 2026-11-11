import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, scope } from '../../packages/application/test/helpers.ts'
import { adviseRoute, validateAdviceForConfirmation, assembleReviewEvidence, assessReviewEvidence, parseReviewReport, reviewSubjectDigest, profileRefKey } from '../../packages/routing/dist/index.js'

const now = '2026-11-11T00:00:00.000Z'
const profile = { profileId: 'profile-synthetic', revision: 1, identityDigest: 'a'.repeat(64) }
test('C advice writes, replays, rolls back and reopens through A actual SQLite port', t => {
  const h = fixture(t)
  const result = adviseRoute({ id: 'advice-sql', projectId: scope.projectId, sourceRef: 'source-synthetic',
    taskContextDigest: 'b'.repeat(64), catalogRevision: 'c'.repeat(64), policyRevision: 'policy-synthetic',
    eligibility: [{ ref: profile, eligible: true, reasons: [], evidenceRefs: ['fixture-only'], budgetUnknown: false }],
    evidenceByProfile: { [profileRefKey(profile)]: ['fixture-only'] }, now: new Date(now) })
  assert.equal(result.kind, 'advice')
  const advice = result.advice
  assert.throws(() => h.store.uow.atomic(() => { h.store.workflows.routingEvidence.advice.put(advice); throw new Error('rollback') }))
  assert.equal(h.store.workflows.routingEvidence.advice.get(advice.id), undefined)
  assert.equal(h.store.workflows.routingEvidence.advice.put(advice).replayed, false)
  assert.equal(h.store.workflows.routingEvidence.advice.put(advice).replayed, true)
  assert.throws(() => h.store.workflows.routingEvidence.advice.put({ ...advice, sourceRef: 'changed-source' }))
  h.reopen()
  const stored = h.store.workflows.routingEvidence.advice.get(advice.id)
  assert.equal(validateAdviceForConfirmation(stored, { now: new Date(now), projectId: scope.projectId,
    taskContextDigest: 'b'.repeat(64), catalogRevision: 'c'.repeat(64), policyRevision: 'policy-synthetic', projectScope: scope,
    profiles: [{ ref: profile, admitted: true, allowedScope: scope, currentIdentityDigest: profile.identityDigest }] }).ok, true)
  assert.equal(h.store.workflows.routingEvidence.advice.list({ projectId: 'another-project' }).records.length, 0)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 0)
})
test('C consumes A persisted fixture report without promoting it to a current review or completion authority', t => {
  const h = fixture(t)
  const subject = { candidate: { ticketId: 'author-ticket', assignmentId: 'author-assignment', contract: { workId: 'author-work', revision: 1, digest: 'b'.repeat(64) }, candidateGeneration: 1 },
    artifactDigest: 'c'.repeat(64), baseCommit: 'd'.repeat(40), environmentRef: 'environment-fixture', checkPolicyRef: 'check-fixture' }
  const report = parseReviewReport({ protocol: 'review-report/1', subjectDigest: reviewSubjectDigest(subject), disposition: 'no_findings',
    summary: 'Synthetic report for storage consumer only', findings: [], limitations: ['No reviewer was run'] })
  const artifact = h.store.artifacts.write(Buffer.from(JSON.stringify(report))); h.store.artifacts.insert(artifact)
  const evidence = assembleReviewEvidence({ id: 'review-sql', projectId: scope.projectId, subject, reviewerProfileRef: profile,
    reviewAttempt: { ticketId: 'review-ticket', assignmentId: 'review-assignment', attemptId: 'review-attempt', fenceEpoch: 1,
      contract: { workId: 'review-work', revision: 1, digest: 'e'.repeat(64) } }, inputDigest: 'f'.repeat(64), report,
    reportArtifactRef: artifact.id, isolation: { kind: 'sealed_copy', proofRef: 'synthetic-not-isolation-admission', capsuleManifestDigest: '9'.repeat(64) },
    evidenceRefs: ['synthetic-report'], layer: 'protocol_fixture', observedAt: now })
  h.store.workflows.routingEvidence.reviews.put(evidence)
  h.reopen()
  const stored = h.store.workflows.routingEvidence.reviews.get(evidence.id)
  const context = { now: new Date(now), current: subject, currentInputDigest: 'f'.repeat(64), currentReviewerProfileRef: profile,
    reviewerAuthorizedForProject: true, trustedProducerLayer: 'protocol_fixture' }
  const current = assessReviewEvidence(stored, report, context)
  assert.equal(current.state, 'missing', 'A schema/protocol fixture is not controlled reviewer evidence')
  assert.ok(current.reasons.some(reason => reason.code === 'evidence_missing'))
  assert.equal(current.machinePass, false); assert.equal(current.humanAcceptance, false)
  assert.ok(assessReviewEvidence(stored, report, { ...context, current: { ...subject, candidate: { ...subject.candidate, candidateGeneration: 2 } } }).reasons.some(reason => reason.code === 'candidate_changed'))
  assert.ok(assessReviewEvidence(stored, report, { ...context, currentInputDigest: '1'.repeat(64) }).reasons.some(reason => reason.code === 'input_mutated'))
  assert.ok(h.store.artifacts.read(artifact.id))
  assert.equal(h.store.workflows.routingEvidence.reviews.list({ projectId: 'another-project', subject }).records.length, 0)
  assert.equal(h.store.events.after(0, 100).filter(event => event.topic === 'application.candidate.accepted').length, 0)
})
