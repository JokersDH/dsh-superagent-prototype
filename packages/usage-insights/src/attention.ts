/**
 * Current attention snapshot. This is a *pending age* observation at capture time, not historical
 * queue waiting: the attention inbox lists what is waiting now, and a bounded page is reported as
 * bounded rather than extrapolated to a total.
 */
import type { AttentionSummary, IngestCoverage, MetricCoverage } from './protocol.ts'
import { median } from './metrics.ts'
import type { ParsedAttention } from './subject.ts'

const toMetric = (coverage: IngestCoverage | ParsedAttention['coverage']): MetricCoverage => {
  if (coverage === 'complete') return 'complete'
  if (coverage === 'unsupported') return 'unsupported'
  if (coverage === 'source_missing' || coverage === 'not_collected') return coverage
  return 'partial'
}

const severity: Record<MetricCoverage, number> = { complete: 0, partial: 1, source_missing: 2, not_collected: 3, unsupported: 4 }
const worst = (a: MetricCoverage, b: MetricCoverage): MetricCoverage => (severity[b] > severity[a] ? b : a)

export function attentionSummary(parsed: ParsedAttention, capturedAt: string, declared: IngestCoverage): AttentionSummary {
  const projectCounts = new Map<string, number>()
  const byKind = new Map<AttentionSummary['byKind'][number]['kind'], number>([['question', 0], ['candidate', 0], ['blocked', 0]])
  const byReason = new Map<string, number>()
  const ages: number[] = []
  let itemsWithSince = 0
  let inconsistent = 0

  for (const item of parsed.items) {
    projectCounts.set(item.projectId, (projectCounts.get(item.projectId) ?? 0) + 1)
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1)
    for (const reason of item.reasons) byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
    if (item.sinceAt === null) continue
    itemsWithSince++
    const age = Date.parse(capturedAt) - Date.parse(item.sinceAt)
    if (age < 0) { inconsistent++; continue }
    ages.push(age)
  }

  let coverage = worst(toMetric(declared), toMetric(parsed.coverage))
  if (inconsistent > 0) coverage = worst(coverage, 'partial')
  if (parsed.hasMore) coverage = worst(coverage, 'partial')

  return {
    observedAt: parsed.observedAt,
    items: parsed.items.length,
    itemsWithSince,
    waitingAgeMs: median(ages),
    hasMore: parsed.hasMore,
    questionCoverage: parsed.questionCoverage,
    stale: parsed.stale,
    coverage,
    projectCounts: [...projectCounts.entries()].map(([projectId, items]) => ({ projectId, items })).sort((a, b) => a.projectId.localeCompare(b.projectId)),
    byKind: [...byKind.entries()].filter(([, items]) => items > 0).map(([kind, items]) => ({ kind, items })).sort((a, b) => a.kind.localeCompare(b.kind)),
    byReason: [...byReason.entries()].map(([reason, items]) => ({ reason, items })).sort((a, b) => b.items - a.items || a.reason.localeCompare(b.reason)).slice(0, 24),
  }
}
