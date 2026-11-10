import { z } from 'zod'
import { CandidateRefSchema, IdSchema } from './schemas.ts'

/** Additive product HTTP resource; the frozen Runner/data wire identity is unchanged. */
export const WorkVerificationStatusSchema = z.strictObject({
  protocol: z.literal('work-verification/1'),
  workId: IdSchema,
  state: z.enum(['not_ready', 'queued', 'running', 'retry_wait', 'blocked', 'finished']),
  candidate: CandidateRefSchema.optional(),
  verificationId: IdSchema.optional(),
  failure: z.strictObject({
    id: IdSchema,
    code: z.enum(['verification_failed', 'storage_unavailable']),
    failureCount: z.number().int().positive().safe(),
  }).optional(),
  retryAvailable: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.candidate && value.candidate.contract.workId !== value.workId)
    ctx.addIssue({ code: 'custom', message: 'Verification belongs to another work' })
  if ((value.state === 'blocked') !== (value.failure !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Only a blocked verification has a failure' })
  if (value.state !== 'not_ready' && value.state !== 'finished' && !value.candidate)
    ctx.addIssue({ code: 'custom', message: 'Pending verification needs the current candidate' })
  if ((value.state === 'finished') !== (value.verificationId !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Only finished verification names a result' })
  if (value.retryAvailable && (value.state !== 'blocked' || !value.candidate))
    ctx.addIssue({ code: 'custom', message: 'Only a blocked current candidate can be retried' })
})

export const VerificationRetryCommandSchema = z.strictObject({
  kind: z.literal('retry_verification'),
  commandId: IdSchema,
  conversationId: IdSchema,
  candidate: CandidateRefSchema,
  blockedId: IdSchema,
})

export type WorkVerificationStatus = z.infer<typeof WorkVerificationStatusSchema>
export type VerificationRetryCommand = z.infer<typeof VerificationRetryCommandSchema>
