import { z } from 'zod'
import { IdSchema, TimestampSchema } from './schemas.ts'

export const ConversationSummarySchema = z.strictObject({
  id: IdSchema,
  title: z.string().trim().min(1).max(512),
  titleRevision: z.number().int().positive().safe(),
  archiveRevision: z.number().int().nonnegative().safe(),
  projectId: IdSchema.optional(),
  projectIds: z.array(IdSchema).max(128).readonly(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  archivedAt: TimestampSchema.optional(),
  messageCount: z.number().int().nonnegative().safe(),
  workCount: z.number().int().nonnegative().safe(),
  attention: z.boolean(),
})
export const ConversationCatalogQuerySchema = z.strictObject({
  projectId: IdSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional(),
})
export const ConversationCatalogSchema = z.strictObject({
  protocol: z.literal('conversation-catalog/1'),
  conversations: z.array(ConversationSummarySchema).max(50).readonly(),
  hasMore: z.boolean(),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional(),
}).refine(value => value.hasMore === (value.nextCursor !== undefined), 'Catalog cursor must match pagination state')
const base = z.strictObject({ commandId: IdSchema, conversationId: IdSchema })
export const ConversationCommandSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('create_conversation'), projectId: IdSchema, title: z.string().trim().min(1).max(512) }),
  base.extend({ kind: z.literal('rename_conversation'), expectedTitleRevision: z.number().int().positive().safe(), title: z.string().trim().min(1).max(512) }),
  base.extend({ kind: z.literal('archive_conversation'), expectedArchiveRevision: z.number().int().nonnegative().safe(), archived: z.boolean() }),
])
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>
export type ConversationCatalogQuery = z.infer<typeof ConversationCatalogQuerySchema>
export type ConversationCatalog = z.infer<typeof ConversationCatalogSchema>
export type ConversationCommand = z.infer<typeof ConversationCommandSchema>
