import { z } from 'zod'
import { DigestSchema, IdSchema } from './schemas.ts'
import { ProposalPreviewSchema } from './proposal-commands.ts'

export const AssistantCandidatePrepareSchema = z.strictObject({ messageId: IdSchema,
  index: z.number().int().min(0).max(7), payloadDigest: DigestSchema })
export const AssistantCandidatesSchema = z.strictObject({ protocol: z.literal('assistant-candidates/1'),
  messageId: IdSchema, replyMessageId: IdSchema, projectId: IdSchema, conversationId: IdSchema,
  status: z.enum(['unavailable', 'none', 'candidates']),
  candidates: z.array(z.strictObject({ index: z.number().int().min(0).max(7),
    kind: z.enum(['propose_work', 'propose_revision', 'propose_decision']), summary: z.string().max(2000), payloadDigest: DigestSchema,
    requiredInputs: ProposalPreviewSchema.shape.requiredInputs })).max(8).readonly(),
  rejected: z.array(z.strictObject({ index: z.number().int().min(0).max(7), reason: z.string().min(1).max(100) })).max(8).readonly(),
  trust: z.literal('untrusted_data'), authorization: z.literal('none'), executable: z.literal(false),
}).refine(value => (value.status === 'candidates') === (value.candidates.length > 0) &&
  new Set(value.candidates.map(candidate => candidate.index)).size === value.candidates.length,
  'Candidate indices and status must match the verified reply projection')
export type AssistantCandidatePrepare = z.infer<typeof AssistantCandidatePrepareSchema>
export type AssistantCandidates = z.infer<typeof AssistantCandidatesSchema>
