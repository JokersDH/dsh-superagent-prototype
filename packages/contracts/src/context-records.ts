import { z } from 'zod'
import { ContractRefSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { AssistantContextBindingSchema } from './assistant-context.ts'
import { ContextPreviewSchema, ContextSelectionSchema } from './context-preview.ts'

/** Public continuation is signed by main; the caller cannot select arbitrary projectIds. */
export const ContextHistoryQuerySchema = z.strictObject({
  projectId: IdSchema, conversationId: IdSchema.optional(), workId: IdSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(), cursor: z.string().min(1).max(16384).optional(),
})
export const ContextHistoryEntrySchema = z.strictObject({
  messageId: IdSchema, projectId: IdSchema, conversationId: IdSchema,
  confirmedAt: TimestampSchema, expiresAt: TimestampSchema, contract: ContractRefSchema.optional(),
  selections: z.array(ContextSelectionSchema).min(1).max(5).readonly(), sourceCount: z.number().int().min(1).max(64),
  message: z.strictObject({ state: z.enum(['available', 'missing']), text: z.string().max(320).optional(), truncated: z.boolean() })
    .refine(value => value.state === 'available' ? value.text !== undefined : value.text === undefined && !value.truncated),
})
export const ContextHistorySchema = z.strictObject({
  protocol: z.literal('context-history/1'), projectId: IdSchema, conversationId: IdSchema.optional(), workId: IdSchema.optional(),
  observedAt: TimestampSchema, entries: z.array(ContextHistoryEntrySchema).max(50).readonly(), hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(16384).optional(),
}).superRefine((value, ctx) => {
  if (value.hasMore !== (value.nextCursor !== undefined) || new Set(value.entries.map(entry => entry.messageId)).size !== value.entries.length ||
    value.entries.some(entry => entry.projectId !== value.projectId ||
      (value.conversationId !== undefined && entry.conversationId !== value.conversationId) ||
      (value.workId !== undefined && entry.contract?.workId !== value.workId)))
    ctx.addIssue({ code: 'custom', message: 'Context history must match its exact scope and continuation' })
})

/** Original frozen data only. Expiry is historical and this response carries no send/execute token. */
export const ContextScopeReviewSchema = z.strictObject({ protocol: z.literal('context-scope-review/1'),
  reasons: z.array(z.enum(['project_changed', 'selection_narrowed', 'selection_broadened', 'selection_replaced',
    'exclusion_added', 'exclusion_removed', 'selection_validity_changed'])).max(7).readonly(),
  partial: z.boolean(), withheldSourceCount: z.number().int().min(0).max(64), authorization: z.literal('none') })
  .refine(value => new Set(value.reasons).size === value.reasons.length, 'Scope explanations must be distinct')
export const ContextSourcesSchema = z.strictObject({
  protocol: z.literal('context-sources/1'), observedAt: TimestampSchema, binding: AssistantContextBindingSchema,
  state: z.enum(['verified', 'missing', 'unverified', 'scope_changed']),
  sources: ContextPreviewSchema.shape.sources, omitted: ContextPreviewSchema.shape.omitted,
  injectionFlags: ContextPreviewSchema.shape.injectionFlags,
  scopeReview: ContextScopeReviewSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.scopeReview && (value.scopeReview.partial !== (value.state !== 'verified') ||
    value.scopeReview.withheldSourceCount !== (value.state === 'scope_changed' ? value.binding.sources.length : 0)))
    ctx.addIssue({ code: 'custom', message: 'Scope diagnostics must preserve the authoritative original-source state' })
  if (value.state !== 'verified' && (value.sources.length || value.omitted.length || value.injectionFlags.length))
    ctx.addIssue({ code: 'custom', message: 'Unverified history must not contain source content' })
  if (value.state === 'verified' && (value.sources.length !== value.binding.sources.length || value.sources.some((source, index) => {
    const bound = value.binding.sources[index]
    return !bound || source.sourceId !== bound.sourceId || source.kind !== bound.kind || source.sourceDigest !== bound.sourceDigest ||
      source.previewDigest !== bound.previewDigest || source.truncated !== bound.truncated
  }))) ctx.addIssue({ code: 'custom', message: 'Historical source data must retain its exact original binding' })
})
export type ContextHistoryQuery = z.infer<typeof ContextHistoryQuerySchema>
export type ContextHistoryEntry = z.infer<typeof ContextHistoryEntrySchema>
export type ContextHistory = z.infer<typeof ContextHistorySchema>
export type ContextSources = z.infer<typeof ContextSourcesSchema>
