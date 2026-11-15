/**
 * Cross-check the document the coordinator serves against the analysis it was derived from.
 *
 * The page (`usage-observation/1`), the report and the numeric export must describe the same
 * observation. The page is formatted by the coordinator, so this comparison parses its strings *for
 * verification only* — the parsed number never leaves this module, is never exported and never
 * becomes a value: the display export has no numeric field for exactly that reason.
 *
 * The two documents may come from different readers of the same window (the coordinator's
 * in-process readers and the CLI's authenticated HTTP read), so the snapshot identity is reported but
 * not required to match. What must match is the declared window, scope, days and timezone, and every
 * metric row within the display's one-decimal rounding.
 */
import { UsageObservationSchema, type UsageObservation } from '@personal-agent/contracts'
import { UsageInsightsSummarySchema, type MetricRow, type UsageInsightsSummary } from './protocol.ts'

export const CROSS_CHECK_PROTOCOL = 'usage-insights-cross-check/1' as const
/** The coordinator formats values with one fraction digit, so agreement is bounded by half of it. */
export const CROSS_CHECK_ABSOLUTE_TOLERANCE = 0.05

export type CrossCheckDisagreementKind =
  | 'snapshot_missing'
  | 'window_mismatch'
  | 'scope_mismatch'
  | 'days_mismatch'
  | 'timezone_mismatch'
  | 'display_unavailable'
  | 'metric_missing_in_display'
  | 'metric_missing_in_summary'
  | 'duplicate_display_row'
  | 'value_mismatch'
  | 'sample_mismatch'
  | 'header_sample_mismatch'

export interface CrossCheckDisagreement {
  readonly kind: CrossCheckDisagreementKind
  readonly metricId: string | null
  readonly detail: string
}

export interface CrossCheckResult {
  /** True when both documents carry the same observation identity. Different readers differ here. */
  readonly sameObservation: boolean
  /** True when the declared window/scope/days/timezone agree, so rows can be compared at all. */
  readonly comparable: boolean
  readonly snapshot: { readonly display: string | null; readonly analysis: string }
  readonly checked: number
  readonly agreements: number
  readonly disagreements: readonly CrossCheckDisagreement[]
  readonly notes: readonly string[]
  readonly tolerance: { readonly absolute: number; readonly note: string }
}

export class CrossCheckFault extends Error {
  readonly code: 'invalid_display_dto' | 'invalid_summary'
  constructor(code: CrossCheckFault['code'], message: string) {
    super(message)
    this.name = 'CrossCheckFault'
    this.code = code
  }
}

/**
 * The coordinator builds `metricId@layer@currency`, using the literal `product` when a row has no
 * evidence layer, and leaves the trailing separator when there is no currency. This is the only place
 * that shape is reconstructed, and it is used to *find* the served row, never to create a value.
 * (The served `layer` field uses the consumer vocabulary, where the same row reads `observed`.)
 */
export const expectedDisplayId = (row: MetricRow): string =>
  [row.metricId, row.layer ?? 'product', row.currency ?? ''].join('@')

const parseDisplayNumber = (value: string | null): number | null => {
  if (value === null) return null
  const normalized = value.replace(/[\s,]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const agrees = (analysis: number, display: number): boolean =>
  Math.abs(analysis - display) <= Math.max(CROSS_CHECK_ABSOLUTE_TOLERANCE, Math.abs(analysis) * 1e-9)

/** Compare one served document with one analysis summary. */
export function crossCheckAnalysisWithDisplay(input: {
  dto: UsageObservation
  summary: UsageInsightsSummary
}): CrossCheckResult {
  const dto = UsageObservationSchema.safeParse(input.dto)
  if (!dto.success) throw new CrossCheckFault('invalid_display_dto', 'The document is not a usage-observation/1 payload')
  const summary = UsageInsightsSummarySchema.safeParse(input.summary)
  if (!summary.success) throw new CrossCheckFault('invalid_summary', 'The summary does not match the stable schema')
  const display = dto.data, analysis = summary.data

  const disagreements: CrossCheckDisagreement[] = []
  const notes: string[] = []
  const sameObservation = display.summaryId !== null && display.summaryId === analysis.summaryId
  const snapshot = { display: display.summaryId, analysis: analysis.summaryId }
  const fail = (kind: CrossCheckDisagreementKind, metricId: string | null, detail: string) =>
    disagreements.push({ kind, metricId, detail })

  if (display.summaryId === null) fail('snapshot_missing', null, 'The served document carries no observation identity')
  if (display.window.from !== analysis.window.from || display.window.to !== analysis.window.to)
    fail('window_mismatch', null, `served ${display.window.from}→${display.window.to}, analysed ${analysis.window.from}→${analysis.window.to}`)
  if (display.days !== Math.round((Date.parse(analysis.window.to) - Date.parse(analysis.window.from)) / 86_400_000))
    fail('days_mismatch', null, `served ${display.days} day window differs from the analysed window`)
  if (display.timezone !== analysis.timezone)
    fail('timezone_mismatch', null, `served ${display.timezone}, analysed ${analysis.timezone}`)
  const displayProjects = [...display.scope.projectIds].sort()
  const analysisProjects = analysis.projects.map(project => project.projectId).sort()
  if (JSON.stringify(displayProjects) !== JSON.stringify(analysisProjects))
    fail('scope_mismatch', null, `served ${displayProjects.join(',')}, analysed ${analysisProjects.join(',')}`)
  if (display.status === 'unavailable')
    fail('display_unavailable', null, 'The served document has no metrics to compare')

  const comparable = disagreements.length === 0
  if (!comparable)
    return {
      sameObservation, comparable, snapshot, checked: 0, agreements: 0, disagreements, notes,
      tolerance: {
        absolute: CROSS_CHECK_ABSOLUTE_TOLERANCE,
        note: 'Agreement is bounded by half the display rounding; the parsed value is used only here.',
      },
    }

  let checked = 0, agreementCount = 0
  const displayRows = new Map<string, UsageObservation['metrics'][number]>()
  for (const metric of display.metrics) {
    if (displayRows.has(metric.id)) fail('duplicate_display_row', metric.id, 'The served document repeats a metric id')
    displayRows.set(metric.id, metric)
  }
  const matched = new Set<string>()
  for (const row of analysis.metrics) {
    const id = expectedDisplayId(row)
    const served = displayRows.get(id)
    const before = disagreements.length
    checked++
    if (served === undefined) {
      fail('metric_missing_in_display', row.metricId, `the served document has no row for ${id}`)
      continue
    }
    matched.add(id)
    const servedNumber = parseDisplayNumber(served.value)
    if (row.value === null) {
      if (servedNumber === null && served.value === null) agreementCount++
      else fail('value_mismatch', row.metricId, `analysed value is unknown but the served value is ${JSON.stringify(served.value)}`)
      continue
    }
    if (servedNumber === null) {
      fail('value_mismatch', row.metricId, `served value ${JSON.stringify(served.value)} is not a number`)
      continue
    }
    if (!agrees(row.value, servedNumber)) {
      fail('value_mismatch', row.metricId, `analysed ${row.value}, served ${servedNumber}`)
      continue
    }
    if (row.value !== servedNumber && notes.length < 8)
      notes.push(`${row.metricId}: analysed ${row.value} is served as ${served.value} after one-decimal rounding`)
    if (served.sampleCount !== null && served.sampleCount !== row.sampleCount)
      fail('sample_mismatch', row.metricId, `analysed ${row.sampleCount} samples, served ${served.sampleCount}`)
    // A row agrees only when both its value and its sample count agree.
    if (disagreements.length === before) agreementCount++
  }
  for (const [id, metric] of displayRows) {
    if (matched.has(id)) continue
    checked++
    fail('metric_missing_in_summary', metric.id, 'the served document has a row the analysis did not produce')
  }
  if (analysis.coverage.workEvidence === 'complete') {
    const before = disagreements.length
    checked++
    if (display.sampleCount !== analysis.limits.worksSeen)
      fail('header_sample_mismatch', null, `analysed ${analysis.limits.worksSeen} enumerated works, served ${display.sampleCount}`)
    if (disagreements.length === before) agreementCount++
  } else if (display.sampleCount !== null) {
    checked++
    fail('header_sample_mismatch', null, 'a bounded source must not carry a complete header sample count')
  }
  if (display.unknownCount !== null && notes.length < 8)
    notes.push('the served document carries a combined unknown count; rows count different things, so this cross-check does not add them up')

  return {
    sameObservation,
    comparable: true,
    snapshot,
    checked,
    agreements: agreementCount,
    disagreements,
    notes,
    tolerance: {
      absolute: CROSS_CHECK_ABSOLUTE_TOLERANCE,
      note: 'Agreement is bounded by half the display rounding; the parsed value is used only here and is never exported.',
    },
  }
}
