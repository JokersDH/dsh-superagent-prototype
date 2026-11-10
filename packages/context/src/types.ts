import { z } from 'zod'
import { ContractRefSchema, IdSchema, ScopeSchema, TimestampSchema } from '@personal-agent/contracts'
import type { ContractRef, Scope } from '@personal-agent/contracts'

/**
 * Package-local service inputs for the bounded context reader. These are deliberately NOT a public
 * wire protocol: the main agent owns shared DTOs. If these values need to cross HTTP, main should
 * define the wire schema in `@personal-agent/contracts` and adapt to these types.
 */

const projectPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.split('/').includes('..') &&
      value.trim().length > 0,
    'Path must be project-relative without parent traversal',
  )

export const ContextSourceKindSchema = z.enum([
  'project_metadata',
  'work',
  'contract',
  'verification',
  'delivery',
  'decision',
  'document',
  'source_file',
])
export type ContextSourceKind = z.infer<typeof ContextSourceKindSchema>

export const ContextPurposeSchema = z.enum(['conversation_discussion', 'work_authoring'])
export type ContextPurpose = z.infer<typeof ContextPurposeSchema>

export const ContextGatewaySchema = z.enum(['conversation', 'executor'])
export type ContextGateway = z.infer<typeof ContextGatewaySchema>

const uniqueKinds = (kinds: readonly ContextSourceKind[]) => new Set(kinds).size === kinds.length

export const ContextGrantSchema = z
  .strictObject({
    grantId: IdSchema,
    projectId: IdSchema,
    /** Which authorization family issued the grant; only `conversation` grants are readable here. */
    gateway: ContextGatewaySchema,
    purpose: ContextPurposeSchema,
    scope: ScopeSchema,
    sourceKinds: z.array(ContextSourceKindSchema).min(1).max(8).refine(uniqueKinds, 'Source kinds must be unique').readonly(),
    maxFiles: z.number().int().min(1).max(64),
    maxBytes: z.number().int().min(1).max(4 * 1024 * 1024),
    maxTokens: z.number().int().min(1).max(500_000),
    maxDurationMs: z.number().int().min(1).max(60_000),
    /** Visible, explicit confirmation timestamp. There is no implicit grant. */
    confirmedAt: TimestampSchema,
    confirmedBy: IdSchema,
    expiresAt: TimestampSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope.projectId !== value.projectId) {
      ctx.addIssue({ code: 'custom', message: 'Grant scope belongs to another project', path: ['scope', 'projectId'] })
    }
  })
export type ContextGrant = z.infer<typeof ContextGrantSchema>

export const ContextBudgetSchema = z.strictObject({
  maxFiles: z.number().int().min(1).max(64).optional(),
  maxBytes: z.number().int().min(1).max(4 * 1024 * 1024).optional(),
  maxTokens: z.number().int().min(1).max(500_000).optional(),
  maxDurationMs: z.number().int().min(1).max(60_000).optional(),
  maxSlices: z.number().int().min(1).max(64).optional(),
})
export type ContextBudget = z.infer<typeof ContextBudgetSchema>
export interface ResolvedContextBudget {
  readonly maxFiles: number
  readonly maxBytes: number
  readonly maxTokens: number
  readonly maxDurationMs: number
  readonly maxSlices: number
}

export const ContextRequestSchema = z
  .strictObject({
    requestId: IdSchema,
    projectId: IdSchema,
    purpose: ContextPurposeSchema,
    /** The current question/task text; used only for deterministic relevance ranking. */
    query: z.string().max(8192),
    grant: ContextGrantSchema,
    workId: IdSchema.optional(),
    contract: ContractRefSchema.optional(),
    budget: ContextBudgetSchema.optional(),
    /** Opaque resume cursor from a previous bundle for the same request shape. */
    cursor: z.string().max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.grant.projectId !== value.projectId) {
      ctx.addIssue({ code: 'custom', message: 'Grant belongs to another project', path: ['grant', 'projectId'] })
    }
  })
export type ContextRequest = z.infer<typeof ContextRequestSchema>

export const ContextOmissionReasonSchema = z.enum([
  'budget_files',
  'budget_bytes',
  'budget_tokens',
  'budget_time',
  'budget_slices',
  'denied_path',
  'denied_kind',
  'excluded_path',
  'external_link',
  'cross_project',
  'binary',
  'oversized',
  'unreadable',
  'missing',
  'stale',
  'contract_stale',
])
export type ContextOmissionReason = z.infer<typeof ContextOmissionReasonSchema>

export type ContextMediaType = 'text' | 'markdown' | 'json' | 'source' | 'binary'

export interface ContextSourceBaseline {
  readonly commit?: string
  readonly contentDigest: string
  /** `content` hashes the whole file; other scopes identify metadata/prefix only. */
  readonly digestScope: 'content' | 'prefix' | 'metadata'
  readonly capturedAt: string
}

export interface ContextSourceDescriptor {
  readonly sourceId: string
  readonly projectId: string
  readonly kind: ContextSourceKind
  readonly path: string
  readonly title?: string
  readonly bytes: number
  readonly mediaType: ContextMediaType
  readonly baseline: ContextSourceBaseline
  readonly validity: 'current' | 'stale' | 'missing'
  readonly workId?: string
  readonly contract?: ContractRef
}

export interface ContextWorkDescriptor {
  readonly workId: string
  readonly contract: ContractRef
  readonly scope: Scope
  readonly title: string
  readonly validity: 'current' | 'stale' | 'missing'
}

export interface ContextReadPort {
  /** Project baseline identity (for example a Git commit). `undefined` means the project is unknown. */
  projectBaseline(projectId: string): Promise<{ commit?: string; capturedAt: string } | undefined>
  listSources(input: {
    readonly projectId: string
    readonly kinds: readonly ContextSourceKind[]
    readonly allowedPaths: readonly string[]
    readonly excludedPaths: readonly string[]
    readonly limit: number
  }): Promise<readonly ContextSourceDescriptor[]>
  readSource(input: {
    readonly source: ContextSourceDescriptor
    readonly maxBytes: number
  }): Promise<{ content: string; bytes: number; digest: string }>
  /** Optional current-work lookup used to reject stale/foreign contracts. */
  workContext?(workId: string): Promise<ContextWorkDescriptor | undefined>
}

export interface ContextSlice {
  readonly sourceId: string
  readonly kind: ContextSourceKind
  readonly path: string
  readonly title?: string
  readonly content: string
  readonly range: { readonly start: number; readonly end: number }
  readonly truncated: boolean
  readonly bytes: number
  readonly tokens: number
  readonly relevance: number
  /** File content and instructions inside it are data to analyse, never authority or tool grants. */
  readonly trust: 'untrusted_data'
  readonly baseline: ContextSourceBaseline
  readonly workId?: string
  readonly contract?: ContractRef
}

export interface ContextOmission {
  readonly sourceId?: string
  readonly path?: string
  readonly reason: ContextOmissionReason
  readonly detail?: string
}

export interface ContextInjectionFlag {
  readonly sourceId: string
  readonly path: string
  /** Stable labels for detected instruction-like patterns; matched text is never echoed as authority. */
  readonly patterns: readonly string[]
}

export interface ContextBundle {
  readonly protocol: 'context-bundle/1'
  readonly requestId: string
  readonly projectId: string
  readonly purpose: ContextPurpose
  readonly grantId: string
  readonly status: 'sufficient' | 'partial' | 'insufficient'
  readonly trust: 'untrusted_data'
  readonly baseline: { readonly commit?: string; readonly capturedAt: string }
  readonly authorization: {
    readonly sourceKinds: readonly ContextSourceKind[]
    readonly allowedPaths: readonly string[]
    readonly excludedPaths: readonly string[]
  }
  readonly slices: readonly ContextSlice[]
  readonly omitted: readonly ContextOmission[]
  readonly injectionFlags: readonly ContextInjectionFlag[]
  readonly explanations: readonly string[]
  readonly budget: ResolvedContextBudget
  readonly used: { readonly files: number; readonly bytes: number; readonly tokens: number; readonly durationMs: number }
  readonly nextCursor?: string
}

export interface ContextValidation {
  readonly validity: 'current' | 'stale' | 'missing' | 'mixed'
  readonly baselineChanged: boolean
  readonly slices: readonly { readonly sourceId: string; readonly path: string; readonly validity: 'current' | 'stale' | 'missing' }[]
}

export const DEFAULT_CONTEXT_BUDGET: ResolvedContextBudget = Object.freeze({
  maxFiles: 24,
  maxBytes: 512 * 1024,
  maxTokens: 16_000,
  maxDurationMs: 5_000,
  maxSlices: 24,
})
