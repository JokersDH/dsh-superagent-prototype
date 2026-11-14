/**
 * Wave-24 controls over the complete 0ede report: the positive is the recorded real run; each
 * mutation changes exactly one public diagnostics/capability observation.
 */
import { readFileSync } from 'node:fs'
import { runCase, LAYERS } from '../lib/status.mjs'
import { evaluateRelease } from '../lib/release.mjs'
import { tier } from '../lib/release-requirements.mjs'
import { resolveFixtureDigest } from '../lib/fixtures.mjs'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/wave24-0ede-report.json', import.meta.url), 'utf8'))
const recordedNow = Date.parse(fixture.checkedAt) + 1_000
const copy = () => JSON.parse(JSON.stringify(fixture))
const evaluate = report => evaluateRelease({ report, requirement: tier('installed-alpha'), expectedSource: fixture.source.commit,
  now: recordedNow, resolveFixture: resolveFixtureDigest })
const codes = result => new Set(result.failures.map(item => item.code))
const diag = report => report.cases.find(item => item.id === 'E7-SCOPE-DIAGNOSTICS').evidence.scopeDiagnostics
const reuse = report => report.cases.find(item => item.id === 'E5-REVIEW-REUSE-CONSISTENCY').evidence.reviewReuse
const define = (id, title) => ({ id, title, layer: LAYERS.READONLY, evidence: { kind: 'gate-mutation' }, limitations: [
  'Recorded real 0ede report evaluated at its recorded time; only one observation is mutated per case.',
] })
const reject = async (assert, label, mutate, expected = 'scopeDiagnostics_invalid') => {
  const report = copy(); mutate(report)
  const result = evaluate(report)
  assert(`${label}_REJECTED`, result.ok === false, `gate accepted ${label}`)
  assert(`${label}_CODE`, codes(result).has(expected), `expected ${expected}, got ${[...codes(result)].join(',')}`)
}

export async function wave24GateCases() {
  const cases = []
  cases.push(await runCase({ ...define('W24-REAL-0EDE-POSITIVE', 'The recorded complete 0ede report passes installed-alpha at its recorded time') },
    async ({ assert, evidence }) => {
      const result = evaluate(fixture)
      assert('POSITIVE_PASS', result.status === 'PASS' && result.ok === true, JSON.stringify({ status: result.status, failures: [...codes(result)] }))
      evidence.positive = { status: result.status, recordedAt: fixture.checkedAt, source: fixture.source }
    }))
  cases.push(await runCase({ ...define('W24-DIAG-WITHHELD-NEGATIVE', 'A negative withheld source count is rejected') },
    async ({ assert }) => reject(assert, 'WITHHELD_NEGATIVE', report => { diag(report).plain.diagnostic.withheldSourceCount = -1 })))
  cases.push(await runCase({ ...define('W24-DIAG-WITHHELD-OVERFLOW', 'A withheld count beyond the public bound is rejected') },
    async ({ assert }) => reject(assert, 'WITHHELD_OVERFLOW', report => { diag(report).narrow.diagnostic.withheldSourceCount = 65 })))
  cases.push(await runCase({ ...define('W24-DIAG-DUPLICATE-REASON', 'Duplicate scope reasons are rejected') },
    async ({ assert }) => reject(assert, 'REASON_DUPLICATE', report => { const value = diag(report).narrow.diagnostic; value.reasons = [...value.reasons, ...value.reasons.slice(0, 1)] })))
  cases.push(await runCase({ ...define('W24-DIAG-INVALID-REASON', 'An unknown scope reason is rejected') },
    async ({ assert }) => reject(assert, 'REASON_INVALID', report => { diag(report).narrow.diagnostic.reasons = ['made_up_reason'] })))
  cases.push(await runCase({ ...define('W24-DIAG-AUTHORIZATION', 'A diagnostic claiming authorization is rejected') },
    async ({ assert }) => reject(assert, 'DIAG_AUTH', report => { diag(report).plain.diagnostic.authorization = 'granted' })))
  cases.push(await runCase({ ...define('W24-DIAG-MISSING-FIELD', 'A diagnostic without the withheld observation is rejected') },
    async ({ assert }) => reject(assert, 'DIAG_MISSING', report => { delete diag(report).narrow.diagnostic.withheldSourceCount })))
  cases.push(await runCase({ ...define('W24-DIAG-WITHHELD-MISMATCH', 'A withheld count that disagrees with the binding source count is rejected') },
    async ({ assert }) => reject(assert, 'WITHHELD_MISMATCH', report => { diag(report).narrow.diagnostic.withheldSourceCount = 2 })))
  cases.push(await runCase({ ...define('W24-CAPABILITY-SELF-DOWNGRADE', 'A review evidence cannot downgrade the package capability fact alone') },
    async ({ assert }) => reject(assert, 'CAPABILITY_DOWNGRADE', report => {
      const value = reuse(report)
      value.packageCapability = { ...value.packageCapability, digestSupported: false }
      value.digestAvailable = false
      value.digestScope = 'package_lacks_identity'
      delete value.healthDigest; delete value.sameDigest
    }, 'capability_mismatch')))
  cases.push(await runCase({ ...define('W24-DIAG-OPTIN-500', 'A failed opt-in HTTP response cannot be replaced by a schema-valid payload') },
    async ({ assert }) => reject(assert, 'OPTIN_500', report => { diag(report).plain.optIn = 500 })))
  cases.push(await runCase({ ...define('W24-DIAG-OPTIN-MISSING', 'A missing opt-in HTTP status is rejected') },
    async ({ assert }) => reject(assert, 'OPTIN_MISSING', report => { delete diag(report).plain.optIn })))
  cases.push(await runCase({ ...define('W24-DIAG-OPTIN-NON200', 'A non-200 success status for the opt-in is rejected') },
    async ({ assert }) => reject(assert, 'OPTIN_NON200', report => { diag(report).plain.optIn = 201 })))
  cases.push(await runCase({ ...define('W24-DIAG-NARROW-500', 'A failed narrow opt-in response is rejected even with a diagnostic') },
    async ({ assert }) => reject(assert, 'NARROW_500', report => { diag(report).narrow.optIn = 500 })))
  cases.push(await runCase({ ...define('W24-MISSING-DIGEST', 'Deleting the digest observations on a supporting package is rejected') },
    async ({ assert }) => reject(assert, 'MISSING_DIGEST', report => {
      const value = reuse(report); delete value.digestAvailable; delete value.healthDigest; delete value.sameDigest
    }, 'reviewReuse_invalid')))
  return cases
}
