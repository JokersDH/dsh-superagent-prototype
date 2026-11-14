import { z } from 'zod'
import { DigestSchema, TimestampSchema } from './schemas.ts'
import { ExecutionAvailabilitySchema } from './configuration.ts'

const count = z.number().int().min(0).max(128)
/** Configuration observations only; never a probe, execution grant or release verdict. */
export const TrialReadinessSchema = z.strictObject({
  protocol: z.literal('trial-readiness/1'), observedAt: TimestampSchema, configurationRevision: DigestSchema,
  mode: z.enum(['fixture', 'product', 'personal']), startupMode: z.enum(['normal', 'recovery_readonly']),
  discussion: z.enum(['configuration_present', 'not_configured', 'provider_error', 'unknown']),
  execution: z.union([ExecutionAvailabilitySchema, z.strictObject({ state: z.literal('unknown') })]),
  development: z.enum(['configuration_present', 'needs_project', 'blocked', 'fixture_only', 'readonly', 'unknown']),
  projects: z.strictObject({ development: count, discussion: count, dispatchable: count }),
  profiles: z.strictObject({ native: count, controlled: count, admittedNative: count, admittedControlled: count }),
  capabilities: z.strictObject({ contextHistory: z.boolean(), contextSources: z.boolean(), decisions: z.boolean(), proposals: z.boolean() }),
  authorization: z.literal('none'),
}).superRefine((value, ctx) => {
  const invalid = value.profiles.admittedNative > value.profiles.native || value.profiles.admittedControlled > value.profiles.controlled ||
    value.projects.development + value.projects.discussion > 128 || value.projects.dispatchable > value.projects.development ||
    (value.startupMode === 'recovery_readonly' && (value.development !== 'readonly' || value.execution.state !== 'unavailable' ||
      value.execution.reason !== 'recovery_readonly' || value.projects.dispatchable !== 0 || value.profiles.admittedNative !== 0 ||
      value.profiles.admittedControlled !== 0 || value.capabilities.decisions || value.capabilities.proposals)) ||
    (value.development === 'configuration_present' && (value.mode === 'fixture' || value.startupMode !== 'normal' ||
      value.execution.state !== 'available' || value.execution.kind !== 'native' || !value.profiles.admittedNative || !value.projects.dispatchable))
  if (invalid) ctx.addIssue({ code: 'custom', message: 'Readiness must preserve configuration scope, counts and readonly limits' })
})
export type TrialReadiness = z.infer<typeof TrialReadinessSchema>
/** UI navigation callbacks only; these names are never accepted as execution commands. */
export type TrialNavigationAction = 'configure_model' | 'import_project' | 'inspect_executor' | 'open_conversation'
