import { z } from 'zod'
import { DigestSchema, TimestampSchema } from './schemas.ts'
import { UsageObservationSchema } from './usage-observation.ts'

const count = z.number().int().min(0).max(1_000_000).safe()
const capabilities = z.enum(['pageObservation', 'numericExport', 'displayDownload'])
const row = z.strictObject({ rowId: z.string().min(1).max(160), layer: z.enum(['observed', 'controlled', 'native', 'operator', 'unknown']),
  unit: z.string().max(16), hasValue: z.boolean(), sampleCount: count.nullable() })
const origin = z.strictObject({ kind: z.enum(['package', 'runtime', 'unknown']),
  identitySource: z.enum(['install-manifest', 'incomplete-manifest', 'archive-only']).nullable(),
  buildId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).nullable(), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  archiveSha256: DigestSchema.nullable(),
  capabilities: z.strictObject({ pageObservation: z.boolean(), numericExport: z.boolean(), displayDownload: z.boolean() }).nullable(),
  browserTrigger: z.enum(['present', 'absent', 'unverifiable']).nullable(), missing: z.array(capabilities).max(3) })

/** Metadata from a fresh authorized observation. It contains no metric value, label or detail. */
export const UsageSupportReportSchema = z.strictObject({
  protocol: z.literal('usage-insights-support-summary/1'), observationProtocol: z.literal('usage-observation/1'),
  documentKind: z.literal('observation'), status: UsageObservationSchema.shape.status,
  summaryId: DigestSchema.nullable(), observedAt: TimestampSchema, days: UsageObservationSchema.shape.days,
  timezone: z.string().min(1).max(64), window: UsageObservationSchema.shape.window, scope: UsageObservationSchema.shape.scope,
  coverage: z.enum(['完整覆盖', '部分覆盖', '未声明']), coverageState: UsageObservationSchema.shape.coverageState,
  counts: z.strictObject({ rows: count, withValue: count, unknown: count, sampleCount: count.nullable() }),
  rows: z.array(row).max(32),
  limitations: z.array(z.enum(['部分指标没有可核对值。', '当前观察不完整。', '当前范围未提供观察。'])).max(3),
  numericValues: z.literal(false),
  note: z.literal('Display document: the served values are formatted strings. This summary carries metadata only; it is not a numeric analysis result.'),
  authorization: z.literal('none'), origin: origin.nullable(),
  evidence: z.strictObject({ coverageState: UsageObservationSchema.shape.coverageState, rowsWithValue: count,
    rowsWithoutValue: count, sampleCount: count.nullable(), partial: z.boolean(),
    absentFacts: z.array(z.string().regex(/^(?:\d+ row\(s\) have no observed value|the observation is partial|coverage is unknown|the observation is unavailable|the header sample count is not established)$/)).max(5) }),
  exportCapability: z.enum(['present', 'absent', 'unverified']),
}).superRefine((value, ctx) => {
  const withValue = value.rows.filter(row => row.hasValue).length
  if (value.counts.rows !== value.rows.length || value.counts.withValue !== withValue ||
    value.counts.unknown !== value.rows.length - withValue || new Set(value.rows.map(row => row.rowId)).size !== value.rows.length ||
    value.evidence.rowsWithValue !== withValue || value.evidence.rowsWithoutValue !== value.counts.unknown ||
    value.evidence.sampleCount !== value.counts.sampleCount || value.evidence.coverageState !== value.coverageState ||
    value.evidence.partial !== (value.coverageState !== 'complete' || value.status !== 'ready') ||
    value.window.to !== value.observedAt || Date.parse(value.window.to) - Date.parse(value.window.from) !== value.days * 86400000 ||
    new Set(value.scope.projectIds).size !== value.scope.projectIds.length ||
    (value.scope.aggregation === 'single_project' && value.scope.projectIds.length !== 1) ||
    value.scope.label !== (value.scope.projectIds.length === 1 ? '当前项目' : `本次 ${value.scope.projectIds.length} 个项目`) ||
    (value.status === 'ready' && (!value.summaryId || !value.rows.length || !value.scope.projectIds.length)) ||
    (value.status === 'unavailable' && (value.summaryId !== null || value.rows.length > 0 || value.counts.sampleCount !== null)) ||
    value.coverage !== ({ complete: '完整覆盖', partial: '部分覆盖', unknown: '未声明' } as const)[value.coverageState] ||
    (value.origin === null && value.exportCapability !== 'unverified'))
    ctx.addIssue({ code: 'custom', message: 'Support metadata must preserve its source scope, window and counts' })
})
export type UsageSupportReport = z.infer<typeof UsageSupportReportSchema>

export const UsageSupportDownloadSchema = z.strictObject({
  protocol: z.literal('usage-support-download/1'), report: UsageSupportReportSchema,
  fileName: z.string().regex(/^support-(7|30)d-([a-f0-9]{12}|no-snapshot)-[A-Za-z0-9._-]{1,64}\.json$/),
  mediaType: z.literal('application/json'), text: z.string().min(1).max(65536), bytes: z.number().int().min(1).max(65536), sha256: DigestSchema,
}).superRefine((value, ctx) => {
  let input: unknown
  try { input = JSON.parse(value.text) } catch { ctx.addIssue({ code: 'custom', message: 'Support file must be JSON' }); return }
  const parsed = z.strictObject({ protocol: z.literal('usage-insights-support/1'), report: UsageSupportReportSchema }).safeParse(input)
  const expectedName = `support-${value.report.days}d-${value.report.summaryId?.slice(0, 12) ?? 'no-snapshot'}-${value.report.origin?.buildId ?? 'unknown-build'}.json`
  if (!parsed.success || JSON.stringify(parsed.data.report) !== JSON.stringify(value.report) ||
    new TextEncoder().encode(value.text).byteLength !== value.bytes || value.fileName !== expectedName)
    ctx.addIssue({ code: 'custom', message: 'Support file must preserve the exact metadata report, name and byte count' })
})
export type UsageSupportDownload = z.infer<typeof UsageSupportDownloadSchema>
