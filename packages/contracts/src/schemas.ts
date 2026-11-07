import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0' as const;
export const CONTRACT_API_MAJOR = 1 as const;

const text = (max = 4096) => z.string().min(1).max(max).refine(value => value.trim().length > 0, 'Text must not be blank');
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = count.min(1);
const list = <T extends z.ZodType>(item: T, max = 1024) => z.array(item).max(max).readonly();
const uniqueBy = <T>(items: readonly T[], key: (item: T) => string) => new Set(items.map(key)).size === items.length;
const relativePath = text(1024).refine(value => !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.includes('\\') && !value.includes('\0') && !value.split('/').includes('..'), 'Path must be project-relative without parent traversal');

export const IdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const EvidenceRefSchema = IdSchema.clone();
export const JsonSchema = z.json();
export const TimestampSchema = z.iso.datetime({ offset: false });
export const TestStatusSchema = z.enum(['PASS', 'FAIL', 'SKIPPED', 'NOT_TESTED']);
const uniqueIds = z.array(IdSchema).max(1024).refine(values => uniqueBy(values, value => value), 'IDs must be unique').readonly().meta({ uniqueItems: true });

export const ContractRefSchema = z.strictObject({ workId: IdSchema, revision: positive, digest: DigestSchema });
export const ScopeSchema = z.strictObject({
  projectId: IdSchema,
  allowedPaths: z.array(relativePath).min(1).max(256).readonly(),
  excludedPaths: list(relativePath, 256),
  externalActions: uniqueIds,
  expiresAt: TimestampSchema.optional(),
}).meta({ 'x-runtime-rules': ['project-relative-paths'] });
export const CriterionSchema = z.union([
  z.strictObject({ id: IdSchema, description: text(), kind: z.literal('machine'), required: z.literal(true), checkDefinitionRef: IdSchema }),
  z.strictObject({ id: IdSchema, description: text(), kind: z.literal('machine'), required: z.literal(false), checkDefinitionRef: IdSchema.optional() }),
  z.strictObject({ id: IdSchema, description: text(), kind: z.literal('human'), required: z.boolean() }),
]);
export const RequiredCriteriaSchema = z.array(CriterionSchema).min(1).max(128)
  .refine(items => items.some(item => item.required), 'At least one required criterion is necessary')
  .refine(items => uniqueBy(items, item => item.id), 'Criterion IDs must be unique').readonly()
  .meta({ contains: { type: 'object', properties: { required: { const: true } }, required: ['required'] }, minContains: 1, 'x-runtime-rules': ['unique-criterion-ids', 'registered-checks-verified-by-application'] });
export const ContractRevisionSchema = ContractRefSchema.extend({ goal: text(16384), scope: ScopeSchema, criteria: RequiredCriteriaSchema, authorityRef: IdSchema, createdAt: TimestampSchema });
export const WorkRecordSchema = z.strictObject({ id: IdSchema, projectId: IdSchema, conversationId: IdSchema, title: text(512), createdAt: TimestampSchema });
export const TicketLinkSchema = z.strictObject({ contract: ContractRefSchema, ticketId: IdSchema, role: z.enum(['primary', 'child']), authorityRef: IdSchema });
export const AssignmentRefSchema = z.strictObject({ ticketId: IdSchema, assignmentId: IdSchema, contract: ContractRefSchema });
export const AttemptRefSchema = AssignmentRefSchema.extend({ attemptId: IdSchema, fenceEpoch: positive });
export const OwnershipSchema = z.enum(['spawned_process', 'shared_service_session']);
export const RuntimeReferenceSchema = AttemptRefSchema.extend({ ownership: OwnershipSchema, runnerIdentityRef: IdSchema, connectionEpoch: positive, nativeSessionRef: text(1024).optional(), nativeRunRef: text(1024).optional(), journalRef: IdSchema.optional() });
export const CandidateRefSchema = AssignmentRefSchema.extend({ candidateGeneration: positive });
export const WorkViewSchema = z.strictObject({
  work: WorkRecordSchema, contract: ContractRevisionSchema, links: list(TicketLinkSchema),
  phase: z.enum(['evaluating', 'queued', 'working', 'needs_user', 'verifying', 'switching', 'stopping', 'delivered', 'ended', 'uncertain']),
  coreSnapshotRef: IdSchema, openQuestionIds: uniqueIds, artifactIds: uniqueIds,
  resourceStatus: z.enum(['quiescent', 'active', 'indeterminate']), evidenceRefs: uniqueIds,
  actions: z.strictObject({
    dispatchHold: z.strictObject({ paused: z.boolean(), revision: count }),
    currentAssignment: AssignmentRefSchema.optional(), currentCandidate: CandidateRefSchema.optional(),
    currentVerificationId: IdSchema.optional(), retryActionToken: IdSchema.optional(),
    available: z.array(z.enum(['pause_dispatch', 'resume_dispatch', 'retry_assignment', 'continue_work', 'stop_work', 'accept_candidate'])).max(6).readonly(),
  }),
}).superRefine((value, ctx) => {
  if (value.work.id !== value.contract.workId || value.work.projectId !== value.contract.scope.projectId) ctx.addIssue({ code: 'custom', message: 'Work and contract identities must agree' });
  const { actions } = value;
  for (const ref of [actions.currentAssignment, actions.currentCandidate]) {
    if (ref && !sameContract(ref.contract, value.contract)) ctx.addIssue({ code: 'custom', message: 'Action context must reference the current contract' });
  }
  if (actions.currentCandidate && (!actions.currentAssignment || actions.currentAssignment.ticketId !== actions.currentCandidate.ticketId || actions.currentAssignment.assignmentId !== actions.currentCandidate.assignmentId)) ctx.addIssue({ code: 'custom', message: 'Candidate must belong to the current assignment' });
  if (actions.available.includes('retry_assignment') && (!actions.currentAssignment || !actions.retryActionToken)) ctx.addIssue({ code: 'custom', message: 'Retry needs an assignment and action token' });
  if (actions.available.includes('accept_candidate') && (!actions.currentCandidate || !actions.currentVerificationId)) ctx.addIssue({ code: 'custom', message: 'Acceptance needs a candidate and verification' });
}).meta({ 'x-runtime-rules': ['current-work-contract-action-context'] });

export const CapabilityObservationSchema = z.strictObject({ feature: IdSchema, advertised: JsonSchema, observed: JsonSchema, test: TestStatusSchema, policy: z.enum(['allowed', 'blocked', 'requires_review']), evidenceRefs: uniqueIds })
  .refine(value => value.test !== 'PASS' || value.evidenceRefs.length > 0, 'A passing observation needs evidence');
export const AgentProfileSchema = z.strictObject({
  id: IdSchema, revision: positive, driverId: IdSchema, driverApiMajor: z.literal(1), driverRelease: text(128),
  executable: text(4096).refine(value => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), 'Executable must be an absolute trusted path'),
  argv: list(z.string().max(4096).refine(value => !value.includes('\0'), 'Argument cannot contain NUL'), 128),
  expectedVersion: text(128), nativeConfigRef: IdSchema, permissionPolicyRevision: IdSchema,
  credentialReference: IdSchema.optional(), requiredFeatures: uniqueIds,
});
export const CompatibilityIdentitySchema = z.strictObject({
  profileId: IdSchema, profileRevision: positive, executableDigest: DigestSchema, nativeVersion: text(128),
  driverRelease: text(128), driverApiMajor: z.literal(1), sdkVersion: text(128).optional(), sdkEntrypoint: text(256).optional(),
  wireVersion: text(128), schemaDigest: DigestSchema, resolvedConfigFingerprint: DigestSchema, permissionPolicyRevision: IdSchema,
  configStability: z.enum(['frozen', 'watched', 'unverified']), platform: text(64), architecture: text(64), runtimeVersion: text(128),
});
export const ProbeReportSchema = z.strictObject({ identity: CompatibilityIdentitySchema.optional(), capabilities: list(CapabilityObservationSchema), readiness: z.enum(['missing', 'needs_setup', 'needs_auth', 'incompatible', 'inspection_passed', 'native_test_passed']), checkedAt: TimestampSchema, evidenceRefs: uniqueIds })
  .refine(value => !['inspection_passed', 'native_test_passed'].includes(value.readiness) || value.identity !== undefined, 'Successful inspection needs a compatibility identity');
export const PreparedExecutionPolicySchema = AttemptRefSchema.extend({ requestedPolicyRevision: IdSchema, nativeAppliedSettingsRef: IdSchema, effectiveConfigFingerprint: DigestSchema, enforcement: z.enum(['enforced', 'approval_guarded', 'advisory']), verification: z.enum(['passed', 'failed', 'not_tested']), evidenceRef: EvidenceRefSchema });
export const AttemptSpecSchema = AttemptRefSchema.extend({ profile: AgentProfileSchema, workspaceRef: IdSchema, resourceLeaseRef: IdSchema, policySnapshotRef: IdSchema, budgetRef: IdSchema });
const runnerBase = AttemptRefSchema.extend({ id: IdSchema });
export const RunnerCommandSchema = z.discriminatedUnion('kind', [
  runnerBase.extend({ kind: z.literal('begin'), inputRef: IdSchema, preparedPolicyRef: IdSchema }),
  runnerBase.extend({ kind: z.literal('deliver'), inputRef: IdSchema, expectedTurnRef: IdSchema.optional() }),
  runnerBase.extend({ kind: z.literal('answer'), nativeBindingRef: IdSchema, answerRef: IdSchema }),
  runnerBase.extend({ kind: z.literal('cancel') }),
  runnerBase.extend({ kind: z.literal('pause_at_boundary') }),
]);
export const RuntimeFactKindSchema = z.enum(['policy.prepared', 'dispatch.observed', 'question.opened', 'answer.observed', 'turn.ended', 'candidate.observed', 'cancel.observed', 'writer.observed', 'runtime.exited', 'config.changed', 'usage.observed', 'runtime.error']);
export const CriticalFactSchema = AttemptRefSchema.extend({ factId: IdSchema, source: IdSchema, kind: RuntimeFactKindSchema, nativeRef: text(1024).optional(), payloadRef: IdSchema });
export const DurableReceiptSchema = z.strictObject({ factId: IdSchema, persisted: z.literal(true), seq: positive });
export const ProgressUpdateSchema = AttemptRefSchema.extend({ text: z.string().max(8192), observedAt: TimestampSchema });
export const DriverErrorCodeSchema = z.enum(['executable_missing', 'version_mismatch', 'auth_required', 'unsupported_capability', 'protocol_error', 'rate_limited', 'transport_lost', 'process_exited', 'budget_exceeded', 'state_indeterminate']);
export const NativeDispatchSchema = z.strictObject({ commandId: IdSchema, delivery: z.enum(['not_sent', 'written', 'native_accepted', 'indeterminate']), retry: z.enum(['same_key_safe', 'reconcile_first', 'user_action', 'none']), nativeRef: text(1024).optional(), error: z.strictObject({ code: DriverErrorCodeSchema, message: text() }).optional(), evidenceRefs: uniqueIds })
  .refine(value => value.delivery !== 'indeterminate' || value.retry !== 'same_key_safe', 'An indeterminate send cannot claim safe replay').meta({ 'x-runtime-rules': ['no-safe-replay-for-indeterminate-send'] });
export const ProcessSpecSchema = z.strictObject({ executable: text(4096), argv: list(z.string().max(4096), 128), cwdRef: IdSchema, environmentRef: IdSchema });
export const ReconcileReportSchema = z.strictObject({ status: z.enum(['running', 'terminal', 'missing', 'indeterminate']), writer: z.enum(['active', 'quiescent', 'indeterminate']), nativeCursor: text(1024).optional(), evidenceRefs: uniqueIds });
export const ServeExitSchema = z.strictObject({ reason: z.enum(['terminal', 'cancelled', 'disconnected', 'error']), evidenceRefs: uniqueIds });

export const WireRequestIdSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('string'), value: z.string().max(1024) }),
  z.strictObject({ kind: z.literal('integer'), decimal: z.string().max(20).regex(/^(?:0|-?[1-9][0-9]*)$/).refine(value => { if (value.length > 20 || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) return false; const n = BigInt(value); return n >= -(2n ** 63n) && n < 2n ** 63n; }, 'Request integer must fit signed int64') }),
]);
export const NativeQuestionBindingSchema = AttemptRefSchema.extend({ id: IdSchema, connectionEpoch: positive, nativeRequestId: WireRequestIdSchema, nativeMethod: text(256), provenanceRef: IdSchema });
export const QuestionOptionSchema = z.strictObject({ id: IdSchema, label: text(512), semantic: z.enum(['allow_once', 'deny', 'cancel', 'business_choice', 'native_other']) });
const options = z.array(QuestionOptionSchema).min(1).max(128).refine(items => uniqueBy(items, item => item.id), 'Option IDs must be unique').readonly();
export const QuestionFieldSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: IdSchema, label: text(512), required: z.boolean(), kind: z.literal('text') }),
  z.strictObject({ id: IdSchema, label: text(512), required: z.boolean(), kind: z.literal('boolean') }),
  z.strictObject({ id: IdSchema, label: text(512), required: z.boolean(), kind: z.literal('single'), options }),
  z.strictObject({ id: IdSchema, label: text(512), required: z.boolean(), kind: z.literal('multiple'), options }),
]);
export const QuestionPresentationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('choices'), options, multiple: z.boolean() }),
  z.strictObject({ kind: z.literal('form'), fields: z.array(QuestionFieldSchema).min(1).max(64).refine(items => uniqueBy(items, item => item.id), 'Field IDs must be unique').readonly() }),
  z.strictObject({ kind: z.literal('free_text') }),
  z.strictObject({ kind: z.literal('url_flow'), vettedUrl: z.url().refine(value => { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }, 'URL flow needs HTTP(S) without embedded credentials'), purpose: text(), statusRef: IdSchema }),
  z.strictObject({ kind: z.literal('review'), summary: text(), options }),
]);
export const QuestionAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('choices'), optionIds: z.array(IdSchema).min(1).max(128).refine(items => uniqueBy(items, item => item), 'Answer options must be unique').readonly() }),
  z.strictObject({ kind: z.literal('form'), values: z.record(IdSchema, z.union([z.string().max(16384), z.boolean(), list(IdSchema, 128)])) }),
  z.strictObject({ kind: z.literal('free_text'), text: text(16384) }),
  z.strictObject({ kind: z.literal('url_action'), action: z.enum(['open', 'cancel']) }),
  z.strictObject({ kind: z.literal('defer') }),
]);
export const UserQuestionSchema = z.strictObject({
  id: IdSchema, version: positive, kind: z.enum(['clarification', 'permission', 'authentication', 'review']), contract: ContractRefSchema,
  scope: ScopeSchema, decisionKey: IdSchema.optional(), prompt: text(16384), nativePayloadRef: IdSchema, presentation: QuestionPresentationSchema,
  targets: z.array(NativeQuestionBindingSchema).min(1).max(128).readonly(), openedAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(), decisionDeadline: TimestampSchema.optional(), validity: z.enum(['open', 'answered', 'expired', 'cancelled']),
}).superRefine((value, ctx) => {
  if (!uniqueBy(value.targets, target => target.id)) ctx.addIssue({ code: 'custom', message: 'Target IDs must be unique' });
  if (value.targets.some(target => !sameContract(target.contract, value.contract))) ctx.addIssue({ code: 'custom', message: 'Question targets must reference its contract' });
  if (value.kind !== 'clarification' && value.targets.length !== 1) ctx.addIssue({ code: 'custom', message: 'Native authorization and review requests cannot share targets' });
  if (['permission', 'review'].includes(value.kind) && !['choices', 'review'].includes(value.presentation.kind)) ctx.addIssue({ code: 'custom', message: 'Native approval must retain exact options' });
  if (value.kind === 'authentication' && !['url_flow', 'review'].includes(value.presentation.kind)) ctx.addIssue({ code: 'custom', message: 'Authentication must use a native URL/review flow' });
  for (const deadline of [value.expiresAt, value.decisionDeadline]) if (deadline && Date.parse(deadline) < Date.parse(value.openedAt)) ctx.addIssue({ code: 'custom', message: 'Question deadline precedes opening' });
}).meta({ 'x-runtime-rules': ['question-kind-presentation', 'matching-contract-targets', 'single-target-native-authorization'] });
export const AnswerDeliverySchema = z.strictObject({ answerId: IdSchema, targetBindingId: IdSchema, status: z.enum(['local_recorded', 'response_written', 'native_applied', 'indeterminate', 'expired']), evidenceRefs: uniqueIds });
export const VerificationSchema = CandidateRefSchema.extend({
  id: IdSchema, artifactDigest: DigestSchema, criteriaDigest: DigestSchema, environmentRef: IdSchema,
  results: z.array(z.strictObject({ criterionId: IdSchema, outcome: z.enum(['PASS', 'FAIL', 'SKIPPED', 'NOT_TESTED', 'NOT_APPLICABLE']), evidenceRefs: uniqueIds })).min(1).max(128).refine(items => uniqueBy(items, item => item.criterionId), 'Verification criteria must be unique').readonly(),
  verifierIdentityRef: IdSchema,
});
export const CompletionProposalSchema = CandidateRefSchema.extend({ verificationId: IdSchema, artifactDigest: DigestSchema, humanAcceptanceRef: IdSchema.optional() });
export const UserDecisionSchema = z.strictObject({ id: IdSchema, version: positive, content: text(16384), scope: ScopeSchema, authorityRef: IdSchema, supersedes: IdSchema.optional(), revokedAt: TimestampSchema.optional() });
export const InterventionRecordSchema = z.strictObject({ id: IdSchema, workId: IdSchema.optional(), projectId: IdSchema, ticketRefs: uniqueIds, assignmentRefs: uniqueIds, actorRef: IdSchema, source: z.enum(['direct_message', 'question_answer', 'manual_edit', 'explicit_override']), beforeContractRef: ContractRefSchema.optional(), afterContractRef: ContractRefSchema.optional(), beforeArtifactRef: IdSchema.optional(), afterArtifactRef: IdSchema.optional(), environmentRef: IdSchema, rawFeedbackRef: IdSchema, occurredAt: TimestampSchema });
export const InterpretationSchema = z.strictObject({ id: IdSchema, interventionId: IdSchema, revision: positive, labels: z.array(z.enum(['execution_violation', 'goal_change', 'temporary_environment', 'explicit_preference', 'mixed', 'unknown'])).min(1).max(6).readonly(), evidenceRefs: uniqueIds, hypothesisRef: IdSchema });
export const PolicyRevisionSchema = z.strictObject({ id: IdSchema, revision: positive, scope: ScopeSchema, sourceRefs: uniqueIds, requiredFeatures: uniqueIds, experimentRefs: uniqueIds, deployment: z.enum(['candidate', 'testing', 'shadow', 'active', 'suspended', 'revoked', 'rejected']), contentRef: IdSchema });
export const ReplyAnchorSchema = z.strictObject({ workId: IdSchema.optional(), questionId: IdSchema.optional(), messageId: IdSchema.optional() }).refine(value => Object.values(value).some(Boolean), 'Reply anchor must identify a target');
export const ConversationMessageSchema = z.strictObject({ id: IdSchema, conversationId: IdSchema, sequence: positive, role: z.enum(['user', 'assistant', 'system']), projectId: IdSchema.optional(), selectedProfileId: IdSchema.optional(), anchor: ReplyAnchorSchema.optional(), provenance: z.enum(['trusted_user', 'reasoner_reply', 'question_answer_display', 'application_notice']), text: z.string().max(65536), sourceRefs: uniqueIds, createdAt: TimestampSchema });
export const ConversationPageSchema = z.strictObject({ conversationId: IdSchema, messages: list(ConversationMessageSchema, 200), beforeCursor: positive.optional(), hasMore: z.boolean() }).refine(value => value.messages.every(item => item.conversationId === value.conversationId), 'Message conversation mismatch');
export const LearningViewSchema = z.strictObject({ globallyPaused: z.boolean(), policies: list(PolicyRevisionSchema, 200) });
export const KnowledgeSourceViewSchema = z.strictObject({ id: IdSchema, title: text(512), projectId: IdSchema, locationRef: IdSchema, validity: z.enum(['current', 'stale', 'missing']), evidenceRefs: uniqueIds });
export const KnowledgePageSchema = z.strictObject({ decisions: list(UserDecisionSchema, 200), sources: list(KnowledgeSourceViewSchema, 200), nextCursor: text(1024).optional() });
const userBase = z.strictObject({ commandId: IdSchema, conversationId: IdSchema });
export const UserCommandSchema = z.discriminatedUnion('kind', [
  userBase.extend({ kind: z.literal('chat'), text: text(32768), projectId: IdSchema, selectedProfileId: IdSchema.optional(), anchor: ReplyAnchorSchema.optional() }),
  userBase.extend({ kind: z.literal('create_work'), projectId: IdSchema, goal: text(16384), scope: ScopeSchema, criteria: RequiredCriteriaSchema, profileId: IdSchema }),
  userBase.extend({ kind: z.literal('revise_work'), expected: ContractRefSchema, goal: text(16384), scope: ScopeSchema, criteria: RequiredCriteriaSchema }),
  userBase.extend({ kind: z.literal('stop_work'), workId: IdSchema }),
  userBase.extend({ kind: z.literal('pause_dispatch'), expected: ContractRefSchema, expectedHoldRevision: count }),
  userBase.extend({ kind: z.literal('resume_dispatch'), expected: ContractRefSchema, expectedHoldRevision: count }),
  userBase.extend({ kind: z.literal('retry_assignment'), expected: AssignmentRefSchema, actionToken: IdSchema }),
  userBase.extend({ kind: z.literal('continue_work'), expected: ContractRefSchema }),
  userBase.extend({ kind: z.literal('answer_question'), questionId: IdSchema, expectedVersion: positive, answer: QuestionAnswerSchema }),
  userBase.extend({ kind: z.literal('accept_candidate'), candidate: CandidateRefSchema }),
  userBase.extend({ kind: z.literal('record_decision'), content: text(16384), scope: ScopeSchema, sourceMessageId: IdSchema }),
  userBase.extend({ kind: z.literal('revoke_decision'), decisionId: IdSchema, expectedVersion: positive }),
  userBase.extend({ kind: z.literal('set_learning_paused'), paused: z.boolean() }),
  userBase.extend({ kind: z.literal('control_policy'), policyId: IdSchema, expectedRevision: positive, action: z.enum(['suspend', 'revoke', 'request_evaluation']) }),
]).refine(value => value.kind !== 'create_work' || value.projectId === value.scope.projectId, 'Command and scope projects must agree');
export const TrustedActorSchema = z.strictObject({ userId: IdSchema, authorityRef: IdSchema, source: z.enum(['local_ui', 'local_cli', 'explicit_rule']) });
export const AppErrorCodeSchema = z.enum(['conflict', 'stale_contract', 'stale_candidate', 'stale_binding', 'unsupported_capability', 'auth_required', 'policy_unprepared', 'writer_indeterminate', 'verification_failed', 'cursor_expired', 'storage_unavailable', 'budget_exceeded', 'invalid_request', 'question_expired', 'schema_mismatch', 'forbidden', 'state_in_use']);
export const AppErrorSchema = z.strictObject({ code: AppErrorCodeSchema, message: text(), retry: z.enum(['safe', 'reconcile', 'user_action', 'none']), evidenceRef: EvidenceRefSchema.optional() });
const receiptBase = z.strictObject({ commandId: IdSchema, workId: IdSchema.optional(), entityRefs: z.strictObject({ decisionId: IdSchema.optional(), policyId: IdSchema.optional(), questionId: IdSchema.optional() }).optional(), seq: count });
export const CommandReceiptSchema = z.discriminatedUnion('status', [receiptBase.extend({ status: z.literal('recorded') }), receiptBase.extend({ status: z.literal('rejected'), error: AppErrorSchema })]);
export const SnapshotSchema = z.strictObject({ cursor: count, works: list(WorkViewSchema, 200), questions: list(UserQuestionSchema, 200), conversation: ConversationPageSchema.optional(), learning: LearningViewSchema.optional(), knowledge: KnowledgePageSchema.optional() });
export const ChangeSchema = z.strictObject({ seq: positive, topic: IdSchema, entityRef: IdSchema, payload: JsonSchema });
export const InspectQuerySchema = z.strictObject({ workId: IdSchema.optional(), conversationId: IdSchema.optional(), beforeMessageCursor: positive.optional(), limit: z.number().int().min(1).max(200).optional(), includeLearning: z.boolean().optional(), knowledgeProjectId: IdSchema.optional(), knowledgeCursor: text(1024).optional() });
export const ReasonerProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reply'), text: text(32768), sourceRefs: uniqueIds }),
  z.strictObject({ kind: z.literal('propose_work'), goal: text(16384), projectId: IdSchema, sourceMessageId: IdSchema }),
  z.strictObject({ kind: z.literal('propose_revision'), expected: ContractRefSchema, rationale: text(), sourceMessageId: IdSchema }),
  z.strictObject({ kind: z.literal('propose_decision'), content: text(16384), scope: ScopeSchema, sourceMessageId: IdSchema }),
]);
export const ContractIdentitySchema = z.strictObject({ apiMajor: z.literal(CONTRACT_API_MAJOR), version: z.literal(CONTRACT_VERSION), schemaHash: DigestSchema });

export const ExecutionInputSchema = z.strictObject({ inputId: IdSchema, contract: ContractRefSchema, text: text(131072), contextRefs: uniqueIds, sourceMessageRefs: uniqueIds, provenance: z.enum(['authorized_work_input', 'user_supplement']) });
export const NativeAnswerPayloadSchema = z.strictObject({ answerId: IdSchema, questionId: IdSchema, questionVersion: positive, nativeBinding: NativeQuestionBindingSchema, answer: QuestionAnswerSchema, authorityRef: IdSchema });
export const TurnEndedPayloadSchema = z.strictObject({ nativeTurnRef: text(1024), outcome: z.enum(['completed', 'cancelled', 'failed']), candidateAvailable: z.boolean(), evidenceRefs: uniqueIds });
export const CandidateObservedPayloadSchema = z.strictObject({ artifactRefs: uniqueIds, summaryRef: IdSchema, evidenceRefs: uniqueIds });
export const CancelObservedPayloadSchema = z.strictObject({ dispatch: NativeDispatchSchema, acknowledged: z.boolean(), evidenceRefs: uniqueIds });
export const WriterObservedPayloadSchema = z.strictObject({ resources: z.array(z.strictObject({ resourceRef: IdSchema, ownership: OwnershipSchema, status: z.enum(['active', 'quiescent', 'indeterminate']), evidenceRefs: uniqueIds })).min(1).max(1024).readonly() });
export const RuntimeExitedPayloadSchema = z.strictObject({ resourceRef: IdSchema, exitCode: z.number().int().min(-2147483648).max(2147483647).nullable(), signal: text(64).nullable(), evidenceRefs: uniqueIds });
export const ConfigChangedPayloadSchema = z.strictObject({ previousFingerprint: DigestSchema, observedFingerprint: DigestSchema, detection: z.enum(['watch', 'handshake', 'identity']), evidenceRefs: uniqueIds });
export const UsageObservedPayloadSchema = z.strictObject({ completeness: z.enum(['observed', 'partial', 'unknown']), inputTokens: count.optional(), outputTokens: count.optional(), cost: z.strictObject({ currency: z.string().regex(/^[A-Z]{3}$/), amount: z.number().finite().min(0) }).optional(), evidenceRefs: uniqueIds });
export const RuntimeErrorPayloadSchema = z.strictObject({ code: DriverErrorCodeSchema, message: text(), dispatch: NativeDispatchSchema.optional(), evidenceRefs: uniqueIds });
export const RuntimeFactPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('policy.prepared'), value: PreparedExecutionPolicySchema }),
  z.strictObject({ kind: z.literal('dispatch.observed'), value: NativeDispatchSchema }),
  z.strictObject({ kind: z.literal('question.opened'), value: UserQuestionSchema }),
  z.strictObject({ kind: z.literal('answer.observed'), value: AnswerDeliverySchema }),
  z.strictObject({ kind: z.literal('turn.ended'), value: TurnEndedPayloadSchema }),
  z.strictObject({ kind: z.literal('candidate.observed'), value: CandidateObservedPayloadSchema }),
  z.strictObject({ kind: z.literal('cancel.observed'), value: CancelObservedPayloadSchema }),
  z.strictObject({ kind: z.literal('writer.observed'), value: WriterObservedPayloadSchema }),
  z.strictObject({ kind: z.literal('runtime.exited'), value: RuntimeExitedPayloadSchema }),
  z.strictObject({ kind: z.literal('config.changed'), value: ConfigChangedPayloadSchema }),
  z.strictObject({ kind: z.literal('usage.observed'), value: UsageObservedPayloadSchema }),
  z.strictObject({ kind: z.literal('runtime.error'), value: RuntimeErrorPayloadSchema }),
]);

function sameContract(a: z.infer<typeof ContractRefSchema>, b: z.infer<typeof ContractRefSchema>): boolean {
  return a.workId === b.workId && a.revision === b.revision && a.digest === b.digest;
}

export const wireSchemas = {
  Id: IdSchema, Digest: DigestSchema, EvidenceRef: EvidenceRefSchema, Json: JsonSchema, Timestamp: TimestampSchema, TestStatus: TestStatusSchema,
  ContractRef: ContractRefSchema, Scope: ScopeSchema, Criterion: CriterionSchema, RequiredCriteria: RequiredCriteriaSchema, ContractRevision: ContractRevisionSchema,
  WorkRecord: WorkRecordSchema, TicketLink: TicketLinkSchema, AssignmentRef: AssignmentRefSchema, AttemptRef: AttemptRefSchema, Ownership: OwnershipSchema,
  RuntimeReference: RuntimeReferenceSchema, CandidateRef: CandidateRefSchema, WorkView: WorkViewSchema, CapabilityObservation: CapabilityObservationSchema,
  AgentProfile: AgentProfileSchema, CompatibilityIdentity: CompatibilityIdentitySchema, ProbeReport: ProbeReportSchema, PreparedExecutionPolicy: PreparedExecutionPolicySchema,
  AttemptSpec: AttemptSpecSchema, RunnerCommand: RunnerCommandSchema, RuntimeFactKind: RuntimeFactKindSchema, CriticalFact: CriticalFactSchema,
  DurableReceipt: DurableReceiptSchema, ProgressUpdate: ProgressUpdateSchema, DriverErrorCode: DriverErrorCodeSchema, NativeDispatch: NativeDispatchSchema,
  ProcessSpec: ProcessSpecSchema, ReconcileReport: ReconcileReportSchema, ServeExit: ServeExitSchema, WireRequestId: WireRequestIdSchema,
  NativeQuestionBinding: NativeQuestionBindingSchema, QuestionOption: QuestionOptionSchema, QuestionField: QuestionFieldSchema, QuestionPresentation: QuestionPresentationSchema,
  QuestionAnswer: QuestionAnswerSchema, UserQuestion: UserQuestionSchema, AnswerDelivery: AnswerDeliverySchema, Verification: VerificationSchema,
  CompletionProposal: CompletionProposalSchema, UserDecision: UserDecisionSchema, InterventionRecord: InterventionRecordSchema, Interpretation: InterpretationSchema,
  PolicyRevision: PolicyRevisionSchema, ReplyAnchor: ReplyAnchorSchema, ConversationMessage: ConversationMessageSchema, ConversationPage: ConversationPageSchema,
  LearningView: LearningViewSchema, KnowledgeSourceView: KnowledgeSourceViewSchema, KnowledgePage: KnowledgePageSchema, UserCommand: UserCommandSchema,
  TrustedActor: TrustedActorSchema, AppErrorCode: AppErrorCodeSchema, AppError: AppErrorSchema, CommandReceipt: CommandReceiptSchema,
  Snapshot: SnapshotSchema, Change: ChangeSchema, InspectQuery: InspectQuerySchema, ReasonerProposal: ReasonerProposalSchema, ContractIdentity: ContractIdentitySchema,
  ExecutionInput: ExecutionInputSchema, NativeAnswerPayload: NativeAnswerPayloadSchema, TurnEndedPayload: TurnEndedPayloadSchema,
  CandidateObservedPayload: CandidateObservedPayloadSchema, CancelObservedPayload: CancelObservedPayloadSchema, WriterObservedPayload: WriterObservedPayloadSchema,
  RuntimeExitedPayload: RuntimeExitedPayloadSchema, ConfigChangedPayload: ConfigChangedPayloadSchema, UsageObservedPayload: UsageObservedPayloadSchema,
  RuntimeErrorPayload: RuntimeErrorPayloadSchema, RuntimeFactPayload: RuntimeFactPayloadSchema,
} as const;
