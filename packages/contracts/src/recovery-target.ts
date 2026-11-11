import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { ProjectRegistrationInputSchema } from './projects.ts'
import { ExecutionProfileRefSchema } from './routing-review.ts'
import { RecoveryActivationCommitSchema, RecoveryActivationIntentSchema } from './recovery-activation.ts'

const stateRoot = RecoveryActivationIntentSchema.shape.target.shape.stateRoot
export const RecoveryTargetConfigurationSchema = z.strictObject({
  protocol: z.literal('recovery-target-configuration/1'),
  projects: z.array(z.strictObject({ sourceProjectId: IdSchema, targetProjectId: IdSchema,
    registration: ProjectRegistrationInputSchema })).min(1).max(20).readonly(),
  executor: ExecutionProfileRefSchema,
}).refine(value => new Set(value.projects.map(project => project.sourceProjectId)).size === value.projects.length &&
  new Set(value.projects.map(project => project.targetProjectId)).size === value.projects.length, 'Recovery project mappings must be unique')

/** Internal materialization input. Source identity is re-read by main; this JSON grants no startup. */
export const RecoveryTargetPreparationSchema = z.strictObject({
  protocol: z.literal('recovery-target-preparation/1'),
  source: RecoveryActivationCommitSchema,
  configuration: RecoveryTargetConfigurationSchema,
  startupAvailable: z.literal(false),
})
export const RecoveryTargetMaterialSchema = z.strictObject({
  protocol: z.literal('recovery-target-material/1'),
  activationId: IdSchema, generationId: IdSchema, stateRoot,
  intentDigest: DigestSchema, configurationDigest: DigestSchema, manifestDigest: DigestSchema,
  productSchema: z.number().int().positive().safe(), preparedAt: TimestampSchema,
  startupAvailable: z.literal(false),
})

/** Read-only observations only. Empty tables and a matching manifest do not prove writer quiescence. */
export const RecoveryTargetInventorySchema = z.strictObject({
  protocol: z.literal('recovery-target-inventory/1'), stateRoot, observedAt: TimestampSchema,
  productSchema: z.number().int().positive().safe().nullable(), databaseDigest: DigestSchema.nullable(),
  integrity: z.enum(['ok', 'failed', 'unknown']), completeness: z.enum(['complete', 'bounded', 'unsupported']),
  tables: z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    category: z.enum(['metadata', 'business', 'unknown']), rows: z.number().int().nonnegative().safe() })).max(256).readonly(),
  issues: z.array(z.enum(['not_private', 'unsafe_link', 'busy_or_changed', 'unsupported_schema', 'unknown_table',
    'business_rows_present', 'missing_database', 'integrity_failed'])).max(16).readonly(),
  startupAvailable: z.literal(false),
}).refine(value => new Set(value.tables.map(table => table.name)).size === value.tables.length, 'Target inventory tables must be unique')

export type RecoveryTargetConfiguration = z.infer<typeof RecoveryTargetConfigurationSchema>
export type RecoveryTargetPreparation = z.infer<typeof RecoveryTargetPreparationSchema>
export type RecoveryTargetMaterial = z.infer<typeof RecoveryTargetMaterialSchema>
export type RecoveryTargetInventory = z.infer<typeof RecoveryTargetInventorySchema>

/** A-owned synchronous readonly storage inspection; never migrates or creates the target DB. */
export interface RecoveryTargetInventoryReader {
  inspect(stateRoot: string): RecoveryTargetInventory
}
/** D-owned async filesystem preparation in a trusted private parent, outside any source UnitOfWork. */
export interface RecoveryTargetMaterializer {
  prepare(input: RecoveryTargetPreparation): Promise<RecoveryTargetMaterial>
  read(stateRoot: string): Promise<RecoveryTargetMaterial | undefined>
  /** Remove only proven-owned staging for this identity, never historical state or a running target. */
  discardStaging(activationId: string): Promise<void>
}
