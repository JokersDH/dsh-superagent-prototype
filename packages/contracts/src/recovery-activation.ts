import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'

const stateRoot = z.string().min(1).max(4096).refine(value => !value.includes('\0') && /^(?:\/|[A-Za-z]:[\\/])/.test(value), 'An absolute state root is required')

/** Internal immutable source fact, not an HTTP grant or proof that a target may start. */
export const RecoveryActivationIntentSchema = z.strictObject({
  protocol: z.literal('recovery-activation-intent/1'),
  activationId: IdSchema,
  commandId: IdSchema,
  planId: IdSchema,
  planDigest: DigestSchema,
  source: z.strictObject({ stateId: IdSchema, stateRoot, markerDigest: DigestSchema, inspectionFingerprint: DigestSchema }),
  target: z.strictObject({ generationId: IdSchema, stateRoot, configurationDigest: DigestSchema }),
  principal: z.strictObject({ userId: IdSchema, authorityRef: IdSchema }),
  machineDigest: DigestSchema,
  /** Digest of the current, verified resource/isolation policy; a historical binding is insufficient. */
  resourcePolicyDigest: DigestSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).superRefine((value, context) => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.createdAt)
  if (duration <= 0 || duration > 300000) context.addIssue({ code: 'custom', message: 'Activation confirmation expires within five minutes' })
  if (value.source.stateRoot === value.target.stateRoot || value.source.stateId === value.target.generationId)
    context.addIssue({ code: 'custom', message: 'Historical source and new execution state must be distinct' })
})
export type RecoveryActivationIntent = z.infer<typeof RecoveryActivationIntentSchema>

/** Every write joins the caller's existing source UnitOfWork; no new connection or business dispatch. */
export interface RecoveryActivationFacts {
  get(activationId: string): RecoveryActivationIntent | undefined
  forCommand(commandId: string): RecoveryActivationIntent | undefined
  /** Immutable same-body replay; conflicting activation/command identity must throw. */
  put(intent: RecoveryActivationIntent): { intent: RecoveryActivationIntent; replayed: boolean }
}

export const RecoveryActivationCommitSchema = z.strictObject({
  protocol: z.literal('recovery-activation-commit/1'),
  intent: RecoveryActivationIntentSchema,
  sourceReceipt: z.strictObject({ commandId: IdSchema, seq: z.number().int().positive().safe() }),
}).refine(value => value.sourceReceipt.commandId === value.intent.commandId, 'Receipt must name the intent command')
export type RecoveryActivationCommit = z.infer<typeof RecoveryActivationCommitSchema>
