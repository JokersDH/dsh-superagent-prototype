import { performance } from 'node:perf_hooks'
import { ApplicationFault } from '@personal-agent/application'
import { UsageObservationQuerySchema, UsageObservationSchema, WorkEvidenceSchema, IdSchema } from '@personal-agent/contracts'
import type { UsageObservation, UsageObservationQuery, WorkEvidence } from '@personal-agent/contracts'
import type { MetricRow, UsageInsightsSummary } from '@personal-agent/usage-insights'

export interface UsageObservationReaders {
  projectIds(): readonly string[]
  cursor(): number
  listWorks(projectIds: readonly string[], limit: number): { works: readonly { id: string; projectId: string }[]; hasMore: boolean }
  workEvidence(workId: string): Promise<WorkEvidence>
}
const MAX_WORKS = 50, MAX_RECORDS = 10000, MAX_BYTES = 2 * 1024 * 1024, DEADLINE_MS = 2000
const LABELS: Record<string, string> = {
  'outcomes.count': '已观察执行次数', 'outcomes.accepted': '已接受交付',
  'interventions.total': '人工介入事实', 'interventions.questions': '提出问题',
  'interventions.answers': '明确回答', 'interventions.acceptances': '接受事实',
  'review.readyToAcceptanceMs': '平均候选就绪到接受', 'review.activeMs': '平均界面可见时长（部分代理）',
  'execution.durationMs': '平均记录执行耗时', 'queue.waitMs': '平均记录排队耗时',
  'usage.inputTokens': '已知输入 token', 'usage.outputTokens': '已知输出 token', 'usage.cost': '已知记录成本',
}
const layer = (value: MetricRow['layer']): UsageObservation['metrics'][number]['layer'] =>
  value === 'actual_native' ? 'native' : value === 'controlled' ? 'controlled' : value === 'operator_note' ? 'operator' : value === null ? 'observed' : 'unknown'

/** Existing scoped public readers only; this component has no storage writer or execution port. */
export class ProductUsageObservation {
  private readonly readers: UsageObservationReaders
  private readonly now: () => string
  constructor(readers: UsageObservationReaders, now = () => new Date().toISOString()) { this.readers = readers; this.now = now }

  async read(raw: UsageObservationQuery): Promise<UsageObservation> {
    const query = UsageObservationQuerySchema.parse(raw), observedAt = this.now(), days = query.days ?? 7, timezone = query.timezone ?? 'UTC'
    const allowed = [...this.readers.projectIds()]
    if (new Set(allowed).size !== allowed.length) throw new ApplicationFault('storage_unavailable', 'Observation project identities conflict', 'none')
    if (query.projectId && !allowed.includes(query.projectId)) throw new ApplicationFault('forbidden', 'Observation project is outside the configured scope', 'none')
    const projects = query.projectId ? [query.projectId] : allowed
    const offset = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(observedAt)).find(part => part.type === 'timeZoneName')?.value ?? 'UTC'
    const base = {
      protocol: 'usage-observation/1' as const, observedAt, days, timezone,
      window: { from: new Date(Date.parse(observedAt) - days * 86400000).toISOString(), to: observedAt },
      windowLabel: `近 ${days} 天 · ${offset}`,
      scope: { projectIds: projects.length > 32 ? [] : projects,
        aggregation: projects.length === 1 ? 'single_project' as const : 'declared_multi_project' as const,
        label: projects.length === 1 ? '当前项目' : `本次 ${projects.length} 个项目` },
      unknownCount: null, authorization: 'none' as const,
    }
    const unavailable = (reason: string) => UsageObservationSchema.parse({ ...base, status: 'unavailable', summaryId: null,
      coverage: '未提供', coverageState: 'unknown', sampleCount: null, metrics: [], limitations: [reason] })
    if (!projects.length) return unavailable('尚无可观察的项目。')
    if (projects.length > 32) return unavailable('项目超过单次观察范围，请选择一个项目。')

    // Optional analytics must not make ordinary installed startup depend on a new package closure.
    let analyze: typeof import('@personal-agent/usage-insights')['analyzeUsageInsights']
    try { ({ analyzeUsageInsights: analyze } = await import('@personal-agent/usage-insights')) }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(String(error.code)))
        return unavailable('当前安装尚未提供统计模块。')
      throw error
    }
    const deadline = performance.now() + DEADLINE_MS, cursor = this.readers.cursor()
    const page = this.readers.listWorks(projects, MAX_WORKS)
    if (page.works.length > MAX_WORKS) throw new ApplicationFault('storage_unavailable', 'Observation work limit was not respected', 'none')
    const index = new Map<string, string>()
    for (const work of page.works) {
      IdSchema.parse(work.id)
      if (!projects.includes(work.projectId) || index.has(work.id))
        throw new ApplicationFault('storage_unavailable', 'Observation work identities conflict', 'none')
      index.set(work.id, work.projectId)
    }
    const evidence: WorkEvidence[] = []
    let records = 0, bytes = 0, bounded = page.hasMore, missing = false
    for (const [workId, projectId] of index) {
      const remaining = deadline - performance.now()
      if (remaining <= 0) { bounded = true; break }
      let timer: ReturnType<typeof setTimeout> | undefined
      let value: WorkEvidence
      try {
        value = await Promise.race([Promise.resolve().then(() => this.readers.workEvidence(workId)), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('observation_deadline')), remaining)
        })])
      } catch (error) {
        if (error instanceof ApplicationFault && error.error.code === 'forbidden') throw error
        missing = true; continue
      } finally { clearTimeout(timer) }
      if (performance.now() >= deadline) { bounded = true; break }
      // Bound all children independently of G's generic API, before its schema/analysis runs.
      if (!value || !Array.isArray(value.entries) || !Array.isArray(value.outcomes)) { missing = true; continue }
      const size = 1 + value.entries.length + value.outcomes.length
      if (records + size > MAX_RECORDS) { bounded = true; break }
      const encoded = JSON.stringify(value), length = Buffer.byteLength(encoded)
      if (bytes + length > MAX_BYTES) { bounded = true; break }
      const parsed = WorkEvidenceSchema.safeParse(value)
      if (!parsed.success || parsed.data.workId !== workId || parsed.data.outcomes.some(outcome => outcome.projectId !== projectId))
        throw new ApplicationFault('storage_unavailable', 'Observation evidence identity mismatch', 'none')
      records += size; bytes += length
      const inWindow = (at: string) => Date.parse(at) >= Date.parse(base.window.from) && Date.parse(at) < Date.parse(base.window.to)
      const outcomes = parsed.data.outcomes.filter(outcome => inWindow(outcome.observedAt))
      evidence.push({ ...parsed.data, entries: parsed.data.entries.filter(entry => inWindow(entry.at)), outcomes,
        projection: parsed.data.projection === 'recorded' && !outcomes.length ? 'not_in_window' : parsed.data.projection })
      bounded ||= parsed.data.truncated
      missing ||= parsed.data.projection === 'source_missing'
    }
    if (JSON.stringify(this.readers.projectIds()) !== JSON.stringify(allowed))
      throw new ApplicationFault('forbidden', 'Observation project scope changed during collection', 'none')
    const changed = cursor !== this.readers.cursor()
    const coverage = missing ? 'source_missing' as const : bounded || changed ? 'caller_limit' as const : 'complete' as const
    const analysis = analyze({ protocol: 'usage-insights-input/1', inputId: 'product-usage-observation', capturedAt: observedAt,
      timezone, window: base.window, projects: projects.map(projectId => ({ projectId })),
      source: { kind: 'http_read', descriptor: 'authorized-product-readers', digest: null, capturedAt: observedAt, layerAssertion: 'recorded_by_producer' },
      declaredCoverage: { outcomes: coverage, workEvidence: coverage, attention: 'not_collected' },
      workIndex: [...index].map(([workId, projectId]) => ({ workId, projectId })), outcomes: [], workEvidence: evidence, attentionPages: [],
      limits: { maxRecords: MAX_RECORDS, maxWorks: MAX_WORKS, maxPages: 1 },
    })
    if (analysis.summary.quarantine.total) return unavailable('本次来源核对未通过，暂不提供统计。')
    return this.project(base, analysis.summary, missing || bounded || changed || performance.now() >= deadline)
  }

  private project(base: Omit<UsageObservation, 'status' | 'summaryId' | 'coverage' | 'coverageState' | 'sampleCount' | 'metrics' | 'limitations'>,
    summary: UsageInsightsSummary, bounded: boolean): UsageObservation {
    const partial = bounded || summary.coverage.overall !== 'complete' || summary.metrics.some(row => row.coverage !== 'complete')
    const observed = summary.metrics.some(row => row.value !== null && row.sampleCount > 0)
    const metrics = summary.metrics.slice(0, 32).map(row => ({
      id: [row.metricId, row.layer ?? 'product', row.currency ?? ''].join('@'), label: LABELS[row.metricId] ?? row.metricId,
      value: row.value === null ? null : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(row.value),
      unit: row.unit === 'currency' ? row.currency ?? '' : row.unit === 'ms' ? 'ms' : row.unit === 'tokens' ? 'tokens' : '',
      layer: layer(row.layer), sampleCount: row.sampleCount,
      detail: `未知 ${row.unknownCount} · ${row.coverage === 'complete' ? '完整' : '部分或缺失'}${row.layer ? ` · ${row.layer}` : ''}`,
    }))
    return UsageObservationSchema.parse({ ...base, status: observed ? 'ready' : 'insufficient_data', summaryId: summary.summaryId,
      coverage: partial ? '部分覆盖' : '完整覆盖', coverageState: partial ? 'partial' : 'complete',
      sampleCount: !bounded && summary.coverage.workEvidence === 'complete' ? summary.limits.worksSeen : null,
      metrics, limitations: [
        ...(bounded ? ['本次读取存在上限、变化或缺失，数值仅代表已观察部分。'] : []),
        '仅统计现有工作证据；未记录的执行耗时、排队、用量与成本保持未知。',
        '界面可见审阅时长是部分活动代理，不是人工工时或效率收益。',
      ] })
  }
}
