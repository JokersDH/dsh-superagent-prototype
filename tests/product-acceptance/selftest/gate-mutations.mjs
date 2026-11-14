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
      return { id: 'artifact-1', sha256: DIGEST, bytes: 24,
        tuple: { target: { sourceCommit: COMMIT, buildId: 'b', productSchema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' } } }
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
    case 'sourceConfirm':
      return { authorization: 'not_granted', startupAvailable: false, queueHeld: true, markerUnchanged: true, replay: true }
    case 'sourceConfirmRefusal':
      return { status: 409, activation: false, target: false }
    case 'candidateFlow':
      return { status: 'candidates', executable: false, prepare: 200, confirm: 'recorded', providerCalls: 1 }
    case 'history':
      return { first: 1, more: true, second: 1, crossConversation: 0, modelOff: 3, expiredVisible: true, providerCalls: 2 }
    case 'sources':
      return { verified: 2, stateAfterCorrupt: 'missing', providerCalls: 1 }
    case 'contextUi':
      return { desktopMessages: 1, mobileMessages: 2, tabMessages: 2, historyRows: 4, pendingReconciled: true, providerRequests: 5, auditCommandIds: ['c'] }
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
    case 'personalReview':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', state: 'recovery_readonly', entryOrigin: 'main CLI + demo.ts',
        before: { healthy: true, candidates: 403, history: 403 },
        after: { candidates: 200, history: 200, sources: 200, originalBody: true },
        reviewFile: { mode: '600', access: 'historical_data_read_only', startupAvailable: false },
        business: 422, queueHeld: true, providerRequests: 2,
        consumerEntry: { origin: 'package', package: { source: COMMIT, buildId: 'b', tarSha256: DIGEST, tarBytes: 1 },
          files: [{ path: 'apps/launcher/lib/start.mjs', sha256: 'a'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/restored-review.ts', sha256: 'b'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/demo.ts', sha256: 'c'.repeat(64), bytes: 1 }] },
      }
    case 'restoredReviewRefusals':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', entryOrigin: 'main CLI + demo.ts',
        results: { tamperedSignature: { healthy: false }, foreignRoot: { healthy: false }, publicMode: { healthy: false },
          symlink: { healthy: false }, fifo: { healthy: false }, expiredOrTampered: { healthy: false },
          existingOutput: { status: 1 }, unknownProject: { status: 1 }, unsafePath: { status: 1 } },
        notTestedEntry: ['expiry with a valid signature'], notTestedReason: 'forging a signature needs the probe-owned action key',
        consumerEntry: { origin: 'package', package: { source: COMMIT, buildId: 'b', tarSha256: DIGEST, tarBytes: 1 },
          files: [{ path: 'apps/launcher/lib/start.mjs', sha256: 'a'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/restored-review.ts', sha256: 'b'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/demo.ts', sha256: 'c'.repeat(64), bytes: 1 }] },
      }
    case 'reviewReuse':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', healthDigest: DIGEST, digestAvailable: true, sameDigest: DIGEST, firstPid: 100, unboundPid: 200, pidAfterRefusals: 100, pidAfterUnbound: 200,
        packageCapability: { source: COMMIT, buildId: 'b', tarSha256: DIGEST, digestSupported: true },
        processes: { live: 'start-1', reused: 'start-1' }, scope: 'selection digest present',
        consumerEntry: { origin: 'package', package: { source: COMMIT, buildId: 'b', tarSha256: DIGEST, tarBytes: 1 },
          files: [{ path: 'apps/launcher/lib/start.mjs', sha256: 'a'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/restored-review.ts', sha256: 'b'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/demo.ts', sha256: 'c'.repeat(64), bytes: 1 }] },
        outcomes: { sameFile: { status: 'REUSED', instance: { pid: 100, processStart: 'start-1' } },
          differentFile: { status: 'BLOCKED', code: 'restored_review_selection_mismatch' },
          missingFile: { status: 'BLOCKED', code: 'restored_review_selection_mismatch' },
          portChange: { status: 'BLOCKED', code: 'instance_conflict' },
          unboundThenSelection: { status: 'BLOCKED', code: 'restored_review_selection_mismatch' } },
      }
    case 'scopeDiagnostics':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal',
        consumerEntry: { origin: 'package', package: { source: COMMIT, buildId: 'b', tarSha256: DIGEST, tarBytes: 1 },
          files: [{ path: 'apps/launcher/lib/start.mjs', sha256: 'a'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/restored-review.ts', sha256: 'b'.repeat(64), bytes: 1 },
            { path: 'apps/coordinator/product/demo.ts', sha256: 'c'.repeat(64), bytes: 1 }] },
        plain: { plain: 200, plainHasDiagnostic: false, optIn: 200, duplicate: 400, unknown: 400, state: 'verified', bindingSourceCount: 0,
          diagnostic: { protocol: 'context-scope-review/1', reasons: [], partial: false, withheldSourceCount: 0, authorization: 'none' } },
        narrow: { start: 'RUNNING', plain: 200, bodyServed: false, state: 'scope_changed', bindingSourceCount: 1,
          diagnostic: { protocol: 'context-scope-review/1', reasons: ['selection_narrowed'], partial: true, withheldSourceCount: 1, authorization: 'none' } },
      }
    case 'trialUi':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', selector: { navigations: ['主对话视图', '试用准备'], trialRegion: '试用准备', draft: '.composer textarea' },
        bundle: { entry: 'app/apps/console/dist/assets/index-1.js', sha256: DIGEST, bytes: 10 },
        actions: { model: 'opened-settings', import: 'opened-import-form', executor: 'opened-executor', conversation: 'opened-conversation-draft-kept' },
        negatives: { abort: { preservesPrior: true }, badSchema: { alertShown: true, leaksGranted: false, keepsPersonal: true }, legacy: { absentInterfaceStated: true } },
        readinessReads: 1, writes: 0, providerBefore: 2, providerAfter: 2,
        layout: { desktop: { overlaps: [], overflow: { scrollWidth: 1440, innerWidth: 1440 } },
          mobile: { overlaps: [], overflow: { scrollWidth: 390, innerWidth: 390 } } },
        screenshots: [{ path: 'a.png', sha256: DIGEST, bytes: 2048 }, { path: 'b.png', sha256: 'c'.repeat(64), bytes: 2048 }],
        problems: ['console: Failed to load resource: net::ERR_FAILED', 'console: Failed to load resource: the server responded with a status of 404 (Not Found)', 'console: Failed to load resource: net::ERR_EMPTY_RESPONSE'],
        pageErrors: [], problemsFiltered: { total: 3, injectedResourceFailures: 3 },
      }
    case 'readiness':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', mockRequests: 2, providerBefore: 2,
        normal: {
          status: 'RUNNING', mode: 'personal', startupMode: 'normal',
          readiness: { status: 200, body: { protocol: 'trial-readiness/1', observedAt: '2026-11-14T00:00:00.000Z', configurationRevision: DIGEST,
            mode: 'personal', startupMode: 'normal', discussion: 'not_configured',
            execution: { state: 'unknown' }, development: 'needs_project',
            projects: { development: 0, discussion: 1, dispatchable: 0 },
            profiles: { native: 0, controlled: 1, admittedNative: 0, admittedControlled: 0 },
            capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false }, authorization: 'none' } },
          configuration: { revision: DIGEST },
          negatives: { invalidBearer: 401, noBearer: 401, badQuery: 400, badQueryCode: 'invalid_request', missingRoute: 404 },
          registration: 200, after: { status: 200, body: { observedAt: '2026-11-14T00:00:05.000Z', configurationRevision: 'c'.repeat(64),
            projects: { development: 1, discussion: 1, dispatchable: 0 } } },
        },
        readonly: {
          status: 'RUNNING', startupMode: 'recovery_readonly',
          readiness: { status: 200, body: { protocol: 'trial-readiness/1', observedAt: '2026-11-14T00:00:00.000Z', configurationRevision: DIGEST,
            mode: 'personal', startupMode: 'recovery_readonly', discussion: 'not_configured',
            execution: { state: 'unavailable', reason: 'recovery_readonly' }, development: 'readonly',
            projects: { development: 1, discussion: 1, dispatchable: 0 },
            profiles: { native: 1, controlled: 1, admittedNative: 0, admittedControlled: 0 },
            capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false }, authorization: 'none' } },
        },
        fixture: {
          status: 'RUNNING', mode: 'fixture',
          readiness: { status: 200, body: { protocol: 'trial-readiness/1', observedAt: '2026-11-14T00:00:00.000Z', configurationRevision: DIGEST,
            mode: 'fixture', startupMode: 'normal', discussion: 'not_configured',
            execution: { state: 'available', kind: 'controlled_fixture' }, development: 'fixture_only',
            projects: { development: 0, discussion: 1, dispatchable: 0 },
            profiles: { native: 0, controlled: 1, admittedNative: 0, admittedControlled: 0 },
            capabilities: { contextHistory: true, contextSources: true, decisions: false, proposals: false }, authorization: 'none' } },
        },
      }
    case 'workflowFormats':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'installed_bytes', capability: 'default1+explicit2',
        snapshotProtocols: ['workflow-snapshot/1', 'workflow-snapshot/2'], evidenceProtocols: ['workflow-evidence/1', 'workflow-evidence/2'],
        hasFormatVersion: true, hasFamilySetVersion: true, readSignature: 'export function readWorkflowEvidence(databasePath: string, version: 1 | 2 = 1)',
        v1: { protocol: 'workflow-snapshot/1', evidenceProtocol: 'workflow-evidence/1', families: 13, familySetVersion: null, status: 'ok', verified: 'ok', digest: DIGEST },
        v2: { protocol: 'workflow-snapshot/2', evidenceProtocol: 'workflow-evidence/2', families: 21, familySetVersion: 2, status: 'ok', verified: 'ok', digest: 'c'.repeat(64) },
        invalid3: { rejected: true, destinationCreated: false }, dbUnchanged: true, dbBytes: 679936,
        portability: { installArtifact: 'pa-install/1', restoreReport: 'personal-restore/1' },
        packageCapabilities: { source: COMMIT, buildId: 'b', tarSha256: DIGEST, digestSupported: true },
        explicitV2: 'verified: workflow-snapshot/2 with 21 families and familySetVersion 2',
      }
    case 'installedStability':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'recovery_readonly', concurrent: [200, 200, 200, 200], repeatedEqual: true, queueReturned: true, countsStable: true,
        providerUnchanged: true, reopened: 'RUNNING', reopenedEqual: true,
      }
    case 'secondRoot':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'recovery_readonly', restore: 'RESTORED', verify: 'VERIFIED',
        probeScope: 'fixture+recovery_readonly', personalRebinding: 'main_readonly_binding_entry_absent',
        businessData: { producer: 'installed fixture executor', workPhase: 'delivered', workArtifacts: 1, questionsAnswered: 1,
          candidateConfirmed: 'recorded', nativeApplied: false, boundary: 'fixture scope only' },
        before: { bindings: 1, results: 1, messages: 4, decisions: 1, questions: 1 }, after: { bindings: 1, results: 1, messages: 4, decisions: 1 },
        readOnly: { originalBodyEqual: true, messages: 4, workPhase: 'delivered', workArtifacts: 1, questionsVisible: 1, candidates: 200, candidateStatus: 'candidates', candidateCount: 1,
          audit: 200, history: 200, historyRows: 1, sources: 200, business: 422, effectRows: 0, effectRowsBefore: 0,
          modelRequestsBefore: 2, modelRequestsAfter: 2 },
      }
    case 'installedSourceConfirm':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'recovery_readonly', prepare: { status: 200, authorization: 'not_granted', startupAvailable: false, targetCreated: false },
        confirm: { status: 200, activationId: 'activation-1', auditEqual: true }, queueHeld: true, markerUnchanged: true,
        replay: { status: 200, equal: true }, reopened: { status: 'RUNNING', replay: 200, equal: true }, providerRequests: 2,
      }
    case 'installedCandidates':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', action: 'discussion_only_default_off_then_enabled',
        actions: { suggestionsOff: 200, suggestionsOffEnabled: false, offCandidateStatus: 'none',
          suggestionsOn: 200, suggestionsOnEnabled: true, candidates: 200, candidateStatus: 'candidates', candidateCount: 2,
          candidateWorkPrepare: 200, candidateWorkRequiredInputs: ['work.scope'], candidateWorkStatus: 'rejected',
          candidatePrepare: 200, candidateConfirm: 200, candidateConfirmStatus: 'recorded',
          candidateReplay: 200, candidateReplaySame: true, candidateRejectPrepare: 200, candidateReject: 200, candidateRejectStatus: 'recorded',
          nativeSends: 0, dispatchPaused: 'discussion_only_no_executor' },
      }
    case 'ownershipMocks':
      return {
        subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        helper: {
          upgradePath: 'install/app/apps/launcher/lib/upgrade.mjs',
          instancePath: 'install/app/apps/launcher/lib/instance.mjs',
          upgradeSha256: '1'.repeat(64), instanceSha256: '2'.repeat(64), upgradeBytes: 60281, instanceBytes: 20023,
          sourceCommit: COMMIT, buildId: 'b', tarSha256: DIGEST,
        },
        productSource: { artifact: 'target', source: COMMIT, buildId: 'b', tarSha256: DIGEST },
        probeSource: { path: 'tests/product-acceptance/cases/w17-d-child-gate.mjs', sha256: '3'.repeat(64) },
        previousPackageHelper: { source: BASELINE, buildId: 'old', tarSha256: '4'.repeat(64), upgradeSha256: '5'.repeat(64),
          pass: 2, fail: 3, failures: ['same_uid_child_not_owned', 'child_not_signalled', 'unknown_child_blocks_proof'], proof: { proven: true } },
        steps: [{ id: 'parent_owned', status: 'PASS' }, { id: 'same_uid_child_not_owned', status: 'PASS' }, { id: 'child_not_signalled', status: 'PASS' }, { id: 'unknown_child_blocks_proof', status: 'PASS' }],
        proof: { proven: false },
      }
    case 'ownershipCopy':
      return { subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        status: 2, code: 'requested_root_mismatch', apiAlive: true }
    case 'upgradeFaults': {
      const probe = { fault: { code: 'upgrade_interrupted', operationId: 'operation-1' }, recover: { status: 'RECOVERED_PREVIOUS', exit: 0, code: null },
        operation: { after: 'operation-1' }, pointerBefore: 'build-old', pointerAfter: 'build-old', dataKept: true,
        steps: [{ id: 'fault_observed', status: 'PASS' }, { id: 'recover', status: 'PASS' }, { id: 'recovered_health', status: 'PASS' }, { id: 'data_kept', status: 'PASS' }] }
      return { subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        windows: Object.fromEntries(['crash_after_stop', 'crash_after_stop_kill', 'target_unhealthy'].map(mode => [mode, { probe }])) } }
    case 'currentInstall':
      return { subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        mode: 'personal', action: 'probe', observed: 'RUNNING', instanceMode: 'personal',
        capability: { hasContextRoute: true, hasHistoryRoute: true, hasSourcesRoute: true, hasReplyResults: true, hasDiscussionReadiness: true },
        configuration: { assistantContextAvailable: true }, actions: { send: 200, sendStatus: 'recorded', audit: 200, history: 200, sources: 200, reply: 'ok' } }
    case 'backupContextReply':
      return { subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        before: { bindings: 1, results: 1, messages: 2 }, after: { bindings: 1, results: 1, messages: 2 }, artifacts: 1, reply: 'ok' }
    case 'frozenScope':
      return { artifact: { buildId: 'b', source: 'a'.repeat(40), schema: 18, tarSha256: 'b'.repeat(64), tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' },
        capability: { hasContextRoute: true, hasHistoryRoute: true, hasSourcesRoute: true, hasReplyResults: true }, main: { schema: 18 }, currentMainEligible: true }
    case 'legacyMigration':
      return { old: { schema: 16, messages: 2 }, migrated: { schema: 18, messages: 2 } }
    case 'schemaMigration':
      return { old: { schema: 15, messages: 3 }, migrated: { schema: 16, messages: 3, bindingTable: true }, reopened: true }
    case 'completedReply':
      return { providerRequests: 1, replies: 1, auditStable: true }
    case 'unknownReply':
      return { providerRequests: 1, notice: true, reply: false }
    case 'backupContextReply':
      return { before: { bindings: 1, results: 1, messages: 2 }, after: { bindings: 1, results: 1, messages: 2 }, artifacts: 1, reply: 'ok' }
    case 'installedContext':
      return { mode: 'fixture', subject: { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' }, available: true, prepare: 200, send: 'recorded', reply: 'ok', audit: 200, modelCalls: 1 }
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
        deadLauncher: { status: 'UNVERIFIED', apiAliveBefore: true, stopExit: 0, apiAliveAfterStop: false },
      }
    case 'crossUpgrade':
      return { baseline: { buildId: 'old', schema: 16, source: 'old' }, migratedSchema: 18,
        status: 'BLOCKED', code: 'state_schema_newer_than_binary', dataSchema: 18 }
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

const buildCase = (entry, overrides = {}) => {
  const evidence = Object.fromEntries((entry.evidence ?? []).map((key) => [key, evidenceFor(key)]))
  const nested = ['subject', 'frozenScope', 'currentInstall', 'upgradeFaults', 'ownershipCopy', 'installedContext',
    'backupContextReply', 'ownershipMocks', 'installedCandidates', 'secondRoot', 'installedSourceConfirm', 'installedStability']
    .some((key) => evidence[key] !== undefined)
  if ((entry.layers ?? []).includes(LAYERS.INSTALLED) && entry.id !== 'E4-INSTALL-ARTIFACT-IDENTITY' && !nested)
    evidence.subject = { source: COMMIT, buildId: 'b', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' }
  return {
    id: entry.id,
    layer: entry.layers[0],
    status: STATUS.PASS,
    assertions: [{ id: 'MUTATION-CONTROL', ok: true }],
    source: { commit: COMMIT },
    evidence,
    ...overrides,
  }
}

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
const INSTALL_ID = 'E4-INSTALL-ARTIFACT-IDENTITY'
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
    id: 'E1-MUTATE-REQUIRED-FAIL',
    title: 'A required case with FAIL status blocks the tier',
    check: ({ assert }) =>
      rejectWith(assert, 'REQUIRED_FAIL', (report) => {
        findCase(report, INSTALL_ID).status = STATUS.FAIL
        return report
      }, 'case_not_pass'),
  },
  {
    id: 'E1-MUTATE-REQUIRED-UNKNOWN',
    title: 'A required case with UNKNOWN status blocks the tier',
    check: ({ assert }) =>
      rejectWith(assert, 'REQUIRED_UNKNOWN', (report) => {
        findCase(report, INSTALL_ID).status = STATUS.UNKNOWN
        return report
      }, 'case_not_pass'),
  },
  {
    id: 'E1-MUTATE-WRONG-REPORT-SOURCE',
    title: 'A report whose source differs from the evaluated source is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'WRONG_REPORT_SOURCE', (report) => {
        report.source.commit = 'f'.repeat(40)
        return report
      }, 'source_mismatch'),
  },
  {
    id: 'E1-MUTATE-WRONG-ARTIFACT-TUPLE',
    title: 'A changed frozen tar tuple is rejected instead of accepted as the tested artifact',
    check: ({ assert }) =>
      rejectWith(assert, 'WRONG_ARTIFACT_TUPLE', (report) => {
        findCase(report, 'E6-ARTIFACT-CURRENT-SCOPE').evidence.frozenScope.artifact.source = 'not-a-commit'
        return report
      }, 'frozenScope_invalid'),
  },
  {
    id: 'E1-MUTATE-REQUIRED-PASS-EMPTY-EVIDENCE',
    title: 'Required PASS cases with empty evidence are rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'REQUIRED_PASS_EMPTY', (report) => {
        for (const id of ['E7-OWNERSHIP-COPY', 'E4-UPGRADE-FAULTS', 'E6-CURRENT-MAIN-INSTALL']) {
          const item = findCase(report, id)
          item.status = STATUS.PASS
          item.assertions = [{ id: 'label-only', ok: true }]
          item.evidence = {}
        }
        return report
      }, 'required_evidence_missing'),
  },
  {
    id: 'E1-MUTATE-FOREIGN-SUBJECT-SOURCE',
    title: 'A valid-looking foreign source cannot be substituted for the tested artifact',
    check: ({ assert }) =>
      rejectWith(assert, 'FOREIGN_SOURCE', (report) => {
        findCase(report, 'E4-INSTALL-ARTIFACT-IDENTITY').evidence.artifact = { tuple: { target: {
          sourceCommit: COMMIT, buildId: 'build-1', productSchema: 18, tarSha256: DIGEST, tarBytes: 1 } } }
        findCase(report, 'E6-INSTALLED-CONTEXT').evidence.installedContext.subject = {
          source: 'a'.repeat(40), buildId: 'build-1', schema: 18, tarSha256: DIGEST, tarBytes: 1 }
        return report
      }, 'subject_mismatch'),
  },
  {
    id: 'E1-MUTATE-FOREIGN-SUBJECT-SHA-SIZE',
    title: 'A valid-looking foreign SHA/byte size cannot satisfy the subject relation',
    check: ({ assert }) =>
      rejectWith(assert, 'FOREIGN_SHA_SIZE', (report) => {
        findCase(report, 'E4-INSTALL-ARTIFACT-IDENTITY').evidence.artifact = { tuple: { target: {
          sourceCommit: COMMIT, buildId: 'build-1', productSchema: 18, tarSha256: DIGEST, tarBytes: 1 } } }
        findCase(report, 'E6-INSTALLED-CONTEXT').evidence.installedContext.subject = {
          source: COMMIT, buildId: 'build-1', schema: 18, tarSha256: 'f'.repeat(64), tarBytes: 9 }
        return report
      }, 'subject_mismatch'),
  },
  {
    id: 'E1-MUTATE-FOREIGN-SUBJECT-BUILD',
    title: 'A valid-looking foreign build id cannot satisfy the subject relation',
    check: ({ assert }) =>
      rejectWith(assert, 'FOREIGN_BUILD', (report) => {
        findCase(report, 'E4-INSTALL-ARTIFACT-IDENTITY').evidence.artifact = { tuple: { target: {
          sourceCommit: COMMIT, buildId: 'build-1', productSchema: 18, tarSha256: DIGEST, tarBytes: 1 } } }
        findCase(report, 'E6-INSTALLED-CONTEXT').evidence.installedContext.subject = {
          source: COMMIT, buildId: 'foreign-build', schema: 18, tarSha256: DIGEST, tarBytes: 1 }
        return report
      }, 'subject_mismatch'),
  },
  {
    id: 'E1-MUTATE-WRONG-MODE',
    title: 'A fixture-mode installed probe cannot be relabeled as personal',
    check: ({ assert }) =>
      rejectWith(assert, 'WRONG_MODE', (report) => {
        findCase(report, 'E6-INSTALLED-CONTEXT').evidence.installedContext.mode = 'personal'
        return report
      }, 'installedContext_invalid'),
  },
  {
    id: 'E1-MUTATE-REQUIRED-WRONG-RUN',
    title: 'A required install case bound to another source run is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'REQUIRED_WRONG_RUN', (report) => {
        findCase(report, 'E7-OWNERSHIP-COPY').source = { commit: 'e'.repeat(40) }
        return report
      }, 'stale_case_evidence'),
  },
  {
    id: 'E1-MUTATE-CURRENT-BLOCKED-AS-PASS',
    title: 'A BLOCKED/null-health current probe cannot be relabeled PASS',
    check: ({ assert }) =>
      rejectWith(assert, 'CURRENT_BLOCKED_PASS', (report) => {
        const item = findCase(report, 'E6-CURRENT-MAIN-INSTALL')
        item.status = STATUS.PASS
        item.assertions = [{ id: 'label-only', ok: true }]
        item.evidence.currentInstall = { ...item.evidence.currentInstall, observed: 'BLOCKED', health: null, instanceMode: null }
        return report
      }, 'current_install_failed'),
  },
  {
    id: 'E1-MUTATE-CURRENT-FIXTURE-MODE',
    title: 'A fixture-mode instance cannot satisfy current personal installation',
    check: ({ assert }) =>
      rejectWith(assert, 'CURRENT_FIXTURE', (report) => {
        const item = findCase(report, 'E6-CURRENT-MAIN-INSTALL')
        item.status = STATUS.PASS
        item.assertions = [{ id: 'label-only', ok: true }]
        item.evidence.currentInstall = { ...item.evidence.currentInstall, mode: 'fixture', instanceMode: 'fixture' }
        return report
      }, 'current_install_failed'),
  },
  {
    id: 'E1-MUTATE-OWNERSHIP-COPY-NO-EXIT',
    title: 'A refused copy without exit/code is not behavioral ownership evidence',
    check: ({ assert }) =>
      rejectWith(assert, 'COPY_NO_EXIT', (report) => {
        const item = findCase(report, 'E7-OWNERSHIP-COPY')
        item.status = STATUS.PASS
        item.assertions = [{ id: 'label-only', ok: true }]
        item.evidence.ownershipCopy = { ...item.evidence.ownershipCopy, status: undefined, code: null, apiAlive: true }
        return report
      }, 'ownership_copy_failed'),
  },
  {
    id: 'E1-MUTATE-FAULT-STEP-NAMES',
    title: 'Fault windows made only of PASS step names are rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'FAULT_STEP_NAMES', (report) => {
        const item = findCase(report, 'E4-UPGRADE-FAULTS')
        item.status = STATUS.PASS
        item.assertions = [{ id: 'label-only', ok: true }]
        const steps = [{ id: 'fault_observed', status: 'PASS' }, { id: 'recover', status: 'PASS' }, { id: 'recovered_health', status: 'PASS' }, { id: 'data_kept', status: 'PASS' }]
        item.evidence.upgradeFaults.windows = Object.fromEntries(['crash_after_stop', 'crash_after_stop_kill', 'target_unhealthy'].map(mode => [mode, { probe: { steps } }]))
        return report
      }, 'upgrade_faults_failed'),
  },
  {
    id: 'E1-MUTATE-RECOVER-BLOCKED',
    title: 'A BLOCKED/exit2/unknown_live_resource recovery cannot satisfy the fault window',
    check: ({ assert }) =>
      rejectWith(assert, 'RECOVER_BLOCKED', (report) => {
        const item = findCase(report, 'E4-UPGRADE-FAULTS')
        const probe = item.evidence.upgradeFaults.windows.crash_after_stop.probe
        probe.recover = { status: 'BLOCKED', exit: 2, code: 'unknown_live_resource' }
        return report
      }, 'upgradeFaults_invalid'),
  },
  {
    id: 'E1-MUTATE-RECOVER-EXIT1-SUCCESS',
    title: 'The actual D success terminal status with exit1 is bound to pointer/data, not ignored',
    check: ({ assert }) =>
      rejectWith(assert, 'RECOVER_EXIT1', (report) => {
        const item = findCase(report, 'E4-UPGRADE-FAULTS')
        const probe = item.evidence.upgradeFaults.windows.crash_after_stop.probe
        probe.recover = { status: 'RECOVERED_PREVIOUS', exit: 1, code: null }
        probe.pointerAfter = 'build-new'
        return report
      }, 'upgradeFaults_invalid'),
  },
  {
    id: 'E1-MUTATE-FAULT-WRONG-OPERATION',
    title: 'A recovery that does not retain the original operation is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'FAULT_OPERATION', (report) => {
        const item = findCase(report, 'E4-UPGRADE-FAULTS')
        const probe = item.evidence.upgradeFaults.windows.crash_after_stop.probe
        probe.operation.after = 'other-operation'
        return report
      }, 'upgradeFaults_invalid'),
  },
  {
    id: 'E1-MUTATE-NOOP-EXIT1',
    title: 'A successful NO_OP terminal with exit1 is rejected for the current CLI contract',
    check: ({ assert }) =>
      rejectWith(assert, 'NOOP_EXIT1', (report) => {
        const item = findCase(report, 'E4-UPGRADE-FAULTS')
        const probe = item.evidence.upgradeFaults.windows.target_unhealthy.probe
        probe.recover = { status: 'NO_OP', exit: 1, code: null }
        return report
      }, 'upgradeFaults_invalid'),
  },
  {
    id: 'E1-MUTATE-POINTER-MISSING',
    title: 'Missing pointerBefore/pointerAfter cannot pass by undefined equality',
    check: ({ assert }) =>
      rejectWith(assert, 'POINTER_MISSING', (report) => {
        const item = findCase(report, 'E4-UPGRADE-FAULTS')
        const probe = item.evidence.upgradeFaults.windows.crash_after_stop.probe
        delete probe.pointerBefore
        delete probe.pointerAfter
        return report
      }, 'upgradeFaults_invalid'),
  },
  {
    id: 'E1-MUTATE-FOREIGN-ABI-PLATFORM',
    title: 'linux/x64/ABI999 subject cannot certify a darwin/arm64/137 package',
    check: ({ assert }) =>
      rejectWith(assert, 'FOREIGN_ABI', (report) => {
        findCase(report, 'E4-INSTALL-ARTIFACT-IDENTITY').evidence.artifact = { tuple: { target: {
          sourceCommit: COMMIT, buildId: 'build-1', productSchema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '137', platform: 'darwin', arch: 'arm64' } } }
        const item = findCase(report, 'E6-CURRENT-MAIN-INSTALL')
        item.evidence.currentInstall = { ...item.evidence.currentInstall, subject: {
          source: COMMIT, buildId: 'build-1', schema: 18, tarSha256: DIGEST, tarBytes: 1, abi: '999', platform: 'linux', arch: 'x64' } }
        return report
      }, 'subject_mismatch'),
  },
  {
    id: 'E1-MUTATE-HELPER-FOREIGN-PROVENANCE',
    title: 'A new-source safety helper cannot certify the older installed subject',
    check: ({ assert }) =>
      rejectWith(assert, 'HELPER_FOREIGN', (report) => {
        // The full original report stays intact; only the helper provenance is swapped to the newer
        // frozen package while the installed subject remains the older one.
        const item = findCase(report, 'E5-D-OWNERSHIP-MOCKS')
        item.evidence.ownershipMocks = { ...item.evidence.ownershipMocks,
          helper: { ...item.evidence.ownershipMocks.helper, sourceCommit: '9'.repeat(40), buildId: 'new-build', tarSha256: '8'.repeat(64) } }
        return report
      }, 'helper_source'),
  },
  {
    id: 'E1-MUTATE-HELPER-WITHOUT-FILE-HASH',
    title: 'Helper provenance without the loaded file digest is not admissible',
    check: ({ assert }) =>
      rejectWith(assert, 'HELPER_NO_HASH', (report) => {
        const item = findCase(report, 'E5-D-OWNERSHIP-MOCKS')
        delete item.evidence.ownershipMocks.helper.upgradeSha256
        return report
      }, 'helper_provenance'),
  },
  {
    id: 'E1-MUTATE-OWNERSHIP-SUBJECT-FOREIGN',
    title: 'The safety probe subject must equal the tested install tuple',
    check: ({ assert }) =>
      rejectWith(assert, 'OWNERSHIP_SUBJECT', (report) => {
        const item = findCase(report, 'E5-D-OWNERSHIP-MOCKS')
        item.evidence.ownershipMocks.subject = { ...item.evidence.ownershipMocks.subject, source: '6'.repeat(40) }
        return report
      }, 'subject_mismatch'),
  },
  {
    id: 'E1-MUTATE-NO-PREVIOUS-CONTROL',
    title: 'A safety probe without the failing previous-package control is not admissible',
    check: ({ assert }) =>
      rejectWith(assert, 'NO_CONTROL', (report) => {
        delete findCase(report, 'E5-D-OWNERSHIP-MOCKS').evidence.ownershipMocks.previousPackageHelper
        return report
      }, 'previous_control'),
  },
  {
    id: 'E1-MUTATE-INSTALLED-CANDIDATE-NATIVE',
    title: 'A candidate confirmation that records a native send is not an installed candidate proof',
    check: ({ assert }) =>
      rejectWith(assert, 'CANDIDATE_NATIVE', (report) => {
        findCase(report, 'E5-INSTALLED-CANDIDATES').evidence.installedCandidates.actions.nativeSends = 1
        return report
      }, 'installedCandidates_invalid'),
  },
  {
    id: 'E1-MUTATE-INSTALLED-CANDIDATE-NO-REPLAY',
    title: 'A candidate proof without the original receipt replay is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'CANDIDATE_NO_REPLAY', (report) => {
        findCase(report, 'E5-INSTALLED-CANDIDATES').evidence.installedCandidates.actions.candidateReplaySame = false
        return report
      }, 'installedCandidates_invalid'),
  },
  {
    id: 'E1-MUTATE-SECOND-ROOT-RESEND',
    title: 'A second root that issued a provider request is not a held restored snapshot',
    check: ({ assert }) =>
      rejectWith(assert, 'SECOND_ROOT_RESEND', (report) => {
        findCase(report, 'E7-SECOND-ROOT-READONLY').evidence.secondRoot.readOnly.modelRequestsAfter = 3
        return report
      }, 'secondRoot_invalid'),
  },
  {
    id: 'E1-MUTATE-SOURCE-PREPARE-GRANTED',
    title: 'An installed source confirmation that claims authorization is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'SOURCE_GRANTED', (report) => {
        findCase(report, 'E6-INSTALLED-SOURCE-CONFIRM').evidence.installedSourceConfirm.prepare.authorization = 'granted'
        return report
      }, 'installedSourceConfirm_invalid'),
  },
  {
    id: 'E1-MUTATE-STABILITY-QUEUE-NOT-RETURNED',
    title: 'A stability run that leaves queue rows behind is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'STABILITY_QUEUE', (report) => {
        findCase(report, 'E9-INSTALLED-STABILITY').evidence.installedStability.queueReturned = false
        return report
      }, 'installedStability_invalid'),
  },
  {
    id: 'E1-MUTATE-WORKFLOW-V2-BORROWED',
    title: 'A package without dual-version code cannot claim explicit v2 support',
    check: ({ assert }) =>
      rejectWith(assert, 'WORKFLOW_V2', (report) => {
        const item = findCase(report, 'E5-WORKFLOW-FORMATS').evidence.workflowFormats
        item.v2 = { ...item.v2, families: 13 }
        return report
      }, 'workflowFormats_invalid'),
  },
  {
    id: 'E1-MUTATE-SECOND-ROOT-PERSONAL-CLAIM',
    title: 'A fixture second root cannot be presented as a personal rebinding',
    check: ({ assert }) =>
      rejectWith(assert, 'SECOND_ROOT_PERSONAL', (report) => {
        delete findCase(report, 'E7-SECOND-ROOT-READONLY').evidence.secondRoot.probeScope
        return report
      }, 'secondRoot_invalid'),
  },
  {
    id: 'E1-MUTATE-PERSONAL-REVIEW-UNBOUND-READ',
    title: 'An unbound restored personal start that already reads the project is not the explicit-review proof',
    check: ({ assert }) =>
      rejectWith(assert, 'PERSONAL_UNBOUND', (report) => {
        findCase(report, 'E4-PERSONAL-RESTORED-REVIEW').evidence.personalReview.before.candidates = 200
        return report
      }, 'personalReview_invalid'),
  },
  {
    id: 'E1-MUTATE-PERSONAL-REVIEW-FIFO-ALLOWED',
    title: 'A blocking FIFO review input that still starts is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'REVIEW_FIFO', (report) => {
        findCase(report, 'E5-RESTORED-REVIEW-REFUSALS').evidence.restoredReviewRefusals.results.fifo.healthy = true
        return report
      }, 'restoredReviewRefusals_invalid'),
  },
  {
    id: 'E1-MUTATE-CONSUMER-ENTRY-FOREIGN',
    title: 'A source-checkout consumer cannot back an installed review claim even with the right data tuple',
    check: ({ assert }) =>
      rejectWith(assert, 'CONSUMER_FOREIGN', (report) => {
        const item = findCase(report, 'E4-PERSONAL-RESTORED-REVIEW').evidence.personalReview
        item.consumerEntry.package = { ...item.consumerEntry.package, source: 'e'.repeat(40), buildId: 'foreign-build', tarSha256: 'f'.repeat(64) }
        item.consumerEntry.files[0].sha256 = 'f'.repeat(64)
        return report
      }, 'personalReview_invalid'),
  },
  {
    id: 'E1-MUTATE-CONSUMER-ENTRY-SOURCE-ORIGIN',
    title: 'A main-checkout consumer is not an installed consumer',
    check: ({ assert }) =>
      rejectWith(assert, 'CONSUMER_SOURCE', (report) => {
        findCase(report, 'E5-RESTORED-REVIEW-REFUSALS').evidence.restoredReviewRefusals.consumerEntry.origin = 'source'
        return report
      }, 'restoredReviewRefusals_invalid'),
  },
  {
    id: 'E1-MUTATE-REUSE-SILENT-SELECTION',
    title: 'A different review selection that silently reuses the live instance is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'REUSE_SILENT', (report) => {
        findCase(report, 'E5-REVIEW-REUSE-CONSISTENCY').evidence.reviewReuse.outcomes.differentFile = { status: 'RUNNING', reused: true, instance: { pid: 100 } }
        return report
      }, 'reviewReuse_invalid'),
  },
  {
    id: 'E1-MUTATE-SCOPE-DIAGNOSTIC-LEAK',
    title: 'Default sources response must not carry the optional scope review field',
    check: ({ assert }) =>
      rejectWith(assert, 'DIAGNOSTIC_LEAK', (report) => {
        findCase(report, 'E7-SCOPE-DIAGNOSTICS').evidence.scopeDiagnostics.plain.plainHasDiagnostic = true
        return report
      }, 'scopeDiagnostics_invalid'),
  },
  {
    id: 'E1-MUTATE-SCOPE-WITHHELD-NEGATIVE',
    title: 'A negative withheld source count is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'WITHHELD_NEGATIVE', (report) => {
        const value = findCase(report, 'E7-SCOPE-DIAGNOSTICS').evidence.scopeDiagnostics
        value.plain.diagnostic.withheldSourceCount = -1
        return report
      }, 'scopeDiagnostics_invalid'),
  },
  {
    id: 'E1-MUTATE-SCOPE-WITHHELD-OVERFLOW',
    title: 'A withheld source count beyond the public bound is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'WITHHELD_OVERFLOW', (report) => {
        const value = findCase(report, 'E7-SCOPE-DIAGNOSTICS').evidence.scopeDiagnostics
        value.narrow.diagnostic.withheldSourceCount = 65
        return report
      }, 'scopeDiagnostics_invalid'),
  },
  {
    id: 'E1-MUTATE-SCOPE-DUPLICATE-REASON',
    title: 'Duplicate or invalid scope reasons are rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'REASON_DUPLICATE', (report) => {
        const value = findCase(report, 'E7-SCOPE-DIAGNOSTICS').evidence.scopeDiagnostics
        value.narrow.diagnostic.reasons = ['selection_narrowed', 'selection_narrowed']
        return report
      }, 'scopeDiagnostics_invalid'),
  },
  {
    id: 'E1-MUTATE-SCOPE-AUTHORIZATION',
    title: 'A scope diagnostic claiming authorization is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'DIAG_AUTH', (report) => {
        const value = findCase(report, 'E7-SCOPE-DIAGNOSTICS').evidence.scopeDiagnostics
        value.plain.diagnostic.authorization = 'granted'
        return report
      }, 'scopeDiagnostics_invalid'),
  },
  {
    id: 'E26-MUTATE-TRIAL-UI-EAGER-READINESS',
    title: 'An installation that reads readiness before the trial view is opened is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'UI_EAGER', (report) => {
        findCase(report, 'E3-TRIAL-WORKBENCH-UI').evidence.trialUi.readinessReads = 0
        return report
      }, 'trialUi_invalid'),
  },
  {
    id: 'E26-MUTATE-TRIAL-UI-GRANTED-LEAK',
    title: 'A bad readiness schema that displays the granted claim is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'UI_LEAK', (report) => {
        findCase(report, 'E3-TRIAL-WORKBENCH-UI').evidence.trialUi.negatives.badSchema.leaksGranted = true
        return report
      }, 'trialUi_invalid'),
  },
  {
    id: 'E26-MUTATE-TRIAL-UI-DRAFT-LOST',
    title: 'A navigation callback that loses the original draft is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'UI_DRAFT', (report) => {
        findCase(report, 'E3-TRIAL-WORKBENCH-UI').evidence.trialUi.actions.conversation = 'draft:'
        return report
      }, 'trialUi_invalid'),
  },
  {
    id: 'E26-MUTATE-TRIAL-UI-MOBILE-OVERFLOW',
    title: 'A mobile layout that overflows horizontally is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'UI_OVERFLOW', (report) => {
        findCase(report, 'E3-TRIAL-WORKBENCH-UI').evidence.trialUi.layout.mobile.overflow.scrollWidth = 420
        return report
      }, 'trialUi_invalid'),
  },
  {
    id: 'E26-MUTATE-TRIAL-UI-NO-SCREENSHOT',
    title: 'A UI claim without a screenshot from the packaged bytes is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'UI_NO_SHOT', (report) => {
        findCase(report, 'E3-TRIAL-WORKBENCH-UI').evidence.trialUi.screenshots = []
        return report
      }, 'trialUi_invalid'),
  },
  {
    id: 'E26-MUTATE-READINESS-SELF-AUTHORIZATION',
    title: 'Readiness cannot claim authorization instead of none',
    check: ({ assert }) =>
      rejectWith(assert, 'READINESS_AUTH', (report) => {
        findCase(report, 'E7-READINESS').evidence.readiness.normal.readiness.body.authorization = 'granted'
        return report
      }, 'readiness_invalid'),
  },
  {
    id: 'E26-MUTATE-READINESS-READONLY-DISPATCH',
    title: 'A recovery-readonly readiness body cannot advertise a dispatchable project',
    check: ({ assert }) =>
      rejectWith(assert, 'READINESS_READONLY', (report) => {
        const body = findCase(report, 'E7-READINESS').evidence.readiness.readonly.readiness.body
        body.projects.dispatchable = 1
        return report
      }, 'readiness_invalid'),
  },
  {
    id: 'E26-MUTATE-READINESS-AUTH-ACCEPTED',
    title: 'An invalid bearer accepted with 200 is not a valid auth refusal',
    check: ({ assert }) =>
      rejectWith(assert, 'READINESS_401', (report) => {
        findCase(report, 'E7-READINESS').evidence.readiness.normal.negatives.invalidBearer = 200
        return report
      }, 'readiness_invalid'),
  },
  {
    id: 'E26-MUTATE-READINESS-STALE-REVISION',
    title: 'A stale readiness revision after a configuration change is rejected',
    check: ({ assert }) =>
      rejectWith(assert, 'READINESS_STALE', (report) => {
        const value = findCase(report, 'E7-READINESS').evidence.readiness.normal
        value.after.body.configurationRevision = value.readiness.body.configurationRevision
        return report
      }, 'readiness_invalid'),
  },
  {
    id: 'E1-MUTATE-CAPABILITY-SELF-DOWNGRADE',
    title: 'A review package cannot self-report unsupported digest while the package fact says supported',
    check: ({ assert }) =>
      rejectWith(assert, 'CAPABILITY_DOWNGRADE', (report) => {
        const value = findCase(report, 'E5-REVIEW-REUSE-CONSISTENCY').evidence.reviewReuse
        value.packageCapability = { ...value.packageCapability, digestSupported: false }
        value.digestAvailable = false
        value.digestScope = 'package_lacks_identity'
        delete value.healthDigest; delete value.sameDigest
        return report
      }, 'capability_mismatch'),
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
