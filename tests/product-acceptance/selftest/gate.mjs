import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCase, STATUS, LAYERS } from '../lib/status.mjs'
import { evaluateRelease, REPORT_SCHEMA } from '../lib/release.mjs'
import { FIXTURE_PROTOCOL, loadFixture } from '../lib/fixtures.mjs'

const NOW = Date.parse('2026-11-10T12:00:00.000Z')
const COMMIT = 'a'.repeat(40)
const DIGEST = 'b'.repeat(64)

const validCase = (overrides = {}) => ({
  id: 'E1-GATE-CONTROL',
  title: 'Control case',
  layer: LAYERS.CONTROLLED,
  status: STATUS.PASS,
  assertions: [{ id: 'CONTROL', ok: true }],
  source: { commit: COMMIT },
  evidence: {
    candidate: { workId: 'work-1', generation: 1 },
    verification: { id: 'verification-1', results: [{ criterionId: 'fixed-output', outcome: 'PASS' }] },
    artifact: { id: 'artifact-1', sha256: DIGEST },
    acceptance: { accepted: true, candidateRef: 'work-1:1' },
  },
  ...overrides,
})

const bundle = (overrides = {}) => ({
  schema: REPORT_SCHEMA,
  source: { commit: COMMIT, dirty: false },
  checkedAt: new Date(NOW).toISOString(),
  cases: [validCase()],
  claim: { status: STATUS.PASS },
  ...overrides,
})

const REQUIREMENT = {
  tier: 'selftest-controlled',
  maxAgeMs: 60 * 60 * 1000,
  allowedLayers: [LAYERS.CONTROLLED, LAYERS.READONLY],
  cases: [{ id: 'E1-GATE-CONTROL', required: true, evidence: ['candidate'] }],
}

const gate = (report, extra = {}) =>
  evaluateRelease({ report, requirement: REQUIREMENT, expectedSource: COMMIT, now: NOW, ...extra })

const temporary = (document) => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-fixture-'))
  const path = join(directory, 'fixture.json')
  writeFileSync(path, JSON.stringify(document, null, 2))
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

/**
 * Every case here is a defect in an otherwise plausible evidence bundle. PASS means the gate named
 * the exact failure; FAIL means the gate would have aggregated bad evidence into a green release.
 */
const CASES = [
  {
    id: 'E1-GATE-CONTROL',
    title: 'A complete, source-bound bundle aggregates as PASS',
    check: ({ assert }) => {
      const result = gate(bundle())
      assert('ACCEPTS_VALID', result.ok === true, JSON.stringify(result.failures))
    },
  },
  {
    id: 'E1-GATE-REJECT-MISSING-CASE',
    title: 'Absent required case cannot be treated as covered',
    check: ({ assert }) => {
      const result = gate(bundle({ cases: [] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'missing_required_case'))
    },
  },
  {
    id: 'E1-GATE-REJECT-UNKNOWN-STATUS',
    title: 'Unknown/undefined status is rejected, not coerced',
    check: ({ assert }) => {
      const result = gate(bundle({ cases: [validCase({ status: 'GREEN' })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'unknown_status'))
    },
  },
  {
    id: 'E1-GATE-REJECT-UNCERTAIN-ACCEPT',
    title: 'An uncertain acceptance never aggregates as delivery',
    check: ({ assert }) => {
      const result = gate(
        bundle({
          cases: [
            validCase({
              evidence: {
                ...validCase().evidence,
                acceptance: { accepted: true, candidateRef: 'work-1:1', uncertain: true },
              },
            }),
          ],
        }),
      )
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'uncertain_acceptance'))
    },
  },
  {
    id: 'E1-GATE-REJECT-STALE-REPORT',
    title: 'An old report that claims PASS is rejected as stale',
    check: ({ assert }) => {
      const result = gate(bundle({ checkedAt: new Date(NOW - 8 * 60 * 60 * 1000).toISOString() }))
      assert('REJECTED', !result.ok)
      assert('STALE', result.failures.some((item) => item.code === 'stale_report'))
      assert('SELF_CLAIM', result.failures.some((item) => item.code === 'self_declared_pass_rejected'))
    },
  },
  {
    id: 'E1-GATE-REJECT-SOURCE-MISMATCH',
    title: 'Evidence from another commit is rejected',
    check: ({ assert }) => {
      const result = gate(bundle({ source: { commit: 'c'.repeat(40) } }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'source_mismatch'))
    },
  },
  {
    id: 'E1-GATE-REJECT-NO-CANDIDATE',
    title: 'Acceptance without a recorded candidate is rejected',
    check: ({ assert }) => {
      const result = gate(
        bundle({
          cases: [validCase({ evidence: { ...validCase().evidence, acceptance: { accepted: true } } })],
        }),
      )
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'missing_candidate'))
    },
  },
  {
    id: 'E1-GATE-REJECT-VACUOUS',
    title: 'A pass with no assertions is not evidence',
    check: ({ assert }) => {
      const result = gate(bundle({ cases: [validCase({ assertions: [] })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'vacuous_pass'))
    },
  },
  {
    id: 'E1-GATE-REJECT-FAILED-ASSERTION',
    title: 'A PASS case carrying a failed assertion is rejected',
    check: ({ assert }) => {
      const result = gate(bundle({ cases: [validCase({ assertions: [{ id: 'X', ok: false }] })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'assertion_failed'))
    },
  },
  {
    id: 'E1-GATE-REJECT-MISSING-EVIDENCE',
    title: 'A required evidence reference must exist',
    check: ({ assert }) => {
      const result = gate(
        bundle({ cases: [validCase({ evidence: { ...validCase().evidence, candidate: undefined } })] }),
      )
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'required_evidence_missing'))
    },
  },
  {
    id: 'E1-GATE-REJECT-DUPLICATE',
    title: 'Duplicate case identity is rejected',
    check: ({ assert }) => {
      const result = gate(bundle({ cases: [validCase(), validCase()] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'duplicate_case_id'))
    },
  },
  {
    id: 'E1-GATE-REJECT-BAD-PATCH',
    title: 'A patch whose recorded digest differs from the downloaded bytes is rejected',
    check: ({ assert }) => {
      const patch = { sha256: DIGEST, verifiedSha256: 'd'.repeat(64), format: 'git-patch', apply: { ok: true } }
      const result = gate(bundle({ cases: [validCase({ evidence: { ...validCase().evidence, patch } })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'bad_patch'))
    },
  },
  {
    id: 'E1-GATE-REJECT-UNAPPLIED-PATCH',
    title: 'A patch that did not apply is rejected',
    check: ({ assert }) => {
      const patch = { sha256: DIGEST, verifiedSha256: DIGEST, format: 'git-patch', apply: { ok: false } }
      const result = gate(bundle({ cases: [validCase({ evidence: { ...validCase().evidence, patch } })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'bad_patch'))
    },
  },
  {
    id: 'E1-GATE-REJECT-MALFORMED-PATCH',
    title: 'A malformed patch digest is rejected',
    check: ({ assert }) => {
      const patch = { sha256: 'nope', verifiedSha256: 'nope', format: 'git-patch', apply: { ok: true } }
      const result = gate(bundle({ cases: [validCase({ evidence: { ...validCase().evidence, patch } })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'bad_patch'))
    },
  },
  {
    id: 'E1-GATE-REJECT-UNEXECUTED-NATIVE',
    title: 'A native case that never executed cannot pass',
    check: ({ assert }) => {
      const nativeCase = validCase({
        layer: LAYERS.NATIVE,
        evidence: { ...validCase().evidence, native: { executed: false, modelTasks: 0 } },
      })
      const result = gate(bundle({ cases: [nativeCase] }))
      assert('REJECTED', !result.ok)
      assert('UNEXECUTED', result.failures.some((item) => item.code === 'unexecuted_native'))
      assert('LAYER', result.failures.some((item) => item.code === 'layer_not_allowed'))
    },
  },
  {
    id: 'E1-GATE-REJECT-INVALID-RESPONSE',
    title: 'An unknown/invalid response consumed by a passing case is rejected',
    check: ({ assert }) => {
      const result = gate(
        bundle({ cases: [validCase({ evidence: { ...validCase().evidence, responses: { invalid: 1 } } })] }),
      )
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'invalid_response_tolerated'))
    },
  },
  {
    id: 'E1-GATE-REJECT-STALE-CASE-BINDING',
    title: 'Case evidence bound to another commit is stale',
    check: ({ assert }) => {
      const result = gate(bundle({ cases: [validCase({ source: { commit: 'e'.repeat(40) } })] }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'stale_case_evidence'))
    },
  },
  {
    id: 'E1-GATE-REJECT-FIXTURE-DRIFT',
    title: 'Fixture bytes changed after the case ran are rejected',
    check: ({ assert }) => {
      const report = bundle({
        cases: [
          validCase({
            evidence: { ...validCase().evidence, fixture: { id: 'scope', path: '/dev/null', sha256: DIGEST } },
          }),
        ],
      })
      const result = gate(report, { resolveFixture: () => 'f'.repeat(64) })
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'fixture_digest_mismatch'))
    },
  },
  {
    id: 'E1-GATE-REJECT-SCHEMA',
    title: 'A report without the acceptance schema is rejected',
    check: ({ assert }) => {
      const result = gate(bundle({ schema: 'something/else' }))
      assert('REJECTED', !result.ok)
      assert('CODE', result.failures.some((item) => item.code === 'report_schema_invalid'))
    },
  },
  {
    id: 'E1-FIXTURE-STRICT',
    title: 'Illegal command fixtures are refused by the loader',
    check: ({ assert }) => {
      const good = {
        protocol: FIXTURE_PROTOCOL,
        id: 'scope-outside',
        type: 'scope-outside-grant',
        data: { projectId: 'project-atlas', scope: { allowedPaths: ['docs/'] } },
      }
      const loaded = temporary(good)
      try {
        assert('ACCEPTS_VALID', loadFixture(loaded.path, 'scope-outside-grant').id === 'scope-outside')
      } finally {
        loaded.cleanup()
      }
      const illegal = [
        ['protocol', { ...good, protocol: 'other/1' }],
        ['unknown_field', { ...good, extra: true }],
        ['type', { ...good, type: 'command' }],
        ['id', { ...good, id: 'other' }, { id: 'scope-outside' }],
        ['inside_grant', { ...good, data: { projectId: 'project-atlas', scope: { allowedPaths: ['src/'] } } }],
        ['absolute', { ...good, data: { projectId: 'project-atlas', scope: { allowedPaths: ['/etc/passwd'] } } }],
      ]
      for (const [label, document, options] of illegal) {
        const fixture = temporary(document)
        try {
          let thrown
          try {
            loadFixture(fixture.path, 'scope-outside-grant', options)
          } catch (error) {
            thrown = error
          }
          assert(`REJECT_${label}`, thrown !== undefined)
        } finally {
          fixture.cleanup()
        }
      }
    },
  },
  {
    id: 'E1-FIXTURE-PORTABILITY-STRICT',
    title: 'Portability checklists reject traversal, duplicates and bad digests',
    check: ({ assert }) => {
      const base = {
        protocol: FIXTURE_PROTOCOL,
        id: 'bundle-checklist',
        type: 'bundle-checklist',
        data: {
          version: '0.1.0',
          files: [{ path: 'app/state.sqlite', sha256: DIGEST, bytes: 4096 }],
          rollback: { supported: true, restoresVersion: '0.0.9' },
        },
      }
      const good = temporary(base)
      try {
        assert('ACCEPTS_VALID', loadFixture(good.path, 'bundle-checklist').data.version === '0.1.0')
      } finally {
        good.cleanup()
      }
      const illegal = [
        ['traversal', [{ path: '../escape', sha256: DIGEST, bytes: 1 }]],
        [
          'duplicate',
          [
            { path: 'app/a', sha256: DIGEST, bytes: 1 },
            { path: 'app/a', sha256: DIGEST, bytes: 1 },
          ],
        ],
        ['digest', [{ path: 'app/a', sha256: 'nope', bytes: 1 }]],
        ['bytes', [{ path: 'app/a', sha256: DIGEST, bytes: -1 }]],
      ]
      for (const [label, files] of illegal) {
        const fixture = temporary({ ...base, data: { ...base.data, files } })
        try {
          let thrown
          try {
            loadFixture(fixture.path, 'bundle-checklist')
          } catch (error) {
            thrown = error
          }
          assert(`REJECT_${label}`, thrown !== undefined)
        } finally {
          fixture.cleanup()
        }
      }
    },
  },
  {
    id: 'E1-ADMISSION-FAIL-CLOSED',
    title: 'The pilot runner refuses corrupt ledgers, clipped bounds and a missing adapter',
    check: ({ assert }) => {
      const here = dirname(fileURLToPath(import.meta.url))
      const run = spawnSync(process.execPath, [join(here, '../pilot/runner-selftest.mjs')], { encoding: 'utf8', timeout: 120_000 })
      let result
      try {
        result = JSON.parse(run.stdout)
      } catch {
        result = undefined
      }
      assert('SELFTEST_RAN', result !== undefined, (run.stderr || run.stdout || '').slice(-300))
      assert('SELFTEST_NO_FAILURE', result?.failures?.length === 0, JSON.stringify(result?.failures ?? []))
      assert('SELFTEST_BOUND_NOT_CLIPPED', result?.assertions?.some((item) => item.id === 'BOUND_IS_DECLARED_NOT_CLIPPED' && item.ok))
      assert('SELFTEST_CORRUPT_LEDGER', result?.assertions?.filter((item) => item.id.startsWith('CORRUPT_')).every((item) => item.ok))
      assert('SELFTEST_ADMISSION_REFUSALS', result?.assertions?.filter((item) => item.id.startsWith('ADMISSION_')).every((item) => item.ok))
      assert('SELFTEST_NO_REFUSAL_SENDS', result?.assertions?.some((item) => item.id === 'NO_SEND_FOR_ALL_REFUSALS' && item.ok))
      assert('SELFTEST_SEND_COUNTER', result?.modelSends === 2 && result?.refusalSends === 0, `${result?.modelSends}/${result?.refusalSends}`)
      assert('SELFTEST_CHECKS', (result?.passes ?? 0) >= 55, String(result?.passes))
      assert('SELFTEST_LEGACY', result?.assertions?.filter((item) => item.id.startsWith('CORRUPT_V1_')).every((item) => item.ok))
      assert('SELFTEST_LEGACY_EMPTY', result?.assertions?.some((item) => item.id === 'V1_EMPTY_MIGRATES' && item.ok))
      assert('SELFTEST_COST_UNKNOWN', result?.assertions?.filter((item) => item.id.includes('COST')).every((item) => item.ok))
      assert('SELFTEST_IDENTITY', result?.assertions?.filter((item) => ['ADMISSION_NO_MODEL', 'ADMISSION_NO_PROVIDER', 'ADMISSION_NO_B_ENTRY', 'ADMISSION_ENTRY_FALLBACK'].includes(item.id)).every((item) => item.ok))
    },
  },
  {
    id: 'E1-PREFLIGHT-NO-FALLBACK',
    title: 'The recorded preflight is blocked on a missing adapter instead of falling back to the CLI',
    check: ({ assert }) => {
      const here = dirname(fileURLToPath(import.meta.url))
      const preflight = JSON.parse(readFileSync(join(here, '../pilot/reports/preflight.json'), 'utf8'))
      assert('PREFLIGHT_BLOCKED', preflight.status === 'BLOCKED', preflight.status)
      assert('NO_ADAPTER', preflight.reasons.some((item) => item.code === 'adapter_missing'), JSON.stringify(preflight.reasons))
      assert('NO_CLI_FALLBACK_LABEL', JSON.stringify(preflight).includes('codex-cli-adapter') === false)
      assert('LEDGER_ZERO', preflight.ledger.turns === 0 && preflight.ledger.tokens === 0, JSON.stringify(preflight.ledger))
      assert('LEDGER_NOT_CORRUPT', preflight.ledgerState !== 'CORRUPT', preflight.ledgerState)
      assert('ADMISSION_NOT_OK', preflight.admission?.ok === false, JSON.stringify(preflight.admission?.ok))
    },
  },
]

export async function gateSelftestCases() {
  const results = []
  for (const definition of CASES)
    results.push(
      await runCase(
        {
          id: definition.id,
          title: definition.title,
          layer: LAYERS.READONLY,
          evidence: { kind: 'gate-selftest' },
          limitations: ['In-memory evidence bundles; proves the aggregator, not a product workflow'],
        },
        definition.check,
      ),
    )
  return results
}
