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

/** A fresh authorized read exported as display data; it never supplies numeric-analysis authority. */
export const UsageObservationDownloadSchema = z.strictObject({
  protocol: z.literal('usage-observation-download/1'), observation: UsageObservationSchema,
  fileName: z.string().regex(/^observation-(7|30)d-[a-f0-9]{12}\.json$/),
  mediaType: z.literal('application/json'), text: z.string().min(1).max(65536), sha256: DigestSchema,
}).superRefine((value, ctx) => {
  let raw: unknown
  try { raw = JSON.parse(value.text) } catch { ctx.addIssue({ code: 'custom', message: 'Export must be JSON' }); return }
  const parsed = z.strictObject({
    protocol: z.literal('usage-insights-display-export/1'), authorization: z.literal('none'),
    sourceIdentity: z.strictObject({ kind: z.literal('display_dto'), numericValues: z.literal(false), note: z.string().min(1).max(512) }),
    snapshot: z.strictObject({ snapshotId: DigestSchema.nullable(), capturedAt: TimestampSchema,
      continuity: z.literal('first_observation'), previous: z.null(), note: z.null() }),
    exportedFrom: z.strictObject({ observationProtocol: z.literal('usage-observation/1'), observedAt: TimestampSchema,
      days: z.union([z.literal(7), z.literal(30)]), timezone: z.string().min(1).max(64),
      reader: z.literal('the coordinator document served by GET /v1/insights') }),
    scope: UsageObservationSchema.shape.scope, window: UsageObservationSchema.shape.window,
    header: z.strictObject({ status: UsageObservationSchema.shape.status, windowLabel: UsageObservationSchema.shape.windowLabel,
      coverage: UsageObservationSchema.shape.coverage, coverageState: UsageObservationSchema.shape.coverageState,
      sampleCount: count.nullable(), unknownCount: count.nullable() }),
    rows: z.array(z.strictObject({ rowId: z.string().min(1).max(160), label: z.string().min(1).max(128),
      layer: z.enum(['observed', 'controlled', 'native', 'operator', 'unknown']), unit: z.string().max(16),
      formatted: z.string().min(1).max(128).nullable(), sampleCount: count.nullable(), detail: z.string().min(1).max(512) })).max(32),
    truncation: z.strictObject({ byRows: z.literal(false), byBytes: z.boolean(), totalRows: count, includedRows: count,
      maxRows: z.literal(32), maxBytes: z.literal(65536), bytes: count }),
    crossCheck: z.strictObject({ numericValuesAvailable: z.literal(false), reason: z.string().min(1).max(512) }),
    limitations: z.array(z.string().min(1).max(512)).max(32),
  }).safeParse(raw)
  if (!parsed.success) { ctx.addIssue({ code: 'custom', message: 'Export has an invalid display document' }); return }
  const document = parsed.data
  const dto = value.observation
  const bytes = new TextEncoder().encode(value.text).byteLength
  let omittedRowFits = false
  const next = dto.metrics[document.rows.length]
  if (document.truncation.byBytes && next) {
    const candidate = { ...document, rows: [...document.rows, { rowId: next.id, label: next.label, layer: next.layer,
      unit: next.unit, formatted: next.value, sampleCount: next.sampleCount, detail: next.detail }],
      truncation: { ...document.truncation, byBytes: false, includedRows: document.rows.length + 1, bytes: 0 } }
    for (let attempt = 0; attempt < 5; attempt++) {
      const size = new TextEncoder().encode(`${JSON.stringify(candidate, null, 2)}\n`).byteLength
      if (size === candidate.truncation.bytes) break
      candidate.truncation.bytes = size
    }
    omittedRowFits = candidate.truncation.bytes <= 65536
  }
  if (bytes > 65536 || dto.status === 'unavailable' || dto.summaryId === null ||
    value.fileName !== `observation-${dto.days}d-${dto.summaryId.slice(0, 12)}.json` ||
    document.snapshot.snapshotId !== dto.summaryId || document.snapshot.capturedAt !== dto.observedAt ||
    document.exportedFrom.observedAt !== dto.observedAt || document.exportedFrom.days !== dto.days || document.exportedFrom.timezone !== dto.timezone ||
    JSON.stringify(document.scope) !== JSON.stringify(dto.scope) || JSON.stringify(document.window) !== JSON.stringify(dto.window) ||
    JSON.stringify(document.header) !== JSON.stringify({ status: dto.status, windowLabel: dto.windowLabel, coverage: dto.coverage,
      coverageState: dto.coverageState, sampleCount: dto.sampleCount, unknownCount: dto.unknownCount }) ||
    document.truncation.bytes !== bytes || document.truncation.totalRows !== dto.metrics.length ||
    document.truncation.includedRows !== document.rows.length || document.rows.length > dto.metrics.length ||
    document.truncation.byBytes !== (document.rows.length < dto.metrics.length) || omittedRowFits ||
    document.rows.some((row, index) => {
      const metric = dto.metrics[index]
      return !metric || row.rowId !== metric.id || row.label !== metric.label || row.layer !== metric.layer || row.unit !== metric.unit ||
        row.formatted !== metric.value || row.sampleCount !== metric.sampleCount || row.detail !== metric.detail
    }))
    ctx.addIssue({ code: 'custom', message: 'Export must preserve its observed snapshot, scope and display values' })
})
export type UsageObservationDownload = z.infer<typeof UsageObservationDownloadSchema>
