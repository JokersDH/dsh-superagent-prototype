import { runCase, STATUS, LAYERS } from '../lib/status.mjs'
import { evaluateRelease, REPORT_SCHEMA } from '../lib/release.mjs'
import { tier, SAFETY_CASES, CONTROLLED_CASES, INSTALL_CASES, NATIVE_CASES } from '../lib/release-requirements.mjs'

const NOW = Date.parse('2026-11-10T12:00:00.000Z')
const COMMIT = 'a'.repeat(40)
const DIGEST = 'b'.repeat(64)
const BASELINE = 'c'.repeat(40)

const evidenceFor = (key) => {
  switch (key) {
    case 'configurationRevision':
      return DIGEST
    case 'workId':
      return 'work-1'
    case 'verificationId':
      return 'verification-1'
    case 'conversation':
      return { id: 'conv-1', messages: 4 }
    case 'artifact':
      return { id: 'artifact-1', sha256: DIGEST, bytes: 24 }
    case 'patch':
      return {
        id: 'artifact-patch',
        format: 'git-patch',
        sha256: DIGEST,
        verifiedSha256: DIGEST,
        bytes: 120,
        apply: { ok: true, targetCommit: BASELINE, projectPath: '/tmp/baseline' },
      }
    case 'download':
      return { filename: 'product-output.txt', bytes: 24, sha256: DIGEST, verifiedSha256: DIGEST }
    case 'native':
      return {
        executed: true,
        version: 'codex 0.164.0',
        attemptId: 'attempt-1',
        commandId: 'command-1',
        modelTasks: 1,
        evidenceRefs: ['evidence-native-1'],
        sourceCommit: COMMIT,
      }
    case 'acceptance':
      return { accepted: true, candidateRef: 'work-1:1' }
    case 'installation':
      return {
        status: 'installed',
        bundleVersion: '0.1.0',
        bundleDigest: DIGEST,
        stagedPath: '/tmp/installed-bundle',
        steps: [
          { id: 'first-run', status: STATUS.PASS },
          { id: 'start-stop', status: STATUS.PASS },
        ],
        originalCheckoutAvailable: false,
      }
    case 'decisionWorkflow':
      return {
        previewReadOnly: true,
        records: 1,
        revoked: true,
        sourceState: 'current',
        executionEffects: 0,
        businessRejections: ['conflict', 'tampered_token'],
        events: 2,
      }
    case 'install':
      return {
        firstRun: 'OK',
        doctor: { status: 'DEGRADED', checks: { release_manifest: 'PASS', runtime_dependencies: 'PASS' } },
        instance: { buildId: 'build-1', startupMode: 'normal' },
        health: { status: 'ok', mode: 'fixture' },
      }
    case 'reuse':
      return { pid: 1, reusedPid: 1, conflictCode: 'instance_conflict', concurrent: [{ status: 'RUNNING' }, { status: 'BLOCKED' }] }
    case 'restore':
      return {
        bundleSha256: DIGEST,
        counts: { entries: 14, artifacts: 1 },
        database: { integrity: 'ok', foreignKeyViolations: 0 },
        restoreReport: 'recovery_readonly',
        authorization: { status: 'BLOCKED', owner: 'main' },
        businessStatus: 422,
      }
    case 'tamper':
      return { sameSizeCode: 'release_artifact_missing', missingCode: 'release_artifact_missing', corruptBundleCode: 'archive_invalid' }
    case 'rollback':
      return { bundleSha256: DIGEST, target: '/tmp/state', postBackupReceipt: 'recorded' }
    case 'evidenceHistory':
      return {
        protocol: 'work-evidence-history/1',
        entries: 12,
        window: 'complete',
        pages: [1, 1],
        refusals: { limitZero: 400, limitMax: 400, unknown: 404 },
      }
    case 'contextUse':
      return { protocol: 'assistant-context-prepared/1', sources: 2,
        binding: { commandId: 'c', messageId: 'm', bundleDigest: 'd' }, providerRequests: 1, reopened: true }
    case 'sse':
      return { complete: true, providerRequests: 1 }
    case 'guards':
      return { cross: 403, drift: 'conflict', expiry: 'stale_contract', offline: 'unsupported_capability', unknownProviderCalls: 1 }
    case 'contextUi':
      return { desktopMessages: 1, mobileMessages: 2, tabMessages: 2, pendingReconciled: true, providerRequests: 5, auditCommandIds: ['c'] }
    case 'concurrency':
      return { prepared: 4, recorded: 4, replies: 4, providerCalls: 4, bindings: 4 }
    case 'replyDurable':
      return { first: { calls: 1, replies: 0 }, recovered: { calls: 0, replies: 1 } }
    case 'replyUnknown':
      return { crashedCalls: 1, recoveredCalls: 0, notice: '未自动重发' }
    case 'replyMessageWindow':
      return { crashedCalls: 1, recoveredCalls: 0, replies: 1 }
    case 'replyBadArtifact':
      return { calls: 0, replies: 0, notice: '无法核对' }
    case 'schemaMigration':
      return { old: { schema: 15, messages: 3 }, migrated: { schema: 16, messages: 3, bindingTable: true }, reopened: true }
    case 'completedReply':
      return { providerRequests: 1, replies: 1, auditStable: true }
    case 'unknownReply':
      return { providerRequests: 1, notice: true, reply: false }
    case 'installedContext':
      return { available: true, prepare: 200, send: 'recorded', reply: 'ok', audit: 200, modelCalls: 1 }
    case 'personalInstall':
      return {
        start: 'RUNNING',
        health: 'ok',
        console: { status: 200, asset: true },
        auth: 401,
        schema: 15,
        stop: { status: 'STOPPED', closed: true },
        modelSends: 0,
        artifact: { buildId: 'target' },
        configConflict: { code: 'release_source_conflict', before: 'base', after: 'base' },
      }
    case 'contextPreview':
      return {
        protocol: 'context-preview/1',
        trust: 'untrusted_data',
        budget: { maxFiles: 32, maxBytes: 131072, maxTokens: 32768 },
        budgetClamped: ['maxFiles', 'maxBytes', 'maxTokens'],
        totals: { files: 3, bytes: 1200, tokens: 300 },
        kinds: ['contract', 'work'],
        refusals: { crossProject: 403, missingWork: 400 },
      }
    case 'proposalUi':
      return {
        preview: { works: 0, receipts: 2 },
        confirm: { works: 1, visibleRows: 1 },
        secondConfirm: { works: 2 },
        reject: { works: 2 },
        viewports: ['desktop', 'notebook', 'mobile'],
        pendingSurvivedReload: true,
        lostResponseSettledOnce: true,
      }
    case 'proposals':
      return {
        preview: { protocol: 'proposal-preview/1', requiredInputs: ['work.scope', 'work.criteria', 'work.profileId'], ttlMs: 300000 },
        confirm: { workId: 'work-1', seq: 5 },
        replay: { seq: 5, works: 1 },
        refusals: { missingInput: 400, changedPayload: 409, tampered: 403, crossProject: 403 },
        reject: { recorded: true, noWork: true },
        isolation: { projectA: 1, projectB: 1 },
        decision: { recorded: true },
        authAnswer: 409,
      }
    case 'configRoot':
      return {
        baseline: { role: 'baseline', firstRun: 'OK', initialized: 'FAIL', seeded: 'PASS' },
        target: { role: 'target', firstRun: 'OK', initialized: 'PASS', seeded: 'PASS' },
        baselineHistorical: 'FAIL',
      }
    case 'hostGuards':
      return {
        mode: { fixtureReused: true, personalRefused: 'author_executor_unavailable', existingUntouched: true },
        unknownPid: { startCode: 'instance_identity_mismatch', stopStatus: 1, alive: true },
      }
    case 'multiState':
      return {
        stopOtherState: { exit: 1, bAlive: true, bApiAlive: true },
        deadLauncher: { status: 'UNVERIFIED', apiAlive: true, apiAliveAfterStop: true },
      }
    case 'crossUpgrade':
      return {
        baseline: { buildId: 'old', schema: 13, tarSha256: DIGEST, source: 'old' },
        target: { buildId: 'new', schema: 15, tarSha256: 'c'.repeat(64), source: 'new' },
        upgrade: { status: 'CONFIRMED', to: 'new' },
        schema: 15,
        postKept: true,
        crossSchema: { code: 'state_schema_newer_than_binary', migrationRefusal: false, dataSchema: 15 },
      }
    case 'upgrade':
      return {
        baseline: { buildId: 'build-old', schema: 12, tarSha256: DIGEST },
        target: { buildId: 'build-new', schema: 13, tarSha256: 'c'.repeat(64) },
        migratedSchema: 13,
        messages: { before: 3, after: 4 },
        preUpgradeDataReadable: true,
        postUpgradeMessageKept: true,
        oldBinary: { code: 'daemon_start_failed', migrationError: true, dataUntouched: true },
        explicitRestore: { schema: 12, upgradedStateKept: true },
      }
    case 'workEvidence':
      return {
        protocol: 'work-evidence/1',
        workId: 'work-1',
        projection: 'recorded',
        entries: 12,
        outcomes: 1,
        truncated: false,
        unknownWorkStatus: 400,
      }
    case 'recoveryPreflight':
      return {
        inspection: {
          protocol: 'recovery-inspection/1',
          state: 'recovery_readonly',
          markerDigest: DIGEST,
          blockerCodes: ['authorization_not_implemented'],
        },
        plan: {
          protocol: 'recovery-plan/1',
          authorization: 'not_granted',
          commitAvailable: false,
          bindings: [{ sourceProjectId: 'project-atlas', headCommit: BASELINE }],
          ttlMs: 300000,
        },
        writes: { rowsBefore: { event_log: 0 }, rowsAfter: { event_log: 0 }, markerUnchanged: true, bindingsUnsaved: true },
        refusals: { staleFingerprint: 409, foreignProject: 403, commit: 422, normalPrepare: 422 },
      }
    case 'cycles':
      return { requested: 8, completed: 8, attemptCount: 8, failures: [] }
    case 'fixture':
      return { id: 'fixture', path: '/dev/null', sha256: DIGEST }
    case 'verificationRecovery':
      return { blockedId: 'blocked-1', retried: true, accepted: true }
    case 'nativeControl':
      return {
        executed: true,
        version: 'codex 0.164.0',
        attemptId: 'attempt-native-1',
        commandId: 'command-native-1',
        profileIdentityDigest: DIGEST,
        sourceCommit: COMMIT,
        stop: { observed: true, evidenceRefs: ['stop-evidence'] },
        question: { observed: true, evidenceRefs: ['question-evidence'] },
        recovery: { observed: true, evidenceRefs: ['recovery-evidence'] },
        budget: { grantId: 'wave03-b-native', usedTokens: 1200, maxTokens: 64000 },
        evidenceRefs: ['native-evidence-1'],
      }
    case 'pilot':
      return {
        protocol: 'independent-review-pilot/1',
        grantId: 'wave05-independent-review-pilot-01',
        executed: true,
        turnsUsed: 24,
        tokensUsed: 180000,
        costUSD: 4.2,
        usageCompleteness: 'observed',
        oracleDigest: DIGEST,
        decision: 'promising',
        sourceCommit: COMMIT,
        arms: [
          { id: 'no_review', turnStarts: 0 },
          { id: 'same_session_self_review', turnStarts: 8 },
          { id: 'fresh_session_review', turnStarts: 8 },
        ],
        refusals: [],
      }
    case 'reviewTiming':
      return {
        candidateReadyAt: '2026-11-10T00:00:00.000Z',
        acceptedAt: '2026-11-10T00:00:01.000Z',
        readyToAcceptanceMs: 1000,
        activeReviewMs: 500,
        activeReviewSource: 'ui_visibility_proxy',
        activeReviewCompleteness: 'partial',
        acceptedEvents: 1,
      }
    case 'attention':
      return {
        projects: 2,
        items: 3,
        groups: [{ projectId: 'project-atlas', reason: 'deadline' }],
        expiredSent: 0,
        batchGrantedPermissions: false,
      }
    case 'routeAdvice':
      return {
        protocol: 'route-advice/1',
        id: 'advice-1',
        projectId: 'project-atlas',
        taskContextDigest: DIGEST,
        catalogRevision: DIGEST,
        policyRevision: 'policy-1',
        eligible: [{ profileId: 'profile-a', revision: 1, identityDigest: DIGEST }],
        suggested: { profileId: 'profile-a', revision: 1, identityDigest: DIGEST },
        excluded: [],
        basis: 'only_eligible',
        evidenceRefs: ['evidence-advice-1'],
        createdAt: '2026-11-10T00:00:00.000Z',
        expiresAt: '2026-11-11T00:00:00.000Z',
        defaultPath: false,
      }
    case 'reviewReport':
      return {
        protocol: 'review-report/1',
        subjectDigest: DIGEST,
        disposition: 'findings',
        findings: [{ path: 'src/index.js', line: 3, severity: 'high', claim: 'off-by-one in range end' }],
        limitations: [],
      }
    case 'reviewEvidence':
      return {
        protocol: 'review-evidence/1',
        subject: {
          candidate: {
            workId: 'author-work',
            ticketId: 'author-ticket',
            assignmentId: 'author-assignment',
            contract: { workId: 'author-work', revision: 1, digest: DIGEST },
            candidateGeneration: 1,
          },
          artifactDigest: DIGEST,
          baseCommit: COMMIT,
        },
        reviewAttempt: {
          workId: 'review-work',
          ticketId: 'review-ticket',
          assignmentId: 'review-assignment',
          contract: { workId: 'review-work', revision: 1, digest: DIGEST },
          attemptId: 'attempt-review',
          fenceEpoch: 1,
        },
        reviewerProfile: { profileId: 'reviewer-profile', revision: 1, identityDigest: DIGEST },
        inputDigest: DIGEST,
        reportDigest: DIGEST,
        reportArtifactRef: 'artifact-review-report',
        isolation: { kind: 'sealed_copy', proofRef: 'proof-sealed-1', capsuleManifestDigest: DIGEST },
        layer: 'controlled',
        disposition: 'findings',
      }
    case 'heterogeneous':
      return {
        authorProtocol: 'codex-native/1',
        reviewerProtocol: 'acp/1',
        different: true,
        executed: true,
        reviewerVersion: 'acp-0.1.0',
        reviewerProfileIdentityDigest: DIGEST,
        budget: { grantId: 'wave05-independent-review-pilot-01', maxTokens: 200000, usedTokens: 1200, maxUSD: 5 },
        isolation: { kind: 'sealed_copy', proofRef: 'proof-capsule-1', capsuleManifestDigest: DIGEST },
        subject: { artifactDigest: DIGEST, baseCommit: COMMIT },
        evidenceRefs: ['evidence-hetero-1'],
        sourceCommit: COMMIT,
        reviewTurnStarts: 8,
      }
    case 'recovery':
      return {
        startupMode: 'recovery_readonly',
        rowsBefore: { effect: 1 },
        rowsAfter: { effect: 1 },
        rejectedStatuses: [422, 422],
      }
    case 'assistant':
      return { configured: true, model: 'mock-model', mockAttempts: 1 }
    case 'layouts':
      return { desktop: { horizontalOverflow: false } }
    case 'catalog':
      return { conversations: 3, archived: 1 }
    default:
      throw new Error(`No synthetic evidence for ${key}`)
  }
}

const buildCase = (entry, overrides = {}) => ({
  id: entry.id,
  layer: entry.layers[0],
  status: STATUS.PASS,
  assertions: [{ id: 'MUTATION-CONTROL', ok: true }],
  source: { commit: COMMIT },
  evidence: Object.fromEntries((entry.evidence ?? []).map((key) => [key, evidenceFor(key)])),
  ...overrides,
})

const fullProduct = tier('full-product')
const heterogeneous = tier('actual-heterogeneous-review')

const buildReportFor = (requirement, mutate = (report) => report) => {
  const report = {
    schema: REPORT_SCHEMA,
    source: { commit: COMMIT, dirty: false },
    checkedAt: new Date(NOW).toISOString(),
    cases: requirement.cases.map((entry) => buildCase(entry)),
    claim: { status: STATUS.PASS },
  }
  return mutate(report)
}

const gateFor = (requirement, report) =>
  evaluateRelease({
    report,
    requirement,
    expectedSource: COMMIT,
    now: NOW,
    resolveFixture: () => DIGEST,
  })

const rejectHeterogeneous = (assert, label, mutate, expected) => {
  const result = gateFor(heterogeneous, buildReportFor(heterogeneous, mutate))
  assert(`${label}_REJECTED`, result.ok === false, `gate accepted ${label}`)
  assert(
    `${label}_CODE`,
    result.failures.map((item) => item.code).includes(expected),
    `expected ${expected}, got ${[...new Set(result.failures.map((item) => item.code))].join(',')}`,
  )
}

const rejectTier = (assert, label, tierName, mutate, expected) => {
  const requirement = tier(tierName)
  const result = gateFor(requirement, buildReportFor(requirement, mutate))
  assert(`${label}_REJECTED`, result.ok === false, `gate accepted ${label}`)
  assert(
    `${label}_CODE`,
    result.failures.map((item) => item.code).includes(expected),
    `expected ${expected}, got ${[...new Set(result.failures.map((item) => item.code))].join(',')}`,
  )
}

const buildReport = (mutate = (report) => report) => {
  const report = {
    schema: REPORT_SCHEMA,
    source: { commit: COMMIT, dirty: false },
    checkedAt: new Date(NOW).toISOString(),
    cases: fullProduct.cases.map((entry) => buildCase(entry)),
    claim: { status: STATUS.PASS },
  }
  return mutate(report)
}

const gate = (report) =>
  evaluateRelease({
    report,
    requirement: fullProduct,
    expectedSource: COMMIT,
    now: NOW,
    resolveFixture: () => DIGEST,
  })

const codes = (result) => result.failures.map((item) => item.code)

const rejectWith = (assert, label, mutate, expected) => {
  const result = gate(buildReport(mutate))
  assert(`${label}_REJECTED`, result.ok === false, `gate accepted ${label}`)
  assert(
    `${label}_CODE`,
    codes(result).includes(expected),
    `expected ${expected}, got ${[...new Set(codes(result))].join(',')}`,
  )
  return result
}

const findCase = (report, id) => report.cases.find((item) => item.id === id)
const NATIVE_ID = NATIVE_CASES[0].id
const INSTALL_ID = INSTALL_CASES[0].id
const DOWNLOAD_ID = 'E3-ACCEPT-AND-DOWNLOAD'
const PATCH_ID = 'E2-DAILY-VERTICAL'

/**
 * E1 mutation matrix: one independent defect per case against an otherwise valid full-product
 * evidence bundle. PASS means the gate rejected exactly that defect; FAIL means a false pass.
 */
const CASES = [
  {
    id: 'E1-MUTATE-WRONG-LAYER',
    title: 'A native requirement cannot be satisfied by a controlled case',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'WRONG_LAYER',
        (report) => {
          findCase(report, NATIVE_ID).layer = LAYERS.CONTROLLED
          return report
        },
        'layer_not_allowed',
      ),
  },
  {
    id: 'E1-MUTATE-DIRTY-SOURCE',
    title: 'A dirty source worktree cannot carry release evidence',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'DIRTY_SOURCE',
        (report) => {
          report.source.dirty = true
          return report
        },
        'source_dirty',
      ),
  },
  {
    id: 'E1-MUTATE-MISSING-SOURCE',
    title: 'A report without a source commit is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'MISSING_SOURCE',
        (report) => {
          delete report.source
          return report
        },
        'report_source_missing',
      ),
  },
  {
    id: 'E1-MUTATE-STALE-REPORT',
    title: 'An old report is rejected even when it claims PASS',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'STALE',
        (report) => {
          report.checkedAt = new Date(NOW - 8 * 60 * 60 * 1000).toISOString()
          return report
        },
        'stale_report',
      ),
  },
  {
    id: 'E1-MUTATE-CROSS-COMMIT',
    title: 'A case bound to another commit is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'CROSS_COMMIT',
        (report) => {
          findCase(report, 'E2-DAILY-VERTICAL').source = { commit: 'd'.repeat(40) }
          return report
        },
        'stale_case_evidence',
      ),
  },
  {
    id: 'E1-MUTATE-UNBOUND-CASE',
    title: 'A required case without a source binding is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'UNBOUND',
        (report) => {
          delete findCase(report, 'E2-DAILY-VERTICAL').source
          return report
        },
        'case_source_unbound',
      ),
  },
  {
    id: 'E1-MUTATE-EMPTY-EVIDENCE',
    title: 'An empty evidence string is not evidence',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'EMPTY_STRING',
        (report) => {
          findCase(report, 'E2-CONFIGURATION').evidence.configurationRevision = ''
          return report
        },
        'required_evidence_missing',
      ),
  },
  {
    id: 'E1-MUTATE-EMPTY-OBJECT-EVIDENCE',
    title: 'An empty evidence object is not evidence',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'EMPTY_OBJECT',
        (report) => {
          findCase(report, 'E2-CONFIGURATION').evidence.configurationRevision = {}
          return report
        },
        'required_evidence_missing',
      ),
  },
  {
    id: 'E1-MUTATE-MISSING-CASE',
    title: 'A missing required case is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'MISSING_CASE',
        (report) => {
          report.cases = report.cases.filter((item) => item.id !== 'E2-DAILY-VERTICAL')
          return report
        },
        'missing_required_case',
      ),
  },
  {
    id: 'E1-MUTATE-FAILED-ASSERTION',
    title: 'A passing case with a failed assertion is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'FAILED_ASSERTION',
        (report) => {
          findCase(report, 'E2-DAILY-VERTICAL').assertions = [{ id: 'X', ok: false }]
          return report
        },
        'assertion_failed',
      ),
  },
  {
    id: 'E1-MUTATE-NO-DOWNLOAD-BYTES',
    title: 'A download without bytes is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NO_BYTES',
        (report) => {
          findCase(report, DOWNLOAD_ID).evidence.download.bytes = 0
          return report
        },
        'bad_download',
      ),
  },
  {
    id: 'E1-MUTATE-DOWNLOAD-DIGEST',
    title: 'A download whose verified digest differs is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'DOWNLOAD_DIGEST',
        (report) => {
          findCase(report, DOWNLOAD_ID).evidence.download.verifiedSha256 = 'e'.repeat(64)
          return report
        },
        'bad_download',
      ),
  },
  {
    id: 'E1-MUTATE-PATCH-NOT-APPLIED',
    title: 'A patch that was not applied is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'PATCH_NOT_APPLIED',
        (report) => {
          findCase(report, PATCH_ID).evidence.patch.apply.ok = false
          return report
        },
        'bad_patch',
      ),
  },
  {
    id: 'E1-MUTATE-PATCH-DIGEST',
    title: 'A patch whose verified digest differs is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'PATCH_DIGEST',
        (report) => {
          findCase(report, PATCH_ID).evidence.patch.verifiedSha256 = 'f'.repeat(64)
          return report
        },
        'bad_patch',
      ),
  },
  {
    id: 'E1-MUTATE-DUPLICATE-ID',
    title: 'A duplicate case identity is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'DUPLICATE',
        (report) => {
          report.cases.push({ ...findCase(report, 'E2-DAILY-VERTICAL') })
          return report
        },
        'duplicate_case_id',
      ),
  },
  {
    id: 'E1-MUTATE-UNKNOWN-STATUS',
    title: 'An unknown status is rejected, not coerced',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'UNKNOWN_STATUS',
        (report) => {
          findCase(report, 'E2-DAILY-VERTICAL').status = 'GREEN'
          return report
        },
        'unknown_status',
      ),
  },
  {
    id: 'E1-MUTATE-UNKNOWN-LAYER',
    title: 'An unknown evidence layer is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'UNKNOWN_LAYER',
        (report) => {
          findCase(report, 'E2-DAILY-VERTICAL').layer = 'trust-me'
          return report
        },
        'unknown_layer',
      ),
  },
  {
    id: 'E1-MUTATE-NATIVE-NOT-EXECUTED',
    title: 'Native evidence with executed=false is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NATIVE_NOT_EXECUTED',
        (report) => {
          findCase(report, NATIVE_ID).evidence.native.executed = false
          return report
        },
        'native_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-NATIVE-NO-VERSION',
    title: 'Native evidence without a version is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NATIVE_NO_VERSION',
        (report) => {
          findCase(report, NATIVE_ID).evidence.native.version = ''
          return report
        },
        'native_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-NATIVE-NO-ATTEMPT',
    title: 'Native evidence without attempt/command identity is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NATIVE_NO_ATTEMPT',
        (report) => {
          delete findCase(report, NATIVE_ID).evidence.native.attemptId
          return report
        },
        'native_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-NATIVE-NO-EVIDENCE',
    title: 'Native evidence without original evidence references is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NATIVE_NO_EVIDENCE',
        (report) => {
          findCase(report, NATIVE_ID).evidence.native.evidenceRefs = []
          return report
        },
        'native_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-NATIVE-NO-MODEL-TASKS',
    title: 'Native evidence without executed model tasks is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NATIVE_NO_MODEL_TASKS',
        (report) => {
          findCase(report, NATIVE_ID).evidence.native.modelTasks = 0
          return report
        },
        'native_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-INSTALL-NOT-STAGED',
    title: 'Installation evidence not produced by a staged bundle is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'INSTALL_NOT_STAGED',
        (report) => {
          findCase(report, INSTALL_ID).evidence.installation.status = 'planned'
          return report
        },
        'installation_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-INSTALL-NOT-INDEPENDENT',
    title: 'Installation that still needs the checkout is rejected',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'INSTALL_NOT_INDEPENDENT',
        (report) => {
          findCase(report, INSTALL_ID).evidence.installation.originalCheckoutAvailable = true
          return report
        },
        'installation_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-NOT-TESTED',
    title: 'A required NOT_TESTED case cannot satisfy a release',
    check: ({ assert }) =>
      rejectWith(
        assert,
        'NOT_TESTED',
        (report) => {
          findCase(report, INSTALL_ID).status = STATUS.NOT_TESTED
          return report
        },
        'case_not_pass',
      ),
  },
  {
    id: 'E1-MUTATE-SELF-CLAIM',
    title: 'A report cannot declare PASS while the gate finds blockers',
    check: ({ assert }) => {
      const result = gate(
        buildReport((report) => {
          findCase(report, NATIVE_ID).evidence.native.executed = false
          report.claim = { status: STATUS.PASS }
          return report
        }),
      )
      assert('REJECTED', !result.ok)
      assert('SELF_CLAIM', codes(result).includes('self_declared_pass_rejected'))
    },
  },
  {
    id: 'E1-MUTATE-ADMISSION-PROBE',
    title: 'The reproduced wave-04 false pass is now rejected',
    check: ({ assert }) => {
      // Exactly the shape main reported: every case controlled, executed=false, dirty source,
      // empty evidence objects and no per-case source binding, while claiming PASS.
      const report = {
        schema: REPORT_SCHEMA,
        source: { commit: COMMIT, dirty: true },
        checkedAt: new Date(NOW).toISOString(),
        cases: fullProduct.cases.map((entry) => ({
          id: entry.id,
          status: STATUS.PASS,
          layer: LAYERS.CONTROLLED,
          assertions: [{ id: 'synthetic-control', ok: true }],
          evidence: Object.fromEntries((entry.evidence ?? []).map((key) => [key, key === 'native' ? { executed: false } : {}])),
        })),
        claim: { status: STATUS.PASS },
      }
      const result = gate(report)
      assert('REJECTED', !result.ok)
      for (const code of [
        'source_dirty',
        'layer_not_allowed',
        'case_source_unbound',
        'required_evidence_missing',
        'native_evidence_invalid',
        'installation_evidence_invalid',
      ])
        assert(`CODE_${code}`, codes(result).includes(code), [...new Set(codes(result))].join(','))
      assert('NOT_PASS', result.status !== STATUS.PASS)
    },
  },
  {
    id: 'E1-STRUCTURE-TIER-SUPERSET',
    title: 'Full product includes every lower-tier required safety and workflow case',
    check: ({ assert }) => {
      const ids = new Set(fullProduct.cases.filter((item) => item.required !== false).map((item) => item.id))
      for (const entry of [...SAFETY_CASES, ...CONTROLLED_CASES, ...INSTALL_CASES, ...NATIVE_CASES])
        assert(`INCLUDES_${entry.id}`, ids.has(entry.id), `full-product omits ${entry.id}`)
      assert('SAFETY_COUNT', SAFETY_CASES.length >= 30, `${SAFETY_CASES.length} safety cases`)
    },
  },
  {
    id: 'E1-STRUCTURE-NO-ALLOW-GAP',
    title: 'There is no option that turns a declared gap into a release PASS',
    check: ({ assert }) => {
      const report = buildReport((value) => {
        findCase(value, INSTALL_ID).status = STATUS.NOT_TESTED
        return value
      })
      for (const extra of [{ allowGaps: true }, { allowNotTested: true }, { allowTested: true }]) {
        const result = evaluateRelease({
          report,
          requirement: fullProduct,
          expectedSource: COMMIT,
          now: NOW,
          resolveFixture: () => DIGEST,
          ...extra,
        })
        assert(`STILL_FAILS_${Object.keys(extra)[0]}`, result.status !== STATUS.PASS)
        assert(`GAP_CODE_${Object.keys(extra)[0]}`, codes(result).includes('case_not_pass'))
      }
    },
  },
]

const findIn = (report, id) => report.cases.find((item) => item.id === id)
const ADVICE_ID = 'E2-ROUTE-ADVICE'
const REPORT_ID = 'E3-REVIEW-REPORT'
const EVIDENCE_ID = 'E3-REVIEW-ISOLATION'
const HETERO_ID = 'E5-HETEROGENEOUS-REVIEW'

const ROUTING_CASES = [
  {
    id: 'E1-MUTATE-ROUTE-NO-ELIGIBLE',
    title: 'Advice claiming only_eligible with no eligible profile is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'ROUTE_NO_ELIGIBLE',
        (report) => {
          const advice = findIn(report, ADVICE_ID).evidence.routeAdvice
          advice.eligible = []
          advice.suggested = { profileId: 'ghost', revision: 1, identityDigest: DIGEST }
          return report
        },
        'route_advice_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-ROUTE-OVERLAP',
    title: 'A profile cannot be both eligible and excluded',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'ROUTE_OVERLAP',
        (report) => {
          const advice = findIn(report, ADVICE_ID).evidence.routeAdvice
          advice.excluded = [{ profileId: 'profile-a', revision: 1, identityDigest: DIGEST, reason: 'not_admitted' }]
          return report
        },
        'route_advice_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-ROUTE-EXPIRED',
    title: 'Expired advice is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'ROUTE_EXPIRED',
        (report) => {
          const advice = findIn(report, ADVICE_ID).evidence.routeAdvice
          advice.expiresAt = '2026-11-09T00:00:00.000Z'
          return report
        },
        'route_advice_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-ROUTE-NO-EVIDENCE',
    title: 'An eligible recommendation without evidence references is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'ROUTE_NO_EVIDENCE',
        (report) => {
          findIn(report, ADVICE_ID).evidence.routeAdvice.evidenceRefs = []
          return report
        },
        'route_advice_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-ROUTE-DEFAULT-PATH',
    title: 'Advisory advice cannot enter the default path',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'ROUTE_DEFAULT_PATH',
        (report) => {
          findIn(report, ADVICE_ID).evidence.routeAdvice.defaultPath = true
          return report
        },
        'route_advice_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-REVIEW-DISPOSITION',
    title: 'no_findings with findings is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'REVIEW_DISPOSITION',
        (report) => {
          const value = findIn(report, REPORT_ID).evidence.reviewReport
          value.disposition = 'no_findings'
          return report
        },
        'review_report_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-REVIEW-SAME-ASSIGNMENT',
    title: 'Review execution cannot reuse the author assignment',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'REVIEW_SAME_ASSIGNMENT',
        (report) => {
          const value = findIn(report, EVIDENCE_ID).evidence.reviewEvidence
          value.reviewAttempt.assignmentId = value.subject.candidate.assignmentId
          return report
        },
        'review_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-REVIEW-NO-ISOLATION',
    title: 'Review without sealed-copy isolation proof is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'REVIEW_NO_ISOLATION',
        (report) => {
          delete findIn(report, EVIDENCE_ID).evidence.reviewEvidence.isolation
          return report
        },
        'review_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-REVIEW-BAD-DIGEST',
    title: 'Review evidence with a malformed report digest is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'REVIEW_BAD_DIGEST',
        (report) => {
          findIn(report, EVIDENCE_ID).evidence.reviewEvidence.reportDigest = 'not-a-digest'
          return report
        },
        'review_evidence_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-HETERO-SAME-PROTOCOL',
    title: 'A reviewer on the same protocol is not heterogeneous',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'HETERO_SAME_PROTOCOL',
        (report) => {
          const value = findIn(report, HETERO_ID).evidence.heterogeneous
          value.reviewerProtocol = value.authorProtocol
          return report
        },
        'heterogeneous_review_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-HETERO-NOT-EXECUTED',
    title: 'A heterogeneous review that never executed is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'HETERO_NOT_EXECUTED',
        (report) => {
          findIn(report, HETERO_ID).evidence.heterogeneous.executed = false
          return report
        },
        'heterogeneous_review_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-HETERO-NO-VERSION',
    title: 'Heterogeneous review without a reviewer version is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'HETERO_NO_VERSION',
        (report) => {
          findIn(report, HETERO_ID).evidence.heterogeneous.reviewerVersion = ''
          return report
        },
        'heterogeneous_review_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-HETERO-NO-BUDGET',
    title: 'Heterogeneous review without a bounded budget is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'HETERO_NO_BUDGET',
        (report) => {
          findIn(report, HETERO_ID).evidence.heterogeneous.budget.maxUSD = 0
          return report
        },
        'heterogeneous_review_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-HETERO-NO-ISOLATION',
    title: 'Heterogeneous review without sealed-copy isolation is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'HETERO_NO_ISOLATION',
        (report) => {
          delete findIn(report, HETERO_ID).evidence.heterogeneous.isolation
          return report
        },
        'heterogeneous_review_invalid',
      ),
  },
  {
    id: 'E1-MUTATE-NATIVE-CONTROL-NOT-EXECUTED',
    title: 'Native control must come from an executed vendor run',
    check: ({ assert }) =>
      rejectTier(assert, 'NATIVE_CONTROL_NOT_EXECUTED', 'actual-native-control', (report) => {
        findIn(report, 'E5-NATIVE-CONTROL').evidence.nativeControl.executed = false
        return report
      }, 'native_control_invalid'),
  },
  {
    id: 'E1-MUTATE-NATIVE-CONTROL-NO-STOP',
    title: 'Native control without an observed stop is rejected',
    check: ({ assert }) =>
      rejectTier(assert, 'NATIVE_CONTROL_NO_STOP', 'actual-native-control', (report) => {
        findIn(report, 'E5-NATIVE-CONTROL').evidence.nativeControl.stop = { observed: false, evidenceRefs: [] }
        return report
      }, 'native_control_invalid'),
  },
  {
    id: 'E1-MUTATE-NATIVE-CONTROL-NO-RECOVERY',
    title: 'Native control without observed recovery is rejected',
    check: ({ assert }) =>
      rejectTier(assert, 'NATIVE_CONTROL_NO_RECOVERY', 'actual-native-control', (report) => {
        delete findIn(report, 'E5-NATIVE-CONTROL').evidence.nativeControl.recovery
        return report
      }, 'native_control_invalid'),
  },
  {
    id: 'E1-MUTATE-PILOT-ZERO-TURNS',
    title: 'A zero-turn pilot cannot be a value result',
    check: ({ assert }) =>
      rejectTier(assert, 'PILOT_ZERO_TURNS', 'review-value', (report) => {
        findIn(report, 'E6-REVIEW-PILOT').evidence.pilot.turnsUsed = 0
        return report
      }, 'pilot_evidence_invalid'),
  },
  {
    id: 'E1-MUTATE-PILOT-UNKNOWN-USAGE',
    title: 'A pilot with unknown usage is rejected',
    check: ({ assert }) =>
      rejectTier(assert, 'PILOT_UNKNOWN_USAGE', 'review-value', (report) => {
        findIn(report, 'E6-REVIEW-PILOT').evidence.pilot.usageCompleteness = 'unknown'
        return report
      }, 'pilot_evidence_invalid'),
  },
  {
    id: 'E1-MUTATE-PILOT-BLOCKED-PASS',
    title: 'A BLOCKED pilot dressed as a decision is rejected',
    check: ({ assert }) =>
      rejectTier(assert, 'PILOT_BLOCKED_PASS', 'review-value', (report) => {
        findIn(report, 'E6-REVIEW-PILOT').evidence.pilot.decision = 'BLOCKED'
        return report
      }, 'pilot_evidence_invalid'),
  },
  {
    id: 'E1-MUTATE-PILOT-NO-ORACLE',
    title: 'A pilot without the frozen oracle digest is rejected',
    check: ({ assert }) =>
      rejectTier(assert, 'PILOT_NO_ORACLE', 'review-value', (report) => {
        findIn(report, 'E6-REVIEW-PILOT').evidence.pilot.oracleDigest = 'nope'
        return report
      }, 'pilot_evidence_invalid'),
  },
  {
    id: 'E1-MUTATE-HETERO-NO-SUBJECT',
    title: 'Heterogeneous review without subject binding is rejected',
    check: ({ assert }) =>
      rejectHeterogeneous(
        assert,
        'HETERO_NO_SUBJECT',
        (report) => {
          delete findIn(report, HETERO_ID).evidence.heterogeneous.subject
          return report
        },
        'heterogeneous_review_invalid',
      ),
  },
]

export async function gateMutationCases() {
  const results = []
  for (const definition of [...CASES, ...ROUTING_CASES])
    results.push(
      await runCase(
        {
          id: definition.id,
          title: definition.title,
          layer: LAYERS.READONLY,
          evidence: { kind: 'gate-mutation' },
          limitations: ['Synthetic evidence bundles; proves the aggregator, not a product workflow'],
        },
        definition.check,
      ),
    )
  return results
}
