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
    case 'cycles':
      return { requested: 8, completed: 8, attemptCount: 8, failures: [] }
    case 'fixture':
      return { id: 'fixture', path: '/dev/null', sha256: DIGEST }
    case 'verificationRecovery':
      return { blockedId: 'blocked-1', retried: true, accepted: true }
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

export async function gateMutationCases() {
  const results = []
  for (const definition of CASES)
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
