import { z } from 'zod'
import { ContractRefSchema, IdSchema } from './schemas.ts'

/** Read-only selection and capability projection; never a runtime or dispatch authorization. */
export const WorkExecutionSchema = z.strictObject({
  protocol: z.literal('work-execution/1'), contract: ContractRefSchema,
  profileId: IdSchema, revision: z.number().int().positive().safe().nullable(), driverId: IdSchema.nullable(),
  displayName: z.string().trim().min(1).max(160),
  runningInput: z.enum(['native_steer', 'unsupported', 'unknown', 'not_running']),
})
export type WorkExecution = z.infer<typeof WorkExecutionSchema>
