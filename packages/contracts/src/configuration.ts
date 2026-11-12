import { z } from 'zod'
import { AppErrorCodeSchema, DigestSchema, IdSchema, RequiredCriteriaSchema, ScopeSchema } from './schemas.ts'

export const CONFIGURATION_PROTOCOL = 'application-configuration/1' as const
const label = z.string().trim().min(1).max(160)
const ids = z.array(IdSchema).max(128).readonly()
const unique = (values: readonly { id: string }[]) => new Set(values.map((value) => value.id)).size === values.length

/** Public read projection only; launch paths, argv, private config and credential references are excluded. */
export const ExecutionProfileViewSchema = z
  .strictObject({
    id: IdSchema,
    revision: z.number().int().positive().safe(),
    displayName: label,
    driverId: IdSchema,
    kind: z.enum(['controlled_fixture', 'native']),
    readiness: z.enum([
      'fixture_ready',
      'not_tested',
      'missing',
      'needs_setup',
      'needs_auth',
      'incompatible',
      'inspection_passed',
      'native_test_passed',
    ]),
    dispatchAllowed: z.boolean(),
    blockedReason: AppErrorCodeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.kind === 'controlled_fixture') !== (value.readiness === 'fixture_ready'))
      ctx.addIssue({ code: 'custom', message: 'Fixture readiness belongs only to a controlled fixture' })
    if (value.dispatchAllowed && value.kind === 'native' && value.readiness !== 'native_test_passed')
      ctx.addIssue({
        code: 'custom',
        message: 'Native dispatch requires tested compatibility and trusted runtime admission',
      })
    if (value.dispatchAllowed === (value.blockedReason !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Only a blocked profile needs a reason' })
  })

export const RegisteredCheckViewSchema = z.strictObject({
  id: IdSchema,
  revision: z.number().int().positive().safe(),
  displayName: label,
})
export const ConfiguredProjectViewSchema = z
  .strictObject({
    id: IdSchema,
    displayName: label,
    scope: ScopeSchema,
    profileIds: ids,
    defaultProfileId: IdSchema.optional(),
    defaultCriteria: RequiredCriteriaSchema,
    settingsAvailable: z.boolean().optional(),
    dispatchAllowed: z.boolean(),
    blockedReason: AppErrorCodeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope.projectId !== value.id || new Set(value.profileIds).size !== value.profileIds.length)
      ctx.addIssue({ code: 'custom', message: 'Project scope and unique profile identities must agree' })
    if (value.defaultProfileId && !value.profileIds.includes(value.defaultProfileId))
      ctx.addIssue({ code: 'custom', message: 'The project default must be one of its enabled profiles' })
    if (value.dispatchAllowed && (!value.defaultProfileId || !value.profileIds.length))
      ctx.addIssue({ code: 'custom', message: 'An enabled project requires an enabled default profile' })
    if (value.dispatchAllowed === (value.blockedReason !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Only a blocked project needs a reason' })
  })

export const ApplicationConfigurationSchema = z
  .strictObject({
    protocol: z.literal(CONFIGURATION_PROTOCOL),
    revision: DigestSchema,
    reviewActivityAvailable: z.boolean().optional(),
    decisionsAvailable: z.boolean().optional(),
    proposalsAvailable: z.boolean().optional(),
    contextPreviewAvailable: z.boolean().optional(),
    assistantContextAvailable: z.boolean().optional(),
    contextHistoryAvailable: z.boolean().optional(),
    contextSourcesAvailable: z.boolean().optional(),
    projects: z.array(ConfiguredProjectViewSchema).max(128).readonly(),
    profiles: z.array(ExecutionProfileViewSchema).max(128).readonly(),
    checks: z.array(RegisteredCheckViewSchema).max(128).readonly(),
  })
  .superRefine((value, ctx) => {
    for (const entries of [value.projects, value.profiles, value.checks])
      if (!unique(entries))
        ctx.addIssue({ code: 'custom', message: 'Configuration IDs must be unique within each collection' })
    const enabled = new Set(value.profiles.filter((profile) => profile.dispatchAllowed).map((profile) => profile.id))
    const checks = new Set(value.checks.map((check) => check.id))
    for (const project of value.projects) {
      if (project.profileIds.some((id) => !enabled.has(id)))
        ctx.addIssue({ code: 'custom', message: 'Projects may select only dispatchable profiles' })
      if (!project.defaultCriteria.some((criterion) => criterion.kind === 'machine' && criterion.required))
        ctx.addIssue({ code: 'custom', message: 'Project defaults need a required registered machine check' })
      if (
        project.defaultCriteria.some(
          (criterion) =>
            criterion.kind === 'machine' &&
            criterion.checkDefinitionRef !== undefined &&
            !checks.has(criterion.checkDefinitionRef),
        )
      )
        ctx.addIssue({ code: 'custom', message: 'Every named default check must be registered' })
    }
  })
  .meta({
    'x-runtime-rules': ['unique-configuration-ids', 'enabled-project-profile-references', 'registered-default-checks'],
  })

export type ExecutionProfileView = z.infer<typeof ExecutionProfileViewSchema>
export type RegisteredCheckView = z.infer<typeof RegisteredCheckViewSchema>
export type ConfiguredProjectView = z.infer<typeof ConfiguredProjectViewSchema>
export type ApplicationConfiguration = z.infer<typeof ApplicationConfigurationSchema>
