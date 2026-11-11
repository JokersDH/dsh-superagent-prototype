import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { RecoveryActivationCommitSchema } from './recovery-activation.ts'

export const RecoverySourceCheckpointQuerySchema = z.strictObject({
  /** Only this exact already-committed intent/receipt/event may be excluded from comparison. */
  ignoreCommitted: RecoveryActivationCommitSchema.optional(),
  maxRows: z.number().int().min(1).max(20000).optional(),
  maxRowsPerFamily: z.number().int().min(1).max(10000).optional(),
})
export const RecoverySourceCheckpointSchema = z.strictObject({
  protocol: z.literal('recovery-source-checkpoint/1'), observedAt: TimestampSchema,
  productSchema: z.number().int().positive().nullable(), observedEventCursor: z.number().int().nonnegative().safe(),
  coverage: z.enum(['complete', 'bounded', 'unsupported']), sourceFingerprint: DigestSchema.nullable(),
  families: z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    rows: z.number().int().nonnegative().safe(), digest: DigestSchema, truncated: z.boolean() })).max(256).readonly(),
  ignoredConfirmation: z.strictObject({ activationId: IdSchema, commandId: IdSchema,
    receiptSeq: z.number().int().positive().safe() }).nullable(),
  volatileFieldsIgnored: z.array(z.literal('coordinator_instances.heartbeat_at')).max(1).readonly(),
  issues: z.array(z.enum(['scan_bounded', 'unsupported_schema', 'unknown_table', 'missing_table', 'confirmation_mismatch', 'inconsistent_record'])).max(16).readonly(),
  startupAvailable: z.literal(false),
}).superRefine((value, ctx) => {
  if (new Set(value.families.map(family => family.name)).size !== value.families.length ||
    (value.coverage === 'complete' && (!value.productSchema || !value.sourceFingerprint || !value.families.length ||
      value.issues.length || value.families.some(family => family.truncated))))
    ctx.addIssue({ code: 'custom', message: 'A complete source checkpoint requires complete, consistent logical families' })
})
export type RecoverySourceCheckpointQuery = z.infer<typeof RecoverySourceCheckpointQuerySchema>
export type RecoverySourceCheckpoint = z.infer<typeof RecoverySourceCheckpointSchema>

/** Logical source data only. Marker/host/profile/resources and startup authority remain main-owned. */
export interface RecoverySourceReader {
  inspect(query?: RecoverySourceCheckpointQuery): RecoverySourceCheckpoint
}
