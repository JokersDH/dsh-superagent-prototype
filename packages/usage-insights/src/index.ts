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
export { analyzeUsageInsights, recordUnits, summarize, UsageInsightsFault } from './analyze.ts'
export { composeUsageInsightsInput, CompositionFault } from './node-composition.ts'
export type {
  AuthorizedReadsPort,
  AuthorizedWorkRef,
  ComposedInsightInput,
  CompositionIssue,
  CompositionRequest,
} from './node-composition.ts'
export { compareBaseline } from './baseline.ts'
export { attentionSummary } from './attention.ts'
export { interventionMetrics, metricRow, outcomeMetrics, workInterventions } from './metrics.ts'
export { outcomeSubject, parseAttentionPages, parseOutcomes, parseWorkRecords } from './subject.ts'
export { renderMarkdown, renderTerminal, safeText } from './report.ts'
export {
  EXPORT_DEFAULT_MAX_BYTES, EXPORT_DEFAULT_MAX_ROWS, EXPORT_PROTOCOL, ExportDocumentSchema, ExportFault, ExportRowSchema,
  SNAPSHOT_CONTINUITY, SNAPSHOT_PROTOCOL, SnapshotBlockSchema, buildInsightExport, exportDigest, previousSnapshotOf,
  serializeBounded, snapshotBlock,
} from './export.ts'
export type {
  ExportDocument, ExportOptions, ExportRow, PreviousSnapshot, SnapshotBlock, SnapshotContinuity, TruncationBlock,
} from './export.ts'
export {
  DISPLAY_EXPORT_PROTOCOL, DisplayExportDocumentSchema, DisplayExportFault, DisplayExportRowSchema,
  buildDisplayExport, displayExportDigest,
} from './display-export.ts'
export type { DisplayExportDocument, DisplayExportOptions, DisplayExportRow } from './display-export.ts'
export {
  CROSS_CHECK_ABSOLUTE_TOLERANCE, CROSS_CHECK_PROTOCOL, CrossCheckFault, crossCheckAnalysisWithDisplay, expectedDisplayId,
} from './crosscheck.ts'
export type { CrossCheckDisagreement, CrossCheckDisagreementKind, CrossCheckResult } from './crosscheck.ts'
export {
  SUPPORT_SUMMARY_PROTOCOL, SupportFault, buildSupportReport, describeDisplayDocument, renderSupportReport, renderSupportSummary,
} from './support.ts'
export type { SupportEvidence, SupportOrigin, SupportReport, SupportRow, SupportSummary } from './support.ts'
export {
  SUPPORT_DTO_PROTOCOL, SUPPORT_FILE_MAX_BYTES, SUPPORT_FILE_PROTOCOL, SupportPortFault, buildSupportFile,
  SupportReportSchema, createSupportHandler, originFromManifest, readSupportDocument, readSupportFile, supportLabels,
} from './support-port.ts'
export type {
  SupportConservation, SupportDigestCheck, SupportDocumentRead, SupportFile, SupportOriginTrigger,
} from './support-port.ts'
export {
  consumerAdmission, consumerLayer, consumerScope, formatMetricValue, metricRowKey, metricUnitLabel,
  observedOutcomeCount, rowCoverageMeaning, rowSemantics, toInsightConsumerView,
} from './facing.ts'
export type {
  ConsumerViewOptions, InsightConsumerLayer, InsightConsumerMetric, InsightConsumerScope, InsightConsumerView, RowSemantics,
} from './facing.ts'
