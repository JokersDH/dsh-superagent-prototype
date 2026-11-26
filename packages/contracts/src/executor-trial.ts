import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { ExecutionProfileViewSchema } from './configuration.ts'

export const ExecutorTrialCommandSchema = z.strictObject({
  commandId: IdSchema, profileId: IdSchema, revision: z.number().int().positive().safe(),
  identityDigest: DigestSchema, policyDigest: DigestSchema, confirmUnverifiedVersion: z.literal(true),
})
export const ExecutorTrialInspectionSchema = z.strictObject({
  protocol: z.literal('executor-trial-inspection/1'), profile: ExecutionProfileViewSchema,
  identityDigest: DigestSchema, policyDigest: DigestSchema, confirmationCommandId: IdSchema,
  authorization: z.enum(['not_granted', 'granted']), confirmationAvailable: z.boolean(), observedAt: TimestampSchema,
}).superRefine((value, ctx) => {
  if (value.profile.dispatchAllowed || value.profile.compatibility?.operations.some(item => item.enabled))
    ctx.addIssue({ code: 'custom', message: 'Inspection cannot itself enable execution' })
  if (value.confirmationAvailable && value.profile.compatibility?.classification !== 'compatible_unverified')
    ctx.addIssue({ code: 'custom', message: 'Only a complete compatible observation can request explicit trial consent' })
})
export const ExecutorTrialReceiptSchema = z.strictObject({
  protocol: z.literal('executor-trial-receipt/1'), commandId: IdSchema, seq: z.number().int().positive().safe(),
  profileId: IdSchema, revision: z.number().int().positive().safe(), identityDigest: DigestSchema, policyDigest: DigestSchema,
  authorization: z.literal('granted'), effective: z.literal('next_normal_start'),
})
export type ExecutorTrialCommand = z.infer<typeof ExecutorTrialCommandSchema>
export type ExecutorTrialInspection = z.infer<typeof ExecutorTrialInspectionSchema>
export type ExecutorTrialReceipt = z.infer<typeof ExecutorTrialReceiptSchema>
