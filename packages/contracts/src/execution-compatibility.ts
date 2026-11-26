import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'

/** Read-only product facts. These DTOs do not grant permission to create a Work or send a prompt. */
export const ExecutionOperationSchema = z.enum(['begin', 'answer', 'steer', 'cancel', 'resume'])
export const ExecutionOperationViewSchema = z.strictObject({
  operation: ExecutionOperationSchema,
  supported: z.boolean().nullable(),
  validation: z.enum(['native', 'controlled', 'protocol', 'unobserved']),
  enabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.enabled && (value.supported !== true || !['native', 'controlled'].includes(value.validation)))
    ctx.addIssue({ code: 'custom', message: 'An enabled operation needs explicit support and a product consumer check' })
  if (value.validation === 'unobserved' && value.supported !== null)
    ctx.addIssue({ code: 'custom', message: 'Unobserved support must remain unknown' })
})
export const ExecutionCompatibilityViewSchema = z.strictObject({
  classification: z.enum(['verified', 'compatible_unverified', 'incompatible', 'unknown']),
  nativeVersion: z.string().trim().min(1).max(128).nullable(),
  protocol: z.string().trim().min(1).max(128).nullable(),
  schemaDigest: DigestSchema.nullable(),
  checkedAt: TimestampSchema,
  operations: z.array(ExecutionOperationViewSchema).max(5).readonly(),
}).superRefine((value, ctx) => {
  if (new Set(value.operations.map(item => item.operation)).size !== value.operations.length)
    ctx.addIssue({ code: 'custom', message: 'Operation facts must be unique' })
  if (['verified', 'compatible_unverified'].includes(value.classification) && (!value.nativeVersion || !value.protocol || !value.schemaDigest))
    ctx.addIssue({ code: 'custom', message: 'Compatible protocols require an exact observed identity' })
  if (['incompatible', 'unknown'].includes(value.classification) && value.operations.some(item => item.enabled))
    ctx.addIssue({ code: 'custom', message: 'Unknown or incompatible protocols cannot enable native operations' })
})
export const ExecutionTrialAdmissionSchema = z.strictObject({
  mode: z.literal('explicit_trial'),
  identityDigest: DigestSchema,
  policyDigest: DigestSchema,
  confirmationCommandId: IdSchema,
})
export type ExecutionOperation = z.infer<typeof ExecutionOperationSchema>
export type ExecutionOperationView = z.infer<typeof ExecutionOperationViewSchema>
export type ExecutionCompatibilityView = z.infer<typeof ExecutionCompatibilityViewSchema>
export type ExecutionTrialAdmission = z.infer<typeof ExecutionTrialAdmissionSchema>
