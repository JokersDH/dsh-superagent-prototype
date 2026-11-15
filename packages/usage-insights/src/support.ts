/**
 * Sanitized support summary of a served observation.
 *
 * A colleague asking for help needs the scope, window, coverage, counts and identity of what they
 * saw — not the values, not free text and not a path. This module reads the served
 * `usage-observation/1` document and returns metadata only: no formatted value, no label, no detail
 * string. It deliberately cannot be used to turn a display document into numbers.
 */
import { UsageObservationSchema, type UsageObservation } from '@personal-agent/contracts'

export const SUPPORT_SUMMARY_PROTOCOL = 'usage-insights-support-summary/1' as const

export interface SupportRow {
  readonly rowId: string
  readonly layer: 'observed' | 'controlled' | 'native' | 'operator' | 'unknown'
  readonly unit: string
  readonly hasValue: boolean
  readonly sampleCount: number | null
}

export interface SupportSummary {
  readonly protocol: typeof SUPPORT_SUMMARY_PROTOCOL
  readonly observationProtocol: 'usage-observation/1'
  readonly status: UsageObservation['status']
  readonly summaryId: string | null
  readonly observedAt: string
  readonly days: 7 | 30
  readonly timezone: string
  readonly window: { readonly from: string; readonly to: string }
  readonly scope: { readonly projectIds: readonly string[]; readonly aggregation: string; readonly label: string }
  readonly coverage: string
  readonly coverageState: 'complete' | 'partial' | 'unknown'
  readonly counts: { readonly rows: number; readonly withValue: number; readonly unknown: number; readonly sampleCount: number | null }
  readonly rows: readonly SupportRow[]
  readonly limitations: readonly string[]
  readonly numericValues: false
  readonly note: string
  readonly authorization: 'none'
}

export class SupportFault extends Error {
  readonly code: 'invalid_display_dto'
  constructor(message: string) {
    super(message)
    this.name = 'SupportFault'
    this.code = 'invalid_display_dto'
  }
}

/**
 * Describe a served document for a support ticket. Only identifiers, units, layer names, counts,
 * coverage and the served limitations are copied; values and free text are not.
 */
export function describeDisplayDocument(raw: unknown): SupportSummary {
  const parsed = UsageObservationSchema.safeParse(raw)
  if (!parsed.success) throw new SupportFault('The document is not a usage-observation/1 payload')
  const dto = parsed.data
  const rows: SupportRow[] = dto.metrics.map(metric => ({
    rowId: metric.id,
    layer: metric.layer,
    unit: metric.unit,
    hasValue: metric.value !== null,
    sampleCount: metric.sampleCount,
  }))
  return {
    protocol: SUPPORT_SUMMARY_PROTOCOL,
    observationProtocol: 'usage-observation/1',
    status: dto.status,
    summaryId: dto.summaryId,
    observedAt: dto.observedAt,
    days: dto.days,
    timezone: dto.timezone,
    window: { from: dto.window.from, to: dto.window.to },
    scope: { projectIds: dto.scope.projectIds, aggregation: dto.scope.aggregation, label: dto.scope.label },
    coverage: dto.coverage,
    coverageState: dto.coverageState,
    counts: {
      rows: rows.length,
      withValue: rows.filter(row => row.hasValue).length,
      unknown: rows.filter(row => !row.hasValue).length,
      sampleCount: dto.sampleCount,
    },
    rows,
    limitations: dto.limitations,
    numericValues: false,
    note: 'Display document: the served values are formatted strings. This summary carries metadata only; it is not a numeric analysis result.',
    authorization: 'none',
  }
}

/** Markdown rendering of a support summary, safe to paste into a ticket. */
export function renderSupportSummary(summary: SupportSummary): string {
  const lines: string[] = []
  lines.push(`# Observation support summary`)
  lines.push('')
  lines.push(`| Field | Value |`)
  lines.push(`| --- | --- |`)
  lines.push(`| Status | ${summary.status} |`)
  lines.push(`| Observation | ${summary.observedAt} (${summary.days} days, ${summary.timezone}) |`)
  lines.push(`| Window | ${summary.window.from} → ${summary.window.to} |`)
  lines.push(`| Scope | ${summary.scope.projectIds.join(', ') || '—'} (${summary.scope.aggregation}) |`)
  lines.push(`| Coverage | ${summary.coverageState} |`)
  lines.push(`| Summary id | ${summary.summaryId ?? 'none'} |`)
  lines.push(`| Rows | ${summary.counts.rows} (${summary.counts.withValue} with a value, ${summary.counts.unknown} unknown) |`)
  lines.push('')
  lines.push(`| Row id | Layer | Unit | Value present | Samples |`)
  lines.push(`| --- | --- | --- | --- | --- |`)
  for (const row of summary.rows)
    lines.push(`| ${row.rowId} | ${row.layer} | ${row.unit || '—'} | ${row.hasValue ? 'yes' : 'no'} | ${row.sampleCount ?? '—'} |`)
  lines.push('')
  for (const limitation of summary.limitations) lines.push(`- ${limitation}`)
  lines.push('')
  lines.push(summary.note)
  return `${lines.join('\n')}\n`
}
