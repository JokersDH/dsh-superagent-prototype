export {
  ContextGrantSchema,
  ContextRequestSchema,
  ContextBudgetSchema,
  ContextSourceKindSchema,
  ContextPurposeSchema,
  ContextGatewaySchema,
  ContextOmissionReasonSchema,
  DEFAULT_CONTEXT_BUDGET,
} from './types.ts'
export type {
  ContextBudget,
  ContextBundle,
  ContextGateway,
  ContextGrant,
  ContextInjectionFlag,
  ContextMediaType,
  ContextOmission,
  ContextOmissionReason,
  ContextPurpose,
  ContextReadPort,
  ContextRequest,
  ContextSlice,
  ContextSourceBaseline,
  ContextSourceDescriptor,
  ContextSourceKind,
  ContextValidation,
  ContextWorkDescriptor,
  ResolvedContextBudget,
} from './types.ts'
export { ContextError, ContextSourceAccessError } from './errors.ts'
export type { ContextErrorCode, ContextSourceFailure } from './errors.ts'
export { ContextReader } from './reader.ts'
export type { ContextReaderOptions } from './reader.ts'
export { StaticContextPort } from './static-port.ts'
export type { StaticContextPortOptions, StaticContextSource } from './static-port.ts'
export { CompositeContextPort } from './composite-port.ts'
export { LocalProjectSourcePort } from './local-port.ts'
export { ReadIndexContextPort } from './read-index-port.ts'
export type {
  ContextDecisionSource,
  ReadIndexContextPortOptions,
  ReadIndexProjectView,
  ReadIndexWorkView,
  WorkspaceReadIndex,
} from './read-index-port.ts'
export {
  ContextComposer,
  COMPOSITION_BUDGET_CEILINGS,
  DEFAULT_COMPOSED_GROUPS,
  authorizeComposition,
  buildCompositionPreview,
  buildSourceManifest,
  compareSourceManifests,
  validateComposedGroups,
} from './composer.ts'
export type {
  ComposedSourceManifest,
  ComposedSourceManifestBudget,
  ComposedSourceManifestCoverage,
  ComposedSourceManifestEntry,
  ComposedSourceManifestSelection,
  SourceManifestChange,
  SourceManifestChangeReason,
  SourceManifestComparison,
  CompositionAuthorization,
  ResolvedCompositionBudget,
} from './composer.ts'
export type {
  ComposedArtifactProvider,
  ComposedArtifactView,
  ComposedConversationMessage,
  ComposedConversationProvider,
  ComposedDecisionProvider,
  ComposedDecisionView,
  ComposedGroupName,
  ComposedGroupPlan,
  ComposedGroupResult,
  ContextComposerOptions,
  ContextComposerSources,
  ContextComposition,
  ContextCompositionRequest,
} from './composer.ts'
export {
  createPublishedArtifactProvider,
  createScopedConversationProvider,
} from './scoped-adapters.ts'
export type {
  ArtifactAdapterCoverage,
  ConversationAdapterCoverage,
  ConversationSelection,
  PublishedArtifactSelection,
  ScopedAdapterError,
  ScopedArtifactLookup,
  ScopedArtifactMetadata,
  ScopedArtifactProvider,
  ScopedConversationMessageView,
  ScopedConversationPage,
  ScopedConversationProvider,
  ScopedConversationReader,
} from './scoped-adapters.ts'
export { PROMPT_DATA_CEILINGS, projectPromptData } from './prompt-data.ts'
export type {
  PromptDataBudget,
  PromptDataHardCeilings,
  PromptDataOmission,
  PromptDataProjection,
  PromptDataSourceReference,
} from './prompt-data.ts'
export { collectContextHistory } from './history.ts'
export type {
  HistoryCompletedReply,
  HistoryEntry,
  HistoryEntrySource,
  HistoryEntryState,
  HistoryOmission,
  HistoryView,
  HistoryViewOptions,
} from './history.ts'
export {
  RELEVANCE_CEILINGS,
  RELEVANCE_DEFAULTS,
  createConversationRelevanceCandidates,
  createDecisionRelevanceCandidates,
  createReadIndexWorkCandidates,
  selectRelevantSources,
} from './relevance.ts'
export type {
  RelevanceBudget,
  RelevanceCandidate,
  RelevanceCandidateBatch,
  RelevanceItem,
  RelevanceOmission,
  RelevanceOmissionReason,
  RelevanceSelection,
  RelevanceSelectionOptions,
} from './relevance.ts'
export {
  SOURCE_REVIEW_CEILINGS,
  SOURCE_REVIEW_DEFAULTS,
  projectSourceReview,
} from './source-review.ts'
export type {
  SourceReviewBudget,
  SourceReviewCategory,
  SourceReviewCeilings,
  SourceReviewItem,
  SourceReviewOmission,
  SourceReviewProjection,
  SourceReviewSuppressed,
} from './source-review.ts'
export { buildContextPreview } from './preview.ts'
export type { ContextPreview, ContextPreviewFile } from './preview.ts'
export type { LocalProjectSourcePortOptions } from './local-port.ts'
export { authorizeContextRequest, sourceAllowedByGrant } from './authorization.ts'
export { detectInjectionPatterns } from './injection.ts'
export { estimateTokens, queryTerms, relevanceScore } from './tokens.ts'
export { isDeniedPath, isExternalReference, pathWithin, scopeWithin } from './paths.ts'
export { sha256Bytes, sha256Text } from './digest.ts'
export { explainRestoredReviewScope } from './restored-review.ts'
export type { RestoredScopeReason, RestoredScopeReview, RestoredScopeReviewInput } from './restored-review.ts'
