/**
 * `@personal-agent/usage-insights` — read-only efficiency observation.
 *
 * The module consumes existing product records (`ExecutionOutcome`, `ReviewTiming`,
 * `AttentionPage`, `WorkEvidence`) plus an explicit operator baseline and derives sanitized,
 * deterministic metrics. It owns no storage, no queue, no scheduler and no authority.
 */
export {
  INGEST_COVERAGE,
  METRIC_COVERAGE,
  METRIC_DEFINITIONS,
  METRIC_DEFINITIONS as metricDefinitions,
  NULL_REASONS,
  OPERATOR_BASELINE_PROTOCOL,
  QUARANTINE_CODES,
  SOURCE_KINDS,
  AttentionSummarySchema,
  AppliedLimitsSchema,
  BaselineComparisonSchema,
  CoverageBlockSchema,
  DeclaredCoverageSchema,
  IngestCoverageSchema,
  InsightLimitsSchema,
  InsightWindowSchema,
  MetricCoverageSchema,
  MetricIdSchema,
  MetricRowSchema,
  MetricUnitSchema,
  OperatorBaselineSchema,
  ProjectScopeSchema,
  ProjectSummarySchema,
  QuarantineDigestSchema,
  QuarantineEntrySchema,
  QueueFactSchema,
  SourceDeclarationSchema,
  SourceKindSchema,
  SubjectRowSchema,
  UsageCompletenessSchema,
  UsageInsightsAnalysisSchema,
  UsageInsightsInputSchema,
  UsageInsightsSummarySchema,
  USAGE_INSIGHTS_COMPATIBILITY,
} from './protocol.ts'
export type {
  Aggregation,
  AppliedLimits,
  AttentionSummary,
  BaselineComparison,
  CoverageBlock,
  DeclaredCoverage,
  IngestCoverage,
  InsightLimits,
  InsightWindow,
  MetricCoverage,
  MetricId,
  MetricRow,
  MetricUnit,
  NullReason,
  OperatorBaseline,
  ProjectScope,
  ProjectSummary,
  QuarantineCode,
  QuarantineDigest,
  QuarantineEntry,
  QueueFact,
  SourceDeclaration,
  SourceKind,
  SubjectRow,
  UsageCompleteness,
  UsageInsightsAnalysis,
  UsageInsightsInput,
  UsageInsightsSummary,
} from './protocol.ts'
export { analyzeUsageInsights, summarize, UsageInsightsFault } from './analyze.ts'
export { compareBaseline } from './baseline.ts'
export { attentionSummary } from './attention.ts'
export { interventionMetrics, metricRow, outcomeMetrics, workInterventions } from './metrics.ts'
export { outcomeSubject, parseAttentionPages, parseOutcomes, parseWorkRecords } from './subject.ts'
export { renderMarkdown, renderTerminal, safeText } from './report.ts'
export { metricRowKey, observedOutcomeCount, toInsightConsumerView } from './facing.ts'
export type { ConsumerViewOptions, InsightConsumerMetric, InsightConsumerView } from './facing.ts'
