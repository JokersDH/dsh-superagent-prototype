import { z } from 'zod'
import { CandidateRefSchema, ContractRefSchema, IdSchema, TimestampSchema } from './schemas.ts'

export const AttentionKindSchema = z.enum(['question', 'candidate', 'blocked'])
export const AttentionReasonSchema = z.enum(['waiting_age', 'unknown_wait', 'deadline_overdue', 'deadline_near',
  'blocks_other_work', 'permission_pending', 'authentication_pending', 'candidate_ready', 'verification_blocked',
  'machine_failed', 'writer_indeterminate', 'dispatch_paused'])
const base = z.strictObject({
  id: IdSchema, projectId: IdSchema, conversationId: IdSchema, contract: ContractRefSchema,
  workTitle: z.string().min(1).max(512), summary: z.string().min(1).max(512),
  sinceAt: TimestampSchema.nullable(), deadlineAt: TimestampSchema.nullable(), expiresAt: TimestampSchema.nullable(),
  blockedWorkIds: z.array(IdSchema).max(128).readonly(),
})
export const AttentionItemSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('question'), questionId: IdSchema, questionVersion: z.number().int().positive().safe(),
    questionKind: z.enum(['clarification', 'permission', 'authentication', 'review']) }),
  base.extend({ kind: z.literal('candidate'), candidate: CandidateRefSchema, verificationId: IdSchema }),
  base.extend({ kind: z.literal('blocked'), code: z.enum(['verification_blocked', 'machine_failed', 'writer_indeterminate', 'dispatch_paused']) }),
]).superRefine((value, ctx) => {
  if (value.kind === 'candidate' && (value.candidate.contract.workId !== value.contract.workId ||
    value.candidate.contract.revision !== value.contract.revision || value.candidate.contract.digest !== value.contract.digest))
    ctx.addIssue({ code: 'custom', message: 'Attention candidate must match its exact contract' })
  if (new Set(value.blockedWorkIds).size !== value.blockedWorkIds.length)
    ctx.addIssue({ code: 'custom', message: 'Known blocked work identities must be unique' })
})
export const AttentionRankSchema = z.strictObject({ id: IdSchema, reasons: z.array(AttentionReasonSchema).min(1).max(12).readonly() })
export const AttentionQuerySchema = z.strictObject({ projectId: IdSchema.optional(), limit: z.number().int().min(1).max(20).optional(),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional() })
export const AttentionPageSchema = z.strictObject({
  protocol: z.literal('attention-inbox/1'), observedAt: TimestampSchema,
  items: z.array(AttentionItemSchema).max(4040).readonly(), ranks: z.array(AttentionRankSchema).max(4040).readonly(),
  ranking: z.enum(['waiting_order', 'deterministic_priority']), scannedWorks: z.number().int().min(0).max(20),
  questionCoverage: z.enum(['complete', 'bounded']), hasMore: z.boolean(),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).optional(),
}).superRefine((value, ctx) => {
  const ids = new Set(value.items.map(item => item.id))
  if (ids.size !== value.items.length || new Set(value.ranks.map(rank => rank.id)).size !== value.ranks.length ||
    value.ranks.length !== value.items.length || value.ranks.some(rank => !ids.has(rank.id)))
    ctx.addIssue({ code: 'custom', message: 'Attention ranks must name each current page item exactly once' })
  if (value.hasMore !== (value.nextCursor !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Work-page continuation must match hasMore' })
})
export type AttentionItem = z.infer<typeof AttentionItemSchema>
export type AttentionRank = z.infer<typeof AttentionRankSchema>
export type AttentionQuery = z.infer<typeof AttentionQuerySchema>
export type AttentionPage = z.infer<typeof AttentionPageSchema>
/** C supplies pure priority rules; main owns authorized source collection and public presentation. */
export type AttentionRanker = (input: { items: readonly AttentionItem[]; now: string }) => readonly AttentionRank[]
