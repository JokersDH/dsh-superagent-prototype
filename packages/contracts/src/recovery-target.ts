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

export const RecoveryTargetPrepareInputSchema = z.strictObject({
  activationId: IdSchema, configuration: RecoveryTargetConfigurationSchema,
})
export const RecoveryTargetStatusSchema = z.strictObject({
  protocol: z.literal('recovery-target-status/1'), activationId: IdSchema, generationId: IdSchema, stateRoot,
  sourceReceipt: RecoveryActivationCommitSchema.shape.sourceReceipt,
  observedAt: TimestampSchema, expiresAt: TimestampSchema,
  step: z.enum(['not_prepared', 'material_prepared', 'inventory_complete', 'blocked']),
  material: RecoveryTargetMaterialSchema.optional(), inventory: RecoveryTargetInventorySchema.optional(),
  blockers: z.array(z.strictObject({ code: z.enum(['source_expired', 'source_changed', 'material_mismatch', 'target_unsafe',
    'initialization_unknown', 'inventory_incomplete', 'business_rows_present', 'authorization_not_implemented']),
    owner: z.enum(['main', 'A', 'B', 'D']), detail: z.string().min(1).max(1024) })).max(16).readonly(),
  authorization: z.literal('not_granted'), startupAvailable: z.literal(false),
}).superRefine((value, context) => {
  if ((value.material && (value.material.activationId !== value.activationId || value.material.generationId !== value.generationId || value.material.stateRoot !== value.stateRoot)) ||
    (value.inventory && value.inventory.stateRoot !== value.stateRoot) ||
    (value.step === 'inventory_complete' && (!value.material || !value.inventory || value.inventory.completeness !== 'complete' ||
      value.inventory.integrity !== 'ok' || !value.inventory.databaseDigest || value.inventory.issues.length ||
      value.inventory.productSchema !== value.material.productSchema || value.inventory.tables.some(table => table.category === 'business' && table.rows > 0))))
    context.addIssue({ code: 'custom', message: 'Target status must bind one material and complete empty inventory' })
})
export type RecoveryTargetPrepareInput = z.infer<typeof RecoveryTargetPrepareInputSchema>
export type RecoveryTargetStatus = z.infer<typeof RecoveryTargetStatusSchema>

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
