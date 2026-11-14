/**
 * Optional presentation input for the trial workspace. This is not a second analysis engine and it
 * never reads SQL or private state: main/G map their own trusted summary into this compact shape.
 * Values are rendered verbatim; F does not estimate cost, saved time, quality or approval rates.
 */
export interface TrialInsightsMetric {
  readonly id: string
  readonly label: string
  /** Producer-formatted value. null means unknown and must stay visible as unknown, never 0. */
  readonly value: string | null
  readonly detail?: string
}

export interface TrialInsightsView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  /** Human-readable observation window, e.g. "11月1日–11月14日". */
  readonly windowLabel?: string
  /** null means the sample count is unknown, not zero. */
  readonly sampleCount: number | null
  readonly coverage?: string
  readonly metrics: readonly TrialInsightsMetric[]
  readonly limitations: readonly string[]
}

export function trialInsightsCount(value: TrialInsightsView): string {
  return value.sampleCount === null ? '样本数未知' : `${value.sampleCount} 个样本`
}

/** Only a ready summary with at least one metric is allowed to show measurements. */
export function trialInsightsRows(value: TrialInsightsView): readonly TrialInsightsMetric[] {
  return value.status === 'ready' ? value.metrics : []
}
