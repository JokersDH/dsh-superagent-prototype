import { z } from 'zod'
import { PersistedProposalSchema } from './assistant-state.ts'
import { IdSchema, ReasonerProposalSchema, RequiredCriteriaSchema, ScopeSchema, TimestampSchema } from './schemas.ts'

const token = z.string().min(16).max(150000).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
export const ProposalPrepareSchema = z.strictObject({ projectId: IdSchema, conversationId: IdSchema, sourceMessageId: IdSchema,
  payload: ReasonerProposalSchema.refine(value => value.kind !== 'reply', 'An ordinary reply is not an executable proposal') })
  .refine(value => value.payload.sourceMessageId === value.sourceMessageId &&
    (value.payload.kind !== 'propose_work' || value.payload.projectId === value.projectId) &&
    (value.payload.kind !== 'propose_decision' || value.payload.scope.projectId === value.projectId), 'Proposal source and project must match')
export const ProposalPreviewSchema = z.strictObject({ protocol: z.literal('proposal-preview/1'),
  record: PersistedProposalSchema.refine(value => value.state === 'pending' && value.version === 1, 'Preview must be pending'),
  requiredInputs: z.array(z.enum(['work.scope', 'work.criteria', 'work.profileId', 'revision.goal', 'revision.scope', 'revision.criteria'])).max(6).readonly(),
  expiresAt: TimestampSchema, token,
})
const base = z.strictObject({ commandId: IdSchema, projectId: IdSchema, conversationId: IdSchema, token })
export const ProposalCommandSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('confirm_proposal'),
    work: z.strictObject({ scope: ScopeSchema, criteria: RequiredCriteriaSchema, profileId: IdSchema }).optional(),
    revision: z.strictObject({ goal: z.string().min(1).max(16384), scope: ScopeSchema, criteria: RequiredCriteriaSchema }).optional(),
  }),
  base.extend({ kind: z.literal('reject_proposal') }),
])
export type ProposalPrepare = z.infer<typeof ProposalPrepareSchema>
export type ProposalPreview = z.infer<typeof ProposalPreviewSchema>
export type ProposalCommand = z.infer<typeof ProposalCommandSchema>
