import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'
import { ProjectEnvironmentInputSchema, ProjectRegistrationInputSchema } from './projects.ts'

export const ProjectSettingsVersionSchema = z.strictObject({
  projectId: IdSchema,
  revision: z.number().int().positive().max(100),
  digest: DigestSchema,
  displayName: z.string().trim().min(1).max(160),
  check: ProjectRegistrationInputSchema.shape.check,
  environment: ProjectEnvironmentInputSchema,
  checkDefinitionRef: IdSchema,
  createdAt: TimestampSchema,
})
export const ProjectSettingsPageSchema = z.strictObject({
  protocol: z.literal('project-settings/1'),
  current: ProjectSettingsVersionSchema.extend({ archiveRevision: z.number().int().nonnegative().safe(), archived: z.boolean() }),
  history: z.array(ProjectSettingsVersionSchema).min(1).max(100).readonly(),
}).superRefine((value, ctx) => {
  if (value.history.some(item => item.projectId !== value.current.projectId) ||
    value.history[0]?.revision !== value.current.revision)
    ctx.addIssue({ code: 'custom', message: 'Settings history must begin with the current project revision' })
})
const base = z.strictObject({ commandId: IdSchema, projectId: IdSchema })
export const ProjectSettingsCommandSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.literal('update_project_settings'), expectedRevision: z.number().int().positive().max(99),
    displayName: z.string().trim().min(1).max(160), check: ProjectRegistrationInputSchema.shape.check, environment: ProjectEnvironmentInputSchema }),
  base.extend({ kind: z.literal('archive_project'), expectedArchiveRevision: z.number().int().nonnegative().safe(), archived: z.boolean() }),
])
export type ProjectSettingsVersion = z.infer<typeof ProjectSettingsVersionSchema>
export type ProjectSettingsPage = z.infer<typeof ProjectSettingsPageSchema>
export type ProjectSettingsCommand = z.infer<typeof ProjectSettingsCommandSchema>
