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
  validateComposedGroups,
} from './composer.ts'
export type {
  ComposedSourceManifest,
  ComposedSourceManifestEntry,
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
export { buildContextPreview } from './preview.ts'
export type { ContextPreview, ContextPreviewFile } from './preview.ts'
export type { LocalProjectSourcePortOptions } from './local-port.ts'
export { authorizeContextRequest, sourceAllowedByGrant } from './authorization.ts'
export { detectInjectionPatterns } from './injection.ts'
export { estimateTokens, queryTerms, relevanceScore } from './tokens.ts'
export { isDeniedPath, isExternalReference, pathWithin, scopeWithin } from './paths.ts'
export { sha256Bytes, sha256Text } from './digest.ts'
export { createScopedConversationProvider, createPublishedArtifactProvider } from './scoped-adapters.ts'
export type {
  ScopedConversationMessageView, ScopedConversationPage, ScopedConversationReader, ConversationSelection,
  ConversationAdapterCoverage, ScopedConversationProvider, ScopedArtifactMetadata, ScopedArtifactLookup,
  PublishedArtifactSelection, ArtifactAdapterCoverage, ScopedArtifactProvider,
} from './scoped-adapters.ts'
