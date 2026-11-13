import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 4 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node tools/bootstrap/probe-wave21-release-gate.mjs <E-root> <verified-e4e-install>')
}
const candidateRoot = resolve(process.argv[2])
const frozen = realpathSync(resolve(process.argv[3]))
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(readFileSync(join(frozen, 'install.json'), 'utf8'))
const app = realpathSync(resolve(frozen, manifest.appRoot ?? 'app'))
assert(app.startsWith(`${frozen}/`))
const entryFiles = ['apps/coordinator/product/demo.ts', 'apps/coordinator/product/restored-review.ts'].map(path => {
  const absolute = join(app, path)
  const sha256 = hash(readFileSync(absolute))
  assert.equal(sha256, manifest.files.find(entry => entry.path === relative(frozen, absolute))?.sha256)
  return { path, sha256 }
})
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const { evaluateRelease } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release.mjs')).href)
const { TIERS } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest = JSON.parse(readFileSync(join(candidateRoot, 'tests/product-acceptance/reports/latest.json'), 'utf8'))
const original = JSON.parse(readFileSync(join(latest.runDirectory, 'report.json'), 'utf8'))
const entryId = 'E4-PERSONAL-RESTORED-REVIEW'
const refusalId = 'E5-RESTORED-REVIEW-REFUSALS'
const originalReview = original.cases.find(value => value.id === entryId)?.evidence?.personalReview
assert(originalReview, 'Original report must contain actual personal review evidence')
const canonical = original.cases.find(value => value.id === 'E4-INSTALL-ARTIFACT-IDENTITY')?.evidence?.artifact?.tuple?.target
assert(canonical, 'Original report must contain its canonical installed subject')
const foreignEntrySubject = { source: manifest.source.commit, buildId: manifest.buildId, schema: manifest.producer.productSchema,
  platform: manifest.producer.platform, arch: manifest.producer.arch, abi: manifest.producer.abi }
assert(foreignEntrySubject.source !== (canonical.source ?? canonical.sourceCommit) || foreignEntrySubject.buildId !== canonical.buildId,
  'Review consumer must genuinely differ from the data package subject')
const evaluate = (report, requirement) => {
  delete report.release
  delete report.claim
  const verdict = evaluateRelease({ report, requirement, expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures.map(value => ({ code: value.code, caseId: value.caseId, detail: value.detail })) }
}
const positive = evaluate(structuredClone(original), TIERS['installed-alpha'])
const cases = [{ id: 'DECLARED_FULL_INSTALLED_ALPHA_CONTROL', ...positive, status: positive.accepted ? 'PASS' : 'FAIL' }]
if (positive.accepted) {
  const report = structuredClone(original)
  const evidence = report.cases.find(value => value.id === entryId).evidence.personalReview
  evidence.entryOrigin = 'verified foreign e4e package CLI/runtime'
  evidence.packageEntry = false
  evidence.entrySubject = foreignEntrySubject
  evidence.entryFiles = entryFiles
  const result = evaluate(report, TIERS['installed-alpha'])
  const focalRefusal = !result.accepted && result.failures.some(value => value.caseId === entryId)
  cases.push({ id: 'FOREIGN_REVIEW_CONSUMER_WITH_UNCHANGED_EE_DATA_SUBJECT', ...result,
    expected: 'A different consumer must not certify the unchanged old data package as having an installed personal-review entry',
    status: focalRefusal ? 'PASS' : 'FAIL' })
} else {
  cases.push({ id: 'FOREIGN_REVIEW_CONSUMER_WITH_UNCHANGED_EE_DATA_SUBJECT', status: 'BLOCKED_BY_CONTROL', reason: 'Original report control failed; no negative is credited' })
}
const ordinaryRequirement = { ...TIERS['installed-alpha'], tier: 'ordinary-ee-scope-without-source-only-review',
  cases: TIERS['installed-alpha'].cases.filter(value => ![entryId, refusalId].includes(value.id)) }
const ordinaryCore = evaluate(structuredClone(original), ordinaryRequirement)
const sourceEntryFiles = ['tools/dev/review-restored.mjs', 'apps/coordinator/product/demo.ts', 'apps/coordinator/product/restored-review.ts'].map(path => ({
  path, sourceRoot: candidateRoot, sha256: hash(readFileSync(join(candidateRoot, path))),
}))
const report = { protocol: 'wave21-review-consumer-subject-admission/1', source, candidateRoot, recordedSource: original.source,
  recordedRun: latest.runDirectory, canonicalInstalledSubject: canonical,
  verifiedForeignConsumer: { root: frozen, subject: foreignEntrySubject, files: entryFiles },
  originalReviewEvidence: originalReview, sourceEntryFiles, cases, ordinaryCore,
  ordinaryRequiredCount: ordinaryRequirement.cases.length,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  blockedByControl: cases.some(value => value.status === 'BLOCKED_BY_CONTROL'),
  vendorSends: 0, nativeTurns: 0, candidateProcessesStarted: 0,
  scope: 'Declared report control already contains source-only personalReview/packageEntry=false labeled installed; focal actual consumer provenance replacement, preserving old ordinary package scope separately, no live execution or new full release claim' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.blockedByControl ? 1 : 0
