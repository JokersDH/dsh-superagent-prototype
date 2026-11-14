/**
 * The draft contract (`project-recipe-draft/1`).
 *
 * A result is one of three shapes and nothing else:
 *  - `draft`        a complete, reviewable suggestion that references *existing* configured scope,
 *                   registered checks and an enabled profile;
 *  - `needs_input`  correctable: the caller must supply explicit input (paths, profile, a facts
 *                   refresh) before a suggestion exists;
 *  - `unsupported`  this product cannot serve the request class at all.
 *
 * Every result carries `authorization: 'none'`, the configuration revision and the facts digest it
 * was derived from, and a content-addressed `revision`. There is deliberately no field for a
 * command, executable, argv, install step, approval token or execution state: a draft is data that
 * still has to pass the existing proposal/work confirmation before anything happens.
 */
import { z } from 'zod'
import { DigestSchema, IdSchema, RequiredCriteriaSchema, ScopeSchema, TimestampSchema } from '@personal-agent/contracts'
import type { Json } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { RECIPE_CATALOG_ID, RECIPE_KINDS } from './catalog.ts'
import { PROJECT_FACTS_PROTOCOL } from './facts.ts'

export const RECIPE_DRAFT_PROTOCOL = 'project-recipe-draft/1' as const

/** Closed issue vocabulary so a caller never has to parse free text to route a result. */
export const RECIPE_ISSUE_CODES = [
  'configuration_invalid',
  'configuration_unsupported_version',
  'catalog_unsupported_version',
  'kind_unknown',
  'project_unknown',
  'facts_project_mismatch',
  'facts_stale',
  'stack_unknown',
  'stack_not_node',
  'manager_unsupported',
  'manager_unknown',
  'locks_ambiguous',
  'workspace_unknown',
  'workspace_member_required',
  'project_discussion_only',
  'project_dispatch_blocked',
  'execution_unavailable',
  'profile_required',
  'profile_not_enabled',
  'criteria_machine_required',
  'criteria_check_unregistered',
  'criteria_selection_unknown',
  'scope_paths_required',
  'scope_path_outside_allowed',
] as const
export type RecipeIssueCode = (typeof RECIPE_ISSUE_CODES)[number]

export const RECIPE_ISSUE_FIELDS = [
  'catalog', 'configuration', 'kind', 'facts', 'workspace', 'manager', 'lockfile', 'stack', 'project', 'execution', 'profile', 'criteria', 'scope',
] as const
export type RecipeIssueField = (typeof RECIPE_ISSUE_FIELDS)[number]

export const RecipeIssueSchema = z.strictObject({
  code: z.enum(RECIPE_ISSUE_CODES),
  field: z.enum(RECIPE_ISSUE_FIELDS),
  /** Bounded, path-free explanation. Never contains file contents, argv, credentials or stacks. */
  message: z.string().trim().min(1).max(400),
})
export type RecipeIssue = z.infer<typeof RecipeIssueSchema>

export const RecipeProvenanceSchema = z.strictObject({
  catalog: z.strictObject({
    id: z.literal(RECIPE_CATALOG_ID),
    version: z.number().int().positive().safe(),
    digest: DigestSchema,
  }),
  configuration: z.strictObject({
    /** The protocol string that was actually observed, e.g. `application-configuration/1`. */
    protocol: z.string().trim().min(1).max(64),
    /** `null` when the configuration could not be parsed; never a fabricated digest. */
    revision: DigestSchema.nullable(),
    projectId: IdSchema,
  }),
  facts: z.strictObject({
    protocol: z.literal(PROJECT_FACTS_PROTOCOL),
    digest: DigestSchema,
    observedAt: TimestampSchema,
    provider: z.string().trim().min(1).max(160),
    source: z.enum(['injected', 'authorized_metadata']),
  }),
  /** The explicit preferences that shaped this result, plus their digest. */
  selection: z.strictObject({
    digest: DigestSchema,
    profileId: IdSchema.optional(),
    paths: z.array(z.string()).max(256).readonly().optional(),
    excludedPaths: z.array(z.string()).max(256).readonly().optional(),
    criteriaIds: z.array(IdSchema).max(128).readonly().optional(),
  }),
  /** Digest over (facts digest, configuration revision, kind, selection). */
  input: DigestSchema,
})
export type RecipeProvenance = z.infer<typeof RecipeProvenanceSchema>

const recipeIdentity = z.strictObject({
  id: z.enum(RECIPE_KINDS),
  version: z.number().int().positive().safe(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(400),
})

const base = z.strictObject({
  protocol: z.literal(RECIPE_DRAFT_PROTOCOL),
  projectId: IdSchema,
  recipe: recipeIdentity,
  provenance: RecipeProvenanceSchema,
  /** Data only. Never an approval, grant or capability. */
  authorization: z.literal('none'),
  /** Human-readable remarks that are part of the result (e.g. "manager was not declared"). */
  notes: z.array(z.string().trim().min(1).max(400)).max(32).readonly(),
})

const draftShape = base.extend({
  status: z.literal('draft'),
  goal: z.string().trim().min(1).max(16384),
  /** The existing `Scope` shape: project-relative paths only, never wider than the configured project scope. */
  scope: ScopeSchema,
  /** The existing `RequiredCriteria` shape: references only criteria already configured and registered. */
  criteria: RequiredCriteriaSchema,
  profileId: IdSchema,
  revision: DigestSchema,
})

const needsInputShape = base.extend({
  status: z.literal('needs_input'),
  needsInput: z.array(RecipeIssueSchema).min(1).max(32).readonly(),
  revision: DigestSchema,
})

const unsupportedShape = base.extend({
  status: z.literal('unsupported'),
  unsupported: z.array(RecipeIssueSchema).min(1).max(32).readonly(),
  revision: DigestSchema,
})

export const ProjectRecipeDraftSchema = z.discriminatedUnion('status', [draftShape, needsInputShape, unsupportedShape])
export type ProjectRecipeDraft = z.infer<typeof ProjectRecipeDraftSchema>
export type ProjectRecipeDraftResult = ProjectRecipeDraft

/** The exact bytes a draft revision commits to: the result without its own `revision` field. */
const withoutRevision = (value: object): Json => {
  const { revision: _revision, ...body } = value as Record<string, unknown>
  return body as unknown as Json
}

export const draftRevision = (value: object): string => canonicalDigest(withoutRevision(value))

export class RecipeDraftError extends Error {
  readonly code: 'invalid_draft' | 'revision_mismatch'
  constructor(code: 'invalid_draft' | 'revision_mismatch', message: string) {
    super(message)
    this.name = 'RecipeDraftError'
    this.code = code
  }
}

/**
 * Strict parse plus revision verification. A caller that only type-guards the object has not verified
 * that the draft was not edited after it was produced; this function is the check to run before
 * feeding a draft into the existing preview/confirmation path.
 */
export function parseProjectRecipeDraft(value: unknown): ProjectRecipeDraft {
  const parsed = ProjectRecipeDraftSchema.safeParse(value)
  if (!parsed.success) throw new RecipeDraftError('invalid_draft', `Not a project recipe draft: ${parsed.error.issues[0]?.message ?? 'invalid shape'}`)
  const draft = parsed.data
  if (draftRevision(draft) !== draft.revision) throw new RecipeDraftError('revision_mismatch', `Draft revision does not match its content: ${draft.projectId}`)
  return draft
}

/** True only for a `draft` result: the shape the existing confirmation flow can preview. */
export const isActionableDraft = (value: ProjectRecipeDraft): value is Extract<ProjectRecipeDraft, { status: 'draft' }> => value.status === 'draft'
