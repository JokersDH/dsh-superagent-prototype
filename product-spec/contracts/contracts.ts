/** Design-only contracts. WP-00 freezes runtime schemas before parallel implementation. */
export type Id = string;
export type Digest = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type EvidenceRef = string;
export type TestStatus = 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_TESTED';
export type ContractRef = { workId: Id; revision: number; digest: Digest };
export type Scope = {
  projectId: Id;
  allowedPaths: readonly string[];
  excludedPaths: readonly string[];
  externalActions: readonly string[];
  expiresAt?: string;
};
export type Criterion = {
  id: Id;
  description: string;
  kind: 'machine' | 'human';
  required: boolean;
  checkDefinitionRef?: Id;
};
/** Runtime schema: at least one meaningful required criterion; required machine checks need a registered definition. */
export type RequiredCriteria = readonly [Criterion, ...Criterion[]];
export type ContractRevision = ContractRef & {
  goal: string;
  scope: Scope;
  criteria: RequiredCriteria;
  authorityRef: Id;
  createdAt: string;
};
export type WorkRecord = {
  id: Id;
  projectId: Id;
  conversationId: Id;
  title: string;
  createdAt: string;
};
export type TicketLink = { contract: ContractRef; ticketId: Id; role: 'primary' | 'child'; authorityRef: Id };
export type AttemptRef = {
  ticketId: Id;
  assignmentId: Id;
  attemptId: Id;
  fenceEpoch: number;
  contract: ContractRef;
};
export type AssignmentRef = { ticketId: Id; assignmentId: Id; contract: ContractRef };
export type Ownership = 'spawned_process' | 'shared_service_session';
export type RuntimeReference = AttemptRef & {
  ownership: Ownership;
  runnerIdentityRef: Id;
  connectionEpoch: number;
  nativeSessionRef?: string;
  nativeRunRef?: string;
  journalRef?: Id;
};
export type WorkView = {
  work: WorkRecord;
  contract: ContractRevision;
  links: readonly TicketLink[];
  /** Derived only. Never persisted as a second authoritative execution state. */
  phase: 'evaluating' | 'queued' | 'working' | 'needs_user' | 'verifying' | 'switching' | 'stopping' | 'delivered' | 'ended' | 'uncertain';
  coreSnapshotRef: Id;
  openQuestionIds: readonly Id[];
  artifactIds: readonly Id[];
  resourceStatus: 'quiescent' | 'active' | 'indeterminate';
  evidenceRefs: readonly EvidenceRef[];
  actions: {
    dispatchHold: { paused: boolean; revision: number };
    currentAssignment?: AssignmentRef;
    currentCandidate?: CandidateRef;
    currentVerificationId?: Id;
    retryActionToken?: Id;
    available: readonly ('pause_dispatch' | 'resume_dispatch' | 'retry_assignment' | 'continue_work' | 'stop_work' | 'accept_candidate')[];
  };
};
export type CapabilityObservation = {
  feature: string;
  advertised: Json;
  observed: Json;
  test: TestStatus;
  policy: 'allowed' | 'blocked' | 'requires_review';
  evidenceRefs: readonly EvidenceRef[];
};
export type AgentProfile = {
  id: Id;
  revision: number;
  driverId: string;
  driverApiMajor: 1;
  driverRelease: string;
  executable: string;
  argv: readonly string[];
  expectedVersion: string;
  nativeConfigRef: Id;
  permissionPolicyRevision: Id;
  credentialReference?: Id;
  requiredFeatures: readonly string[];
};
export type CompatibilityIdentity = {
  profileId: Id;
  profileRevision: number;
  executableDigest: Digest;
  nativeVersion: string;
  driverRelease: string;
  driverApiMajor: 1;
  sdkVersion?: string;
  sdkEntrypoint?: string;
  wireVersion: string;
  schemaDigest: Digest;
  resolvedConfigFingerprint: Digest;
  permissionPolicyRevision: Id;
  configStability: 'frozen' | 'watched' | 'unverified';
  platform: string;
  architecture: string;
  runtimeVersion: string;
};
export type ProbeReport = {
  identity?: CompatibilityIdentity;
  capabilities: readonly CapabilityObservation[];
  readiness: 'missing' | 'needs_setup' | 'needs_auth' | 'incompatible' | 'inspection_passed' | 'native_test_passed';
  checkedAt: string;
  evidenceRefs: readonly EvidenceRef[];
};
export type PreparedExecutionPolicy = AttemptRef & {
  requestedPolicyRevision: Id;
  nativeAppliedSettingsRef: Id;
  effectiveConfigFingerprint: Digest;
  enforcement: 'enforced' | 'approval_guarded' | 'advisory';
  verification: 'passed' | 'failed' | 'not_tested';
  evidenceRef: EvidenceRef;
};
export type AttemptSpec = AttemptRef & {
  profile: AgentProfile;
  workspaceRef: Id;
  resourceLeaseRef: Id;
  policySnapshotRef: Id;
  budgetRef: Id;
};
export type RunnerCommand = AttemptRef & { id: Id } & (
  | { kind: 'begin'; inputRef: Id; preparedPolicyRef: Id }
  | { kind: 'deliver'; inputRef: Id; expectedTurnRef?: Id }
  | { kind: 'answer'; nativeBindingRef: Id; answerRef: Id }
  | { kind: 'cancel' }
  | { kind: 'pause_at_boundary' }
);
export type RuntimeFactKind =
  | 'policy.prepared' | 'dispatch.observed' | 'question.opened' | 'answer.observed'
  | 'turn.ended' | 'candidate.observed' | 'cancel.observed' | 'writer.observed'
  | 'runtime.exited' | 'config.changed' | 'usage.observed' | 'runtime.error';
export type CriticalFact = AttemptRef & {
  factId: Id;
  source: string;
  kind: RuntimeFactKind;
  nativeRef?: string;
  payloadRef: Id;
};
export type DurableReceipt = { factId: Id; persisted: true; seq: number };
export type ProgressUpdate = AttemptRef & { text: string; observedAt: string };
export type DriverErrorCode =
  | 'executable_missing' | 'version_mismatch' | 'auth_required' | 'unsupported_capability'
  | 'protocol_error' | 'rate_limited' | 'transport_lost' | 'process_exited'
  | 'budget_exceeded' | 'state_indeterminate';
export type NativeDispatch = {
  commandId: Id;
  delivery: 'not_sent' | 'written' | 'native_accepted' | 'indeterminate';
  retry: 'same_key_safe' | 'reconcile_first' | 'user_action' | 'none';
  nativeRef?: string;
  error?: { code: DriverErrorCode; message: string };
  evidenceRefs: readonly EvidenceRef[];
};
export type ProcessSpec = { executable: string; argv: readonly string[]; cwdRef: Id; environmentRef: Id };
export interface OwnedProcessHost {
  spawn(spec: ProcessSpec): Promise<{
    resourceRef: Id;
    stdout: AsyncIterable<Uint8Array>;
    stderr: AsyncIterable<Uint8Array>;
    exited: Promise<{ code: number | null; signal: string | null }>;
  }>;
  write(resourceRef: Id, frame: Uint8Array): Promise<void>;
  stopOwned(resourceRef: Id, deadlineMs: number): Promise<{ quiescence: 'confirmed' | 'indeterminate'; evidenceRefs: readonly EvidenceRef[] }>;
}
export interface ProbeHost {
  inspectExecutable(profile: AgentProfile): Promise<{ version: string; digest: Digest; evidenceRef: EvidenceRef }>;
  inspectConfig(reference: Id): Promise<{ fingerprint: Digest; stability: 'frozen' | 'watched' | 'unverified' }>;
}
export interface RecoveryHost {
  readJournal(reference: Id): Promise<readonly CriticalFact[]>;
  inspectRuntime(reference: RuntimeReference): Promise<ReconcileReport>;
}
export type ReconcileReport = {
  status: 'running' | 'terminal' | 'missing' | 'indeterminate';
  writer: 'active' | 'quiescent' | 'indeterminate';
  nativeCursor?: string;
  evidenceRefs: readonly EvidenceRef[];
};
export type ServeExit = { reason: 'terminal' | 'cancelled' | 'disconnected' | 'error'; evidenceRefs: readonly EvidenceRef[] };
export type AttemptIO = {
  commands: AsyncIterable<RunnerCommand>;
  record(fact: CriticalFact): Promise<DurableReceipt>;
  publishProgress(update: ProgressUpdate): void;
  runtime: OwnedProcessHost;
  /** Host permits only references scoped to this attempt; secret values never enter payload storage. */
  payloads: {
    read(reference: Id): Promise<Json>;
    store(payload: Json, classification: 'critical' | 'diagnostic'): Promise<Id>;
  };
};
export interface AgentDriverV1 {
  inspect(profile: AgentProfile, host: ProbeHost): Promise<ProbeReport>;
  serve(spec: AttemptSpec, io: AttemptIO): Promise<ServeExit>;
  reconcile(ref: RuntimeReference, host: RecoveryHost): Promise<ReconcileReport>;
}
export type WireRequestId = { kind: 'string'; value: string } | { kind: 'integer'; decimal: string };
export type NativeQuestionBinding = AttemptRef & {
  id: Id;
  connectionEpoch: number;
  /** Preserve wire type and exact integer value. Never coerce number 43 to string "43". */
  nativeRequestId: WireRequestId;
  nativeMethod: string;
  provenanceRef: Id;
};
export type QuestionOption = { id: Id; label: string; semantic: 'allow_once' | 'deny' | 'cancel' | 'business_choice' | 'native_other' };
export type QuestionField =
  | { id: Id; label: string; required: boolean; kind: 'text' | 'boolean' }
  | { id: Id; label: string; required: boolean; kind: 'single' | 'multiple'; options: readonly QuestionOption[] };
export type QuestionPresentation =
  | { kind: 'choices'; options: readonly QuestionOption[]; multiple: boolean }
  | { kind: 'form'; fields: readonly QuestionField[] }
  | { kind: 'free_text' }
  | { kind: 'url_flow'; vettedUrl: string; purpose: string; statusRef: Id }
  | { kind: 'review'; summary: string; options: readonly QuestionOption[] };
export type QuestionAnswer =
  | { kind: 'choices'; optionIds: readonly Id[] }
  | { kind: 'form'; values: Readonly<Record<Id, string | boolean | readonly string[]>> }
  | { kind: 'free_text'; text: string }
  | { kind: 'url_action'; action: 'open' | 'cancel' }
  | { kind: 'defer' };
export type UserQuestion = {
  id: Id;
  version: number;
  kind: 'clarification' | 'permission' | 'authentication' | 'review';
  contract: ContractRef;
  scope: Scope;
  decisionKey?: string;
  prompt: string;
  nativePayloadRef: Id;
  presentation: QuestionPresentation;
  targets: readonly NativeQuestionBinding[];
  openedAt: string;
  expiresAt?: string;
  decisionDeadline?: string;
  validity: 'open' | 'answered' | 'expired' | 'cancelled';
};
export type AnswerDelivery = {
  answerId: Id;
  targetBindingId: Id;
  status: 'local_recorded' | 'response_written' | 'native_applied' | 'indeterminate' | 'expired';
  evidenceRefs: readonly EvidenceRef[];
};
export type CandidateRef = {
  ticketId: Id;
  assignmentId: Id;
  contract: ContractRef;
  candidateGeneration: number;
};
export type Verification = CandidateRef & {
  id: Id;
  artifactDigest: Digest;
  criteriaDigest: Digest;
  environmentRef: Id;
  results: readonly { criterionId: Id; outcome: TestStatus | 'NOT_APPLICABLE'; evidenceRefs: readonly EvidenceRef[] }[];
  verifierIdentityRef: Id;
};
export type CompletionProposal = CandidateRef & {
  verificationId: Id;
  artifactDigest: Digest;
  humanAcceptanceRef?: Id;
};
export type UserDecision = {
  id: Id;
  version: number;
  content: string;
  scope: Scope;
  authorityRef: Id;
  supersedes?: Id;
  revokedAt?: string;
};
export type InterventionRecord = {
  id: Id;
  workId?: Id;
  projectId: Id;
  ticketRefs: readonly Id[];
  assignmentRefs: readonly Id[];
  actorRef: Id;
  source: 'direct_message' | 'question_answer' | 'manual_edit' | 'explicit_override';
  beforeContractRef?: ContractRef;
  afterContractRef?: ContractRef;
  beforeArtifactRef?: Id;
  afterArtifactRef?: Id;
  environmentRef: Id;
  rawFeedbackRef: Id;
  occurredAt: string;
};
export type Interpretation = {
  id: Id;
  interventionId: Id;
  revision: number;
  labels: readonly ('execution_violation' | 'goal_change' | 'temporary_environment' | 'explicit_preference' | 'mixed' | 'unknown')[];
  evidenceRefs: readonly EvidenceRef[];
  hypothesisRef: Id;
};
export type PolicyRevision = {
  id: Id;
  revision: number;
  scope: Scope;
  sourceRefs: readonly Id[];
  requiredFeatures: readonly string[];
  experimentRefs: readonly Id[];
  deployment: 'candidate' | 'testing' | 'shadow' | 'active' | 'suspended' | 'revoked' | 'rejected';
  contentRef: Id;
};
export type ReplyAnchor = { workId?: Id; questionId?: Id; messageId?: Id };
export type ConversationMessage = {
  id: Id;
  conversationId: Id;
  sequence: number;
  role: 'user' | 'assistant' | 'system';
  projectId?: Id;
  selectedProfileId?: Id;
  anchor?: ReplyAnchor;
  provenance: 'trusted_user' | 'reasoner_reply' | 'question_answer_display' | 'application_notice';
  text: string;
  sourceRefs: readonly Id[];
  createdAt: string;
};
export type ConversationPage = { conversationId: Id; messages: readonly ConversationMessage[]; beforeCursor?: number; hasMore: boolean };
export type LearningView = { globallyPaused: boolean; policies: readonly PolicyRevision[] };
export type KnowledgeSourceView = { id: Id; title: string; projectId: Id; locationRef: Id; validity: 'current' | 'stale' | 'missing'; evidenceRefs: readonly EvidenceRef[] };
export type KnowledgePage = { decisions: readonly UserDecision[]; sources: readonly KnowledgeSourceView[]; nextCursor?: string };
export type UserCommand = { commandId: Id; conversationId: Id } & (
  | { kind: 'chat'; text: string; projectId: Id; selectedProfileId?: Id; anchor?: ReplyAnchor }
  | { kind: 'create_work'; projectId: Id; goal: string; scope: Scope; criteria: RequiredCriteria; profileId: Id }
  | { kind: 'revise_work'; expected: ContractRef; goal: string; scope: Scope; criteria: RequiredCriteria }
  | { kind: 'stop_work'; workId: Id }
  | { kind: 'pause_dispatch'; expected: ContractRef; expectedHoldRevision: number }
  | { kind: 'resume_dispatch'; expected: ContractRef; expectedHoldRevision: number }
  | { kind: 'retry_assignment'; expected: AssignmentRef; actionToken: Id }
  | { kind: 'continue_work'; expected: ContractRef }
  | { kind: 'answer_question'; questionId: Id; expectedVersion: number; answer: QuestionAnswer }
  | { kind: 'accept_candidate'; candidate: CandidateRef }
  | { kind: 'record_decision'; content: string; scope: Scope; sourceMessageId: Id }
  | { kind: 'revoke_decision'; decisionId: Id; expectedVersion: number }
  | { kind: 'set_learning_paused'; paused: boolean }
  | { kind: 'control_policy'; policyId: Id; expectedRevision: number; action: 'suspend' | 'revoke' | 'request_evaluation' }
);
/** Created at the authenticated entry point; never trusted from UserCommand JSON. */
export type TrustedActor = { userId: Id; authorityRef: Id; source: 'local_ui' | 'local_cli' | 'explicit_rule' };
export type CommandReceipt = { commandId: Id; status: 'recorded' | 'rejected'; workId?: Id; entityRefs?: { decisionId?: Id; policyId?: Id; questionId?: Id }; seq: number; error?: AppError };
export type AppError = { code: string; message: string; retry: 'safe' | 'reconcile' | 'user_action' | 'none'; evidenceRef?: EvidenceRef };
export type Snapshot = { cursor: number; works: readonly WorkView[]; questions: readonly UserQuestion[]; conversation?: ConversationPage; learning?: LearningView; knowledge?: KnowledgePage };
export type Change = { seq: number; topic: string; entityRef: Id; payload: Json };
export interface ApplicationService {
  dispatch(command: UserCommand, actor: TrustedActor): Promise<CommandReceipt>;
  inspect(query: { workId?: Id; conversationId?: Id; beforeMessageCursor?: number; limit?: number; includeLearning?: boolean; knowledgeProjectId?: Id; knowledgeCursor?: string }): Promise<Snapshot>;
  changes(after: number): AsyncIterable<Change>;
}
export type ReasonerProposal =
  | { kind: 'reply'; text: string; sourceRefs: readonly Id[] }
  | { kind: 'propose_work'; goal: string; projectId: Id; sourceMessageId: Id }
  | { kind: 'propose_revision'; expected: ContractRef; rationale: string; sourceMessageId: Id }
  | { kind: 'propose_decision'; content: string; scope: Scope; sourceMessageId: Id };
