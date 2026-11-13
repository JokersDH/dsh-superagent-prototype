import { z } from 'zod'
import { RecoveryPrepareSchema, RecoveryPlanSchema } from './recovery-state.ts'
import { RecoveryActivationIntentSchema } from './recovery-activation.ts'
import { RecoveryTargetConfigurationSchema } from './recovery-target.ts'

export const RecoverySourcePrepareSchema = z.strictObject({ preflight: RecoveryPrepareSchema,
  targetStateRoot: RecoveryActivationIntentSchema.shape.target.shape.stateRoot })
const token = z.string().min(64).max(245760).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
export const RecoverySourcePreparedSchema = z.strictObject({ protocol: z.literal('recovery-source-prepared/1'),
  intent: RecoveryActivationIntentSchema, plan: RecoveryPlanSchema, configuration: RecoveryTargetConfigurationSchema,
  token, authorization: z.literal('not_granted'), startupAvailable: z.literal(false) })
  .refine(value => value.intent.planId === value.plan.planId && value.intent.source.inspectionFingerprint === value.plan.inspectionFingerprint,
    'Source confirmation must name the original preflight')
export const RecoverySourceConfirmSchema = z.strictObject({ token })
export type RecoverySourcePrepare = z.infer<typeof RecoverySourcePrepareSchema>
export type RecoverySourcePrepared = z.infer<typeof RecoverySourcePreparedSchema>
export type RecoverySourceConfirm = z.infer<typeof RecoverySourceConfirmSchema>
