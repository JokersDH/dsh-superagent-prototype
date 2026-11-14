/**
 * Optional presentation input for the trial workspace. This is not a second analysis engine and it
 * never reads SQL or private state: main/G map their own trusted summary into this compact shape.
 * Values are rendered verbatim; F does not estimate cost, saved time, quality or approval rates.
 *
 * Admission gate: a summary is only shown as measurements when it declares its observation scope,
 * window and coverage. Structural compatibility alone is not data admission; G's default complete
 * metrics remain outside the product until their scope/coverage findings close.
 */
export type TrialInsightsLayer = 'observed' | 'controlled' | 'native' | 'operator' | 'unknown'

export interface TrialInsightsMetric {
  readonly id: string
  readonly label: string
  /** Producer-formatted value. null means unknown and must stay visible as unknown, never 0. */
  readonly value: string | null
  readonly detail?: string
  /** Optional unit/currency: rows are never summed across different units or currencies. */
  readonly unit?: string
  readonly currency?: string
  readonly layer?: TrialInsightsLayer
  /** null/absent means unknown, not zero. */
  readonly sampleCount?: number | null
}

export interface TrialInsightsScope {
  /** Projects the summary covered. An empty list is not "all projects"; it is undeclared scope. */
  readonly projectIds: readonly string[]
  readonly aggregation: 'single_project' | 'declared_multi_project' | 'cross_project'
  readonly label?: string
}

export interface TrialInsightsView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  /** Human-readable observation window, e.g. "11月1日–11月14日". Required to show measurements. */
  readonly windowLabel?: string
  /** Human-readable coverage statement, e.g. "complete" or "partial: 3 of 5 sources". Required to show measurements. */
  readonly coverage?: string
  readonly coverageState?: 'complete' | 'partial' | 'unknown'
  readonly scope?: TrialInsightsScope
  /** The producer declares the window was cut short; a "complete" view must not be shown then. */
  readonly truncated?: boolean
  /** Known/unknown source counts; null means that count is not established. */
  readonly sources?: { readonly known: number | null; readonly unknown: number | null }
  /** null means the sample count is unknown, not zero. */
  readonly sampleCount: number | null
  /** null/absent means the unknown count is not established, not zero. */
  readonly unknownCount?: number | null
  readonly metrics: readonly TrialInsightsMetric[]
  readonly limitations: readonly string[]
}

export interface TrialInsightsAdmission {
  readonly admitted: boolean
  readonly rows: readonly TrialInsightsMetric[]
  readonly message?: string
  readonly scopeLabel?: string | undefined
}

export function trialInsightsCount(value: TrialInsightsView): string {
  return value.sampleCount === null ? '样本数未知' : `${value.sampleCount} 个样本`
}

export function trialInsightsScopeLabel(value: TrialInsightsView): string | undefined {
  if (value.scope === undefined) return undefined
  if (value.scope.label !== undefined && value.scope.label.trim().length > 0) return value.scope.label
  return value.scope.projectIds.length === 0 ? undefined : value.scope.projectIds.join('、')
}

/**
 * Decide whether the optional report may show measurements. Any missing scope/window/coverage keeps the
 * rows hidden and names the missing declaration instead of implying a complete project-wide result.
 */
export function trialInsightsAdmission(value: TrialInsightsView, activeProjectId?: string): TrialInsightsAdmission {
  if (value.status === 'insufficient_data')
    return { admitted: false, rows: [], message: '样本不足，暂不展示效率结论。' }
  if (value.status === 'unavailable')
    return { admitted: false, rows: [], message: '当前没有可用的观察数据。' }
  if (value.scope === undefined)
    return { admitted: false, rows: [], message: '缺少观测范围说明，暂不展示指标。' }
  if (value.scope.projectIds.length === 0)
    return { admitted: false, rows: [], message: '摘要未声明项目范围，暂不展示指标。' }
  const scopeLabel = trialInsightsScopeLabel(value)
  if (activeProjectId !== undefined && !value.scope.projectIds.includes(activeProjectId))
    return { admitted: false, rows: [], scopeLabel, message: '该摘要不包含当前项目，暂不展示指标。' }
  if (value.windowLabel === undefined || value.windowLabel.trim().length === 0)
    return { admitted: false, rows: [], scopeLabel, message: '缺少观察窗口，暂不展示指标。' }
  if (value.coverage === undefined || value.coverage.trim().length === 0)
    return { admitted: false, rows: [], scopeLabel, message: '缺少覆盖说明，暂不展示指标。' }
  if (value.truncated === true && (value.coverageState === undefined || value.coverageState === 'complete'))
    return { admitted: false, rows: [], scopeLabel, message: '数据被截断，暂不展示完整指标。' }
  if (value.metrics.length === 0)
    return { admitted: false, rows: [], scopeLabel, message: '没有可展示的指标。' }
  return { admitted: true, rows: value.metrics, scopeLabel }
}
