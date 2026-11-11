import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { ProjectRegistrationInputSchema } from './projects.ts'

const blocker = z.strictObject({ code: z.enum(['not_restored', 'marker_invalid', 'restore_evidence_unknown',
  'source_scan_bounded', 'historical_resources_need_revalidation', 'artifact_missing_or_corrupt', 'artifact_scan_bounded',
  'executor_unavailable', 'authorization_not_implemented']), owner: z.enum(['main', 'B', 'D']),
  detail: z.string().min(1).max(512) })
export const RecoveryInspectionSchema = z.strictObject({
  protocol: z.literal('recovery-inspection/1'), state: z.enum(['normal', 'recovery_readonly']),
  observedAt: TimestampSchema, inspectionFingerprint: DigestSchema, markerDigest: DigestSchema.nullable(),
  productSchema: z.number().int().nonnegative().nullable(), eventCursor: z.number().int().nonnegative().safe(),
  heldQueue: z.strictObject({ waiting: z.number().int().nonnegative(), parked: z.number().int().nonnegative() }),
  sourceWorksScanned: z.number().int().nonnegative().max(200), sourceScanTruncated: z.boolean(),
  projects: z.array(z.strictObject({ id: IdSchema, displayName: z.string().min(1).max(160) })).max(128).readonly(),
  historicalAttempts: z.array(z.strictObject({ attemptId: IdSchema, state: z.enum(['active', 'stopping', 'ended']),
    proof: z.literal('needs_fresh_revalidation') })).max(1024).readonly(),
  blockers: z.array(blocker).max(32).readonly(), commitAvailable: z.literal(false),
})
export const RecoveryPrepareSchema = z.strictObject({ expectedFingerprint: DigestSchema,
  bindings: z.array(z.strictObject({ sourceProjectId: IdSchema, project: ProjectRegistrationInputSchema })).min(1).max(20).readonly(),
}).refine(value => new Set(value.bindings.map(binding => binding.sourceProjectId)).size === value.bindings.length, 'Recovery source projects must be unique')
export const RecoveryPlanSchema = z.strictObject({
  protocol: z.literal('recovery-plan/1'), planId: IdSchema, inspectionFingerprint: DigestSchema,
  createdAt: TimestampSchema, expiresAt: TimestampSchema,
  bindings: z.array(z.strictObject({ sourceProjectId: IdSchema, proposedProjectId: IdSchema,
    path: z.string().min(1).max(4096), headCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    configurationDigest: DigestSchema, scopeDigest: DigestSchema })).max(20).readonly(),
  executor: z.strictObject({ profileId: IdSchema, revision: z.number().int().positive(), version: z.string().min(1).max(128),
    executableDigest: DigestSchema }).nullable(),
  artifactsChecked: z.number().int().min(0).max(1000), artifactScanTruncated: z.boolean(),
  blockers: z.array(blocker).max(32).readonly(), authorization: z.literal('not_granted'), commitAvailable: z.literal(false),
}).refine(value => Date.parse(value.expiresAt) > Date.parse(value.createdAt), 'Recovery plans need a future expiry')
export type RecoveryInspection = z.infer<typeof RecoveryInspectionSchema>
export type RecoveryPrepare = z.infer<typeof RecoveryPrepareSchema>
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>
