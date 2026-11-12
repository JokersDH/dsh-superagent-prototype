import { LAYERS } from './status.mjs'

const case_ = (id, extra = {}) => ({ id, required: true, ...extra })

/** The acceptance tool's own rejection proofs. Every release tier must keep these. */
export const SAFETY_CASES = [
  'E1-GATE-CONTROL',
  'E1-GATE-REJECT-MISSING-CASE',
  'E1-GATE-REJECT-UNKNOWN-STATUS',
  'E1-GATE-REJECT-UNCERTAIN-ACCEPT',
  'E1-GATE-REJECT-STALE-REPORT',
  'E1-GATE-REJECT-SOURCE-MISMATCH',
  'E1-GATE-REJECT-NO-CANDIDATE',
  'E1-GATE-REJECT-VACUOUS',
  'E1-GATE-REJECT-FAILED-ASSERTION',
  'E1-GATE-REJECT-MISSING-EVIDENCE',
  'E1-GATE-REJECT-DUPLICATE',
  'E1-GATE-REJECT-BAD-PATCH',
  'E1-GATE-REJECT-UNAPPLIED-PATCH',
  'E1-GATE-REJECT-MALFORMED-PATCH',
  'E1-GATE-REJECT-UNEXECUTED-NATIVE',
  'E1-GATE-REJECT-INVALID-RESPONSE',
  'E1-GATE-REJECT-STALE-CASE-BINDING',
  'E1-GATE-REJECT-FIXTURE-DRIFT',
  'E1-GATE-REJECT-SCHEMA',
  'E1-FIXTURE-STRICT',
  'E1-FIXTURE-PORTABILITY-STRICT',
  'E1-MUTATE-WRONG-LAYER',
  'E1-MUTATE-DIRTY-SOURCE',
  'E1-MUTATE-MISSING-SOURCE',
  'E1-MUTATE-STALE-REPORT',
  'E1-MUTATE-CROSS-COMMIT',
  'E1-MUTATE-UNBOUND-CASE',
  'E1-MUTATE-EMPTY-EVIDENCE',
  'E1-MUTATE-EMPTY-OBJECT-EVIDENCE',
  'E1-MUTATE-MISSING-CASE',
  'E1-MUTATE-FAILED-ASSERTION',
  'E1-MUTATE-NO-DOWNLOAD-BYTES',
  'E1-MUTATE-DOWNLOAD-DIGEST',
  'E1-MUTATE-PATCH-NOT-APPLIED',
  'E1-MUTATE-PATCH-DIGEST',
  'E1-MUTATE-DUPLICATE-ID',
  'E1-MUTATE-UNKNOWN-STATUS',
  'E1-MUTATE-UNKNOWN-LAYER',
  'E1-MUTATE-NATIVE-NOT-EXECUTED',
  'E1-MUTATE-NATIVE-NO-VERSION',
  'E1-MUTATE-NATIVE-NO-ATTEMPT',
  'E1-MUTATE-NATIVE-NO-EVIDENCE',
  'E1-MUTATE-NATIVE-NO-MODEL-TASKS',
  'E1-MUTATE-INSTALL-NOT-STAGED',
  'E1-MUTATE-INSTALL-NOT-INDEPENDENT',
  'E1-MUTATE-NOT-TESTED',
  'E1-MUTATE-SELF-CLAIM',
  'E1-MUTATE-ADMISSION-PROBE',
  'E1-ADMISSION-FAIL-CLOSED',
  'E1-PREFLIGHT-NO-FALLBACK',
  'E1-STRUCTURE-TIER-SUPERSET',
  'E1-STRUCTURE-NO-ALLOW-GAP',
  'E1-MUTATE-ROUTE-NO-ELIGIBLE',
  'E1-MUTATE-ROUTE-OVERLAP',
  'E1-MUTATE-ROUTE-EXPIRED',
  'E1-MUTATE-ROUTE-NO-EVIDENCE',
  'E1-MUTATE-ROUTE-DEFAULT-PATH',
  'E1-MUTATE-REVIEW-DISPOSITION',
  'E1-MUTATE-REVIEW-SAME-ASSIGNMENT',
  'E1-MUTATE-REVIEW-NO-ISOLATION',
  'E1-MUTATE-REVIEW-BAD-DIGEST',
  'E1-MUTATE-HETERO-SAME-PROTOCOL',
  'E1-MUTATE-HETERO-NOT-EXECUTED',
  'E1-MUTATE-HETERO-NO-VERSION',
  'E1-MUTATE-HETERO-NO-BUDGET',
  'E1-MUTATE-HETERO-NO-ISOLATION',
  'E1-MUTATE-HETERO-NO-SUBJECT',
  'E1-MUTATE-NATIVE-CONTROL-NOT-EXECUTED',
  'E1-MUTATE-NATIVE-CONTROL-NO-STOP',
  'E1-MUTATE-NATIVE-CONTROL-NO-RECOVERY',
  'E1-MUTATE-PILOT-ZERO-TURNS',
  'E1-MUTATE-PILOT-UNKNOWN-USAGE',
  'E1-MUTATE-PILOT-BLOCKED-PASS',
  'E1-MUTATE-PILOT-NO-ORACLE',
].map((id) => case_(id, { layers: [LAYERS.READONLY] }))

/** Product workflow evidence from the controlled lane. */
export const CONTROLLED_CASES = [
  case_('E2-CONFIGURATION', { layers: [LAYERS.CONTROLLED], evidence: ['configurationRevision'] }),
  case_('E2-DAILY-VERTICAL', { layers: [LAYERS.CONTROLLED], evidence: ['workId', 'verificationId', 'artifact', 'patch'] }),
  case_('E2-ARTIFACT-ROUNDTRIP', { layers: [LAYERS.CONTROLLED], evidence: ['artifact'] }),
  case_('E2-WORK-EVIDENCE', { layers: [LAYERS.CONTROLLED], evidence: ['workEvidence'] }),
  case_('E2-EVIDENCE-HISTORY', { layers: [LAYERS.CONTROLLED], evidence: ['evidenceHistory'] }),
  case_('E2-REOPEN-PERSISTENCE', { layers: [LAYERS.CONTROLLED], evidence: ['workId', 'conversation'] }),
  case_('E2-REPLAY-AND-CONFLICT', { layers: [LAYERS.CONTROLLED] }),
  case_('E2-SESSION-ISOLATION', { layers: [LAYERS.CONTROLLED] }),
  case_('E2-STALE-BUSINESS-REJECTION', { layers: [LAYERS.CONTROLLED] }),
  case_('E2-MACHINE-FAIL', { layers: [LAYERS.CONTROLLED] }),
  case_('E2-ONE-WRITER', { layers: [LAYERS.CONTROLLED] }),
  case_('E2-SCOPE-AND-PROFILE-GUARDS', { layers: [LAYERS.CONTROLLED], evidence: ['fixture'] }),
  case_('E2-AUTH-AND-ORIGIN', { layers: [LAYERS.CONTROLLED] }),
  case_('E2-ASSISTANT-SDK-MOCK', { layers: [LAYERS.SDK_MOCK], evidence: ['assistant'] }),
  case_('E2-CONVERSATION-CATALOG', { layers: [LAYERS.CONTROLLED], evidence: ['catalog'] }),
  case_('E2-ATTENTION-SIGNAL', { layers: [LAYERS.CONTROLLED], evidence: ['attention'] }),
  case_('E2-REVIEW-TIMING', { layers: [LAYERS.CONTROLLED], evidence: ['reviewTiming'] }),
  case_('E2-ROUTE-FIXTURE', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
  case_('E3-REVIEW-FIXTURES', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
  case_('E3-SEALED-COPY', { layers: [LAYERS.READONLY] }),
  case_('E3-REVIEW-ACTIVITY-UI', { layers: [LAYERS.CONTROLLED], evidence: ['reviewTiming'] }),
  case_('E3-ATTENTION-INBOX', { layers: [LAYERS.CONTROLLED], evidence: ['attention'] }),
  case_('E3-ATTENTION-INBOX-UI', { layers: [LAYERS.CONTROLLED] }),
  case_('E3-DECISION-WORKFLOW', { layers: [LAYERS.CONTROLLED], evidence: ['decisionWorkflow'] }),
  case_('E3-PROPOSAL-HTTP', { layers: [LAYERS.CONTROLLED], evidence: ['proposals'] }),
  case_('E3-PROPOSAL-UI', { layers: [LAYERS.CONTROLLED], evidence: ['proposalUi'] }),
  case_('E3-CONTEXT-PREVIEW', { layers: [LAYERS.CONTROLLED], evidence: ['contextPreview'] }),
  case_('E3-CONTEXT-USE', { layers: [LAYERS.CONTROLLED], evidence: ['contextUse'] }),
  case_('E3-CONTEXT-SSE', { layers: [LAYERS.CONTROLLED], evidence: ['sse'] }),
  case_('E3-CONTEXT-GUARDS', { layers: [LAYERS.CONTROLLED], evidence: ['guards'] }),
  case_('E3-CONTEXT-UI', { layers: [LAYERS.CONTROLLED], evidence: ['contextUi'] }),
  case_('E4-COMPLETED-REPLY', { layers: [LAYERS.CONTROLLED], evidence: ['completedReply'] }),
  case_('E2-REPLY-DURABLE', { layers: [LAYERS.CONTROLLED], evidence: ['replyDurable'] }),
  case_('E2-REPLY-UNKNOWN-DURABLE', { layers: [LAYERS.CONTROLLED], evidence: ['replyUnknown'] }),
  case_('E2-REPLY-MESSAGE-WINDOW', { layers: [LAYERS.CONTROLLED], evidence: ['replyMessageWindow'] }),
  case_('E2-REPLY-BAD-ARTIFACT', { layers: [LAYERS.CONTROLLED], evidence: ['replyBadArtifact'] }),
  case_('E8-SCHEMA-MIGRATION', { layers: [LAYERS.CONTROLLED], evidence: ['schemaMigration'] }),
  case_('E9-CONTEXT-CONCURRENCY', { layers: [LAYERS.CONTROLLED], evidence: ['concurrency'] }),
  case_('E3-DESKTOP-GEOMETRY', { layers: [LAYERS.CONTROLLED], evidence: ['layouts'] }),
  case_('E3-NOTEBOOK-GEOMETRY', { layers: [LAYERS.CONTROLLED], evidence: ['layouts'] }),
  case_('E3-MOBILE-GEOMETRY', { layers: [LAYERS.CONTROLLED], evidence: ['layouts'] }),
  case_('E3-QUESTION-FORM', { layers: [LAYERS.CONTROLLED] }),
  case_('E3-ACCEPT-AND-DOWNLOAD', { layers: [LAYERS.CONTROLLED], evidence: ['download'] }),
  case_('E3-ASSISTANT-SCHEMA-FIXTURES', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
  case_('E3-CONVERSATION-UI', { layers: [LAYERS.CONTROLLED], evidence: ['catalog'] }),
  case_('E3-VERIFICATION-RECOVERY-UI', { layers: [LAYERS.CONTROLLED], evidence: ['verificationRecovery'] }),
  case_('E3-OFFLINE-AND-ERROR', { layers: [LAYERS.CONTROLLED] }),
  case_('E3-KEYBOARD-AND-SCROLL', { layers: [LAYERS.CONTROLLED] }),
  case_('E4-BOUNDED-CYCLES', { layers: [LAYERS.CONTROLLED], evidence: ['cycles'] }),
  case_('E4-PORTABILITY-CHECKLIST', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
  case_('E4-RECOVERY-PREFLIGHT', { layers: [LAYERS.CONTROLLED], evidence: ['recoveryPreflight'] }),
  case_('E4-RECOVERY-READONLY', { layers: [LAYERS.CONTROLLED], evidence: ['recovery'] }),
  case_('E2-VERIFICATION-RECOVERY', { layers: [LAYERS.CONTROLLED], evidence: ['verificationRecovery'] }),
  case_('E2-VERIFICATION-FINISHED-STATES', { layers: [LAYERS.CONTROLLED], evidence: ['verificationRecovery'] }),
]

/** Staged installation outside the development checkout. */
export const INSTALL_CASES = [
  case_('E4-INSTALL-ARTIFACT-IDENTITY', { layers: [LAYERS.INSTALLED], evidence: ['artifact', 'installation'] }),
  case_('E3-PERSONAL-COLD-START', { layers: [LAYERS.INSTALLED], evidence: ['personalInstall'] }),
  case_('E4-INSTALL-FIRST-RUN', { layers: [LAYERS.INSTALLED], evidence: ['install'] }),
  case_('E4-INSTALL-CONFIG-ROOT', { layers: [LAYERS.INSTALLED], evidence: ['configRoot'] }),
  case_('E4-INSTALL-REUSE-CONCURRENCY', { layers: [LAYERS.INSTALLED], evidence: ['reuse'] }),
  case_('E4-INSTALL-HOST-GUARDS', { layers: [LAYERS.INSTALLED], evidence: ['hostGuards'] }),
  case_('E4-BACKUP-RESTORE', { layers: [LAYERS.INSTALLED], evidence: ['restore'] }),
  case_('E4-INSTALL-TAMPER', { layers: [LAYERS.INSTALLED], evidence: ['tamper'] }),
  case_('E4-INSTALL-ROLLBACK', { layers: [LAYERS.INSTALLED], evidence: ['rollback'] }),
  case_('E4-UPGRADE-ROLLBACK', { layers: [LAYERS.INSTALLED], evidence: ['upgrade'] }),
  case_('E4-UPGRADE-CROSS-SCHEMA', { layers: [LAYERS.INSTALLED], evidence: ['crossUpgrade'] }),
  case_('E4-MULTI-STATE', { layers: [LAYERS.INSTALLED], evidence: ['multiState'] }),
]

/** Real vendor execution, with an executed/version/attempt/command/evidence proof. */
export const NATIVE_CASES = [
  case_('E5-NATIVE-DELIVERY', { layers: [LAYERS.NATIVE], evidence: ['native', 'acceptance'] }),
  case_('E5-NATIVE-CONTROL', { layers: [LAYERS.NATIVE], evidence: ['native'] }),
]

/** Advisory routing and review stay experimental; these tiers are separate from product release. */
export const ADVISORY_CASES = [
  case_('E2-ATTENTION-WORKBENCH', { layers: [LAYERS.CONTROLLED], evidence: ['attention'] }),
  case_('E2-ROUTE-ADVICE', { layers: [LAYERS.CONTROLLED], evidence: ['routeAdvice'] }),
]
export const CONTROLLED_REVIEW_CASES = [
  case_('E3-REVIEW-REPORT', { layers: [LAYERS.CONTROLLED], evidence: ['reviewReport'] }),
  case_('E3-REVIEW-ISOLATION', { layers: [LAYERS.CONTROLLED], evidence: ['reviewEvidence'] }),
]
export const HETEROGENEOUS_CASES = [
  case_('E5-HETEROGENEOUS-REVIEW', { layers: [LAYERS.NATIVE], evidence: ['heterogeneous'] }),
]
export const NATIVE_CONTROL_CASES = [
  case_('E5-NATIVE-CONTROL', { layers: [LAYERS.NATIVE], evidence: ['nativeControl'] }),
]
export const PILOT_CASES = [
  case_('E6-REVIEW-PILOT', { layers: [LAYERS.NATIVE], evidence: ['pilot'] }),
]
const FIXTURE_CASES = [
  case_('E2-ROUTE-FIXTURE', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
  case_('E3-REVIEW-FIXTURES', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
  case_('E3-SEALED-COPY', { layers: [LAYERS.READONLY] }),
  case_('E4-PORTABILITY-CHECKLIST', { layers: [LAYERS.READONLY], evidence: ['fixture'] }),
]

const controlled = {
  tier: 'controlled-product-workflow',
  description:
    'Controlled product workflow, negative cases, browser interaction and bounded stability. ' +
    'Excludes portable installation and native execution, so it is not an internal-trial or release claim.',
  maxAgeMs: 6 * 60 * 60 * 1000,
  allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY],
  requireCleanSource: true,
  requireCaseSource: true,
  cases: [...SAFETY_CASES, ...CONTROLLED_CASES],
}

export const TIERS = {
  'harness-only': {
    tier: 'harness-only',
    description: 'The acceptance tool itself rejects bad evidence. No product claim.',
    maxAgeMs: 30 * 60 * 1000,
    allowedLayers: [LAYERS.READONLY, LAYERS.CONTROLLED, LAYERS.SDK_MOCK],
    requireCleanSource: false,
    requireCaseSource: false,
    cases: SAFETY_CASES,
  },
  'e2-controlled-workflow': {
    tier: 'e2-controlled-workflow',
    description: 'E2 controlled workflow and negative cases only.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: CONTROLLED_CASES.filter((item) => item.id.startsWith('E2-')),
  },
  'e3-browser-ui': {
    tier: 'e3-browser-ui',
    description: 'Independent browser/geometry/interaction acceptance only.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.READONLY],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: CONTROLLED_CASES.filter((item) => item.id.startsWith('E3-')),
  },
  'e4-bounded-stability': {
    tier: 'e4-bounded-stability',
    description: 'Bounded mixed cycles and portability checklist rules; installation stays excluded.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.READONLY],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: CONTROLLED_CASES.filter((item) => item.id.startsWith('E4-')),
  },
  'module': {
    tier: 'module',
    description: 'Gate self-tests plus frozen contract/capsule fixtures only. No product workflow.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.READONLY],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...FIXTURE_CASES],
  },
  'controlled-product': controlled,
  'controlled-product-workflow': controlled,
  'actual-native-control': {
    tier: 'actual-native-control',
    description:
      'Controlled product workflow plus real native stop/question/recovery control with version, identity, budget and evidence proof.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.NATIVE],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...NATIVE_CONTROL_CASES],
  },
  'installed-alpha': {
    tier: 'installed-alpha',
    description:
      'Controlled product workflow plus a real staged installation outside the checkout. Native execution may remain separate.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.INSTALLED],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...INSTALL_CASES],
  },
  'review-value': {
    tier: 'review-value',
    description:
      'The controlled product plus one real, complete 8-case three-arm independent-session pilot. ' +
      'It does not require a second protocol, route platform or heterogeneous review; a valid no-go is a research result.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.NATIVE],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...PILOT_CASES],
  },
  'advisory-routing': {
    tier: 'advisory-routing',
    description:
      'Controlled product workflow plus advisory attention/route-advice records. Advice is data only and never enters the default path.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...ADVISORY_CASES],
  },
  'controlled-review': {
    tier: 'controlled-review',
    description:
      'Advisory routing plus a controlled independent review with sealed-copy isolation. Review is not verification or acceptance.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...ADVISORY_CASES, ...CONTROLLED_REVIEW_CASES],
  },
  'actual-heterogeneous-review': {
    tier: 'actual-heterogeneous-review',
    description:
      'Every lower-tier safety case plus a real review executed by a different protocol with version, identity, budget, isolation and subject proof. A replacement model or fixture is not heterogeneity.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.NATIVE],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [
      ...SAFETY_CASES,
      ...CONTROLLED_CASES,
      ...ADVISORY_CASES,
      ...CONTROLLED_REVIEW_CASES,
      ...HETEROGENEOUS_CASES,
    ],
  },
  'local-alpha': {
    tier: 'local-alpha',
    description:
      'Controlled workflow plus a real staged installation in a fresh directory. Native execution is excluded.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.INSTALLED],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...INSTALL_CASES],
  },
  'full-product': {
    tier: 'full-product',
    description:
      'Every lower-tier safety case, the controlled workflow, a staged installation and real native ' +
      'execution. Missing native, installation, download or patch proof makes this tier fail.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.INSTALLED, LAYERS.NATIVE],
    requireCleanSource: true,
    requireCaseSource: true,
    cases: [...SAFETY_CASES, ...CONTROLLED_CASES, ...INSTALL_CASES, ...NATIVE_CASES],
  },
}

export function tier(name) {
  const requirement = TIERS[name]
  if (!requirement) throw new Error(`Unknown tier ${name}. Known: ${Object.keys(TIERS).join(', ')}`)
  return requirement
}
