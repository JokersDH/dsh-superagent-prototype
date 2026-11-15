/**
 * Baseline comparison.
 *
 * An operator baseline is a hand-authored comparison point. It is compared only when it declares
 * the same metric, unit, aggregation, layer, currency and a non-overlapping window, and the result
 * is always labelled observational. Nothing here can produce "hours saved", a percentage benefit or
 * a causal claim, and an unusable baseline yields `null` with a reason instead of a number.
 */
import type { InsightWindow, MetricRow, OperatorBaseline } from './protocol.ts'
import type { BaselineComparison } from './protocol.ts'

const overlaps = (a: InsightWindow, b: InsightWindow) =>
  Date.parse(a.from) < Date.parse(b.to) && Date.parse(b.from) < Date.parse(a.to)

export interface BaselineInput {
  baseline: OperatorBaseline | null
  measured: readonly MetricRow[]
  projectIds: readonly string[]
  window: InsightWindow
}

export function compareBaseline(input: BaselineInput): BaselineComparison {
  const { baseline } = input
  if (!baseline) {
    return {
      status: 'not_requested', observation: 'observational_only', baselineId: null, metricId: null,
      baselineValue: null, measuredValue: null, delta: null, ratio: null,
      baselineSampleCount: null, measuredSampleCount: null, reasons: [], operatorNote: null,
    }
  }

  const reasons: string[] = []
  const unavailable = (reason: string, status: BaselineComparison['status'] = 'not_comparable'): BaselineComparison => ({
    status, observation: 'observational_only', baselineId: baseline.baselineId, metricId: baseline.metricId,
    baselineValue: baseline.value, measuredValue: null, delta: null, ratio: null,
    baselineSampleCount: baseline.sampleCount, measuredSampleCount: null,
    reasons: [reason, ...reasons], operatorNote: baseline.operatorNote,
  })

  if (baseline.coverage !== 'complete') reasons.push(`baseline_coverage_${baseline.coverage}`)
  if (baseline.sampleCount === 0) reasons.push('baseline_has_no_samples')
  if (baseline.projectIds.some(projectId => !input.projectIds.includes(projectId))) reasons.push('baseline_project_out_of_scope')
  if (overlaps(baseline.window, input.window)) reasons.push('window_overlap')
  if (reasons.length) return unavailable(reasons[0]!, 'insufficient_baseline')

  const row = input.measured.find(candidate =>
    candidate.metricId === baseline.metricId &&
    candidate.unit === baseline.unit &&
    candidate.aggregation === baseline.aggregation &&
    candidate.currency === baseline.currency &&
    candidate.layer === baseline.targetLayer)
  if (!row) {
    const anyMetric = input.measured.some(candidate => candidate.metricId === baseline.metricId)
    return unavailable(anyMetric ? 'measured_layer_or_currency_mismatch' : 'measured_metric_unavailable')
  }
  if (row.value === null) return unavailable('measured_value_missing', 'insufficient_baseline')
  if (row.coverage !== 'complete') return unavailable(`measured_coverage_${row.coverage}`)

  const measuredValue = row.value
  const delta = measuredValue - baseline.value
  const ratio = baseline.value > 0 ? measuredValue / baseline.value : null
  const localReasons: string[] = []
  if (baseline.value === 0) localReasons.push('zero_denominator')
  if (baseline.aggregation === 'mean' && row.sampleCount === 0) localReasons.push('measured_has_no_samples')

  return {
    status: localReasons.length ? 'not_comparable' : 'comparable',
    observation: 'observational_only',
    baselineId: baseline.baselineId,
    metricId: baseline.metricId,
    baselineValue: baseline.value,
    measuredValue,
    delta: localReasons.length ? null : delta,
    ratio: localReasons.length ? null : ratio,
    baselineSampleCount: baseline.sampleCount,
    measuredSampleCount: row.sampleCount,
    reasons: localReasons,
    operatorNote: baseline.operatorNote,
  }
}
