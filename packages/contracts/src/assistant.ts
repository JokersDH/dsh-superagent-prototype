import { z } from 'zod'
import { IdSchema, TimestampSchema } from './schemas.ts'

export const AssistantProviderStatusSchema = z.strictObject({
  protocol: z.literal('assistant-provider/1'),
  configured: z.boolean(),
  baseURL: z.string().max(2048).nullable(),
  model: z.string().max(160).nullable(),
  models: z.array(z.string().min(1).max(160)).max(32).readonly(),
  state: z.enum(['not_configured', 'configured', 'responding', 'available', 'error']),
  secureTransport: z.boolean(),
  lastResponseAt: TimestampSchema.optional(),
})
export const AssistantModelSelectionSchema = z.strictObject({ model: z.string().trim().min(1).max(160) })
export type AssistantProviderStatus = z.infer<typeof AssistantProviderStatusSchema>
export const AssistantStreamUpdateSchema = z.strictObject({
  protocol: z.literal('assistant-stream/1'),
  messageId: IdSchema,
  conversationId: IdSchema,
  projectId: IdSchema,
  replyId: IdSchema,
  model: z.string().max(160).nullable(),
  revision: z.number().int().positive().safe(),
  phase: z.enum(['streaming', 'complete', 'interrupted']),
  text: z.string().max(32768),
})
export type AssistantStreamUpdate = z.infer<typeof AssistantStreamUpdateSchema>
