import { z } from 'zod'
import { ContractRefSchema, DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'

export const COMPLETION_HISTORY_MAX_BYTES = 131072
export const CompletionHistoryKindSchema = z.enum(['contracts', 'verifications', 'acceptances'])
const integer = z.number().int().nonnegative().safe()
const cursor = z.string().min(16).max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
export const WorkCompletionHistoryQuerySchema = z.strictObject({
  kind: CompletionHistoryKindSchema, limit: z.number().int().min(1).max(20).default(10), cursor: cursor.optional(),
})
const candidate = { id: IdSchema, ticketId: IdSchema, assignmentId: IdSchema, generation: integer.min(1), artifactDigest: DigestSchema }
export const WorkCompletionHistoryRowSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('contracts'), id: IdSchema, revision: integer.min(1), digest: DigestSchema }),
  z.strictObject({ kind: z.literal('verifications'), ...candidate, at: TimestampSchema, criteriaDigest: DigestSchema }),
  z.strictObject({ kind: z.literal('acceptances'), ...candidate, at: TimestampSchema, criterionCount: integer.max(1024) }),
])
export const WorkCompletionHistorySchema = z.strictObject({
  protocol: z.literal('work-completion-history/1'), workId: IdSchema, projectId: IdSchema,
  currentContract: ContractRefSchema, kind: CompletionHistoryKindSchema, observedAt: TimestampSchema,
  mode: z.literal('live_keyset'), authorization: z.literal('none'), status: z.enum(['ok', 'blocked']),
  reason: z.enum(['entry_too_large', 'page_budget']).nullable(), limit: integer.min(1).max(20),
  returned: integer.max(20), available: integer, entries: z.array(WorkCompletionHistoryRowSchema).max(20),
  hasMore: z.boolean(), nextCursor: cursor.optional(), coverage: z.enum(['complete', 'partial']),
  maxBytes: z.literal(COMPLETION_HISTORY_MAX_BYTES),
}).superRefine((value, context) => {
  if (value.workId !== value.currentContract.workId || value.returned !== value.entries.length || value.returned > value.limit ||
    value.available < value.returned || value.entries.some(row => row.kind !== value.kind) ||
    new Set(value.entries.map(row => row.id)).size !== value.entries.length ||
    (value.status === 'blocked' ? value.reason !== 'entry_too_large' || value.returned !== 0 || !value.hasMore || value.nextCursor !== undefined
      : value.hasMore !== (value.nextCursor !== undefined) || value.reason === 'entry_too_large') ||
    value.coverage !== (value.hasMore ? 'partial' : 'complete') ||
    (!value.hasMore && value.reason !== null) ||
    new TextEncoder().encode(JSON.stringify(value)).byteLength > COMPLETION_HISTORY_MAX_BYTES)
    context.addIssue({ code: 'custom', message: 'Completion history scope, progress, coverage and bytes must agree' })
})
export type WorkCompletionHistoryQuery = z.infer<typeof WorkCompletionHistoryQuerySchema>
export type WorkCompletionHistory = z.infer<typeof WorkCompletionHistorySchema>
