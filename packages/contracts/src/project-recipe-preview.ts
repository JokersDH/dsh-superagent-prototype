import { z } from 'zod'
import { DigestSchema, IdSchema, RequiredCriteriaSchema, ScopeSchema, TimestampSchema } from './schemas.ts'

export const ProjectRecipeKindSchema = z.enum(['regression_fix', 'scoped_change', 'verification_followup'])
export const ProjectRecipePreviewInputSchema = z.strictObject({
  projectId: IdSchema, kind: ProjectRecipeKindSchema,
  allowedPaths: z.array(z.string().min(1).max(1024)).min(1).max(256).readonly(), profileId: IdSchema,
}).refine(value => new Set(value.allowedPaths).size === value.allowedPaths.length, 'Scope atoms must be unique')
export type ProjectRecipePreviewInput = z.infer<typeof ProjectRecipePreviewInputSchema>
export const ProjectRecipeFieldsSchema = z.strictObject({
  projectId: IdSchema, goal: z.string().trim().min(1).max(16384), scope: ScopeSchema,
  criteria: RequiredCriteriaSchema, profileId: IdSchema,
}).refine(value => value.projectId === value.scope.projectId, 'Draft scope belongs to the selected project')
export type ProjectRecipeFields = z.infer<typeof ProjectRecipeFieldsSchema>
/** A read-only prefill observation; its digest is not a command token or permission. */
export const ProjectRecipePreviewSchema = z.strictObject({
  protocol: z.literal('project-recipe-preview/1'), input: ProjectRecipePreviewInputSchema,
  configurationRevision: DigestSchema, factsDigest: DigestSchema.nullable(), catalogDigest: DigestSchema.nullable(),
  observedAt: TimestampSchema, status: z.enum(['draft', 'needs_input', 'unsupported', 'unavailable']),
  title: z.string().min(1).max(160), fields: ProjectRecipeFieldsSchema.nullable(),
  issues: z.array(z.strictObject({ code: z.string().min(1).max(64), message: z.string().min(1).max(400) })).max(32).readonly(),
  authorization: z.literal('none'),
}).superRefine((value, ctx) => {
  if ((value.status === 'draft') !== (value.fields !== null) ||
    (value.status === 'draft' && (!value.factsDigest || !value.catalogDigest || value.issues.length)) ||
    (value.status !== 'draft' && !value.issues.length) ||
    (value.fields && (value.fields.projectId !== value.input.projectId || value.fields.profileId !== value.input.profileId ||
      value.fields.scope.allowedPaths.length !== value.input.allowedPaths.length ||
      value.fields.scope.allowedPaths.some(atom => !value.input.allowedPaths.includes(atom)))))
    ctx.addIssue({ code: 'custom', message: 'Preview fields must match the original selected project, profile and scope atoms' })
})
export type ProjectRecipePreview = z.infer<typeof ProjectRecipePreviewSchema>
