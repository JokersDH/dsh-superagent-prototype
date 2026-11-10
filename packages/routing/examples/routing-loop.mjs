#!/usr/bin/env node
/**
 * Zero-model routing/review consumer example.
 *
 * attention ranking -> eligibility -> cold-start advice -> persisted advice -> confirmation check ->
 * frozen subject -> structured mock review -> persisted ReviewEvidence -> new candidate invalidates it.
 * No model, network or execution is used; the shared A RoutingEvidencePort implementation is pending.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  InMemoryRoutingEvidence,
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
} from '../dist/index.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'demo-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const profile = (id, digest) => ({ profileId: id, revision: 1, identityDigest: digest })

async function main() {
  const items = [
    { id: 'permission-1', kind: 'question', category: 'permission', projectId: 'demo-project', sourceRef: 'work-1', createdAt: now, waitingSince: now, actionable: true, businessDeadline: { at: '2026-11-11T00:00:00.000Z', sourceRef: 'contract-1' }, version: 1 },
    { id: 'clarify-1', kind: 'question', category: 'clarification', projectId: 'other-project', sourceRef: 'work-2', createdAt: now, waitingSince: now, actionable: true, expiresAt: '2026-11-09T00:00:00.000Z', version: 1 },
  ]
  const ranked = rankAttention(items, { now: new Date(now) })
  const groups = groupAttention(ranked)

  const primary = profile('codex-native', 'a'.repeat(64))
  const controlled = profile('second-driver', 'b'.repeat(64))
  const adviceResult = adviseRoute({
    id: 'advice-1',
    projectId: 'demo-project',
    sourceRef: 'source-1',
    taskContextDigest: 'c'.repeat(64),
    catalogRevision: 'd'.repeat(64),
    policyRevision: 'policy-1',
    eligibility: [
      { ref: primary, eligible: true, reasons: [], evidenceRefs: ['evidence-primary'], budgetUnknown: false },
      { ref: controlled, eligible: false, reasons: [{ code: 'evidence_missing', evidenceRefs: ['evidence-controlled'] }], evidenceRefs: ['evidence-controlled'], budgetUnknown: false },
    ],
    evidenceByProfile: { [profileRefKey(primary)]: ['evidence-primary'] },
    now: new Date(now),
  })
  if (adviceResult.kind !== 'advice') throw new Error('expected advice')
  const advice = adviceResult.advice
  const evidencePort = new InMemoryRoutingEvidence()
  const adviceFirst = evidencePort.advice.put(advice)
  const adviceReplay = evidencePort.advice.put(advice)
  const confirmation = validateAdviceForConfirmation(advice, {
    now: new Date(now),
    projectId: 'demo-project',
    taskContextDigest: 'c'.repeat(64),
    catalogRevision: 'd'.repeat(64),
    policyRevision: 'policy-1',
    projectScope: scope,
    profiles: [{ ref: primary, admitted: true, allowedScope: scope, currentIdentityDigest: primary.identityDigest }],
  })

  const subject = {
    candidate: { ticketId: 'ticket-author', assignmentId: 'assignment-author', contract: { workId: 'work-author', revision: 2, digest: 'a'.repeat(64) }, candidateGeneration: 3 },
    artifactDigest: 'b'.repeat(64),
    baseCommit: 'c'.repeat(40),
    environmentRef: 'env-1',
    checkPolicyRef: 'check-1',
  }
  const reviewer = profile('reviewer', 'e'.repeat(64))
  const attempt = { ticketId: 'ticket-review', assignmentId: 'assignment-review', contract: { workId: 'work-review', revision: 1, digest: 'd'.repeat(64) }, attemptId: 'attempt-review', fenceEpoch: 1 }
  const report = parseReviewReport({
    protocol: 'review-report/1',
    subjectDigest: reviewSubjectDigest(subject),
    disposition: 'findings',
    summary: 'One issue found',
    findings: [{ path: 'src/app.ts', severity: 'high', claim: 'Bug' }],
    limitations: [],
  })
  const current = (generation) => ({
    now: new Date(now),
    subject,
    report,
    reportDigest: reviewReportDigest(report),
    inputDigest: 'f'.repeat(64),
    currentInputDigest: 'f'.repeat(64),
    current: {
      candidate: { ticketId: subject.candidate.ticketId, assignmentId: subject.candidate.assignmentId, contract: subject.candidate.contract, candidateGeneration: generation },
      artifactDigest: subject.artifactDigest,
      baseCommit: subject.baseCommit,
      environmentRef: subject.environmentRef,
      checkPolicyRef: subject.checkPolicyRef,
    },
    reviewerProfileRef: reviewer,
    currentReviewerProfileRef: reviewer,
    reviewerAuthorizedForProject: true,
    reviewAttempt: attempt,
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: '9'.repeat(64) },
    claimedLayer: 'controlled',
    trustedProducerLayer: 'controlled',
  })
  const validity = assessReviewValidity(current(3))
  const review = assembleReviewEvidence({
    id: 'review-1',
    projectId: 'demo-project',
    subject,
    reviewerProfileRef: reviewer,
    reviewAttempt: attempt,
    inputDigest: 'f'.repeat(64),
    report,
    reportArtifactRef: 'artifact-1',
    isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: '9'.repeat(64) },
    evidenceRefs: ['evidence-1'],
    layer: 'controlled',
    observedAt: now,
  })
  evidencePort.reviews.put(review)
  const stale = assessReviewValidity(current(4))

  const result = {
    status:
      ranked[0]?.id === 'permission-1' &&
      ranked[1]?.actionable === false &&
      groups.length === 2 &&
      advice.basis === 'only_eligible' &&
      adviceFirst.replayed === false &&
      adviceReplay.replayed === true &&
      confirmation.ok === true &&
      validity.state === 'current' &&
      validity.machinePass === false &&
      stale.state === 'stale' &&
      stale.reasons.some((reason) => reason.code === 'candidate_changed')
        ? 'PASS'
        : 'FAIL',
    modelCalls: 0,
    networkCalls: 0,
    attentionTop: ranked.map((item) => `${item.id}:${item.bucket}`),
    adviceBasis: advice.basis,
    reviewState: validity.state,
    staleReason: stale.reasons.find((reason) => reason.code === 'candidate_changed')?.code ?? null,
    realRoutingEvidencePort: 'NOT_TESTED (A-owned RoutingEvidencePort not present on main)',
  }
  const reportFile = {
    protocol: 'wave05-routing-consumer/1',
    generatedAt: new Date().toISOString(),
    result,
  }
  mkdirSync(join(packageRoot, 'reports'), { recursive: true })
  writeFileSync(join(packageRoot, 'reports/routing-consumer-run.json'), `${JSON.stringify(reportFile, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.status !== 'PASS') process.exitCode = 1
}

await main()
