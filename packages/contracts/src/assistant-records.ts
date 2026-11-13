import { z } from 'zod'
import { DigestSchema, IdSchema, ReasonerProposalSchema, TimestampSchema } from './schemas.ts'
import { AssistantContextBindingSchema } from './assistant-context.ts'

const model = z.string().min(1).max(160)
/** Existing before-send command receipt result; a request record is not a completed response. */
export const AssistantInferenceRecordSchema = z.strictObject({
  kind: z.literal('assistant-inference/1'),
  input: z.strictObject({ messageId: IdSchema, conversationId: IdSchema, projectId: IdSchema }),
  model: model.nullable(),
  replyFormat: z.enum(['plain', 'suggestions']).optional(),
  sourceTextDigest: DigestSchema.optional(),
})
/** Minimal validated response data, not an SDK/session dump or an executable suggestion. */
export const AssistantReplyBodySchema = z.strictObject({
  protocol: z.literal('assistant-reply-body/1'), projectId: IdSchema, conversationId: IdSchema,
  sourceMessageId: IdSchema, replyMessageId: IdSchema, model,
  text: z.string().min(1).max(32768), suggestions: z.array(ReasonerProposalSchema).max(8).readonly(),
}).superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 524288 || value.suggestions.some(suggestion =>
    suggestion.kind !== 'reply' && (suggestion.sourceMessageId !== value.sourceMessageId ||
      (suggestion.kind === 'propose_work' && suggestion.projectId !== value.projectId) ||
      (suggestion.kind === 'propose_decision' && suggestion.scope.projectId !== value.projectId))))
    ctx.addIssue({ code: 'custom', message: 'Reply data must fit the byte cap and retain its original source/project' })
})
export const AssistantReplyResultSchema = z.strictObject({
  protocol: z.literal('assistant-reply-result/1'), requestId: IdSchema, requestDigest: DigestSchema,
  sourceMessageId: IdSchema, replyMessageId: IdSchema, projectId: IdSchema, conversationId: IdSchema,
  principal: z.strictObject({ userId: IdSchema, authorityRef: IdSchema }), model,
  artifactRef: IdSchema, artifactDigest: DigestSchema, textDigest: DigestSchema, recordedAt: TimestampSchema,
})
export type AssistantReplyBody = z.infer<typeof AssistantReplyBodySchema>
export type AssistantReplyResult = z.infer<typeof AssistantReplyResultSchema>
export type AssistantInferenceRecord = z.infer<typeof AssistantInferenceRecordSchema>

/** One completed response joins the existing request receipt; it never authorizes another send. */
export interface AssistantReplyResults {
  forRequest(requestId: string): AssistantReplyResult | undefined
  forReply(replyMessageId: string): AssistantReplyResult | undefined
  put(result: AssistantReplyResult): { result: AssistantReplyResult; replayed: boolean }
}

export const AssistantContextHistoryQuerySchema = z.strictObject({
  projectIds: z.array(IdSchema).min(1).max(128).refine(values => new Set(values).size === values.length).readonly(),
  conversationId: IdSchema.optional(), workId: IdSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(4096).optional(),
})
export const AssistantContextHistoryPageSchema = z.strictObject({
  protocol: z.literal('assistant-context-history/1'), observedAt: TimestampSchema,
  records: z.array(AssistantContextBindingSchema).max(100).readonly(), hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(4096).optional(),
}).refine(value => value.hasMore === (value.nextCursor !== undefined), 'History continuation must be explicit')
export type AssistantContextHistoryQuery = z.infer<typeof AssistantContextHistoryQuerySchema>
export type AssistantContextHistoryPage = z.infer<typeof AssistantContextHistoryPageSchema>
/** Read-only A keyset port; main binds any public cursor to principal and configured project scope. */
export interface AssistantContextHistory {
  page(query: AssistantContextHistoryQuery): AssistantContextHistoryPage
}
