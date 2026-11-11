import { z } from 'zod'
import { IdSchema, JsonSchema, TimestampSchema } from './schemas.ts'
import { ExecutionOutcomeSchema } from './routing-review.ts'

export const WorkEvidenceSchema = z.strictObject({
  protocol: z.literal('work-evidence/1'), workId: IdSchema,
  projection: z.enum(['recorded', 'source_missing', 'not_in_window', 'not_accepted']),
  entries: z.array(z.strictObject({ at: TimestampSchema, kind: z.string().min(1).max(160),
    sourceRef: z.string().min(1).max(1024), detail: JsonSchema })).max(500).readonly(),
  outcomes: z.array(ExecutionOutcomeSchema).max(500).readonly(), truncated: z.boolean(),
}).refine(value => value.outcomes.every(outcome => outcome.attempt.contract.workId === value.workId),
  'Work evidence must not include another work outcome')
export type WorkEvidence = z.infer<typeof WorkEvidenceSchema>
