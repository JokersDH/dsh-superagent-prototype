/**
 * Human-readable rendering. Every free-text field that came from an operator or a producing system
 * is escaped before it reaches Markdown, so a work title, path or note can never inject markup, a
 * link or an execution instruction into the report. Numbers are rendered from the summary only.
 */
import type { MetricRow, UsageInsightsAnalysis, UsageInsightsSummary } from './protocol.ts'

const MAX_TEXT = 512

/** Neutralize markup and control characters in untrusted text. */
export function safeText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`\\<>|]/g, character => `\\${character}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
}

const format = (value: number | null): string => {
  if (value === null) return '—'
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 1000) / 1000)
}

const pct = (part: number, whole: number): string => (whole === 0 ? '—' : `${Math.round((part / whole) * 1000) / 10}%`)

const coverageLabel = (coverage: string): string =>
  coverage === 'complete' ? 'complete'
    : coverage === 'partial' ? 'partial'
      : coverage === 'source_missing' ? 'source missing'
        : coverage === 'not_collected' ? 'not collected'
          : coverage === 'unsupported' ? 'unsupported'
            : coverage

const nullReasonText = (reason: string | null): string => {
  if (!reason) return ''
  const table: Record<string, string> = {
    no_observations: 'no observations',
    endpoint_missing: 'endpoint not exposed',
    timing_missing: 'timing not recorded',
    acceptance_unknown: 'acceptance unknown',
    source_missing: 'source missing',
    not_collected: 'not collected',
    unsupported: 'unsupported',
    conflicted: 'identity conflict',
    layer_missing: 'no evidence layer',
    insufficient_data: 'insufficient data',
  }
  return table[reason] ?? reason
}

const unitLabel = (row: MetricRow): string => (row.unit === 'currency' ? row.currency ?? '?' : row.unit)

export function renderMarkdown(analysis: UsageInsightsAnalysis): string {
  const summary = analysis.summary
  const lines: string[] = []
  lines.push(`# Efficiency observation — ${safeText(summary.inputId)}`)
  lines.push('')
  lines.push('Read-only observation of recorded facts. No metric below grants execution, routing, budget or publication authority.')
  lines.push('')
  lines.push('## Source and window')
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('| --- | --- |')
  lines.push(`| Source kind | ${safeText(summary.sourceKind)} |`)
  lines.push(`| Source | ${safeText(summary.sourceDescriptor)} |`)
  lines.push(`| Captured | ${safeText(summary.capturedAt)} (UTC) |`)
  lines.push(`| Window | ${safeText(summary.window.from)} → ${safeText(summary.window.to)} (${safeText(summary.timezone)}) |`)
  lines.push(`| Projects | ${summary.projects.length === 0 ? '—' : summary.projects.map(project => safeText(project.projectId)).join(', ')} |`)
  lines.push(`| Summary id | ${summary.summaryId} |`)
  lines.push(`| Input digest | ${summary.inputDigest ?? 'not supplied'} |`)
  lines.push('')
  lines.push('## Coverage')
  lines.push('')
  lines.push('| Source | Coverage |')
  lines.push('| --- | --- |')
  for (const [name, value] of Object.entries(summary.coverage))
    lines.push(`| ${name} | ${coverageLabel(value)} |`)
  lines.push('')
  lines.push(`Stopped by: ${summary.limits.stoppedBy}. Records seen ${summary.limits.recordsSeen}, accepted ${summary.limits.recordsAccepted}; works ${summary.limits.worksSeen}; pages ${summary.limits.pagesSeen}.`)
  lines.push('')
  lines.push('## Metrics')
  lines.push('')
  if (summary.metrics.length === 0) lines.push('_No metric could be derived from this bundle._')
  else {
    lines.push('| Metric | Layer | Unit | Value | Samples | Unknown | Excluded | Coverage | Missing reason |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const row of summary.metrics) {
      lines.push(`| ${row.metricId} | ${row.layer ?? 'product record'} | ${unitLabel(row)} | ${format(row.value)} | ${row.sampleCount} | ${row.unknownCount} | ${row.excludedCount} | ${coverageLabel(row.coverage)} | ${row.value === null ? nullReasonText(row.nullReason) : ''} |`)
    }
  }
  lines.push('')
  lines.push('A dash means the value was not observed; the missing-reason column says why. Unknown counts stay separate and are never filled with zero.')
  lines.push('')
  lines.push('## Projects')
  lines.push('')
  if (summary.projects.length === 0) lines.push('_No project was declared._')
  else {
    lines.push('| Project | Works | Outcomes | Accepted | Layers |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const project of summary.projects)
      lines.push(`| ${safeText(project.projectId)} | ${project.works} | ${project.outcomes} | ${project.accepted} | ${project.layers.length ? project.layers.join(', ') : '—'} |`)
  }
  lines.push('')
  lines.push('## Current attention snapshot')
  lines.push('')
  if (summary.attention.items === 0) lines.push(`_No pending item was observed (coverage: ${coverageLabel(summary.attention.coverage)})._`)
  else {
    lines.push(`Observed ${summary.attention.items} pending item(s) at ${summary.attention.observedAt ?? 'an unknown time'}; ${summary.attention.itemsWithSince} carry a start time.`)
    lines.push('')
    lines.push(`Median pending age: ${summary.attention.waitingAgeMs === null ? '—' : `${format(summary.attention.waitingAgeMs)} ms`}. This is a pending-age snapshot, not historical queue waiting.`)
    lines.push('')
    if (summary.attention.byKind.length) lines.push(`By kind: ${summary.attention.byKind.map(item => `${item.kind} ${item.items}`).join(', ')}.`)
    if (summary.attention.byReason.length) lines.push(`By reason: ${summary.attention.byReason.map(item => `${safeText(item.reason)} ${item.items}`).join(', ')}.`)
  }
  lines.push('')
  lines.push('## Recorded usage')
  lines.push('')
  lines.push(`Outcome records: ${summary.usageCompleteness.outcomeRecords}. Known tokens: ${summary.usageCompleteness.recordsWithKnownTokens}. Unknown usage: ${summary.usageCompleteness.recordsWithUnknownUsage}. Known cost: ${summary.usageCompleteness.recordsWithKnownCost}. Records without cost: ${summary.usageCompleteness.recordsWithoutCost}.`)
  lines.push('')
  lines.push(`Token completeness: ${coverageLabel(summary.usageCompleteness.tokensCompleteness)}. Cost completeness: ${coverageLabel(summary.usageCompleteness.costCompleteness)}.`)
  lines.push('')
  lines.push('## Baseline comparison')
  lines.push('')
  const baseline = summary.baseline
  if (baseline.status === 'not_requested') lines.push('_No operator baseline was supplied; this is a single-window observation._')
  else {
    lines.push(`Status: **${baseline.status}** — observational only.`)
    lines.push('')
    lines.push('| Field | Value |')
    lines.push('| --- | --- |')
    lines.push(`| Baseline | ${baseline.baselineId ?? '—'} (${baseline.metricId ?? '—'}) |`)
    lines.push(`| Baseline value | ${format(baseline.baselineValue)} (n=${baseline.baselineSampleCount ?? '—'}) |`)
    lines.push(`| Measured value | ${format(baseline.measuredValue)} (n=${baseline.measuredSampleCount ?? '—'}) |`)
    lines.push(`| Delta | ${format(baseline.delta)} |`)
    lines.push(`| Ratio | ${format(baseline.ratio)} |`)
    if (baseline.reasons.length) lines.push(`| Reasons | ${baseline.reasons.map(safeText).join(', ')} |`)
    if (baseline.operatorNote) {
      lines.push('')
      lines.push(`Operator note (not a measured fact): ${safeText(baseline.operatorNote)}`)
    }
    lines.push('')
    lines.push('No percentage saving, saved-hour or causal claim is derived from this comparison.')
  }
  lines.push('')
  lines.push('## Quarantine')
  lines.push('')
  if (summary.quarantine.total === 0) lines.push('_No record was quarantined._')
  else {
    lines.push(`Total: ${summary.quarantine.total}.`)
    lines.push('')
    lines.push('| Code | Records |')
    lines.push('| --- | --- |')
    for (const entry of summary.quarantine.byCode) lines.push(`| ${entry.code} | ${entry.records} |`)
  }
  lines.push('')
  lines.push('## Limitations')
  lines.push('')
  for (const limitation of summary.limitations) lines.push(`- ${safeText(limitation)}`)
  if (analysis.notes.length) {
    lines.push('')
    lines.push('## Notes')
    lines.push('')
    for (const note of analysis.notes) lines.push(`- ${safeText(note)}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Compact terminal rendering: the same facts without tables. */
export function renderTerminal(analysis: UsageInsightsAnalysis): string {
  const summary: UsageInsightsSummary = analysis.summary
  const lines: string[] = []
  lines.push(`Efficiency observation ${summary.inputId}`)
  lines.push(`  source      ${summary.sourceKind} · ${safeText(summary.sourceDescriptor)}`)
  lines.push(`  window      ${summary.window.from} → ${summary.window.to} (${summary.timezone})`)
  lines.push(`  coverage    outcomes ${coverageLabel(summary.coverage.outcomes)}, work ${coverageLabel(summary.coverage.workEvidence)}, attention ${coverageLabel(summary.coverage.attention)}, overall ${coverageLabel(summary.coverage.overall)}`)
  lines.push(`  projects    ${summary.projects.map(project => `${safeText(project.projectId)} (${project.outcomes})`).join(', ') || '—'}`)
  lines.push('')
  if (summary.metrics.length === 0) lines.push('  no metric could be derived')
  for (const row of summary.metrics) {
    const where = row.layer ? `${row.layer}` : 'product'
    const reason = row.value === null ? `  [${nullReasonText(row.nullReason)}]` : ''
    lines.push(`  ${row.metricId.padEnd(26)} ${format(row.value).padStart(10)} ${unitLabel(row).padEnd(8)} ${where.padEnd(16)} n=${row.sampleCount} unknown=${row.unknownCount}${reason}`)
  }
  if (summary.attention.items > 0) {
    lines.push('')
    lines.push(`  pending     ${summary.attention.items} item(s), median age ${summary.attention.waitingAgeMs === null ? '—' : `${format(summary.attention.waitingAgeMs)} ms`}`)
  }
  lines.push('')
  lines.push(`  usage       known tokens ${summary.usageCompleteness.recordsWithKnownTokens}/${summary.usageCompleteness.outcomeRecords}, unknown ${summary.usageCompleteness.recordsWithUnknownUsage}, without cost ${summary.usageCompleteness.recordsWithoutCost}`)
  if (summary.baseline.status !== 'not_requested')
    lines.push(`  baseline    ${summary.baseline.status} · measured ${format(summary.baseline.measuredValue)} vs ${format(summary.baseline.baselineValue)} · observational only`)
  if (summary.quarantine.total > 0) lines.push(`  quarantine  ${summary.quarantine.total} record(s)`)
  lines.push('')
  lines.push(`  unknown ratio ${pct(summary.usageCompleteness.recordsWithUnknownUsage, summary.usageCompleteness.outcomeRecords)} of outcome records`)
  lines.push('  read-only observation; not an execution, routing, budget or benefit claim')
  return lines.join('\n')
}
