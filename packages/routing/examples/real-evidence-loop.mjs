#!/usr/bin/env node
/**
 * Real temporary-SQLite routing evidence recipe for main.
 *
 * advice -> reviews (by exact subject) -> outcomes (by exact profile) through A's synchronous
 * RoutingEvidencePort, with same-body replay, changed-body refusal, project isolation, reopen and
 * candidate-drift invalidation. No model or network call.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'
import {
  adviseRoute,
  assembleReviewEvidence,
  assessReviewValidity,
  profileRefKey,
  reviewReportDigest,
  reviewSubjectDigest,
} from '../dist/index.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = '2026-11-11T00:00:00.000Z'
const projectId = 'evidence-project'
const scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const profile = (id, digest) => ({ profileId: id, revision: 1, identityDigest: digest })
const primary = profile('codex-native', 'a'.repeat(64))
const reviewer = profile('reviewer', 'e'.repeat(64))
const attempt = {
  ticketId: 'ticket-review',
  assignmentId: 'assignment-review',
  contract: { workId: 'work-review', revision: 1, digest: 'd'.repeat(64) },
  attemptId: 'attempt-review',
  fenceEpoch: 1,
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'pa-routing-real-'))
  const file = join(root, 'state.sqlite')
  let store = new ProductStore({ path: file })
  let ports = createWorkflowPorts(store)
  try {
    const adviceResult = adviseRoute({
      id: 'real-advice-1', projectId, sourceRef: 'source-1',
      taskContextDigest: 'c'.repeat(64), catalogRevision: 'd'.repeat(64), policyRevision: 'policy-1',
      eligibility: [{ ref: primary, eligible: true, reasons: [], evidenceRefs: ['evidence-primary'], budgetUnknown: false }],
      evidenceByProfile: { [profileRefKey(primary)]: ['evidence-primary'] },
      now: new Date(now),
    })
    if (adviceResult.kind !== 'advice') throw new Error('expected advice')
    const advice = adviceResult.advice
    const adviceFirst = ports.routingEvidence.advice.put(advice)
    const adviceReplay = ports.routingEvidence.advice.put(advice)

    const subject = {
      candidate: { ticketId: 'ticket-author', assignmentId: 'assignment-author', contract: { workId: 'work-author', revision: 2, digest: 'a'.repeat(64) }, candidateGeneration: 3 },
      artifactDigest: 'b'.repeat(64), baseCommit: 'c'.repeat(40), environmentRef: 'env-1', checkPolicyRef: 'check-1',
    }
    const report = {
      protocol: 'review-report/1', subjectDigest: reviewSubjectDigest(subject), disposition: 'findings',
      summary: 'One issue found', findings: [{ path: 'src/app.ts', severity: 'high', claim: 'Bug' }], limitations: [],
    }
    const review = assembleReviewEvidence({
      id: 'real-review-1', projectId, subject, reviewerProfileRef: reviewer, reviewAttempt: attempt,
      inputDigest: 'f'.repeat(64), report, reportArtifactRef: 'artifact-1',
      isolation: { kind: 'sealed_copy', proofRef: 'proof-1', capsuleManifestDigest: '9'.repeat(64) },
      evidenceRefs: ['evidence-1'], layer: 'controlled', observedAt: now,
    })
    const reviewFirst = ports.routingEvidence.reviews.put(review)
    const reviewReplay = ports.routingEvidence.reviews.put(review)
    const bySubject = ports.routingEvidence.reviews.list({ projectId, subject }).records.length

    const outcome = {
      protocol: 'execution-outcome/1', id: 'real-outcome-1', projectId, attempt, profileRef: primary,
      acceptance: 'not_requested', evidenceRefs: ['evidence-1'], layer: 'controlled',
      usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: now,
    }
    ports.routingEvidence.outcomes.put(outcome)
    const outcomeReplay = ports.routingEvidence.outcomes.put(outcome)
    const byProfile = ports.routingEvidence.outcomes.list({ projectId, profile: primary }).records.length
    const otherProject = ports.routingEvidence.advice.list({ projectId: 'other-project' }).records.length

    let changedBodyRefused = false
    try {
      ports.routingEvidence.advice.put({ ...advice, evidenceRefs: [...advice.evidenceRefs, 'extra'] })
    } catch {
      changedBodyRefused = true
    }

    store.close()
    store = new ProductStore({ path: file })
    ports = createWorkflowPorts(store)
    const reopenedAdvice = ports.routingEvidence.advice.get('real-advice-1')
    const reopenedReview = ports.routingEvidence.reviews.get('real-review-1')

    const current = (generation) => ({
      now: new Date(now), subject: reopenedReview.subject, report,
      reportDigest: reviewReportDigest(report), inputDigest: reopenedReview.inputDigest, currentInputDigest: reopenedReview.inputDigest,
      current: {
        candidate: { ticketId: subject.candidate.ticketId, assignmentId: subject.candidate.assignmentId, contract: subject.candidate.contract, candidateGeneration: generation },
        artifactDigest: subject.artifactDigest, baseCommit: subject.baseCommit, environmentRef: subject.environmentRef, checkPolicyRef: subject.checkPolicyRef,
      },
      reviewerProfileRef: reopenedReview.reviewerProfileRef, currentReviewerProfileRef: reopenedReview.reviewerProfileRef,
      reviewerAuthorizedForProject: true, reviewAttempt: attempt, ...(reopenedReview.isolation ? { isolation: reopenedReview.isolation } : {}),
      claimedLayer: reopenedReview.layer, trustedProducerLayer: 'controlled',
    })
    const currentState = assessReviewValidity(current(3))
    const drifted = assessReviewValidity(current(4))

    const result = {
      status:
        adviceFirst.replayed === false && adviceReplay.replayed === true &&
        reviewFirst.replayed === false && reviewReplay.replayed === true && bySubject === 1 &&
        outcomeReplay.replayed === true && byProfile === 1 && otherProject === 0 &&
        changedBodyRefused && Boolean(reopenedAdvice) && Boolean(reopenedReview) &&
        currentState.state === 'current' && currentState.machinePass === false &&
        drifted.state === 'stale'
          ? 'PASS'
          : 'FAIL',
      modelCalls: 0,
      networkCalls: 0,
      sqlite: 'real temporary SQLite via createWorkflowPorts(store).routingEvidence',
      adviceReplay: adviceReplay.replayed,
      reviewReplay: reviewReplay.replayed,
      outcomeReplay: outcomeReplay.replayed,
      reviewsByExactSubject: bySubject,
      outcomesByExactProfile: byProfile,
      otherProjectAdvice: otherProject,
      changedBodyRefused,
      reviewState: currentState.state,
      driftedState: drifted.state,
      driftedReason: drifted.reasons.find((reason) => reason.code === 'candidate_changed')?.code ?? null,
      executionAuthority: 'none (advice/review/outcome are data only)',
    }
    mkdirSync(join(packageRoot, 'reports'), { recursive: true })
    writeFileSync(join(packageRoot, 'reports/real-evidence-run.json'), `${JSON.stringify({ protocol: 'wave06-real-routing-evidence/1', generatedAt: new Date().toISOString(), result }, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.status !== 'PASS') process.exitCode = 1
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
}

await main()
