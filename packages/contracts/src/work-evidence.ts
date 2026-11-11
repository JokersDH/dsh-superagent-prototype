import { z } from 'zod'
import { ContractRefSchema, IdSchema, JsonSchema, TimestampSchema } from './schemas.ts'
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

export const WorkEvidenceHistoryQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(16).max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).optional(),
})
export const WorkEvidenceHistorySchema = z.strictObject({
  protocol: z.literal('work-evidence-history/1'), workId: IdSchema, contract: ContractRefSchema, observedAt: TimestampSchema,
  entries: WorkEvidenceSchema.shape.entries.unwrap().element.array().max(100).readonly(),
  hasMore: z.boolean(), nextCursor: z.string().min(16).max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).optional(),
  window: z.enum(['complete', 'caller_limit', 'storage_cap']),
  sourcesCapped: z.array(z.string().min(1).max(100)).max(32).readonly(),
}).superRefine((value, context) => {
  if (value.contract.workId !== value.workId || value.hasMore !== (value.nextCursor !== undefined) ||
    value.hasMore !== (value.window === 'caller_limit') || (value.window === 'complete' && value.sourcesCapped.length) ||
    (value.window === 'storage_cap' && !value.sourcesCapped.length))
    context.addIssue({ code: 'custom', message: 'History identity, continuation and coverage must agree' })
})
export type WorkEvidenceHistoryQuery = z.infer<typeof WorkEvidenceHistoryQuerySchema>
export type WorkEvidenceHistory = z.infer<typeof WorkEvidenceHistorySchema>
