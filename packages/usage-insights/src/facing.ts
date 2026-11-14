/**
 * Projection for the trial workspace.
 *
 * The workspace (`apps/console/src/trial/insights.ts`) only shows measurements when the input
 * declares its observation scope, window and coverage, and it refuses a summary whose declared
 * projects do not include the active project. `InsightConsumerView` is *structurally* identical to
 * that type; this module never imports another worktree, so a change on either side becomes a compile
 * error at the consumer instead of a silent shape mismatch.
 *
 * Rules kept here:
 * - a missing value stays `null`, never `0` or `''`;
 * - a sample count is `null` when it is unknown and `0` only for a genuinely empty window;
 * - the scope declares which projects the numbers cover and whether they are a cross-project
 *   aggregate, so a multi-project total can never be presented as one project's total;
 * - metric rows keep their evidence layer and unit, and unknown counts are never summed across rows
 *   that count different things.
 */
import { METRIC_DEFINITIONS, type MetricRow, type UsageInsightsSummary } from './protocol.ts'

/** Layer vocabulary of the presentation consumer. */
export type InsightConsumerLayer = 'observed' | 'controlled' | 'native' | 'operator' | 'unknown'

/** Mirrors `apps/console/src/trial/insights.ts` `TrialInsightsMetric`. */
export interface InsightConsumerMetric {
  readonly id: string
  readonly label: string
  /** Producer-formatted value. `null` means unknown and must stay visible as unknown. */
  readonly value: string | null
  readonly detail?: string
  /** Unit or currency of this row; rows with different units are never summed together. */
  readonly unit?: string
  readonly layer?: InsightConsumerLayer
  /** `null` means the sample count is unknown, not zero. */
  readonly sampleCount?: number | null
}

/** Mirrors `TrialInsightsView.scope`. */
export interface InsightConsumerScope {
  /** Projects the summary covers. An empty list is not "all projects"; it is undeclared scope. */
  readonly projectIds: readonly string[]
  readonly aggregation: 'single_project' | 'declared_multi_project' | 'cross_project'
  readonly label?: string
}

/** Mirrors `apps/console/src/trial/insights.ts` `TrialInsightsView`. */
export interface InsightConsumerView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  readonly windowLabel?: string
  readonly coverage?: string
  readonly coverageState?: 'complete' | 'partial' | 'unknown'
  readonly scope?: InsightConsumerScope
  readonly sampleCount: number | null
  /** `null` when a consistent de-duplicated total does not exist; rows count different things. */
  readonly unknownCount?: number | null
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

/** Map a recorded evidence layer into the consumer vocabulary without upgrading it. */
export function consumerLayer(layer: MetricRow['layer']): InsightConsumerLayer {
  if (layer === null) return 'observed'
  switch (layer) {
    case 'actual_native': return 'native'
    case 'controlled': return 'controlled'
    case 'protocol_fixture': return 'controlled'
    case 'schema': return 'unknown'
    case 'operator_note': return 'operator'
    default: return 'unknown'
  }
}

const unitLabel = (row: MetricRow): string => {
  if (row.unit === 'currency') return row.currency ?? 'currency'
  return row.unit
}

const formatValue = (row: MetricRow): string | null => {
  if (row.value === null) return null
  const value = Number.isInteger(row.value) ? String(row.value) : String(Math.round(row.value * 1000) / 1000)
  return `${value} ${unitLabel(row)}`
}

const coverageText = (coverage: string): string =>
  coverage === 'complete' ? '完整'
    : coverage === 'partial' ? '部分'
      : coverage === 'source_missing' ? '来源缺失'
        : coverage === 'not_collected' ? '未采集'
          : coverage === 'unsupported' ? '不支持' : coverage

const windowLabel = (summary: UsageInsightsSummary): string => {
  const at = (value: string): string => {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: summary.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(value))
    } catch {
      return value
    }
  }
  return `${at(summary.window.from)} – ${at(summary.window.to)}（${summary.timezone}）`
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

/**
 * The declared scope of the numbers. Metrics are aggregated over every declared project, so two or
 * more projects are a cross-project aggregate and are labelled as such.
 */
export function consumerScope(summary: UsageInsightsSummary): InsightConsumerScope {
  const projectIds = summary.projects.map(project => project.projectId).sort()
  const aggregation = projectIds.length === 1 ? 'single_project' as const : 'cross_project' as const
  return {
    projectIds,
    aggregation,
    label: projectIds.length === 1 ? projectIds[0]! : `跨项目（${projectIds.length} 个项目）`,
  }
}

export interface ConsumerViewOptions {
  /** Limit the rendered rows for a dense screen. Order is stable regardless of the limit. */
  readonly maxMetrics?: number
  readonly maxLimitations?: number
}

export function toInsightConsumerView(summary: UsageInsightsSummary, options: ConsumerViewOptions = {}): InsightConsumerView {
  const quarantined = summary.quarantine.total
  const partial = summary.coverage.overall !== 'complete' || quarantined > 0
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
    unit: unitLabel(row),
    layer: consumerLayer(row.layer),
    // An unavailable row has no sample count, so it must not read as "zero samples".
    sampleCount: row.value === null ? null : row.sampleCount,
  }))

  const coverageState: NonNullable<InsightConsumerView['coverageState']> =
    summary.coverage.overall === 'source_missing' || summary.coverage.overall === 'not_collected' ? 'unknown'
      : partial ? 'partial' : 'complete'

  const limitations = [...summary.limitations]
  const scope = consumerScope(summary)
  if (scope.aggregation === 'cross_project')
    limitations.push(`These numbers aggregate ${scope.projectIds.length} projects and are not any single project's total.`)
  if (partial)
    limitations.push('The observation is partial; unknown or excluded records are counted separately and never filled with zero.')
  if (options.maxLimitations) limitations.splice(options.maxLimitations)

  const sampleCount = observedOutcomeCount(summary)

  return {
    status,
    windowLabel: windowLabel(summary),
    coverage: quarantined > 0
      ? `${coverageText(summary.coverage.overall)}（${quarantined} 条记录被隔离）`
      : coverageText(summary.coverage.overall),
    coverageState,
    scope,
    sampleCount,
    // Rows count outcomes, interventions and currencies; adding their unknown counts would fabricate
    // a total, so the combined unknown count stays unestablished.
    unknownCount: null,
    metrics,
    limitations,
    partial,
  }
}

/**
 * Mirror of the workspace admission rule, so a Node consumer can refuse the same views the UI would.
 * The workspace re-checks this itself; this exists to fail early and identically off-screen.
 */
export function consumerAdmission(view: InsightConsumerView, activeProjectId?: string): {
  readonly admitted: boolean
  readonly reason?: string
} {
  if (view.status === 'insufficient_data') return { admitted: false, reason: 'insufficient_data' }
  if (view.status === 'unavailable') return { admitted: false, reason: 'unavailable' }
  if (view.scope === undefined || view.scope.projectIds.length === 0) return { admitted: false, reason: 'scope_missing' }
  if (activeProjectId !== undefined && !view.scope.projectIds.includes(activeProjectId))
    return { admitted: false, reason: 'active_project_out_of_scope' }
  if (view.windowLabel === undefined || view.windowLabel.trim().length === 0) return { admitted: false, reason: 'window_missing' }
  if (view.coverage === undefined || view.coverage.trim().length === 0) return { admitted: false, reason: 'coverage_missing' }
  if (view.metrics.length === 0) return { admitted: false, reason: 'no_metrics' }
  return { admitted: true }
}
