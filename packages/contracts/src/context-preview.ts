import { z } from 'zod'
import { ContractRefSchema, DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'

export const ContextSelectionSchema = z.enum(['work', 'decisions', 'project', 'conversation', 'artifacts'])
const sourceKind = z.enum(['work', 'contract', 'verification', 'delivery', 'decision', 'project_metadata', 'conversation_message', 'artifact'])
const allowedKinds = { work: ['work', 'contract', 'verification', 'delivery'], decisions: ['decision'],
  project: ['project_metadata'], conversation: ['conversation_message'], artifacts: ['artifact'] } as const
const counts = z.strictObject({ files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), tokens: z.number().nonnegative() })
export const ContextPreviewInputSchema = z.strictObject({
  projectId: IdSchema, conversationId: IdSchema, workId: IdSchema.optional(),
  selections: z.array(ContextSelectionSchema).min(1).max(5).refine(values => new Set(values).size === values.length),
  query: z.string().max(8192).optional(),
  budget: z.strictObject({
    maxFiles: z.number().int().min(1).max(64),
    maxBytes: z.number().int().min(1).max(4194304),
    maxTokens: z.number().int().min(1).max(500000),
  }),
}).refine(value => !!value.workId || !value.selections.some(selection => selection === 'work' || selection === 'artifacts'),
  'Work and artifact context require an explicitly selected work')

export const ContextPreviewSchema = z.strictObject({
  protocol: z.literal('context-preview/1'), requestId: IdSchema, projectId: IdSchema, conversationId: IdSchema,
  contract: ContractRefSchema.optional(), observedAt: TimestampSchema, expiresAt: TimestampSchema,
  status: z.enum(['sufficient', 'partial', 'insufficient']), trust: z.literal('untrusted_data'),
  selections: z.array(ContextSelectionSchema).min(1).max(5),
  sources: z.array(z.strictObject({
    sourceId: IdSchema, kind: sourceKind, title: z.string().max(256), path: z.string().min(1).max(1024),
    content: z.string().max(262144), sourceDigest: DigestSchema, previewDigest: DigestSchema,
    bytes: z.number().int().nonnegative(), estimatedTokens: z.number().nonnegative(), truncated: z.boolean(),
  })).max(64).readonly(),
  groups: z.array(z.strictObject({
    name: z.enum(['contract', 'decisions', 'project_facts', 'conversation', 'artifacts']),
    status: z.enum(['included', 'empty', 'unavailable', 'truncated']), used: counts,
  })).max(5).readonly(),
  omitted: z.array(z.strictObject({ sourceId: z.string().max(256).optional(), path: z.string().max(1024).optional(),
    reason: z.string().min(1).max(100) })).max(1024).readonly(),
  injectionFlags: z.array(z.strictObject({ sourceId: IdSchema, patterns: z.array(z.string().max(160)).max(32) })).max(64).readonly(),
  issues: z.array(z.enum(['conversation_scan_incomplete', 'artifact_source_missing'])).max(2).readonly(),
  budgetClamped: z.array(z.enum(['maxFiles', 'maxBytes', 'maxTokens', 'maxSlices', 'maxDurationMs'])).max(5).readonly(),
  budget: z.strictObject({ maxFiles: z.number().int().positive(), maxBytes: z.number().int().positive(), maxTokens: z.number().int().positive() }),
  totals: counts,
}).superRefine((value, ctx) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt) ||
    new Set(value.selections).size !== value.selections.length ||
    (!value.contract && value.selections.some(selection => selection === 'work' || selection === 'artifacts')) ||
    new Set(value.sources.map(source => source.sourceId)).size !== value.sources.length ||
    value.sources.some(source => !value.selections.some(selection => (allowedKinds[selection] as readonly string[]).includes(source.kind))) ||
    value.totals.files !== value.sources.length || value.totals.bytes > value.budget.maxBytes ||
    value.totals.bytes !== value.sources.reduce((sum, source) => sum + source.bytes, 0) ||
    value.totals.tokens !== value.sources.reduce((sum, source) => sum + source.estimatedTokens, 0) ||
    value.totals.tokens > value.budget.maxTokens || value.totals.files > value.budget.maxFiles ||
    value.injectionFlags.some(flag => !value.sources.some(source => source.sourceId === flag.sourceId)))
    ctx.addIssue({ code: 'custom', message: 'Preview identity, freshness and budget must agree' })
})
export type ContextPreviewInput = z.infer<typeof ContextPreviewInputSchema>
export type ContextPreview = z.infer<typeof ContextPreviewSchema>
