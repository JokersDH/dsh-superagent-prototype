/**
 * Pure metric derivation. Every function here is deterministic over its arguments: no clock, no
 * filesystem, no network. A missing endpoint produces `null` plus an explicit reason.
 */
import type { ExecutionOutcome, Json } from '@personal-agent/contracts'
import type { EvidenceLayerName as EvidenceLayer } from './protocol.ts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import {
  METRIC_DEFINITIONS,
  type MetricCoverage,
  type MetricId,
  type MetricRow,
  type NullReason,
} from './protocol.ts'
import type { WorkRecord } from './subject.ts'

const PROVENANCE_LIMIT = 64
const uniq = (values: Iterable<string>) => [...new Set(values)].sort().slice(0, PROVENANCE_LIMIT)

export interface MetricDraft {
  metricId: MetricId
  layer: EvidenceLayer | null
  currency?: string | null
  value: number | null
  sampleCount: number
  unknownCount: number
  excludedCount: number
  coverage: MetricCoverage
  nullReason: NullReason | null
  provenanceRefs: readonly string[]
}

/** Materialize a draft through the catalogue so unit/aggregation can never drift per call site. */
export function metricRow(draft: MetricDraft): MetricRow {
  const definition = METRIC_DEFINITIONS[draft.metricId]
  const row: MetricRow = {
    metricId: draft.metricId,
    unit: definition.unit,
    aggregation: definition.aggregation,
    layer: draft.layer,
    currency: draft.currency ?? null,
    value: draft.value === null ? null : round(draft.value),
    sampleCount: draft.sampleCount,
    unknownCount: draft.unknownCount,
    excludedCount: draft.excludedCount,
    coverage: draft.coverage,
    nullReason: draft.nullReason,
    provenanceRefs: uniq(draft.provenanceRefs),
  }
  return row
}

/** Keep sub-millisecond and fractional currency precision without leaking float noise into output. */
const round = (value: number): number => (Number.isInteger(value) ? value : Math.round(value * 1000) / 1000)

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length

export const sum = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((total, value) => total + value, 0))

export interface OutcomeMetricInput {
  outcomes: readonly ExecutionOutcome[]
  queueWaitBySubject: ReadonlyMap<string, { waitMs: number; ref: string }>
  subjectKeyOf: (outcome: ExecutionOutcome) => string
  layerCoverage: (layer: EvidenceLayer) => MetricCoverage
  excludedByLayer: ReadonlyMap<EvidenceLayer, number>
}

/**
 * Build the per-layer metric block. Layers are never merged, so a controlled record can never
 * contribute to an `actual_native` number.
 */
export function outcomeMetrics(input: OutcomeMetricInput): MetricRow[] {
  const layers = [...new Set(input.outcomes.map(outcome => outcome.layer))].sort()
  const rows: MetricRow[] = []
  for (const layer of layers) {
    const group = input.outcomes.filter(outcome => outcome.layer === layer)
    const coverage = input.layerCoverage(layer)
    const excluded = input.excludedByLayer.get(layer) ?? 0
    const refs = group.map(outcome => outcome.id)

    rows.push(metricRow({ metricId: 'outcomes.count', layer, value: group.length, sampleCount: group.length,
      unknownCount: 0, excludedCount: excluded, coverage, nullReason: null, provenanceRefs: refs }))

    const accepted = group.filter(outcome => outcome.acceptance === 'accepted')
    rows.push(metricRow({ metricId: 'outcomes.accepted', layer, value: accepted.length, sampleCount: group.length,
      unknownCount: 0, excludedCount: excluded, coverage, nullReason: null, provenanceRefs: refs }))

    const durations = group.flatMap(outcome => (outcome.durationMs === undefined ? [] : [outcome.durationMs]))
    rows.push(meanDraft({ metricId: 'execution.durationMs', layer, values: durations, eligible: group.length,
      unknown: group.length - durations.length, excluded, coverage, nullReason: 'timing_missing', refs }))

    const queueWaits: number[] = []
    const queueRefs: string[] = []
    for (const outcome of group) {
      const fact = input.queueWaitBySubject.get(input.subjectKeyOf(outcome))
      if (fact) { queueWaits.push(fact.waitMs); queueRefs.push(fact.ref) }
    }
    rows.push(meanDraft({ metricId: 'queue.waitMs', layer, values: queueWaits, eligible: group.length,
      unknown: group.length - queueWaits.length, excluded, coverage, nullReason: 'endpoint_missing',
      refs: queueRefs.length ? queueRefs : [] }))

    const readyValues = group.flatMap(outcome => {
      const timing = outcome.reviewTiming
      if (!timing || timing.readyToAcceptanceMs === null) return []
      if (!timing.candidateReadyAt || !timing.acceptedAt) return []
      // Recheck the pair independently of the producer's own arithmetic.
      if (Date.parse(timing.acceptedAt) - Date.parse(timing.candidateReadyAt) !== timing.readyToAcceptanceMs) return []
      if (Date.parse(timing.acceptedAt) < Date.parse(timing.candidateReadyAt)) return []
      return [timing.readyToAcceptanceMs]
    })
    rows.push(meanDraft({ metricId: 'review.readyToAcceptanceMs', layer, values: readyValues, eligible: group.length,
      unknown: group.length - readyValues.length, excluded, coverage,
      nullReason: accepted.length === 0 ? 'acceptance_unknown' : 'timing_missing', refs }))

    const activeValues = group.flatMap(outcome => (outcome.reviewTiming?.activeReviewMs == null ? [] : [outcome.reviewTiming.activeReviewMs]))
    const activeCoverage: MetricCoverage = group.some(outcome => outcome.reviewTiming?.activeReviewCompleteness === 'partial')
      ? 'partial'
      : coverage
    rows.push(meanDraft({ metricId: 'review.activeMs', layer, values: activeValues, eligible: group.length,
      unknown: group.length - activeValues.length, excluded, coverage: activeCoverage, nullReason: 'timing_missing', refs }))

    const inputTokens = group.flatMap(outcome => (outcome.usage.inputTokens === undefined ? [] : [outcome.usage.inputTokens]))
    const unknownUsage = group.filter(outcome => outcome.usage.completeness === 'unknown').length
    rows.push(sumDraft({ metricId: 'usage.inputTokens', layer, values: inputTokens, eligible: group.length,
      unknown: group.length - inputTokens.length, excluded, coverage, refs, unknownUsage }))
    const outputTokens = group.flatMap(outcome => (outcome.usage.outputTokens === undefined ? [] : [outcome.usage.outputTokens]))
    rows.push(sumDraft({ metricId: 'usage.outputTokens', layer, values: outputTokens, eligible: group.length,
      unknown: group.length - outputTokens.length, excluded, coverage, refs, unknownUsage }))

    const byCurrency = new Map<string, number[]>()
    for (const outcome of group) {
      const cost = outcome.usage.cost
      if (!cost) continue
      const list = byCurrency.get(cost.currency) ?? []
      list.push(cost.amount)
      byCurrency.set(cost.currency, list)
    }
    for (const currency of [...byCurrency.keys()].sort()) {
      const amounts = byCurrency.get(currency) ?? []
      rows.push(metricRow({ metricId: 'usage.cost', layer, currency, value: sum(amounts), sampleCount: amounts.length,
        unknownCount: 0, excludedCount: excluded, coverage, nullReason: null,
        provenanceRefs: group.filter(outcome => outcome.usage.cost?.currency === currency).map(outcome => outcome.id) }))
    }
  }
  return rows
}

interface MeanDraftInput {
  metricId: MetricId
  layer: EvidenceLayer
  values: readonly number[]
  eligible: number
  unknown: number
  excluded: number
  coverage: MetricCoverage
  nullReason: NullReason
  refs: readonly string[]
}

function meanDraft(input: MeanDraftInput): MetricRow {
  const value = mean(input.values)
  return metricRow({
    metricId: input.metricId, layer: input.layer, value,
    sampleCount: input.values.length, unknownCount: Math.max(0, input.unknown), excludedCount: input.excluded,
    coverage: input.coverage,
    nullReason: value === null ? (input.eligible === 0 ? 'no_observations' : input.nullReason) : null,
    provenanceRefs: input.refs,
  })
}

interface SumDraftInput extends Omit<MeanDraftInput, 'nullReason'> {
  unknownUsage: number
}

function sumDraft(input: SumDraftInput): MetricRow {
  const value = sum(input.values)
  return metricRow({
    metricId: input.metricId, layer: input.layer, value,
    sampleCount: input.values.length, unknownCount: Math.max(input.unknown, input.unknownUsage, 0),
    excludedCount: input.excluded, coverage: input.coverage,
    nullReason: value === null ? (input.eligible === 0 ? 'no_observations' : 'insufficient_data') : null,
    provenanceRefs: input.refs,
  })
}

export const INTERVENTION_KINDS = {
  'question.opened': 'question',
  'runtime.answer.observed': 'answer',
  'acceptance.recorded': 'acceptance',
} as const

export type InterventionKind = (typeof INTERVENTION_KINDS)[keyof typeof INTERVENTION_KINDS]

export interface WorkInterventionFacts {
  workId: string
  questions: number
  answers: number
  acceptances: number
  total: number
  observed: boolean
  partial: boolean
  refs: string[]
}

/**
 * Count only traceable interaction facts. Assistant messages, model suggestions and a replayed
 * receipt are never counted as a human intervention, and `runtime.question.opened` is not counted
 * alongside `question.opened` because that would double-count one question.
 */
export function workInterventions(work: WorkRecord): WorkInterventionFacts {
  const seen = new Map<InterventionKind, Set<string>>([['question', new Set()], ['answer', new Set()], ['acceptance', new Set()]])
  const refs: string[] = []
  for (const entry of work.entries) {
    const kind = INTERVENTION_KINDS[entry.kind as keyof typeof INTERVENTION_KINDS]
    if (!kind) continue
    const bucket = seen.get(kind)
    if (!bucket || bucket.has(entry.sourceRef)) continue
    bucket.add(entry.sourceRef)
    refs.push(`${entry.kind}:${entry.sourceRef}`)
  }
  const questions = seen.get('question')?.size ?? 0
  const answers = seen.get('answer')?.size ?? 0
  const acceptances = seen.get('acceptance')?.size ?? 0
  const observed = work.coverage !== 'source_missing' && work.coverage !== 'unsupported'
  return {
    workId: work.workId,
    questions,
    answers,
    acceptances,
    total: questions + answers + acceptances,
    observed,
    partial: work.coverage === 'caller_limit' || work.coverage === 'storage_cap',
    refs,
  }
}

export interface InterventionAggregate {
  rows: MetricRow[]
  worksObserved: number
  worksUnknown: number
  /** True only when the work source was proven completely enumerated and genuinely contained no work. */
  measuredEmpty: boolean
}

/**
 * Aggregate interaction counts across attributable works.
 *
 * `unknownWorks` covers every work the observation could not attribute or did not collect: unmapped
 * works, foreign works, works visible only through attention and works dropped by a declared bound.
 * A zero total is produced only when nothing is unknown and the source was proven complete — an
 * excluded or rejected set is never "a measured zero".
 */
export function interventionMetrics(facts: readonly WorkInterventionFacts[], unseenWorks: number,
  workCoverage: MetricCoverage, unmappedReason: NullReason = 'source_missing'): InterventionAggregate {
  const observed = facts.filter(fact => fact.observed)
  const partial = observed.some(fact => fact.partial)
  const coverage: MetricCoverage = observed.length === 0 ? (workCoverage === 'complete' ? 'source_missing' : workCoverage) : partial ? 'partial' : workCoverage
  const worksUnknown = unseenWorks + seenCount(facts)
  const emptyComplete = facts.length === 0 && worksUnknown === 0 && workCoverage === 'complete'
  const build = (metricId: MetricId, pick: (fact: WorkInterventionFacts) => number, refs: string[]) => {
    const value = emptyComplete ? 0 : observed.length === 0 ? null : observed.reduce((total, fact) => total + pick(fact), 0)
    return metricRow({
      metricId, layer: null, value,
      sampleCount: observed.length,
      unknownCount: worksUnknown,
      excludedCount: 0,
      coverage: emptyComplete ? 'complete' : coverage,
      nullReason: value === null ? unmappedReason : null,
      provenanceRefs: refs,
    })
  }
  return {
    rows: [
      build('interventions.total', fact => fact.total, observed.flatMap(fact => fact.refs)),
      build('interventions.questions', fact => fact.questions, observed.filter(fact => fact.questions).map(fact => fact.workId)),
      build('interventions.answers', fact => fact.answers, observed.filter(fact => fact.answers).map(fact => fact.workId)),
      build('interventions.acceptances', fact => fact.acceptances, observed.filter(fact => fact.acceptances).map(fact => fact.workId)),
    ],
    worksObserved: observed.length,
    worksUnknown,
    measuredEmpty: emptyComplete,
  }
}

function seenCount(facts: readonly WorkInterventionFacts[]): number {
  return facts.filter(fact => !fact.observed).length
}

/** Deterministic median, used only for the current attention waiting snapshot. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? null
  const left = sorted[middle - 1] ?? 0
  const right = sorted[middle] ?? 0
  return (left + right) / 2
}

export const digestOf = (value: unknown): string => canonicalDigest(value as Json)
