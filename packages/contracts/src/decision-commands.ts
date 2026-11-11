import { z } from 'zod'
import { PersistedDecisionSchema } from './assistant-state.ts'
import { IdSchema, ScopeSchema, TimestampSchema, UserDecisionSchema } from './schemas.ts'

/** Product companion commands for explicit knowledge; these never grant native execution. */
export const DecisionPrepareSchema = z.strictObject({
  projectId: IdSchema, conversationId: IdSchema, sourceMessageId: IdSchema,
  content: z.string().trim().min(1).max(16384).refine(value => !value.includes('\0')),
  scope: ScopeSchema, supersedes: IdSchema.optional(),
}).refine(value => value.projectId === value.scope.projectId, 'Decision scope must match the requested project')
const token = z.string().min(16).max(150000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
export const DecisionPreviewSchema = z.strictObject({
  protocol: z.literal('decision-preview/1'), decision: UserDecisionSchema,
  conversationId: IdSchema, sourceMessageId: IdSchema, expiresAt: TimestampSchema, token,
})
const commandBase = z.strictObject({ commandId: IdSchema, projectId: IdSchema, conversationId: IdSchema })
export const DecisionCommandSchema = z.discriminatedUnion('kind', [
  commandBase.extend({ kind: z.literal('record_decision'), token }),
  commandBase.extend({ kind: z.literal('revoke_decision'), decisionId: IdSchema, expectedVersion: z.number().int().positive().safe() }),
])
export const DecisionQuerySchema = z.strictObject({ projectId: IdSchema,
  limit: z.number().int().min(1).max(50).optional(), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional() })
export const DecisionViewSchema = z.strictObject({
  record: PersistedDecisionSchema,
  sourceState: z.enum(['current', 'missing', 'stale', 'unknown']),
  /** Recorded is an audit state, never a claim of effective permission or automatic context eligibility. */
  status: z.enum(['recorded', 'revoked', 'superseded', 'expired']),
})
export const DecisionPageSchema = z.strictObject({
  protocol: z.literal('decision-catalog/1'), decisions: z.array(DecisionViewSchema).max(50).readonly(),
  hasMore: z.boolean(), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional(),
}).refine(value => value.hasMore === (value.nextCursor !== undefined), 'Decision continuation must match hasMore')
export type DecisionPrepare = z.infer<typeof DecisionPrepareSchema>
export type DecisionPreview = z.infer<typeof DecisionPreviewSchema>
export type DecisionCommand = z.infer<typeof DecisionCommandSchema>
export type DecisionQuery = z.infer<typeof DecisionQuerySchema>
export type DecisionView = z.infer<typeof DecisionViewSchema>
export type DecisionPage = z.infer<typeof DecisionPageSchema>
