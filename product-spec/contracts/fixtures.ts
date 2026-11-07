/** Illustrative, non-executable fixtures for G0 and UI/Driver discussion. No native capability is certified. */
import type { AgentProfile, ConversationPage, Scope, UserCommand, UserQuestion } from './contracts.js';

export const scope = {
  projectId: 'project-demo',
  allowedPaths: ['src/', 'tests/'],
  excludedPaths: ['.env', '.git/'],
  externalActions: []
} satisfies Scope;

export const createWork = {
  commandId: 'command-demo-create',
  conversationId: 'conversation-main',
  kind: 'create_work',
  projectId: 'project-demo',
  goal: 'Add CSV export and deliver a reviewable patch.',
  scope,
  criteria: [
    { id: 'csv-test', description: 'CSV export checks pass on the frozen artifact.', kind: 'machine', required: true, checkDefinitionRef: 'check-demo-csv' },
    { id: 'review', description: 'The user accepts the export behavior.', kind: 'human', required: true }
  ],
  profileId: 'profile-demo-codex-not-validated'
} satisfies UserCommand;

export const permissionQuestion = {
  id: 'question-demo-permission',
  version: 1,
  kind: 'permission',
  contract: { workId: 'work-demo', revision: 1, digest: 'illustrative-contract-digest' },
  scope,
  prompt: 'Allow the displayed scratch-project test command for this request?',
  nativePayloadRef: 'payload-demo-original-request',
  presentation: {
    kind: 'choices',
    multiple: false,
    options: [
      { id: 'native-option-allow-once', label: 'Allow Once', semantic: 'allow_once' },
      { id: 'native-option-deny', label: 'Deny', semantic: 'deny' }
    ]
  },
  targets: [{
    id: 'binding-demo-request-43',
    ticketId: 'ticket-demo',
    assignmentId: 'assignment-demo',
    attemptId: 'attempt-demo',
    fenceEpoch: 4,
    contract: { workId: 'work-demo', revision: 1, digest: 'illustrative-contract-digest' },
    connectionEpoch: 2,
    nativeRequestId: { kind: 'integer', decimal: '43' },
    nativeMethod: 'illustrative.permission.method',
    provenanceRef: 'provenance-demo-tool-action'
  }],
  openedAt: '2026-11-07T00:00:00Z',
  validity: 'open'
} satisfies UserQuestion;

export const answerPermission = {
  commandId: 'command-demo-answer',
  conversationId: 'conversation-main',
  kind: 'answer_question',
  questionId: permissionQuestion.id,
  expectedVersion: permissionQuestion.version,
  answer: { kind: 'choices', optionIds: ['native-option-deny'] }
} satisfies UserCommand;

export const conversation = {
  conversationId: 'conversation-main',
  hasMore: false,
  messages: [{
    id: 'message-demo',
    conversationId: 'conversation-main',
    sequence: 1,
    role: 'user',
    projectId: 'project-demo',
    selectedProfileId: 'profile-demo-codex-not-validated',
    provenance: 'trusted_user',
    text: 'Discuss the export design first.',
    sourceRefs: ['authority-demo-authenticated-message'],
    createdAt: '2026-11-07T00:00:00Z'
  }]
} satisfies ConversationPage;

export const inspectedOnlyProfile = {
  id: 'profile-demo-codex-not-validated',
  revision: 1,
  driverId: 'codex-native',
  driverApiMajor: 1,
  driverRelease: 'draft-not-a-release',
  executable: '/example/resolve-from-trusted-installation/codex',
  argv: ['app-server'],
  expectedVersion: '0.164.0',
  nativeConfigRef: 'config-demo-managed-reference',
  permissionPolicyRevision: 'permission-demo-scratch-only',
  requiredFeatures: ['structured_questions', 'permission_requests', 'cancel']
} satisfies AgentProfile;
