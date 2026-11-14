/**
 * Declared protocol of the efficiency observation module.
 *
 * Everything here is a *read-only derived statistic*. No field grants execution, routing,
 * acceptance, budget or publication authority, and none of it becomes a second ledger: the
 * inputs are existing product records plus an explicit operator baseline.
 *
 * Measurement honesty rules encoded below:
 * - A missing observation is `null` with a reason, never zero and never a silent default.
 * - `review.activeMs` is a partial UI-visibility proxy, not human working time or a quality score.
 * - `EvidenceLayer` values are never merged: every outcome-derived metric row carries one layer.
 * - Currencies are never combined; `usage.cost` is one row per observed currency.
 * - Operator baselines stay an explicit `operator_note` input and are compared observationally.
 */
import { z } from 'zod'
import {
  AttentionPageSchema,
  ContractRefSchema,
  DigestSchema,
  EvidenceLayerSchema,
  ExecutionOutcomeSchema,
  IdSchema,
  TimestampSchema,
  WorkEvidenceHistorySchema,
  WorkEvidenceSchema,
} from '@personal-agent/contracts'

const count = z.number().int().min(0).max(1_000_000).safe()
const finite = z.number().finite()

/** How much of the declared source was actually enumerated. `caller_limit`/`storage_cap` are page facts. */
export const INGEST_COVERAGE = ['complete', 'caller_limit', 'storage_cap', 'source_missing', 'not_collected', 'unsupported'] as const
export const IngestCoverageSchema = z.enum(INGEST_COVERAGE)
export type IngestCoverage = z.infer<typeof IngestCoverageSchema>
export type EvidenceLayerName = z.infer<typeof EvidenceLayerSchema>

/** Metric-level coverage: page facts collapse to `partial` so a truncated page can never read as complete. */
export const METRIC_COVERAGE = ['complete', 'partial', 'source_missing', 'not_collected', 'unsupported'] as const
export const MetricCoverageSchema = z.enum(METRIC_COVERAGE)
export type MetricCoverage = z.infer<typeof MetricCoverageSchema>

export const NULL_REASONS = [
  'no_observations',
  'endpoint_missing',
  'timing_missing',
  'acceptance_unknown',
  'source_missing',
  'not_collected',
  'unsupported',
  'conflicted',
  'layer_missing',
  'insufficient_data',
] as const
export const NullReasonSchema = z.enum(NULL_REASONS)
export type NullReason = z.infer<typeof NullReasonSchema>

/**
 * Metric catalogue. `scope: 'outcome'` metrics are partitioned by evidence layer;
 * `scope: 'work'` metrics describe product interaction facts and carry no layer claim.
 */
export const METRIC_DEFINITIONS = {
  'outcomes.count': { unit: 'count', aggregation: 'sum', scope: 'outcome',
    definition: 'Distinct accepted-for-analysis execution outcomes per evidence layer.' },
  'outcomes.accepted': { unit: 'count', aggregation: 'sum', scope: 'outcome',
    definition: 'Distinct outcomes whose recorded acceptance is exactly `accepted`.' },
  'execution.durationMs': { unit: 'ms', aggregation: 'mean', scope: 'outcome',
    definition: 'Mean of the duration the producing system recorded on the outcome. Not a queue time.' },
  'queue.waitMs': { unit: 'ms', aggregation: 'mean', scope: 'outcome',
    definition: 'Mean of explicit queued-at to dispatched-at pairs bound to the same attempt.' },
  'review.readyToAcceptanceMs': { unit: 'ms', aggregation: 'mean', scope: 'outcome',
    definition: 'Mean ReviewTiming.readyToAcceptanceMs, checked against its own ready/accepted timestamps.' },
  'review.activeMs': { unit: 'ms', aggregation: 'mean', scope: 'outcome',
    definition: 'Mean observed UI-visibility proxy interval. Partial visibility proxy only, never human hours.' },
  'usage.inputTokens': { unit: 'tokens', aggregation: 'sum', scope: 'outcome',
    definition: 'Sum of known input tokens. Unknown usage is counted separately, never as zero.' },
  'usage.outputTokens': { unit: 'tokens', aggregation: 'sum', scope: 'outcome',
    definition: 'Sum of known output tokens. Unknown usage is counted separately, never as zero.' },
  'usage.cost': { unit: 'currency', aggregation: 'sum', scope: 'outcome',
    definition: 'Sum of known recorded cost in one currency. Currencies are never added together.' },
  'interventions.total': { unit: 'count', aggregation: 'sum', scope: 'work',
    definition: 'Distinct traceable human-interaction facts (questions, answers, acceptances) per work.' },
  'interventions.questions': { unit: 'count', aggregation: 'sum', scope: 'work',
    definition: 'Distinct `question.opened` facts recorded on observed works.' },
  'interventions.answers': { unit: 'count', aggregation: 'sum', scope: 'work',
    definition: 'Distinct `runtime.answer.observed` facts recorded on observed works.' },
  'interventions.acceptances': { unit: 'count', aggregation: 'sum', scope: 'work',
    definition: 'Distinct `acceptance.recorded` facts recorded on observed works.' },
} as const

export const MetricIdSchema = z.enum(Object.keys(METRIC_DEFINITIONS) as [keyof typeof METRIC_DEFINITIONS])
export type MetricId = z.infer<typeof MetricIdSchema>
export const MetricUnitSchema = z.enum(['count', 'ms', 'tokens', 'currency'])
export type MetricUnit = z.infer<typeof MetricUnitSchema>
export const AggregationSchema = z.enum(['mean', 'sum'])
export type Aggregation = z.infer<typeof AggregationSchema>

export const InsightWindowSchema = z.strictObject({
  from: TimestampSchema,
  to: TimestampSchema,
}).refine(value => Date.parse(value.to) > Date.parse(value.from), 'Observation window must be a forward interval')
export type InsightWindow = z.infer<typeof InsightWindowSchema>

/** One metric row. `layer` is required for outcome metrics and forbidden for work-interaction metrics. */
export const MetricRowSchema = z.strictObject({
  metricId: MetricIdSchema,
  unit: MetricUnitSchema,
  aggregation: AggregationSchema,
  layer: EvidenceLayerSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  value: finite.nullable(),
  sampleCount: count,
  unknownCount: count,
  excludedCount: count,
  coverage: MetricCoverageSchema,
  nullReason: NullReasonSchema.nullable(),
  provenanceRefs: z.array(z.string().min(1).max(256)).max(256).readonly(),
}).superRefine((value, ctx) => {
  const definition = METRIC_DEFINITIONS[value.metricId]
  if (definition.unit !== value.unit || definition.aggregation !== value.aggregation)
    ctx.addIssue({ code: 'custom', message: `Metric ${value.metricId} must use its declared unit and aggregation` })
  if ((definition.scope === 'outcome') !== (value.layer !== null))
    ctx.addIssue({ code: 'custom', message: `Metric ${value.metricId} layer presence must match its declared scope` })
  if ((value.unit === 'currency') !== (value.currency !== null))
    ctx.addIssue({ code: 'custom', message: 'Only currency metrics carry a currency code' })
  if ((value.value === null) !== (value.nullReason !== null))
    ctx.addIssue({ code: 'custom', message: 'A missing value needs exactly one reason' })
  if (value.value !== null && (value.sampleCount === 0 && !(value.aggregation === 'sum' && value.value === 0)))
    ctx.addIssue({ code: 'custom', message: 'A present value needs observations, except a zero total over a complete empty set' })
  if (value.value !== null && !Number.isFinite(value.value))
    ctx.addIssue({ code: 'custom', message: 'A present value must be finite' })
  if (value.value !== null && value.unit !== 'currency' && value.value < 0)
    ctx.addIssue({ code: 'custom', message: 'Counters, durations and tokens are non-negative' })
  if (new Set(value.provenanceRefs).size !== value.provenanceRefs.length)
    ctx.addIssue({ code: 'custom', message: 'Metric provenance references must be unique' })
})
export type MetricRow = z.infer<typeof MetricRowSchema>

/** Bounded, identity-only drilldown. No titles, paths, prompts or payloads. */
export const SubjectRowSchema = z.strictObject({
  subjectKey: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: IdSchema,
  workId: IdSchema,
  contract: ContractRefSchema,
  attemptId: IdSchema.nullable(),
  candidateGeneration: z.number().int().positive().safe().nullable(),
  profileId: IdSchema.nullable(),
  layer: EvidenceLayerSchema,
  status: z.enum(['observed', 'incomplete', 'outside_window', 'quarantined']),
  reasons: z.array(z.string().min(1).max(64)).max(8).readonly(),
})
export type SubjectRow = z.infer<typeof SubjectRowSchema>

export const QUARANTINE_CODES = [
  'invalid_record',
  'identity_conflict',
  'replayed_record',
  'out_of_scope_project',
  'outside_window',
  'subject_mismatch',
  'time_inconsistent',
  'project_unknown',
  'unsupported_item',
] as const
export const QuarantineCodeSchema = z.enum(QUARANTINE_CODES)
export type QuarantineCode = z.infer<typeof QuarantineCodeSchema>

export const QuarantineEntrySchema = z.strictObject({
  code: QuarantineCodeSchema,
  recordClass: z.enum(['outcome', 'work_evidence', 'work_history', 'attention_page', 'queue_fact', 'baseline']),
  ref: z.string().min(1).max(256),
  reason: z.string().min(1).max(512),
})
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>

export const InsightLimitsSchema = z.strictObject({
  maxRecords: z.number().int().min(1).max(1_000_000).optional(),
  maxPages: z.number().int().min(1).max(100_000).optional(),
  maxBytes: z.number().int().min(1).max(1_000_000_000).optional(),
  maxWorks: z.number().int().min(1).max(100_000).optional(),
  requestTimeoutMs: z.number().int().min(1).max(600_000).optional(),
  deadlineMs: z.number().int().min(1).max(3_600_000).optional(),
})
export type InsightLimits = z.infer<typeof InsightLimitsSchema>

export const AppliedLimitsSchema = z.strictObject({
  maxRecords: z.number().int().min(1),
  maxWorks: z.number().int().min(1),
  maxPages: z.number().int().min(1),
  recordsSeen: count,
  recordsAccepted: count,
  worksSeen: count,
  pagesSeen: count,
  bytesSeen: count,
  stoppedBy: z.enum(['records', 'works', 'pages', 'bytes', 'deadline', 'none']),
})
export type AppliedLimits = z.infer<typeof AppliedLimitsSchema>

export const SOURCE_KINDS = ['http_read', 'verified_file', 'operator_file', 'synthetic_fixture'] as const
export const SourceKindSchema = z.enum(SOURCE_KINDS)
export type SourceKind = z.infer<typeof SourceKindSchema>

/**
 * Where the bundle came from. `digest` covers the exact bytes a file source was parsed from.
 * `layerAssertion` is deliberately weak: usage-insights never upgrades a producer's own label.
 */
export const SourceDeclarationSchema = z.strictObject({
  kind: SourceKindSchema,
  descriptor: z.string().min(1).max(256),
  digest: DigestSchema.nullable(),
  layerAssertion: z.enum(['recorded_by_producer', 'operator_declared', 'not_claimed']),
  capturedAt: TimestampSchema,
})
export type SourceDeclaration = z.infer<typeof SourceDeclarationSchema>

export const DeclaredCoverageSchema = z.strictObject({
  outcomes: IngestCoverageSchema,
  workEvidence: IngestCoverageSchema,
  attention: IngestCoverageSchema,
})
export type DeclaredCoverage = z.infer<typeof DeclaredCoverageSchema>

export const ProjectScopeSchema = z.strictObject({ projectId: IdSchema })
export type ProjectScope = z.infer<typeof ProjectScopeSchema>

/** Explicit queued/dispatched pair. Only a producer that records both endpoints may supply it. */
export const QueueFactSchema = z.strictObject({
  projectId: IdSchema,
  attempt: z.strictObject({ ticketId: IdSchema, assignmentId: IdSchema, contract: ContractRefSchema, attemptId: IdSchema, fenceEpoch: z.number().int().positive().safe() }),
  queuedAt: TimestampSchema,
  dispatchedAt: TimestampSchema,
  evidenceRef: IdSchema,
}).refine(value => Date.parse(value.dispatchedAt) >= Date.parse(value.queuedAt), 'Dispatch cannot precede queue entry')
export type QueueFact = z.infer<typeof QueueFactSchema>

export const OPERATOR_BASELINE_PROTOCOL = 'operator-baseline/1' as const
/**
 * A hand-entered comparison point. It is never merged into measured facts: `operatorNote` holds
 * assertions such as "we used to spend two days here" that the protocol refuses to treat as data.
 */
export const OperatorBaselineSchema = z.strictObject({
  protocol: z.literal(OPERATOR_BASELINE_PROTOCOL),
  baselineId: IdSchema,
  source: z.string().min(1).max(512),
  definition: z.string().min(1).max(2048),
  projectIds: z.array(IdSchema).min(1).max(32),
  window: InsightWindowSchema,
  timezone: z.string().min(1).max(64),
  metricId: MetricIdSchema,
  unit: MetricUnitSchema,
  aggregation: AggregationSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  targetLayer: EvidenceLayerSchema,
  sampleCount: count,
  value: finite,
  coverage: IngestCoverageSchema,
  operatorNote: z.string().max(4096).nullable(),
}).superRefine((value, ctx) => {
  const definition = METRIC_DEFINITIONS[value.metricId]
  if (definition.unit !== value.unit || definition.aggregation !== value.aggregation)
    ctx.addIssue({ code: 'custom', message: 'A baseline must use the measured metric unit and aggregation' })
  if ((value.unit === 'currency') !== (value.currency !== null))
    ctx.addIssue({ code: 'custom', message: 'Only a currency baseline carries a currency code' })
  if (value.unit !== 'currency' && value.value < 0)
    ctx.addIssue({ code: 'custom', message: 'A counter, duration or token baseline is non-negative' })
  if (value.coverage !== 'complete' && value.value !== 0 && value.sampleCount === 0)
    ctx.addIssue({ code: 'custom', message: 'A non-zero baseline needs samples' })
})
export type OperatorBaseline = z.infer<typeof OperatorBaselineSchema>

/**
 * The bundle a collector or an operator hands to the pure API. Record collections stay `unknown[]`
 * on purpose: a single malformed row is quarantined with a reason instead of silently dropped or
 * coerced, and the envelope itself stays strict.
 */
export const UsageInsightsInputSchema = z.strictObject({
  protocol: z.literal('usage-insights-input/1'),
  inputId: IdSchema,
  capturedAt: TimestampSchema,
  timezone: z.string().min(1).max(64),
  window: InsightWindowSchema,
  projects: z.array(ProjectScopeSchema).min(1).max(32),
  source: SourceDeclarationSchema,
  declaredCoverage: DeclaredCoverageSchema,
  limits: InsightLimitsSchema.optional(),
  outcomes: z.array(z.unknown()).max(50_000).readonly(),
  attentionPages: z.array(z.unknown()).max(1_024).readonly(),
  workEvidence: z.array(z.unknown()).max(50_000).readonly(),
  workHistories: z.array(z.unknown()).max(2_048).readonly().optional(),
  queueFacts: z.array(QueueFactSchema).max(50_000).readonly().optional(),
  baseline: OperatorBaselineSchema.nullable().optional(),
  /** Configuration-only observation (for example the readiness projection). Never a metric input. */
  configSnapshot: z.unknown().optional(),
  /** Sanitized collection problems preserved with the bundle for audit. */
  collectionIssues: z.array(z.strictObject({
    ref: z.string().min(1).max(256),
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  })).max(512).readonly().optional(),
})
export type UsageInsightsInput = z.infer<typeof UsageInsightsInputSchema>

/** Comparison is observational: it never proves saved hours, causality or a benefit rate. */
export const BaselineComparisonSchema = z.strictObject({
  status: z.enum(['comparable', 'not_comparable', 'insufficient_baseline', 'not_requested']),
  observation: z.literal('observational_only'),
  baselineId: IdSchema.nullable(),
  metricId: MetricIdSchema.nullable(),
  baselineValue: finite.nullable(),
  measuredValue: finite.nullable(),
  delta: finite.nullable(),
  ratio: finite.nullable(),
  baselineSampleCount: count.nullable(),
  measuredSampleCount: count.nullable(),
  reasons: z.array(z.string().min(1).max(128)).max(16).readonly(),
  operatorNote: z.string().max(4096).nullable(),
})
export type BaselineComparison = z.infer<typeof BaselineComparisonSchema>

export const AttentionSummarySchema = z.strictObject({
  observedAt: TimestampSchema.nullable(),
  items: count,
  itemsWithSince: count,
  waitingAgeMs: finite.nullable(),
  hasMore: z.boolean(),
  questionCoverage: z.enum(['complete', 'bounded']).nullable(),
  coverage: MetricCoverageSchema,
  projectCounts: z.array(z.strictObject({ projectId: IdSchema, items: count })).max(32).readonly(),
  byKind: z.array(z.strictObject({ kind: z.enum(['question', 'candidate', 'blocked']), items: count })).max(3).readonly(),
  byReason: z.array(z.strictObject({ reason: z.string().min(1).max(64), items: count })).max(24).readonly(),
})
export type AttentionSummary = z.infer<typeof AttentionSummarySchema>

export const UsageCompletenessSchema = z.strictObject({
  outcomeRecords: count,
  recordsWithKnownTokens: count,
  recordsWithUnknownUsage: count,
  recordsWithKnownCost: count,
  recordsWithoutCost: count,
  tokensCompleteness: MetricCoverageSchema,
  costCompleteness: MetricCoverageSchema,
})
export type UsageCompleteness = z.infer<typeof UsageCompletenessSchema>

export const CoverageBlockSchema = z.strictObject({
  outcomes: MetricCoverageSchema,
  workEvidence: MetricCoverageSchema,
  attention: MetricCoverageSchema,
  overall: MetricCoverageSchema,
})
export type CoverageBlock = z.infer<typeof CoverageBlockSchema>

export const QuarantineDigestSchema = z.strictObject({
  total: count,
  byCode: z.array(z.strictObject({ code: QuarantineCodeSchema, records: count })).max(16).readonly(),
  samples: z.array(z.strictObject({ code: QuarantineCodeSchema, recordClass: z.string().min(1).max(32), ref: z.string().min(1).max(256) })).max(20).readonly(),
})
export type QuarantineDigest = z.infer<typeof QuarantineDigestSchema>

export const ProjectSummarySchema = z.strictObject({
  projectId: IdSchema,
  works: count,
  outcomes: count,
  accepted: count,
  layers: z.array(EvidenceLayerSchema).max(5).readonly(),
})
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>

/** The stable, sanitized projection a UI may render. Everything here is aggregate or an id. */
export const UsageInsightsSummarySchema = z.strictObject({
  protocol: z.literal('usage-insights/1'),
  summaryId: z.string().regex(/^[a-f0-9]{64}$/),
  inputId: IdSchema,
  inputDigest: DigestSchema.nullable(),
  capturedAt: TimestampSchema,
  asOf: TimestampSchema,
  timezone: z.string().min(1).max(64),
  window: InsightWindowSchema,
  sourceKind: SourceKindSchema,
  sourceDescriptor: z.string().min(1).max(256),
  projects: z.array(ProjectSummarySchema).max(32).readonly(),
  metrics: z.array(MetricRowSchema).max(512).readonly(),
  attention: AttentionSummarySchema,
  usageCompleteness: UsageCompletenessSchema,
  coverage: CoverageBlockSchema,
  limits: AppliedLimitsSchema,
  quarantine: QuarantineDigestSchema,
  configuration: z.strictObject({
    observed: z.boolean(),
    kind: z.enum(['readiness', 'none']),
    /** Configuration presence is never a benefit, availability or native-execution claim. */
    authority: z.literal('none'),
  }),
  baseline: BaselineComparisonSchema,
  limitations: z.array(z.string().min(1).max(512)).max(32).readonly(),
}).superRefine((value, ctx) => {
  const seen = new Set<string>()
  for (const row of value.metrics) {
    const key = JSON.stringify([row.metricId, row.layer, row.currency])
    if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'Metric rows must be unique per metric, layer and currency' })
    seen.add(key)
  }
  if (new Set(value.projects.map(project => project.projectId)).size !== value.projects.length)
    ctx.addIssue({ code: 'custom', message: 'Project summaries must be unique' })
})
export type UsageInsightsSummary = z.infer<typeof UsageInsightsSummarySchema>

/** Full analysis: stable summary plus bounded diagnostics. Not a new authority record. */
export const UsageInsightsAnalysisSchema = z.strictObject({
  protocol: z.literal('usage-insights-analysis/1'),
  summary: UsageInsightsSummarySchema,
  subjects: z.array(SubjectRowSchema).max(2_000).readonly(),
  quarantine: z.array(QuarantineEntrySchema).max(2_048).readonly(),
  notes: z.array(z.string().min(1).max(512)).max(32).readonly(),
})
export type UsageInsightsAnalysis = z.infer<typeof UsageInsightsAnalysisSchema>

/** Re-exported contract surfaces the module reads, so consumers bind to one identity. */
export const RecordSchemas = {
  outcome: ExecutionOutcomeSchema,
  workEvidence: WorkEvidenceSchema,
  workHistory: WorkEvidenceHistorySchema,
  attentionPage: AttentionPageSchema,
} as const
