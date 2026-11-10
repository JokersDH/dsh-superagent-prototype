import { z } from 'zod'
import { ContractRefSchema, DigestSchema, IdSchema, ReasonerProposalSchema, ScopeSchema, TimestampSchema, UserDecisionSchema } from './schemas.ts'

/** Internal single-writer persistence port. These records carry no execution authority or native wire changes. */
export const PersistedDecisionSchema = z.strictObject({
  decision: UserDecisionSchema,
  sourceMessageId: IdSchema,
  sourceTextDigest: DigestSchema,
  conversationId: IdSchema,
  actorRef: IdSchema,
  recordedAt: TimestampSchema,
  revokedBy: IdSchema.optional(),
}).refine(value => !value.revokedBy || !!value.decision.revokedAt, 'A revoking actor needs a revoked revision')

export const PersistedProposalSchema = z.strictObject({
  proposalId: IdSchema,
  version: z.number().int().positive().safe(),
  state: z.enum(['pending', 'confirmed', 'rejected', 'expired', 'superseded']),
  projectId: IdSchema,
  conversationId: IdSchema,
  sourceMessageId: IdSchema,
  sourceTextDigest: DigestSchema,
  actorRef: IdSchema,
  grantId: IdSchema,
  grantScope: ScopeSchema,
  contract: ContractRefSchema.optional(),
  payload: ReasonerProposalSchema,
  payloadDigest: DigestSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** The confirmed application command must commit in the same transaction as this revision. */
  effectCommandId: IdSchema.optional(),
  supersededBy: IdSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.grantScope.projectId !== value.projectId || (value.payload.kind === 'propose_work' && value.payload.projectId !== value.projectId) ||
    (value.payload.kind === 'propose_decision' && value.payload.scope.projectId !== value.projectId))
    ctx.addIssue({ code: 'custom', message: 'Proposal project and grant must agree' })
  if (value.payload.kind !== 'reply' && value.payload.sourceMessageId !== value.sourceMessageId)
    ctx.addIssue({ code: 'custom', message: 'Proposal source must agree' })
  if ((value.state === 'confirmed') !== (value.effectCommandId !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Only a committed confirmation names an application command' })
  if ((value.state === 'superseded') !== (value.supersededBy !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Only superseded proposals name a replacement' })
})

export type PersistedDecision = z.infer<typeof PersistedDecisionSchema>
export type PersistedProposal = z.infer<typeof PersistedProposalSchema>
export interface AssistantStatePage<T> { records: readonly T[]; nextCursor?: string }
export interface AssistantStateQuery { projectId: string; cursor?: string; limit?: number }

/** All methods are synchronous and join the caller's existing product UnitOfWork. No port opens another writer. */
export interface AssistantStatePort {
  decisions: {
    get(id: string): PersistedDecision | undefined
    list(query: AssistantStateQuery): AssistantStatePage<PersistedDecision>
    /** expectedVersion 0 creates; updates append exactly expectedVersion+1. Same revision/body replay is idempotent. */
    put(record: PersistedDecision, expectedVersion: number): { record: PersistedDecision; replayed: boolean }
    history(id: string, limit?: number): readonly PersistedDecision[]
  }
  proposals: {
    get(id: string): PersistedProposal | undefined
    list(query: AssistantStateQuery): AssistantStatePage<PersistedProposal>
    put(record: PersistedProposal, expectedVersion: number): { record: PersistedProposal; replayed: boolean }
    history(id: string, limit?: number): readonly PersistedProposal[]
  }
}
