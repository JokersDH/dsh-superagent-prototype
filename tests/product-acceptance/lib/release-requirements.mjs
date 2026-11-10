import { LAYERS } from './status.mjs'

/**
 * Release tiers are explicit lists of case identities. Adding a capability to a tier is a deliberate
 * act; a case that merely exists never widens a claim.
 */
export const TIERS = {
  'harness-only': {
    tier: 'harness-only',
    description: 'The acceptance tool itself rejects bad evidence. No product claim.',
    maxAgeMs: 30 * 60 * 1000,
    allowedLayers: [LAYERS.READONLY, LAYERS.CONTROLLED, LAYERS.SDK_MOCK],
    cases: [
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
    ].map((id) => ({ id, required: true })),
  },
  'controlled-product-internal-trial': {
    tier: 'controlled-product-internal-trial',
    description:
      'Controlled product workflow, negative cases, browser interaction and bounded stability. ' +
      'Excludes native execution and portable installation.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY],
    cases: [
      ...['E1-GATE-CONTROL', 'E1-GATE-REJECT-MISSING-CASE', 'E1-GATE-REJECT-UNCERTAIN-ACCEPT',
        'E1-GATE-REJECT-STALE-REPORT', 'E1-GATE-REJECT-NO-CANDIDATE', 'E1-GATE-REJECT-BAD-PATCH',
        'E1-GATE-REJECT-UNEXECUTED-NATIVE', 'E1-GATE-REJECT-INVALID-RESPONSE',
        'E1-FIXTURE-STRICT', 'E1-FIXTURE-PORTABILITY-STRICT'].map((id) => ({ id, required: true })),
      { id: 'E2-CONFIGURATION', required: true, evidence: ['configurationRevision'] },
      { id: 'E2-DAILY-VERTICAL', required: true, evidence: ['workId', 'verificationId', 'artifact'] },
      { id: 'E2-ARTIFACT-ROUNDTRIP', required: true, evidence: ['artifact'] },
      { id: 'E2-REOPEN-PERSISTENCE', required: true, evidence: ['workId', 'conversation'] },
      { id: 'E2-REPLAY-AND-CONFLICT', required: true },
      { id: 'E2-SESSION-ISOLATION', required: true },
      { id: 'E2-STALE-BUSINESS-REJECTION', required: true },
      { id: 'E2-MACHINE-FAIL', required: true },
      { id: 'E2-ONE-WRITER', required: true },
      { id: 'E2-SCOPE-AND-PROFILE-GUARDS', required: true },
      { id: 'E2-AUTH-AND-ORIGIN', required: true },
      { id: 'E2-ASSISTANT-SDK-MOCK', required: true, evidence: ['assistant'] },
      { id: 'E3-DESKTOP-GEOMETRY', required: true, evidence: ['layouts'] },
      { id: 'E3-NOTEBOOK-GEOMETRY', required: true, evidence: ['layouts'] },
      { id: 'E3-MOBILE-GEOMETRY', required: true, evidence: ['layouts'] },
      { id: 'E3-QUESTION-FORM', required: true },
      { id: 'E3-ACCEPT-AND-DOWNLOAD', required: true, evidence: ['download'] },
      { id: 'E3-OFFLINE-AND-ERROR', required: true },
      { id: 'E3-KEYBOARD-AND-SCROLL', required: true },
      { id: 'E4-BOUNDED-CYCLES', required: true, evidence: ['cycles'] },
    ],
  },
  'full-product': {
    tier: 'full-product',
    description:
      'Internal-trial package plus portable installation/rollback and real native execution. ' +
      'Native cases must come from a real vendor agent run with a separately granted budget.',
    maxAgeMs: 6 * 60 * 60 * 1000,
    allowedLayers: [LAYERS.CONTROLLED, LAYERS.SDK_MOCK, LAYERS.READONLY, LAYERS.NATIVE],
    cases: [
      { id: 'E2-DAILY-VERTICAL', required: true, evidence: ['workId', 'verificationId', 'artifact'] },
      { id: 'E3-DESKTOP-GEOMETRY', required: true, evidence: ['layouts'] },
      { id: 'E4-BOUNDED-CYCLES', required: true, evidence: ['cycles'] },
      { id: 'E4-INSTALL-FIRST-RUN', required: true, evidence: ['installation'] },
      { id: 'E4-BACKUP-RESTORE', required: true, evidence: ['installation'] },
      { id: 'E4-UPGRADE-ROLLBACK', required: true, evidence: ['installation'] },
      { id: 'E5-NATIVE-DELIVERY', required: true, evidence: ['native'] },
    ],
  },
}

export function tier(name) {
  const requirement = TIERS[name]
  if (!requirement) throw new Error(`Unknown tier ${name}. Known: ${Object.keys(TIERS).join(', ')}`)
  return requirement
}
