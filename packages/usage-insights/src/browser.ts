/**
 * Browser-safe entry point.
 *
 * The analysis pipeline needs Node's `crypto` for canonical digests and reads files, so a browser
 * bundle must never import the package root. This entry exposes exactly the presentation surface the
 * workspace needs — the declared protocol types, the compact projection and the admission mirror —
 * and nothing that touches `node:` builtins, the filesystem or a credential.
 *
 * Consumers in a browser should receive an already-produced `UsageInsightsSummary` (from main's
 * authorized Node read path) and call `toInsightConsumerView` / `consumerAdmission` on it.
 */
export {
  AppliedLimitsSchema,
  AttentionSummarySchema,
  BaselineComparisonSchema,
  CoverageBlockSchema,
  InsightWindowSchema,
  METRIC_DEFINITIONS,
  MetricRowSchema,
  OperatorBaselineSchema,
  ProjectSummarySchema,
  QuarantineDigestSchema,
  SourceLossesSchema,
  SubjectRowSchema,
  UsageInsightsAnalysisSchema,
  UsageInsightsInputSchema,
  UsageInsightsSummarySchema,
  USAGE_INSIGHTS_COMPATIBILITY,
} from './protocol.ts'
export type {
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
  ProjectSummary,
  QuarantineDigest,
  QuarantineEntry,
  SourceLoss,
  SourceLosses,
  SubjectRow,
  UsageCompleteness,
  UsageInsightsAnalysis,
  UsageInsightsInput,
  UsageInsightsSummary,
} from './protocol.ts'
export { consumerAdmission, consumerLayer, consumerScope, metricRowKey, observedOutcomeCount, toInsightConsumerView } from './facing.ts'
export type {
  ConsumerViewOptions,
  InsightConsumerLayer,
  InsightConsumerMetric,
  InsightConsumerScope,
  InsightConsumerView,
} from './facing.ts'
