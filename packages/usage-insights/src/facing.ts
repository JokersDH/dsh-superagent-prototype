/**
 * Projection for a presentation consumer.
 *
 * The trial workspace (Agent F) owns a compact view type and explicitly refuses to be a second
 * analysis engine: it renders whatever a trusted summary provides and shows `null` as unknown.
 * `InsightConsumerView` below is *structurally* identical to that consumer type; this module does not
 * import another worktree, so the two cannot drift through a hidden dependency, and a change on
 * either side becomes a compile error at the consumer.
 *
 * Rules kept here:
 * - a missing value stays `null`, never `0` or `''`;
 * - a sample count is `null` when it is unknown and `0` only for a genuinely empty window;
 * - metric labels describe the measurement, never a benefit or a ratio.
 */
import { METRIC_DEFINITIONS, type MetricRow, type UsageInsightsSummary } from './protocol.ts'

/** Mirrors `apps/console/src/trial/insights.ts` `TrialInsightsMetric`. */
export interface InsightConsumerMetric {
  readonly id: string
  readonly label: string
  /** Producer-formatted value. `null` means unknown and must stay visible as unknown. */
  readonly value: string | null
  readonly detail?: string
}

/** Mirrors `apps/console/src/trial/insights.ts` `TrialInsightsView`, plus an explicit partial flag. */
export interface InsightConsumerView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  readonly windowLabel?: string
  readonly sampleCount: number | null
  readonly coverage?: string
  readonly metrics: readonly InsightConsumerMetric[]
  readonly limitations: readonly string[]
  /**
   * True when the observation is usable but not complete: bounded sources, a partial proxy metric, a
   * stale/absent snapshot or quarantined records. A consumer must show this instead of a
   * "complete" badge, and must not present any number as a measured total.
   */
  readonly partial: boolean
}

const LABELS: Record<string, string> = {
  'outcomes.count': '已观察执行次数',
  'outcomes.accepted': '已接受交付',
  'execution.durationMs': '执行耗时（系统记录）',
  'queue.waitMs': '排队耗时（显式端点）',
  'review.readyToAcceptanceMs': '候选就绪到接受',
  'review.activeMs': '界面可见审阅时长（部分代理）',
  'usage.inputTokens': '输入 token（已知）',
  'usage.outputTokens': '输出 token（已知）',
  'usage.cost': '记录成本（已知）',
  'interventions.total': '人工介入事实',
  'interventions.questions': '提出问题',
  'interventions.answers': '明确回答',
  'interventions.acceptances': '接受事实',
}

const unitSuffix = (row: MetricRow): string => {
  if (row.unit === 'currency') return row.currency ?? ''
  if (row.unit === 'ms') return 'ms'
  if (row.unit === 'tokens') return 'tokens'
  return ''
}

const formatValue = (row: MetricRow): string | null => {
  if (row.value === null) return null
  const value = Number.isInteger(row.value) ? String(row.value) : String(Math.round(row.value * 1000) / 1000)
  const unit = unitSuffix(row)
  return unit ? `${value} ${unit}` : value
}

const coverageText = (coverage: string): string =>
  coverage === 'complete' ? '完整'
    : coverage === 'partial' ? '部分'
      : coverage === 'source_missing' ? '来源缺失'
        : coverage === 'not_collected' ? '未采集'
          : coverage === 'unsupported' ? '不支持' : coverage

const windowLabel = (summary: UsageInsightsSummary): string => {
  const day = (value: string): string => {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: summary.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(value))
    } catch {
      return value
    }
  }
  return `${day(summary.window.from)} – ${day(summary.window.to)}（${summary.timezone}）`
}

/** Unique, stable identity for a metric row: the metric plus its layer and currency. */
export const metricRowKey = (row: MetricRow): string =>
  [row.metricId, row.layer ?? 'product', row.currency ?? ''].filter(Boolean).join('@')

/**
 * Total observed outcomes when it is genuinely known. A complete empty window is `0`; an
 * uncollected or missing source is `null`, because a zero would be a fabricated count.
 */
export function observedOutcomeCount(summary: UsageInsightsSummary): number | null {
  const rows = summary.metrics.filter(row => row.metricId === 'outcomes.count')
  if (rows.length > 0) return rows.reduce((total, row) => total + (row.value ?? 0), 0)
  if (summary.coverage.outcomes === 'complete') return 0
  return null
}

export interface ConsumerViewOptions {
  /** Limit the rendered rows for a dense screen. Order is stable regardless of the limit. */
  readonly maxMetrics?: number
  readonly maxLimitations?: number
}

export function toInsightConsumerView(summary: UsageInsightsSummary, options: ConsumerViewOptions = {}): InsightConsumerView {
  const quarantined = summary.quarantine.total
  const partial = summary.coverage.overall !== 'complete' || quarantined > 0
  // "Ready" means something was actually observed *and* nothing was rejected: a quarantined record
  // means part of the source is unknown, so its numbers cannot be presented as a complete result.
  const observed = summary.metrics.some(row => row.layer !== null && row.value !== null && row.sampleCount > 0) ||
    summary.attention.items > 0
  const status: InsightConsumerView['status'] =
    summary.coverage.overall === 'source_missing' || summary.coverage.overall === 'not_collected' ? 'unavailable'
      : observed && quarantined === 0 ? 'ready' : 'insufficient_data'

  const ordered = [...summary.metrics].sort((a, b) => a.metricId.localeCompare(b.metricId) ||
    (a.layer ?? '').localeCompare(b.layer ?? '') || (a.currency ?? '').localeCompare(b.currency ?? ''))
  const rows = status === 'unavailable' ? [] : ordered.filter(row => row.value !== null || row.unknownCount > 0)
  const limited = options.maxMetrics ? rows.slice(0, options.maxMetrics) : rows

  const metrics: InsightConsumerMetric[] = limited.map(row => ({
    id: metricRowKey(row),
    label: LABELS[row.metricId] ?? METRIC_DEFINITIONS[row.metricId].definition,
    value: formatValue(row),
    detail: `样本 ${row.sampleCount}，未知 ${row.unknownCount}，覆盖 ${coverageText(row.coverage)}${row.layer ? `，层级 ${row.layer}` : ''}`,
  }))

  const limitations = options.maxLimitations ? summary.limitations.slice(0, options.maxLimitations) : summary.limitations
  const sampleCount = observedOutcomeCount(summary)

  const coverageLabel = quarantined > 0
    ? `${coverageText(summary.coverage.overall)}（${quarantined} 条记录被隔离）`
    : coverageText(summary.coverage.overall)

  return {
    status,
    windowLabel: windowLabel(summary),
    sampleCount,
    coverage: coverageLabel,
    metrics,
    limitations,
    partial,
  }
}
