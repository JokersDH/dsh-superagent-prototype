import {
  ReviewEvidenceSchema,
  ReviewReportSchema,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type {
  AttemptRef,
  ExecutionProfileRef,
  Json,
  ReviewEvidence,
  ReviewReport,
  ReviewSubject,
} from '@personal-agent/contracts'
import type { EvidenceLayer } from './eligibility.ts'
import { snapshot } from './snapshot.ts'

export type ReviewValidityState = 'current' | 'stale' | 'missing' | 'inconclusive'

export type ReviewValidityReasonCode =
  | 'subject_mismatch'
  | 'report_digest_mismatch'
  | 'candidate_changed'
  | 'artifact_changed'
  | 'contract_changed'
  | 'base_changed'
  | 'environment_changed'
  | 'check_policy_changed'
  | 'input_mutated'
  | 'reviewer_identity_drift'
  | 'reviewer_unauthorized'
  | 'author_assignment_reused'
  | 'isolation_missing'
  | 'isolation_invalid'
  | 'layer_mismatch'
  | 'evidence_missing'
  | 'report_inconclusive'

export interface ReviewValidityReason {
  readonly code: ReviewValidityReasonCode
  readonly detail?: string
}

export interface ReviewValidity {
  readonly state: ReviewValidityState
  readonly reasons: readonly ReviewValidityReason[]
  /** A review never becomes a machine verification PASS or a human acceptance. */
  readonly machinePass: false
  readonly humanAcceptance: false
  readonly findingsCount: number
}

export class ReviewParseError extends Error {
  readonly issues: readonly string[]
  constructor(issues: readonly string[]) {
    super('Review report is not a valid review-report/1')
    this.name = 'ReviewParseError'
    this.issues = issues
  }
}

export function parseReviewReport(raw: unknown): ReviewReport {
  const parsed = ReviewReportSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ReviewParseError(parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`))
  }
  return snapshot(parsed.data)
}

export function tryParseReviewReport(
  raw: unknown,
): { readonly ok: true; readonly report: ReviewReport } | { readonly ok: false; readonly issues: readonly string[] } {
  try {
    return { ok: true, report: parseReviewReport(raw) }
  } catch (error) {
    if (error instanceof ReviewParseError) return { ok: false, issues: error.issues }
    throw error
  }
}

export function reviewSubjectDigest(subject: ReviewSubject): string {
  return canonicalDigest(subject as unknown as Json)
}

export function reviewReportDigest(report: ReviewReport): string {
  return canonicalDigest(report as unknown as Json)
}

export interface ReviewCurrentContext {
  readonly current: {
    readonly candidate: {
      readonly ticketId: string
      readonly assignmentId: string
      readonly contract: { readonly workId: string; readonly revision: number; readonly digest: string }
      readonly candidateGeneration: number
    }
    readonly artifactDigest: string
    readonly baseCommit: string
    readonly environmentRef: string
    readonly checkPolicyRef: string
  }
  readonly currentInputDigest: string
  readonly currentReviewerProfileRef: ExecutionProfileRef
  readonly reviewerAuthorizedForProject: boolean
  readonly trustedProducerLayer: EvidenceLayer
}

export interface ReviewCurrentFacts extends ReviewCurrentContext {
  readonly now: Date
  readonly subject: ReviewSubject
  readonly report: ReviewReport
  readonly reportDigest: string
  readonly inputDigest: string
  readonly reviewerProfileRef: ExecutionProfileRef
  readonly reviewAttempt: AttemptRef
  readonly isolation?: ReviewEvidence['isolation']
  readonly readOnlyProofRef?: string
  readonly claimedLayer: EvidenceLayer
}

const DIGEST = /^[a-f0-9]{64}$/
const LAYER_RANK: Record<EvidenceLayer, number> = {
  actual_native: 4,
  controlled: 3,
  protocol_fixture: 2,
  schema: 1,
  operator_note: 0,
}

function refKey(ref: ExecutionProfileRef): string {
  return JSON.stringify([ref.profileId, ref.revision, ref.identityDigest])
}

function sameContract(
  left: { workId: string; revision: number; digest: string },
  right: { workId: string; revision: number; digest: string },
): boolean {
  return left.workId === right.workId && left.revision === right.revision && left.digest === right.digest
}

/**
 * Pure validity assessment. Report content is untrusted data; reproduction text never becomes tool
 * authority. A current review is not a machine PASS and never writes human acceptance.
 */
export function assessReviewValidity(facts: ReviewCurrentFacts): ReviewValidity {
  const reasons: ReviewValidityReason[] = []
  const add = (code: ReviewValidityReasonCode, detail?: string): void => {
    reasons.push({ code, ...(detail === undefined ? {} : { detail }) })
  }

  if (facts.report.subjectDigest !== reviewSubjectDigest(facts.subject)) add('subject_mismatch')
  if (!DIGEST.test(facts.reportDigest) || facts.reportDigest !== reviewReportDigest(facts.report)) {
    add('report_digest_mismatch')
  }
  if (
    facts.subject.candidate.ticketId !== facts.current.candidate.ticketId ||
    facts.subject.candidate.assignmentId !== facts.current.candidate.assignmentId ||
    facts.subject.candidate.candidateGeneration !== facts.current.candidate.candidateGeneration
  ) {
    add('candidate_changed')
  }
  if (!sameContract(facts.subject.candidate.contract, facts.current.candidate.contract)) add('contract_changed')
  if (facts.subject.artifactDigest !== facts.current.artifactDigest) add('artifact_changed')
  if (facts.subject.baseCommit !== facts.current.baseCommit) add('base_changed')
  if (facts.subject.environmentRef !== facts.current.environmentRef) add('environment_changed')
  if (facts.subject.checkPolicyRef !== facts.current.checkPolicyRef) add('check_policy_changed')
  if (facts.inputDigest !== facts.currentInputDigest) add('input_mutated')
  if (refKey(facts.reviewerProfileRef) !== refKey(facts.currentReviewerProfileRef)) add('reviewer_identity_drift')
  if (!facts.reviewerAuthorizedForProject) add('reviewer_unauthorized')
  if (
    facts.subject.candidate.contract.workId === facts.reviewAttempt.contract.workId ||
    facts.subject.candidate.ticketId === facts.reviewAttempt.ticketId ||
    facts.subject.candidate.assignmentId === facts.reviewAttempt.assignmentId
  ) {
    add('author_assignment_reused')
  }
  if (facts.claimedLayer !== facts.trustedProducerLayer) add('layer_mismatch')
  if (LAYER_RANK[facts.trustedProducerLayer] < LAYER_RANK.controlled) add('evidence_missing')

  const hasLegacyProof = facts.readOnlyProofRef !== undefined
  const hasIsolation = facts.isolation !== undefined
  if (hasLegacyProof === hasIsolation) {
    add('isolation_missing', 'review needs exactly one isolation proof')
  } else if (facts.isolation?.kind === 'sealed_copy') {
    if (!facts.isolation.proofRef || !DIGEST.test(facts.isolation.capsuleManifestDigest)) add('isolation_invalid')
  } else if (facts.isolation?.kind === 'native_read_only') {
    if (!facts.isolation.proofRef) add('isolation_invalid')
  } else if (hasLegacyProof && !facts.readOnlyProofRef) {
    add('isolation_invalid')
  }

  if (facts.report.disposition === 'inconclusive') add('report_inconclusive')

  const blocking = reasons.filter((reason) => reason.code !== 'report_inconclusive')
  const state: ReviewValidityState = blocking.some(
    (reason) => reason.code === 'isolation_missing' || reason.code === 'isolation_invalid' || reason.code === 'evidence_missing',
  )
    ? 'missing'
    : blocking.length > 0
      ? 'stale'
      : facts.report.disposition === 'inconclusive'
        ? 'inconclusive'
        : 'current'

  return {
    state,
    reasons,
    machinePass: false,
    humanAcceptance: false,
    findingsCount: facts.report.findings.length,
  }
}

export interface ReviewEvidenceAssemblyInput {
  readonly id: string
  readonly projectId: string
  readonly subject: ReviewSubject
  readonly reviewerProfileRef: ExecutionProfileRef
  readonly reviewAttempt: AttemptRef
  readonly inputDigest: string
  readonly report: ReviewReport
  readonly reportArtifactRef: string
  readonly isolation?: ReviewEvidence['isolation']
  readonly readOnlyProofRef?: string
  readonly evidenceRefs: readonly string[]
  readonly layer: EvidenceLayer
  readonly observedAt: string
}

/** Trusted-producer assembly for A/main; the model never supplies layer, attempt or isolation. */
export function assembleReviewEvidence(input: ReviewEvidenceAssemblyInput): ReviewEvidence {
  return snapshot(ReviewEvidenceSchema.parse({
    protocol: 'review-evidence/1',
    id: input.id,
    projectId: input.projectId,
    subject: input.subject,
    reviewerProfileRef: input.reviewerProfileRef,
    reviewAttempt: input.reviewAttempt,
    inputDigest: input.inputDigest,
    reportDigest: reviewReportDigest(input.report),
    reportArtifactRef: input.reportArtifactRef,
    ...(input.readOnlyProofRef === undefined ? {} : { readOnlyProofRef: input.readOnlyProofRef }),
    ...(input.isolation === undefined ? {} : { isolation: input.isolation }),
    evidenceRefs: input.evidenceRefs,
    layer: input.layer,
    disposition: input.report.disposition,
    observedAt: input.observedAt,
  }))
}

/** Convenience wrapper when the persisted evidence and its parsed report are separate inputs. */
export function assessReviewEvidence(
  evidence: ReviewEvidence,
  report: ReviewReport,
  current: ReviewCurrentContext & { readonly now: Date },
): ReviewValidity {
  return assessReviewValidity({
    ...current,
    subject: evidence.subject,
    report,
    reportDigest: reviewReportDigest(report),
    inputDigest: evidence.inputDigest,
    reviewerProfileRef: evidence.reviewerProfileRef,
    reviewAttempt: evidence.reviewAttempt,
    ...(evidence.isolation === undefined ? {} : { isolation: evidence.isolation }),
    ...(evidence.readOnlyProofRef === undefined ? {} : { readOnlyProofRef: evidence.readOnlyProofRef }),
    claimedLayer: evidence.layer,
  })
}
