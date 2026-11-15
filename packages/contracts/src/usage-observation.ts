import { z } from 'zod'
import { DigestSchema, IdSchema, TimestampSchema } from './schemas.ts'

export const UsageObservationQuerySchema = z.strictObject({
  projectId: IdSchema.optional(), days: z.union([z.literal(7), z.literal(30)]).optional(),
  timezone: z.string().min(1).max(64).optional(),
}).superRefine((value, ctx) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone ?? 'UTC' }) }
  catch { ctx.addIssue({ code: 'custom', message: 'Observation timezone must be an IANA timezone' }) }
})
export type UsageObservationQuery = z.infer<typeof UsageObservationQuerySchema>

const count = z.number().int().min(0).max(1000000).safe()
/** Sanitized display data only. No source payload, executable, principal or permission is returned. */
export const UsageObservationSchema = z.strictObject({
  protocol: z.literal('usage-observation/1'), observedAt: TimestampSchema,
  status: z.enum(['ready', 'insufficient_data', 'unavailable']),
  summaryId: DigestSchema.nullable(), days: z.union([z.literal(7), z.literal(30)]), timezone: z.string().min(1).max(64),
  window: z.strictObject({ from: TimestampSchema, to: TimestampSchema }),
  windowLabel: z.string().min(1).max(200), coverage: z.string().min(1).max(256),
  coverageState: z.enum(['complete', 'partial', 'unknown']),
  scope: z.strictObject({ projectIds: z.array(IdSchema).max(32).readonly(),
    aggregation: z.enum(['single_project', 'declared_multi_project', 'cross_project']), label: z.string().min(1).max(128) }),
  /** Header samples are enumerated works; each metric retains its own independent sample count. */
  sampleCount: count.nullable(), unknownCount: count.nullable(),
  metrics: z.array(z.strictObject({ id: z.string().min(1).max(160), label: z.string().min(1).max(128),
    value: z.string().min(1).max(128).nullable(), detail: z.string().min(1).max(512),
    unit: z.string().max(16), layer: z.enum(['observed', 'controlled', 'native', 'operator', 'unknown']), sampleCount: count.nullable(),
  })).max(32).readonly(),
  limitations: z.array(z.string().min(1).max(512)).max(16).readonly(), authorization: z.literal('none'),
}).superRefine((value, ctx) => {
  const invalid = Date.parse(value.window.to) <= Date.parse(value.window.from) || value.window.to !== value.observedAt ||
    Date.parse(value.window.to) - Date.parse(value.window.from) !== value.days * 86400000 ||
    new Set(value.scope.projectIds).size !== value.scope.projectIds.length ||
    new Set(value.metrics.map(row => row.id)).size !== value.metrics.length ||
    (value.scope.aggregation === 'single_project' && value.scope.projectIds.length !== 1) ||
    (value.status === 'ready' && (!value.scope.projectIds.length || !value.summaryId || !value.metrics.length)) ||
    (value.status === 'unavailable' && (value.metrics.length > 0 || value.sampleCount !== null))
  if (invalid) ctx.addIssue({ code: 'custom', message: 'Observation scope, window, state and rows must agree' })
})
export type UsageObservation = z.infer<typeof UsageObservationSchema>
