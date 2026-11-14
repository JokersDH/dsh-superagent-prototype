/**
 * Orchestration. `analyzeUsageInsights` is a pure function: the same bundle always produces the
 * same summary (the `summaryId` is a digest of the result, and no clock is read). Side effects such
 * as writing a report belong to the CLI and are exclusive-create only.
 */
import type { ExecutionOutcome, Json, Timestamp } from '@personal-agent/contracts'
import type { EvidenceLayerName as EvidenceLayer } from './protocol.ts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { attentionSummary } from './attention.ts'
import { compareBaseline } from './baseline.ts'
import { interventionMetrics, outcomeMetrics, workInterventions } from './metrics.ts'
import {
  UsageInsightsAnalysisSchema,
  UsageInsightsInputSchema,
  type AppliedLimits,
  type AttentionSummary,
  type BaselineComparison,
  type CoverageBlock,
  type DeclaredCoverage,
  type IngestCoverage,
  type MetricCoverage,
  type MetricRow,
  type ProjectSummary,
  type QuarantineCode,
  type QuarantineDigest,
  type QuarantineEntry,
  type SubjectRow,
  type UsageCompleteness,
  type UsageInsightsAnalysis,
  type UsageInsightsInput,
  type UsageInsightsSummary,
} from './protocol.ts'
import {
  firstIssue,
  outcomeSubject,
  parseAttentionPages,
  parseOutcomes,
  parseWorkRecords,
  withinWindow,
} from './subject.ts'
import type { WorkInterventionFacts } from './metrics.ts'

export class UsageInsightsFault extends Error {
  readonly code: 'invalid_input' | 'invalid_argument' | 'unsupported' | 'source_unavailable' | 'limits' | 'output_conflict'
  constructor(code: UsageInsightsFault['code'], message: string) {
    super(message)
    this.name = 'UsageInsightsFault'
    this.code = code
  }
}

const QUARANTINE_DETAIL_LIMIT = 500
const SUBJECT_LIMIT = 2_000

const INGEST_SEVERITY: Record<IngestCoverage, number> = {
  complete: 0, caller_limit: 1, storage_cap: 2, source_missing: 3, not_collected: 4, unsupported: 5,
}
const METRIC_SEVERITY: Record<MetricCoverage, number> = { complete: 0, partial: 1, source_missing: 2, not_collected: 3, unsupported: 4 }

const worstIngest = (a: IngestCoverage, b: IngestCoverage): IngestCoverage => (INGEST_SEVERITY[b] > INGEST_SEVERITY[a] ? b : a)
const worstMetric = (a: MetricCoverage, b: MetricCoverage): MetricCoverage => (METRIC_SEVERITY[b] > METRIC_SEVERITY[a] ? b : a)

const toMetricCoverage = (coverage: IngestCoverage): MetricCoverage => {
  if (coverage === 'complete' || coverage === 'source_missing' || coverage === 'unsupported' || coverage === 'not_collected') return coverage
  return 'partial'
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new UsageInsightsFault('invalid_argument', `Unknown IANA time zone: ${timezone}`)
  }
}

/** An attempt identity that intentionally excludes the candidate generation. */
const attemptKey = (outcome: ExecutionOutcome): string => JSON.stringify([
  outcome.projectId, outcome.attempt.contract.workId, outcome.attempt.contract.revision, outcome.attempt.contract.digest,
  outcome.attempt.ticketId, outcome.attempt.assignmentId, outcome.attempt.attemptId, outcome.attempt.fenceEpoch,
])

interface QuarantineCollector {
  counts: Map<QuarantineCode, number>
  entries: QuarantineEntry[]
  add(entry: QuarantineEntry): void
}

function collector(): QuarantineCollector {
  const counts = new Map<QuarantineCode, number>()
  const entries: QuarantineEntry[] = []
  return {
    counts,
    entries,
    add(entry) {
      counts.set(entry.code, (counts.get(entry.code) ?? 0) + 1)
      if (entries.length < QUARANTINE_DETAIL_LIMIT) entries.push(entry)
    },
  }
}

export function analyzeUsageInsights(raw: unknown): UsageInsightsAnalysis {
  const envelope = UsageInsightsInputSchema.safeParse(raw)
  if (!envelope.success) throw new UsageInsightsFault('invalid_input', firstIssue(envelope.error))
  const input: UsageInsightsInput = envelope.data
  assertTimezone(input.timezone)

  const projectIds = input.projects.map(project => project.projectId)
  const projectSet = new Set(projectIds)
  if (projectSet.size !== projectIds.length) throw new UsageInsightsFault('invalid_input', 'Project scope entries must be unique')

  const quarantine = collector()
  const workParsed = parseWorkRecords(input.workEvidence, input.workHistories ?? [])
  const outcomeParsed = parseOutcomes([...input.outcomes, ...workParsed.outcomes])
  for (const entry of [...outcomeParsed.quarantined, ...workParsed.quarantined]) quarantine.add(entry)
  const attentionParsed = parseAttentionPages(input.attentionPages)
  for (const entry of attentionParsed.quarantined) quarantine.add(entry)

  const excludedByLayer = new Map<EvidenceLayer, number>()
  const inWindow: ExecutionOutcome[] = []
  const outsideWindow: ExecutionOutcome[] = []
  for (const outcome of outcomeParsed.records) {
    if (!projectSet.has(outcome.projectId)) {
      quarantine.add({ code: 'out_of_scope_project', recordClass: 'outcome', ref: outcome.id,
        reason: 'Outcome project is outside the declared project scope' })
      continue
    }
    if (!withinWindow(outcome.observedAt, input.window.from, input.window.to)) {
      excludedByLayer.set(outcome.layer, (excludedByLayer.get(outcome.layer) ?? 0) + 1)
      outsideWindow.push(outcome)
      quarantine.add({ code: 'outside_window', recordClass: 'outcome', ref: outcome.id,
        reason: 'Outcome observation time is outside the declared window; kept as a reference but not counted' })
      continue
    }
    inWindow.push(outcome)
  }

  const queueWaitBySubject = new Map<string, { waitMs: number; ref: string }>()
  if (input.queueFacts?.length) {
    const byAttempt = new Map<string, ExecutionOutcome[]>()
    for (const outcome of inWindow) {
      const key = attemptKey(outcome)
      const list = byAttempt.get(key) ?? []
      list.push(outcome)
      byAttempt.set(key, list)
    }
    for (const [index, fact] of input.queueFacts.entries()) {
      if (!projectSet.has(fact.projectId)) {
        quarantine.add({ code: 'out_of_scope_project', recordClass: 'queue_fact', ref: `queueFacts[${index}]`,
          reason: 'Queue fact project is outside the declared project scope' })
        continue
      }
      const key = JSON.stringify([fact.projectId, fact.attempt.contract.workId, fact.attempt.contract.revision,
        fact.attempt.contract.digest, fact.attempt.ticketId, fact.attempt.assignmentId, fact.attempt.attemptId, fact.attempt.fenceEpoch])
      const matches = byAttempt.get(key) ?? []
      if (matches.length === 0) {
        quarantine.add({ code: 'subject_mismatch', recordClass: 'queue_fact', ref: `queueFacts[${index}]`,
          reason: 'No observed attempt matches this queue fact exactly' })
        continue
      }
      const waitMs = Date.parse(fact.dispatchedAt) - Date.parse(fact.queuedAt)
      for (const outcome of matches) queueWaitBySubject.set(outcomeSubject(outcome).subjectKey, { waitMs, ref: `queue:${fact.evidenceRef}` })
    }
  }

  const invalidSignal = outcomeParsed.quarantined.length > 0 || workParsed.quarantined.length > 0
  const outcomesCoverage = worstIngest(input.declaredCoverage.outcomes, invalidSignal ? 'caller_limit' : 'complete')
  const derivedWork = workParsed.works.reduce<IngestCoverage>((worst, work) => worstIngest(worst, work.coverage), 'complete')
  const workCoverage = worstIngest(input.declaredCoverage.workEvidence, derivedWork)
  const attentionBlock = attentionSummary(attentionParsed, input.capturedAt, input.declaredCoverage.attention)

  const metrics: MetricRow[] = outcomeMetrics({
    outcomes: inWindow,
    queueWaitBySubject,
    subjectKeyOf: outcome => outcomeSubject(outcome).subjectKey,
    layerCoverage: () => toMetricCoverage(outcomesCoverage),
    excludedByLayer,
  })

  const interventionFacts: WorkInterventionFacts[] = workParsed.works.map(work => workInterventions(work))
  const evidenceWorks = new Set(workParsed.works.map(work => work.workId))
  const attentionWorks = new Set(attentionParsed.items.map(item => item.contract.workId))
  const unseenWorks = [...attentionWorks].filter(workId => !evidenceWorks.has(workId)).length
  const interventions = interventionMetrics(interventionFacts, unseenWorks, toMetricCoverage(workCoverage))
  metrics.push(...interventions.rows)

  metrics.sort((a, b) => a.metricId.localeCompare(b.metricId) || (a.layer ?? '').localeCompare(b.layer ?? '') || (a.currency ?? '').localeCompare(b.currency ?? ''))

  const projects = projectSummaries(projectIds, inWindow)
  const usageCompleteness = usageBlock(inWindow)
  const coverage = coverageBlock(outcomesCoverage, workCoverage, attentionBlock)
  const baseline = compareBaseline({ baseline: input.baseline ?? null, measured: metrics, projectIds, window: input.window })
  const limits = appliedLimits(input, input.outcomes.length + workParsed.outcomes.length, inWindow.length, workParsed.works.length, input.attentionPages.length)
  const quarantineDigest = quarantineSummary(quarantine)

  const configObserved = input.configSnapshot !== undefined
  const limitations = collectLimitations({
    input, coverage, baseline, metrics, queueFacts: queueWaitBySubject.size,
    unseenWorks, workCoverage, attention: attentionBlock, configObserved,
  })

  const notes = collectNotes({
    outsideWindow: outsideWindow.length, unseenWorks,
    conflicts: quarantine.counts.get('identity_conflict') ?? 0,
    collectionIssues: input.collectionIssues?.length ?? 0,
  })

  const body = {
    protocol: 'usage-insights/1' as const,
    inputId: input.inputId,
    inputDigest: input.source.digest,
    capturedAt: input.capturedAt,
    asOf: input.capturedAt,
    timezone: input.timezone,
    window: input.window,
    sourceKind: input.source.kind,
    sourceDescriptor: input.source.descriptor,
    projects,
    metrics,
    attention: attentionBlock,
    usageCompleteness,
    coverage,
    limits,
    quarantine: quarantineDigest,
    configuration: { observed: configObserved, kind: configObserved ? 'readiness' as const : 'none' as const, authority: 'none' as const },
    baseline,
    limitations,
  }
  const summary: UsageInsightsSummary = { ...body, summaryId: canonicalDigest(body as unknown as Json) }

  const subjects = subjectRows(inWindow, outsideWindow, queueWaitBySubject)
  const analysis: UsageInsightsAnalysis = {
    protocol: 'usage-insights-analysis/1',
    summary,
    subjects,
    quarantine: quarantine.entries,
    notes,
  }
  return UsageInsightsAnalysisSchema.parse(analysis)
}

/**
 * Per-project counts come only from outcomes, which are the records that carry a project identity.
 * A work with evidence but no outcome cannot be attributed to a project here, so it stays in the
 * global unknown count instead of being guessed.
 */
function projectSummaries(projectIds: readonly string[], outcomes: readonly ExecutionOutcome[]): ProjectSummary[] {
  return projectIds.map(projectId => {
    const group = outcomes.filter(outcome => outcome.projectId === projectId)
    const works = new Set(group.map(outcome => outcome.attempt.contract.workId))
    return {
      projectId,
      works: works.size,
      outcomes: group.length,
      accepted: group.filter(outcome => outcome.acceptance === 'accepted').length,
      layers: [...new Set(group.map(outcome => outcome.layer))].sort(),
    }
  })
}

function usageBlock(outcomes: readonly ExecutionOutcome[]): UsageCompleteness {
  const recordsWithKnownTokens = outcomes.filter(outcome => outcome.usage.inputTokens !== undefined || outcome.usage.outputTokens !== undefined).length
  const recordsWithKnownCost = outcomes.filter(outcome => outcome.usage.cost !== undefined).length
  const recordsWithUnknownUsage = outcomes.filter(outcome => outcome.usage.completeness === 'unknown').length
  const availability = (known: number): MetricCoverage => {
    if (outcomes.length === 0) return 'not_collected'
    if (known === outcomes.length) return 'complete'
    return known === 0 ? 'source_missing' : 'partial'
  }
  return {
    outcomeRecords: outcomes.length,
    recordsWithKnownTokens,
    recordsWithUnknownUsage,
    recordsWithKnownCost,
    recordsWithoutCost: outcomes.length - recordsWithKnownCost,
    tokensCompleteness: availability(recordsWithKnownTokens),
    costCompleteness: availability(recordsWithKnownCost),
  }
}

function coverageBlock(outcomes: IngestCoverage, workEvidence: IngestCoverage, attention: AttentionSummary): CoverageBlock {
  const mapped = { outcomes: toMetricCoverage(outcomes), workEvidence: toMetricCoverage(workEvidence), attention: attention.coverage }
  // "Attention was not requested" is reported per source but must not downgrade an otherwise fully
  // enumerated outcome/work window; it is a scope choice, not a data loss.
  const overall = attention.coverage === 'not_collected'
    ? worstMetric(mapped.outcomes, mapped.workEvidence)
    : worstMetric(worstMetric(mapped.outcomes, mapped.workEvidence), mapped.attention)
  return { ...mapped, overall }
}

function appliedLimits(input: UsageInsightsInput, recordsSample: number, recordsAccepted: number, worksSeen: number, pagesSeen: number): AppliedLimits {
  const maxRecords = input.limits?.maxRecords ?? 50_000
  const maxWorks = input.limits?.maxWorks ?? 50_000
  const maxPages = input.limits?.maxPages ?? 1_024
  const truncatedPages = input.declaredCoverage.attention !== 'complete' || input.declaredCoverage.workEvidence === 'caller_limit' ||
    input.declaredCoverage.workEvidence === 'storage_cap'
  const stoppedBy: AppliedLimits['stoppedBy'] =
    recordsSample >= maxRecords ? 'records'
      : worksSeen >= maxWorks ? 'works'
        : pagesSeen >= maxPages || truncatedPages ? 'pages'
          : 'none'
  return {
    maxRecords, maxWorks, maxPages,
    recordsSeen: recordsSample, recordsAccepted, worksSeen, pagesSeen,
    bytesSeen: 0,
    stoppedBy,
  }
}

function quarantineSummary(quarantine: QuarantineCollector): QuarantineDigest {
  return {
    total: [...quarantine.counts.values()].reduce((total, value) => total + value, 0),
    byCode: [...quarantine.counts.entries()].map(([code, records]) => ({ code, records })).sort((a, b) => a.code.localeCompare(b.code)),
    samples: quarantine.entries.slice(0, 20).map(entry => ({ code: entry.code, recordClass: entry.recordClass, ref: entry.ref })),
  }
}

function subjectRows(inWindow: readonly ExecutionOutcome[], outside: readonly ExecutionOutcome[],
  queueWaitBySubject: ReadonlyMap<string, { waitMs: number; ref: string }>): SubjectRow[] {
  const build = (outcome: ExecutionOutcome, status: SubjectRow['status']): SubjectRow => {
    const identity = outcomeSubject(outcome)
    const reasons: string[] = []
    if (outcome.durationMs === undefined) reasons.push('duration_missing')
    if (outcome.reviewTiming === undefined) reasons.push('timing_missing')
    if (outcome.acceptance === 'unknown') reasons.push('acceptance_unknown')
    if (!queueWaitBySubject.has(identity.subjectKey)) reasons.push('queue_endpoint_missing')
    if (outcome.usage.completeness === 'unknown') reasons.push('usage_unknown')
    if (status === 'outside_window') reasons.push('outside_window')
    return {
      subjectKey: identity.subjectKey,
      projectId: identity.projectId,
      workId: identity.workId,
      contract: identity.contract as SubjectRow['contract'],
      attemptId: identity.attemptId,
      candidateGeneration: identity.candidateGeneration,
      profileId: identity.profileId,
      layer: identity.layer as EvidenceLayer,
      status,
      reasons: reasons.slice(0, 8),
    }
  }
  const unique = new Map<string, SubjectRow>()
  for (const outcome of inWindow) {
    const row = build(outcome, 'observed')
    if (!unique.has(row.subjectKey)) unique.set(row.subjectKey, row)
  }
  for (const outcome of outside) {
    const row = build(outcome, 'outside_window')
    if (!unique.has(row.subjectKey)) unique.set(row.subjectKey, row)
  }
  return [...unique.values()].sort((a, b) => a.subjectKey.localeCompare(b.subjectKey)).slice(0, SUBJECT_LIMIT)
}

interface LimitationInput {
  input: UsageInsightsInput
  coverage: CoverageBlock
  baseline: BaselineComparison
  metrics: readonly MetricRow[]
  queueFacts: number
  unseenWorks: number
  workCoverage: IngestCoverage
  attention: AttentionSummary
  configObserved: boolean
}

function collectLimitations(input: LimitationInput): string[] {
  const limitations: string[] = [
    'Read-only observation of recorded facts. It is not acceptance, routing, budget, publication or execution authority.',
  ]
  if (input.input.source.kind !== 'http_read')
    limitations.push(`Evidence layers are as recorded by the producing system (${input.input.source.kind}); usage-insights does not independently verify native execution.`)
  if (input.coverage.overall !== 'complete')
    limitations.push('At least one input source is partial, missing or unsupported; sample counts describe only observed records and never extrapolate.')
  if (input.metrics.some(row => row.metricId === 'review.activeMs' && row.value !== null))
    limitations.push('review.activeMs is an observed UI-visibility proxy. It is not human working time, attention quality or a productivity score.')
  if (input.metrics.some(row => row.metricId === 'usage.cost'))
    limitations.push('Costs are grouped per recorded currency. Unknown usage and missing cost stay unknown; prices were not looked up.')
  if (input.queueFacts === 0)
    limitations.push('Queue waiting requires explicit queued-at and dispatched-at endpoints bound to the same attempt; the collected product surface did not provide them.')
  if (input.unseenWorks > 0)
    limitations.push(`${input.unseenWorks} work(s) visible through attention had no collected work evidence; their interaction counts stay unknown.`)
  if (input.attention.coverage === 'not_collected')
    limitations.push('Attention was not collected for this observation; pending counts and waiting age are unavailable, not zero.')
  else if (input.attention.coverage !== 'complete')
    limitations.push('The attention snapshot is bounded; pending counts and waiting age describe the observed page, not a total.')
  if (input.baseline.status !== 'not_requested')
    limitations.push('The operator baseline is a separate operator_note input. Any comparison is observational and does not establish causality, saved hours or a benefit rate.')
  if (input.workCoverage === 'complete' && input.coverage.workEvidence === 'not_collected')
    limitations.push('Work evidence was not collected; human-interaction counts are unavailable rather than zero.')
  if (input.configObserved)
    limitations.push('A configuration/readiness snapshot is attached for context only. It contributes no metric, sample, benefit or native-execution proof.')
  return limitations
}

function collectNotes(input: { outsideWindow: number; unseenWorks: number; conflicts: number; collectionIssues: number }): string[] {
  const notes: string[] = []
  if (input.collectionIssues > 0) notes.push(`${input.collectionIssues} collection issue(s) were recorded with the bundle; they are not evidence of missing work.`)
  if (input.outsideWindow > 0) notes.push(`${input.outsideWindow} outcome(s) fell outside the observation window and were excluded from every metric.`)
  if (input.unseenWorks > 0) notes.push(`${input.unseenWorks} work(s) were referenced by attention but had no evidence in this bundle.`)
  if (input.conflicts > 0) notes.push(`${input.conflicts} identity conflict(s) were quarantined; no version was chosen for you.`)
  return notes
}

/** Convenience for consumers that only need the stable projection. */
export function summarize(raw: unknown): UsageInsightsSummary {
  return analyzeUsageInsights(raw).summary
}

export type { DeclaredCoverage, Timestamp }
