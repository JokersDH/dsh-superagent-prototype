import type { z } from 'zod';
import { wireSchemas } from '../src/schemas.ts';

// Synthetic protocol fixtures only; these are not native compatibility reports.
export const digest = 'a'.repeat(64);
export const contract = { workId: 'work-1', revision: 1, digest };
export const scope = { projectId: 'project-1', allowedPaths: ['src/', 'tests/'], excludedPaths: ['.env'], externalActions: [] };
export const criterion = { id: 'test-1', description: 'Registered project tests pass.', kind: 'machine' as const, required: true as const, checkDefinitionRef: 'check-1' };
export const criteria = [criterion, { id: 'review-1', description: 'User accepts the output.', kind: 'human' as const, required: true }];
export const revision = { ...contract, goal: 'Implement CSV export.', scope, criteria, authorityRef: 'authority-1', createdAt: '2026-11-07T00:00:00Z' };
export const assignment = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract };
export const attempt = { ...assignment, attemptId: 'attempt-1', fenceEpoch: 1 };
export const candidate = { ...assignment, candidateGeneration: 1 };
export const profile = { id: 'profile-1', revision: 1, driverId: 'fixture-driver', driverApiMajor: 1 as const, driverRelease: '1.0.0', executable: '/fixture/bin/agent', argv: ['serve'], expectedVersion: '0.0.0-fixture', nativeConfigRef: 'config-1', permissionPolicyRevision: 'permission-1', requiredFeatures: ['questions'] };
export const identity = { profileId: 'profile-1', profileRevision: 1, executableDigest: digest, nativeVersion: '0.0.0-fixture', driverRelease: '1.0.0', driverApiMajor: 1 as const, wireVersion: 'fixture-v1', schemaDigest: digest, resolvedConfigFingerprint: digest, permissionPolicyRevision: 'permission-1', configStability: 'frozen' as const, platform: 'fixture', architecture: 'fixture', runtimeVersion: '24.21.0' };
export const option = { id: 'allow-once', label: 'Allow Once', semantic: 'allow_once' as const };
export const deny = { id: 'deny', label: 'Deny', semantic: 'deny' as const };
export const binding = { ...attempt, id: 'binding-1', connectionEpoch: 1, nativeRequestId: { kind: 'integer' as const, decimal: '43' }, nativeMethod: 'fixture/requestApproval', provenanceRef: 'provenance-1' };
export const question = { id: 'question-1', version: 1, kind: 'permission' as const, contract, scope, prompt: 'Allow this fixture operation?', nativePayloadRef: 'payload-1', presentation: { kind: 'choices' as const, options: [option, deny], multiple: false }, targets: [binding], openedAt: '2026-11-07T00:00:00Z', validity: 'open' as const };
export const verification = { ...candidate, id: 'verification-1', artifactDigest: digest, criteriaDigest: digest, environmentRef: 'environment-1', results: [{ criterionId: 'test-1', outcome: 'PASS' as const, evidenceRefs: ['fixture-evidence'] }], verifierIdentityRef: 'verifier-1' };
export const userDecision = { id: 'decision-1', version: 1, content: 'Do not add external services in this project.', scope, authorityRef: 'authority-1' };
export const policy = { id: 'policy-1', revision: 1, scope, sourceRefs: ['intervention-1'], requiredFeatures: [], experimentRefs: [], deployment: 'shadow' as const, contentRef: 'policy-content-1' };
export const message = { id: 'message-1', conversationId: 'conversation-1', sequence: 1, role: 'user' as const, projectId: 'project-1', provenance: 'trusted_user' as const, text: 'Discuss this project.', sourceRefs: ['authority-1'], createdAt: '2026-11-07T00:00:00Z' };
export const view = { work: { id: 'work-1', projectId: 'project-1', conversationId: 'conversation-1', title: 'CSV export', createdAt: '2026-11-07T00:00:00Z' }, contract: revision, links: [{ contract, ticketId: 'ticket-1', role: 'primary' as const, authorityRef: 'authority-1' }], phase: 'verifying' as const, coreSnapshotRef: 'snapshot-1', openQuestionIds: [], artifactIds: ['artifact-1'], resourceStatus: 'quiescent' as const, evidenceRefs: ['fixture-evidence'], actions: { dispatchHold: { paused: false, revision: 0 }, currentAssignment: assignment, currentCandidate: candidate, currentVerificationId: 'verification-1', retryActionToken: 'action-1', available: ['accept_candidate', 'retry_assignment'] as ('accept_candidate' | 'retry_assignment')[] } };
export const source = { id: 'source-1', title: 'Project decision', projectId: 'project-1', locationRef: 'location-1', validity: 'current' as const, evidenceRefs: ['fixture-evidence'] };
export const chat = { commandId: 'command-1', conversationId: 'conversation-1', kind: 'chat' as const, text: 'Discuss this project.', projectId: 'project-1' };

export const validFixtures = {
  Id: 'id-1', Digest: digest, EvidenceRef: 'evidence-1', Json: { nested: [null, true, 1, 'value'] }, Timestamp: '2026-11-07T00:00:00Z', TestStatus: 'NOT_TESTED',
  ContractRef: contract, Scope: scope, Criterion: criterion, RequiredCriteria: criteria, ContractRevision: revision,
  WorkRecord: view.work, TicketLink: view.links[0]!, AssignmentRef: assignment, AttemptRef: attempt, Ownership: 'spawned_process',
  RuntimeReference: { ...attempt, ownership: 'spawned_process', runnerIdentityRef: 'runner-1', connectionEpoch: 1 }, CandidateRef: candidate, WorkView: view,
  CapabilityObservation: { feature: 'questions', advertised: true, observed: true, test: 'PASS', policy: 'allowed', evidenceRefs: ['fixture-evidence'] },
  AgentProfile: profile, CompatibilityIdentity: identity, ProbeReport: { identity, capabilities: [], readiness: 'inspection_passed', checkedAt: '2026-11-07T00:00:00Z', evidenceRefs: ['fixture-evidence'] },
  PreparedExecutionPolicy: { ...attempt, requestedPolicyRevision: 'permission-1', nativeAppliedSettingsRef: 'settings-1', effectiveConfigFingerprint: digest, enforcement: 'approval_guarded', verification: 'passed', evidenceRef: 'fixture-evidence' },
  AttemptSpec: { ...attempt, profile, workspaceRef: 'workspace-1', resourceLeaseRef: 'lease-1', policySnapshotRef: 'policy-snapshot-1', budgetRef: 'budget-1' },
  RunnerCommand: { ...attempt, id: 'runner-command-1', kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' },
  RuntimeFactKind: 'question.opened', CriticalFact: { ...attempt, factId: 'fact-1', source: 'fixture-driver', kind: 'question.opened', payloadRef: 'payload-1' },
  DurableReceipt: { factId: 'fact-1', persisted: true, seq: 1 }, ProgressUpdate: { ...attempt, text: 'Working.', observedAt: '2026-11-07T00:00:00Z' },
  DriverErrorCode: 'state_indeterminate', NativeDispatch: { commandId: 'command-1', delivery: 'indeterminate', retry: 'reconcile_first', evidenceRefs: [] },
  ProcessSpec: { executable: '/fixture/bin/agent', argv: ['serve'], cwdRef: 'cwd-1', environmentRef: 'environment-1' },
  ReconcileReport: { status: 'indeterminate', writer: 'indeterminate', evidenceRefs: [] }, ServeExit: { reason: 'disconnected', evidenceRefs: [] },
  WireRequestId: { kind: 'integer', decimal: '9223372036854775807' }, NativeQuestionBinding: binding, QuestionOption: option,
  QuestionField: { id: 'name', label: 'Name', required: true, kind: 'text' }, QuestionPresentation: question.presentation,
  QuestionAnswer: { kind: 'choices', optionIds: ['deny'] }, UserQuestion: question,
  AnswerDelivery: { answerId: 'answer-1', targetBindingId: 'binding-1', status: 'response_written', evidenceRefs: ['fixture-evidence'] }, Verification: verification,
  CompletionProposal: { ...candidate, verificationId: 'verification-1', artifactDigest: digest }, UserDecision: userDecision,
  InterventionRecord: { id: 'intervention-1', projectId: 'project-1', ticketRefs: ['ticket-1'], assignmentRefs: ['assignment-1'], actorRef: 'actor-1', source: 'direct_message', environmentRef: 'environment-1', rawFeedbackRef: 'feedback-1', occurredAt: '2026-11-07T00:00:00Z' },
  Interpretation: { id: 'interpretation-1', interventionId: 'intervention-1', revision: 1, labels: ['mixed', 'unknown'], evidenceRefs: [], hypothesisRef: 'hypothesis-1' },
  PolicyRevision: policy, ReplyAnchor: { workId: 'work-1' }, ConversationMessage: message,
  ConversationPage: { conversationId: 'conversation-1', messages: [message], hasMore: false }, LearningView: { globallyPaused: false, policies: [policy] },
  KnowledgeSourceView: source, KnowledgePage: { decisions: [userDecision], sources: [source] }, UserCommand: chat,
  TrustedActor: { userId: 'user-1', authorityRef: 'authority-1', source: 'local_ui' }, AppErrorCode: 'conflict',
  AppError: { code: 'conflict', message: 'Command already has a different payload.', retry: 'none' },
  CommandReceipt: { commandId: 'command-1', status: 'recorded', workId: 'work-1', seq: 1 },
  Snapshot: { cursor: 1, works: [view], questions: [question], conversation: { conversationId: 'conversation-1', messages: [message], hasMore: false }, knowledge: { decisions: [userDecision], sources: [source] } },
  Change: { seq: 1, topic: 'work.changed', entityRef: 'work-1', payload: { id: 'work-1' } }, InspectQuery: { conversationId: 'conversation-1', limit: 20, knowledgeProjectId: 'project-1' },
  ReasonerProposal: { kind: 'propose_work', goal: 'Implement CSV export.', projectId: 'project-1', sourceMessageId: 'message-1' },
  ContractIdentity: { apiMajor: 1, version: '1.0.0', schemaHash: digest },
  ExecutionInput: { inputId: 'input-1', contract, text: 'Implement the requested change.', contextRefs: [], sourceMessageRefs: ['message-1'], provenance: 'authorized_work_input' },
  NativeAnswerPayload: { answerId: 'answer-1', questionId: 'question-1', questionVersion: 1, nativeBinding: binding, answer: { kind: 'choices', optionIds: ['deny'] }, authorityRef: 'authority-1' },
  TurnEndedPayload: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['fixture-evidence'] },
  CandidateObservedPayload: { artifactRefs: ['artifact-1'], summaryRef: 'summary-1', evidenceRefs: ['fixture-evidence'] },
  CancelObservedPayload: { dispatch: { commandId: 'cancel-1', delivery: 'written', retry: 'reconcile_first', evidenceRefs: ['fixture-evidence'] }, acknowledged: false, evidenceRefs: [] },
  WriterObservedPayload: { resources: [{ resourceRef: 'resource-1', ownership: 'spawned_process', status: 'indeterminate', evidenceRefs: [] }] },
  RuntimeExitedPayload: { resourceRef: 'resource-1', exitCode: null, signal: 'SIGTERM', evidenceRefs: ['fixture-evidence'] },
  ConfigChangedPayload: { previousFingerprint: digest, observedFingerprint: 'b'.repeat(64), detection: 'watch', evidenceRefs: ['fixture-evidence'] },
  UsageObservedPayload: { completeness: 'unknown', evidenceRefs: [] },
  RuntimeErrorPayload: { code: 'transport_lost', message: 'Fixture disconnected.', evidenceRefs: [] },
  RuntimeFactPayload: { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: false, evidenceRefs: [] } },
} satisfies { [K in keyof typeof wireSchemas]: z.input<(typeof wireSchemas)[K]> };

export const commandFixtures = [
  chat,
  { commandId: 'command-2', conversationId: 'conversation-1', kind: 'create_work', projectId: 'project-1', goal: 'Implement CSV export.', scope, criteria, profileId: 'profile-1' },
  { commandId: 'command-3', conversationId: 'conversation-1', kind: 'revise_work', expected: contract, goal: 'Also export UTF-8.', scope, criteria },
  { commandId: 'command-4', conversationId: 'conversation-1', kind: 'stop_work', workId: 'work-1' },
  { commandId: 'command-5', conversationId: 'conversation-1', kind: 'pause_dispatch', expected: contract, expectedHoldRevision: 0 },
  { commandId: 'command-6', conversationId: 'conversation-1', kind: 'resume_dispatch', expected: contract, expectedHoldRevision: 1 },
  { commandId: 'command-7', conversationId: 'conversation-1', kind: 'retry_assignment', expected: assignment, actionToken: 'action-1' },
  { commandId: 'command-8', conversationId: 'conversation-1', kind: 'continue_work', expected: contract },
  { commandId: 'command-9', conversationId: 'conversation-1', kind: 'answer_question', questionId: 'question-1', expectedVersion: 1, answer: { kind: 'choices', optionIds: ['deny'] } },
  { commandId: 'command-10', conversationId: 'conversation-1', kind: 'accept_candidate', candidate },
  { commandId: 'command-11', conversationId: 'conversation-1', kind: 'record_decision', content: 'Do not add services.', scope, sourceMessageId: 'message-1' },
  { commandId: 'command-12', conversationId: 'conversation-1', kind: 'revoke_decision', decisionId: 'decision-1', expectedVersion: 1 },
  { commandId: 'command-13', conversationId: 'conversation-1', kind: 'set_learning_paused', paused: true },
  { commandId: 'command-14', conversationId: 'conversation-1', kind: 'control_policy', policyId: 'policy-1', expectedRevision: 1, action: 'suspend' },
] as const;
