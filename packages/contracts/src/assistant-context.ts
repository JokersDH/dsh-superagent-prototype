import { z } from 'zod'
import { ContractRefSchema, DigestSchema, IdSchema, ScopeSchema, TimestampSchema } from './schemas.ts'
import { ContextSelectionSchema } from './context-preview.ts'

/** A frozen user-selected discussion input. This audit record grants neither tools nor replay. */
export const AssistantContextBindingSchema = z.strictObject({
  protocol: z.literal('assistant-context-binding/1'),
  commandId: IdSchema, messageId: IdSchema, requestId: IdSchema,
  projectId: IdSchema, conversationId: IdSchema, userTextDigest: DigestSchema,
  principal: z.strictObject({ userId: IdSchema, authorityRef: IdSchema }),
  purpose: z.literal('conversation_discussion'), scope: ScopeSchema,
  selections: z.array(ContextSelectionSchema).min(1).max(5).readonly(),
  contract: ContractRefSchema.optional(),
  /** Existing content-addressed artifact containing the exact bounded bundle; never a host path. */
  bundleRef: IdSchema, bundleDigest: DigestSchema,
  sources: z.array(z.strictObject({ sourceId: IdSchema,
    kind: z.enum(['work', 'contract', 'verification', 'delivery', 'decision', 'project_metadata', 'conversation_message', 'artifact']),
    sourceDigest: DigestSchema, previewDigest: DigestSchema, truncated: z.boolean(),
  })).min(1).max(64).readonly(),
  confirmedAt: TimestampSchema, expiresAt: TimestampSchema,
}).superRefine((value, ctx) => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.confirmedAt)
  const kinds: Record<string, readonly string[]> = { work: ['work', 'contract', 'verification', 'delivery'],
    decisions: ['decision'], project: ['project_metadata'], conversation: ['conversation_message'], artifacts: ['artifact'] }
  if (value.scope.projectId !== value.projectId || duration <= 0 || duration > 300000 ||
    (value.scope.expiresAt && Date.parse(value.expiresAt) > Date.parse(value.scope.expiresAt)) ||
    new Set(value.selections).size !== value.selections.length ||
    new Set(value.sources.map(source => source.sourceId)).size !== value.sources.length ||
    (!value.contract && value.selections.some(selection => selection === 'work' || selection === 'artifacts')) ||
    value.sources.some(source => !value.selections.some(selection => kinds[selection]!.includes(source.kind))))
    ctx.addIssue({ code: 'custom', message: 'Discussion context scope, freshness, selections and sources must agree' })
})
export type AssistantContextBinding = z.infer<typeof AssistantContextBindingSchema>

/** A-owned synchronous append-only port in the caller's existing chat/receipt UnitOfWork. */
export interface AssistantContextBindings {
  forMessage(messageId: string): AssistantContextBinding | undefined
  forCommand(commandId: string): AssistantContextBinding | undefined
  /** Same body replays; either identity with a different body conflicts. No send or private UoW. */
  put(binding: AssistantContextBinding): { binding: AssistantContextBinding; replayed: boolean }
}
