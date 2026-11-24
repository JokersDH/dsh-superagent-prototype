import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { RecoveryActivationCommitSchema } from './recovery-activation.ts'
import { RecoveryTargetConfigurationSchema, RecoveryTargetMaterialSchema } from './recovery-target.ts'

/** An explicit command naming the already prepared immutable target; never accepts caller authority. */
export const RecoveryTargetAuthorizeSchema = z.strictObject({
  activationId: IdSchema, commandId: IdSchema, configuration: RecoveryTargetConfigurationSchema,
  expectedManifestDigest: DigestSchema, confirmNewExecution: z.literal(true),
})
export const RecoveryTargetGrantSchema = z.strictObject({
  protocol: z.literal('recovery-target-grant/1'), commandId: IdSchema,
  source: RecoveryActivationCommitSchema, material: RecoveryTargetMaterialSchema,
  configuration: RecoveryTargetConfigurationSchema,
  principal: RecoveryActivationCommitSchema.shape.intent.shape.principal,
  machineDigest: DigestSchema, rootIdentity: z.string().min(3).max(128),
  databaseIdentity: z.string().min(3).max(128),
  profileDigest: DigestSchema, executableDigest: DigestSchema,
  registryDigest: DigestSchema, grantedAt: TimestampSchema,
}).superRefine((value, ctx) => {
  const { intent } = value.source
  if (value.material.activationId !== intent.activationId || value.material.generationId !== intent.target.generationId ||
    value.material.stateRoot !== intent.target.stateRoot || value.material.configurationDigest !== intent.target.configurationDigest ||
    value.principal.userId !== intent.principal.userId || value.principal.authorityRef !== intent.principal.authorityRef)
    ctx.addIssue({ code: 'custom', message: 'Target grant must retain the exact original source, principal and material identity' })
})
/** The durable permission is not evidence that a service or any Work has started. */
export const RecoveryTargetAuthorizationSchema = z.strictObject({
  protocol: z.literal('recovery-target-authorization/1'), grant: RecoveryTargetGrantSchema,
  targetReceipt: z.strictObject({ commandId: IdSchema, seq: z.number().int().positive().safe() }),
  authorization: z.literal('granted'), started: z.literal(false), startupAvailable: z.literal(false),
}).refine(value => value.targetReceipt.commandId === value.grant.commandId, 'Target receipt must name the explicit grant')
export type RecoveryTargetAuthorize = z.infer<typeof RecoveryTargetAuthorizeSchema>
export type RecoveryTargetGrant = z.infer<typeof RecoveryTargetGrantSchema>
export type RecoveryTargetAuthorization = z.infer<typeof RecoveryTargetAuthorizationSchema>
