/**
 * Wave-23 required gate controls over the recorded 595 report.
 *
 * The positive control is the real complete report from run 2026-11-13T14-48-56-062Z (fixture copy).
 * It is evaluated at its recorded time; the current re-check time is recorded separately. Each
 * mutation removes or contradicts exactly one required observation and must be rejected.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, STATUS, LAYERS } from '../lib/status.mjs'
import { evaluateRelease } from '../lib/release.mjs'
import { tier, INSTALL_CASES } from '../lib/release-requirements.mjs'
import { resolveFixtureDigest } from '../lib/fixtures.mjs'
import { DEFAULT_FROZEN_DIRS, loadFrozenArtifact } from '../lib/frozen-package.mjs'

const fixture = JSON.parse(readFileSync(new URL('../fixtures/wave22-595-report.json', import.meta.url), 'utf8'))
const positiveDir = process.env.PA_E_W23_POSITIVE_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave21-target'
const recordedNow = Date.parse(fixture.checkedAt) + 1_000
const copy = () => JSON.parse(JSON.stringify(fixture))
const reuse = report => report.cases.find(item => item.id === 'E5-REVIEW-REUSE-CONSISTENCY')
// The recorded 595 report predates the a9b-only E7-SCOPE-DIAGNOSTICS case. The historical positive
// control uses the recorded required scope (present in that report); current runs still use the full
// INSTALL_CASES set, so this is a recorded-time control, not a relaxation of today's gate.
const recordedIds = new Set(fixture.cases.map(item => item.id))
const requirement = {
  ...tier('installed-alpha'),
  cases: INSTALL_CASES.filter(entry => recordedIds.has(entry.id)),
}
function capabilityFor(dir) {
  try {
    const spec = loadFrozenArtifact('positive', dir)
    const read = relative => spawnSync('tar', ['-xOzf', spec.tarPath, `install/app/${relative}`], { timeout: 60_000 })
    const digestSupported = read('apps/launcher/lib/start.mjs').stdout?.toString().includes('restoredReviewDigest') === true &&
      read('apps/coordinator/product/demo.ts').stdout?.toString().includes('restoredReviewDigest') === true
    return { source: spec.sourceCommit, buildId: spec.buildId, tarSha256: spec.tarSha256, digestSupported }
  } catch { return undefined }
}

/** Attaches the capability fact observed from the immutable package bytes to the recorded evidence. */
function withCapability(report) {
  const capability = capabilityFor(positiveDir)
  if (!capability) return report
  const reuseCase = report.cases.find(item => item.id === 'E5-REVIEW-REUSE-CONSISTENCY')
  const formatCase = report.cases.find(item => item.id === 'E5-WORKFLOW-FORMATS')
  if (reuseCase?.evidence?.reviewReuse) reuseCase.evidence.reviewReuse.packageCapability = capability
  if (formatCase?.evidence?.workflowFormats) formatCase.evidence.workflowFormats.packageCapabilities = capability
  return report
}

const evaluate = (report, now = recordedNow) =>
  evaluateRelease({ report: withCapability(report), requirement, expectedSource: fixture.source.commit, now, resolveFixture: resolveFixtureDigest })
const codes = result => new Set(result.failures.map(item => item.code))

/** Hashes the same consumer files from a second frozen package, read from its tar bytes. */
async function foreignConsumer() {
  let spec
  try { spec = loadFrozenArtifact('foreign', process.env.PA_E_W23_FOREIGN_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave22-target') } catch { return undefined }
  // The recorded 595 subject is the positive control; the foreign control is any package that is not it.
  if (spec.sourceCommit === fixture.cases.find(item => item.id === 'E4-INSTALL-ARTIFACT-IDENTITY')
    ?.evidence?.artifact?.tuple?.target?.sourceCommit) return undefined
  const entry = { origin: 'package', package: { source: spec.sourceCommit, buildId: spec.buildId, tarSha256: spec.tarSha256, tarBytes: spec.tarBytes }, files: [] }
  for (const relative of ['apps/launcher/lib/start.mjs', 'apps/coordinator/product/restored-review.ts', 'apps/coordinator/product/demo.ts']) {
    const read = spawnSync('tar', ['-xOzf', spec.tarPath, `install/app/${relative}`], { timeout: 60_000 })
    if (read.status !== 0) return undefined
    const bytes = read.stdout
    entry.files.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength })
  }
  return entry
}

const define = (id, title) => ({ id, title, layer: LAYERS.READONLY, evidence: { kind: 'gate-mutation' }, limitations: [
  'Recorded real 595 report (fixture copy) evaluated at its recorded time; not a fresh run of the product.',
  'Mutations change only the required reuse/consumer observations; no product/package bytes are touched.',
] })

const reject = async (assert, label, mutate, expected = 'reviewReuse_invalid') => {
  const report = copy(); mutate(report)
  const result = evaluate(report)
  assert(`${label}_REJECTED`, result.ok === false, `gate accepted ${label}`)
  assert(`${label}_CODE`, codes(result).has(expected), `expected ${expected}, got ${[...codes(result)].join(',')}`)
}

export async function wave23GateCases() {
  const cases = []
  cases.push(await runCase({ ...define('W23-REAL-595-POSITIVE', 'The recorded complete 595 report passes installed-alpha at its recorded time') },
    async ({ assert, evidence }) => {
      const result = evaluate(fixture)
      assert('POSITIVE_PASS', result.status === 'PASS' && result.ok === true, JSON.stringify({ status: result.status, failures: [...codes(result)] }))
      assert('RECORDED_TIME', Number.isFinite(recordedNow) && Math.abs(Date.now() - recordedNow) > 0, String(fixture.checkedAt))
      evidence.gateControl = { positive: result.status, recordedAt: fixture.checkedAt, recheckedAt: new Date().toISOString(),
        subject: fixture.cases.find(item => item.id === 'E4-INSTALL-ARTIFACT-IDENTITY')?.evidence?.artifact?.tuple?.target ?? null,
        source: fixture.source }
    }))
  cases.push(await runCase({ ...define('W23-REAL-MISSING-PROCESS', 'Deleting the original/reused process identity is rejected') },
    async ({ assert }) => reject(assert, 'MISSING_PROCESS', report => { delete reuse(report).evidence.reviewReuse.processes })))
  cases.push(await runCase({ ...define('W23-REAL-MISSING-DIGEST', 'Deleting the health digest observations is rejected') },
    async ({ assert }) => reject(assert, 'MISSING_DIGEST', report => {
      const value = reuse(report).evidence.reviewReuse
      delete value.digestAvailable; delete value.healthDigest; delete value.sameDigest
    })))
  cases.push(await runCase({ ...define('W23-REAL-DIFFERENT-RUNNING', 'A different selection returning RUNNING on the original PID without a reused flag is rejected') },
    async ({ assert }) => reject(assert, 'DIFFERENT_RUNNING', report => {
      const value = reuse(report).evidence.reviewReuse
      value.outcomes.differentFile = { status: 'RUNNING', instance: { pid: value.firstPid } }
    })))
  cases.push(await runCase({ ...define('W23-REAL-MISSING-REFUSAL', 'Deleting the different-selection refusal observation is rejected') },
    async ({ assert }) => reject(assert, 'MISSING_REFUSAL', report => { delete reuse(report).evidence.reviewReuse.outcomes.differentFile })))
  cases.push(await runCase({ ...define('W23-REAL-FOREIGN-CONSUMER', 'Replacing only the consumer package/files with another real package is rejected while the data subject stays 595') },
    async ({ assert, evidence }) => {
      const entry = await foreignConsumer()
      assert('FOREIGN_PACKAGE_AVAILABLE', entry !== undefined, 'a second frozen package is required for the foreign consumer control')
      if (!entry) return
      const report = copy()
      for (const id of ['E4-PERSONAL-RESTORED-REVIEW', 'E5-RESTORED-REVIEW-REFUSALS', 'E5-REVIEW-REUSE-CONSISTENCY']) {
        const item = report.cases.find(candidate => candidate.id === id)
        if (id === 'E4-PERSONAL-RESTORED-REVIEW') item.evidence.personalReview.consumerEntry = entry
        if (id === 'E5-RESTORED-REVIEW-REFUSALS') item.evidence.restoredReviewRefusals.consumerEntry = entry
        if (id === 'E5-REVIEW-REUSE-CONSISTENCY') item.evidence.reviewReuse.consumerEntry = entry
      }
      const result = evaluate(report)
      assert('FOREIGN_CONSUMER_REJECTED', result.ok === false, 'gate accepted a foreign consumer')
      assert('FOREIGN_CONSUMER_CODE', codes(result).has('personalReview_invalid') || codes(result).has('restoredReviewRefusals_invalid') || codes(result).has('reviewReuse_invalid'),
        [...codes(result)].join(','))
      evidence.foreignConsumer = { package: entry.package, files: entry.files, result: 'rejected' }
    }))
  return cases
}
