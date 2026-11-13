import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.argv.length !== 4 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node tools/bootstrap/probe-wave22-release-gate.mjs <E-root> <verified-595-install>')
}
const candidateRoot = resolve(process.argv[2])
const frozen = realpathSync(resolve(process.argv[3]))
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const expected = JSON.parse(readFileSync(join(repository, 'reports/releases/wave22-admission/delivery.json'), 'utf8')).newArtifact
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const raw = readFileSync(join(frozen, 'install.json'))
const manifest = JSON.parse(raw)
const foreignTar = readFileSync(expected.tarPath)
assert.equal(hash(foreignTar), expected.tarSha256)
assert.equal(foreignTar.length, expected.tarBytes)
assert.equal(hash(raw), expected.installManifestSha256)
assert.equal(hash(readFileSync(join(frozen, 'var/config/release.json'))), expected.releaseManifestSha256)
assert.equal(manifest.source.commit, expected.source)
assert.equal(manifest.buildId, expected.buildId)
const app = realpathSync(resolve(frozen, manifest.appRoot ?? 'app'))
assert(app.startsWith(`${frozen}/`))
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const { evaluateRelease } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release.mjs')).href)
const { TIERS } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest = JSON.parse(readFileSync(join(candidateRoot, 'tests/product-acceptance/reports/latest.json'), 'utf8'))
const original = JSON.parse(readFileSync(join(latest.runDirectory, 'report.json'), 'utf8'))
const ids = ['E4-INSTALL-ARTIFACT-IDENTITY', 'E4-PERSONAL-RESTORED-REVIEW', 'E5-RESTORED-REVIEW-REFUSALS']
const requirement = { ...TIERS['installed-alpha'], tier: 'actual-installed-review-consumer-focal',
  cases: TIERS['installed-alpha'].cases.filter(value => ids.includes(value.id)) }
assert.equal(requirement.cases.length, ids.length, 'Actual installed tier must declare all three audited entries')
const base = structuredClone(original)
base.cases = base.cases.filter(value => ids.includes(value.id))
delete base.release
delete base.claim
for (const id of ids) assert.equal(base.cases.find(value => value.id === id)?.status, 'PASS', `Actual positive must have executed and passed ${id}`)
const canonical = base.cases.find(value => value.id === ids[0]).evidence.artifact.tuple.target
const review = base.cases.find(value => value.id === ids[1]).evidence.personalReview
assert.equal(review.consumerEntry.origin, 'package')
const canonicalTar = readFileSync(canonical.tarPath)
assert.equal(hash(canonicalTar), canonical.tarSha256)
assert.equal(canonicalTar.length, canonical.tarBytes)
const entries = execFileSync('tar', ['-tzf', canonical.tarPath], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }).trim().split('\n')
const fileAudit = review.consumerEntry.files.map(file => {
  assert(!isAbsolute(file.path) && !file.path.split('/').includes('..'))
  const entry = entries.find(value => value.endsWith(`/app/${file.path}`))
  assert(entry && !isAbsolute(entry) && !entry.split('/').includes('..'), 'Consumer file must exist in the actual canonical tar')
  const bytes = execFileSync('tar', ['-xOzf', canonical.tarPath, entry], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
  return { path: file.path, sha256: hash(bytes), bytes: bytes.length, match: hash(bytes) === file.sha256, bytesMatch: bytes.length === file.bytes }
})
assert(fileAudit.every(value => value.match && value.bytesMatch), 'Actual positive consumer files must match immutable canonical package bytes')
const foreignPackage = { source: manifest.source.commit, buildId: manifest.buildId, tarSha256: hash(foreignTar), tarBytes: foreignTar.length }
assert(foreignPackage.source !== (canonical.source ?? canonical.sourceCommit) || foreignPackage.buildId !== canonical.buildId, 'Consumer mutation must use a genuinely different package')
const run = change => {
  const report = structuredClone(base)
  change(report)
  const verdict = evaluateRelease({ report, requirement, expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures.map(value => ({ code: value.code, caseId: value.caseId, detail: value.detail })) }
}
const positive = run(() => {})
const cases = [{ id: 'ACTUAL_E4E_REVIEW_AND_IDENTITY_POSITIVE', ...positive, status: positive.accepted ? 'PASS' : 'FAIL' }]
if (positive.accepted) {
  const value = run(report => {
    const entry = report.cases.find(item => item.id === ids[1]).evidence.personalReview.consumerEntry
    entry.package = foreignPackage
    entry.files = entry.files.map(file => {
      const path = join(app, file.path)
      const bytes = readFileSync(path)
      assert.equal(hash(bytes), manifest.files.find(item => item.path === relative(frozen, path))?.sha256)
      return { path: file.path, sha256: hash(bytes), bytes: bytes.length }
    })
  })
  const focalRefusal = !value.accepted && value.failures.some(failure => failure.caseId === ids[1] && failure.detail.includes('consumer_provenance'))
  cases.push({ id: 'ONE_TRUE_595_CONSUMER_WITH_OLD_E4E_DATA', ...value, status: focalRefusal ? 'PASS' : 'FAIL' })
} else {
  cases.push({ id: 'ONE_TRUE_595_CONSUMER_WITH_OLD_E4E_DATA', status: 'BLOCKED_BY_CONTROL', reason: 'Actual passing review scope failed validation; no negative is credited' })
}
const whole = structuredClone(original)
delete whole.release
delete whole.claim
const wholeVerdict = evaluateRelease({ report: whole, requirement: TIERS['installed-alpha'], expectedSource: whole.source.commit, now: Date.parse(whole.checkedAt) })
const report = { protocol: 'wave22-package-review-provenance-admission/1', source, candidateRoot,
  recordedSource: original.source, recordedRun: latest.runDirectory, canonicalInstalledSubject: canonical,
  actualRequiredEntries: requirement.cases, fileAudit, foreignConsumer: { root: frozen, package: foreignPackage }, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  blockedByControl: cases.some(value => value.status === 'BLOCKED_BY_CONTROL'),
  actualFullTier: { accepted: wholeVerdict.ok, failures: wholeVerdict.failures.map(value => ({ code: value.code, caseId: value.caseId })) },
  vendorSends: 0, nativeTurns: 0, candidateProcessesStarted: 0,
  scope: 'Actual package review/refusal and identity PASS records are validated under their real rules with exact canonical file hashes; one true595 foreign-consumer substitution only. The whole report retains its genuine old e4e reuse FAIL; no full-tier green control is fabricated.' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.blockedByControl ? 1 : 0
