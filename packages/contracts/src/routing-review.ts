import { z } from 'zod'
import { AttemptRefSchema, CandidateRefSchema, DigestSchema, EvidenceRefSchema, IdSchema, ScopeSchema, TimestampSchema, UsageObservedPayloadSchema } from './schemas.ts'

export const ExecutionProfileRefSchema = z.strictObject({ profileId: IdSchema, revision: z.number().int().positive().safe(), identityDigest: DigestSchema })
const refKey = (ref: z.infer<typeof ExecutionProfileRefSchema>) => JSON.stringify([ref.profileId, ref.revision, ref.identityDigest])
const refs = z.array(EvidenceRefSchema).max(128).refine(values => new Set(values).size === values.length, 'Evidence references must be unique').readonly()
export const EvidenceLayerSchema = z.enum(['actual_native', 'controlled', 'protocol_fixture', 'schema', 'operator_note'])
export const ReviewSubjectSchema = z.strictObject({ candidate: CandidateRefSchema, artifactDigest: DigestSchema,
  baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), environmentRef: IdSchema, checkPolicyRef: IdSchema })
export const ReviewReportSchema = z.strictObject({ protocol: z.literal('review-report/1'), subjectDigest: DigestSchema,
  disposition: z.enum(['findings', 'no_findings', 'inconclusive']), summary: z.string().max(8192),
  findings: z.array(z.strictObject({ path: ScopeSchema.shape.allowedPaths.unwrap().element,
    line: z.number().int().positive().safe().optional(), severity: z.enum(['high', 'medium', 'low']),
    claim: z.string().trim().min(1).max(4096), reproduction: z.string().max(8192).optional() })).max(128).readonly(),
  limitations: z.array(z.string().max(1024)).max(32).readonly(),
}).refine(value => value.disposition === 'inconclusive' ||
  (value.disposition === 'no_findings' ? value.findings.length === 0 : value.findings.length > 0),
  'Review disposition must accurately describe its findings')

/** Advice is data; no actor, native command, larger scope, or execution authority is accepted here. */
export const RouteAdviceSchema = z.strictObject({
  protocol: z.literal('route-advice/1'), id: IdSchema, projectId: IdSchema, sourceRef: IdSchema,
  taskContextDigest: DigestSchema, catalogRevision: DigestSchema, policyRevision: IdSchema,
  eligibleProfileRefs: z.array(ExecutionProfileRefSchema).max(64).readonly(), suggestedProfileRef: ExecutionProfileRefSchema.nullable(),
  excluded: z.array(z.strictObject({ profileRef: ExecutionProfileRefSchema, reason: z.enum(['not_admitted', 'evidence_missing', 'identity_drift', 'scope_denied', 'budget_unavailable', 'read_only_unproven', 'unsupported_capability']), evidenceRefs: refs })).max(128).readonly(),
  basis: z.enum(['none_eligible', 'only_eligible', 'operator_default', 'fixed_rule']), evidenceRefs: refs,
  reviewSuggested: z.boolean(), createdAt: TimestampSchema, expiresAt: TimestampSchema,
}).superRefine((value, ctx) => {
  const eligible = new Set(value.eligibleProfileRefs.map(refKey))
  if (eligible.size !== value.eligibleProfileRefs.length || new Set(value.excluded.map(item => refKey(item.profileRef))).size !== value.excluded.length ||
      (value.suggestedProfileRef && !eligible.has(refKey(value.suggestedProfileRef))) ||
      value.excluded.some(item => eligible.has(refKey(item.profileRef))))
    ctx.addIssue({ code: 'custom', message: 'Advice must select a unique eligible profile and keep excluded profiles separate' })
  if ((value.basis === 'none_eligible') !== (eligible.size === 0) || (!eligible.size && value.suggestedProfileRef !== null) ||
      (eligible.size > 0 && !value.suggestedProfileRef) || (value.basis === 'only_eligible') !== (eligible.size === 1))
    ctx.addIssue({ code: 'custom', message: 'Cold-start advice must accurately describe its choices' })
  if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) ctx.addIssue({ code: 'custom', message: 'Advice needs a future expiry' })
  if (eligible.size > 0 && !value.evidenceRefs.length) ctx.addIssue({ code: 'custom', message: 'An eligible recommendation needs supporting evidence references' })
})

/** A review never becomes a verification PASS or a human acceptance record. */
export const ReviewEvidenceSchema = z.strictObject({ protocol: z.literal('review-evidence/1'), id: IdSchema,
  projectId: IdSchema, subject: ReviewSubjectSchema, reviewerProfileRef: ExecutionProfileRefSchema, reviewAttempt: AttemptRefSchema,
  inputDigest: DigestSchema, reportDigest: DigestSchema, reportArtifactRef: IdSchema, readOnlyProofRef: EvidenceRefSchema,
  evidenceRefs: refs, layer: EvidenceLayerSchema, disposition: z.enum(['findings', 'no_findings', 'inconclusive']), observedAt: TimestampSchema,
}).refine(value => value.subject.candidate.contract.workId !== value.reviewAttempt.contract.workId &&
  value.subject.candidate.ticketId !== value.reviewAttempt.ticketId && value.subject.candidate.assignmentId !== value.reviewAttempt.assignmentId,
  'Review execution must not become the author candidate assignment')

/** Observation references have one trusted producer; schema-valid JSON alone does not prove native execution. */
export const ExecutionOutcomeSchema = z.strictObject({ protocol: z.literal('execution-outcome/1'), id: IdSchema,
  projectId: IdSchema, attempt: AttemptRefSchema, profileRef: ExecutionProfileRefSchema, candidate: CandidateRefSchema.optional(),
  verificationRef: IdSchema.optional(), artifactDigest: DigestSchema.optional(), acceptance: z.enum(['not_requested', 'accepted', 'rejected', 'unknown']),
  acceptanceRef: EvidenceRefSchema.optional(), evidenceRefs: refs, layer: EvidenceLayerSchema, usage: UsageObservedPayloadSchema,
  durationMs: z.number().int().nonnegative().safe().optional(), observedAt: TimestampSchema,
}).superRefine((value, ctx) => {
  if (value.candidate && (value.candidate.assignmentId !== value.attempt.assignmentId || value.candidate.ticketId !== value.attempt.ticketId ||
    value.candidate.contract.workId !== value.attempt.contract.workId || value.candidate.contract.revision !== value.attempt.contract.revision ||
    value.candidate.contract.digest !== value.attempt.contract.digest))
    ctx.addIssue({ code: 'custom', message: 'Outcome candidate must belong to the observed attempt' })
  if (value.acceptance === 'accepted' && (!value.acceptanceRef || !value.verificationRef || !value.candidate || !value.artifactDigest || !value.evidenceRefs.length))
    ctx.addIssue({ code: 'custom', message: 'Accepted outcome requires source evidence, never a model score' })
})

export type ExecutionProfileRef = z.infer<typeof ExecutionProfileRefSchema>
export type ReviewSubject = z.infer<typeof ReviewSubjectSchema>
export type ReviewReport = z.infer<typeof ReviewReportSchema>
export type RouteAdvice = z.infer<typeof RouteAdviceSchema>
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>
export type ExecutionOutcome = z.infer<typeof ExecutionOutcomeSchema>
export interface RoutingEvidenceQuery { projectId: string; limit?: number; cursor?: string }
export interface RoutingEvidencePage<T> { records: readonly T[]; nextCursor?: string }
/** Sync, append-only persistence over the existing product UnitOfWork; no eligibility or execution authority. */
export interface RoutingEvidencePort {
  advice: { put(record: RouteAdvice): { record: RouteAdvice; replayed: boolean }; get(id: string): RouteAdvice | undefined; list(query: RoutingEvidenceQuery): RoutingEvidencePage<RouteAdvice> }
  reviews: { put(record: ReviewEvidence): { record: ReviewEvidence; replayed: boolean }; get(id: string): ReviewEvidence | undefined; list(query: RoutingEvidenceQuery & { subject?: ReviewSubject }): RoutingEvidencePage<ReviewEvidence> }
  outcomes: { put(record: ExecutionOutcome): { record: ExecutionOutcome; replayed: boolean }; get(id: string): ExecutionOutcome | undefined; list(query: RoutingEvidenceQuery & { profile?: ExecutionProfileRef }): RoutingEvidencePage<ExecutionOutcome> }
}
