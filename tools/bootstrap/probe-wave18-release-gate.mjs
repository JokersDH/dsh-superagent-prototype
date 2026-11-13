import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (![3, 4].includes(process.argv.length) || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node tools/bootstrap/probe-wave18-release-gate.mjs <E-root> [verified-helper-install]')
}
const candidateRoot = resolve(process.argv[2])
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const admission = JSON.parse(readFileSync(join(repository, 'reports/releases/wave18-admission/delivery.json'), 'utf8'))
const expected = admission.artifact
const frozen = realpathSync(resolve(process.argv[3] ?? expected.verifiedInstallRoot))
const manifest = JSON.parse(readFileSync(join(frozen, 'install.json'), 'utf8'))
const app = realpathSync(resolve(frozen, manifest.appRoot ?? 'app'))
assert(app.startsWith(`${frozen}/`))
const hash = body => createHash('sha256').update(body).digest('hex')
const tar = readFileSync(expected.tarPath)
assert.equal(hash(tar), expected.tarSha256)
assert.equal(tar.length, expected.tarBytes)
assert.equal(manifest.source.commit, expected.source)
assert.equal(manifest.buildId, expected.buildId)
assert.equal(manifest.producer.productSchema, expected.productSchemaActualExport)
assert.equal(hash(readFileSync(join(frozen, 'install.json'))), expected.installManifestSha256)
assert.equal(hash(readFileSync(join(frozen, 'var/config/release.json'))), expected.releaseManifestSha256)
const modulePath = join(app, 'apps/launcher/lib/upgrade.mjs')
const moduleSha256 = hash(readFileSync(modulePath))
assert.equal(moduleSha256, manifest.files.find(value => value.path === relative(frozen, modulePath))?.sha256)
const helperSubject = { source: manifest.source.commit, buildId: manifest.buildId, schema: manifest.producer.productSchema,
  tarSha256: hash(tar), tarBytes: tar.length, platform: manifest.producer.platform, arch: manifest.producer.arch, abi: manifest.producer.abi }

const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const { evaluateRelease } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release.mjs')).href)
const { TIERS } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest = JSON.parse(readFileSync(join(candidateRoot, 'tests/product-acceptance/reports/latest.json'), 'utf8'))
const original = JSON.parse(readFileSync(join(latest.runDirectory, 'report.json'), 'utf8'))
const safetyId = 'E5-D-OWNERSHIP-MOCKS'
const safetyEvidence = report => {
  const evidence = report.cases.find(value => value.id === safetyId)?.evidence?.ownershipMocks
  if (!evidence) throw new Error(`Original report has no ${safetyId} evidence`)
  return evidence
}
const installedSubject = original.cases.find(value => value.id === 'E4-INSTALL-ARTIFACT-IDENTITY')?.evidence?.artifact?.tuple?.target
if (!installedSubject) throw new Error('Original report has no canonical installed artifact tuple')
const evaluate = change => {
  const report = structuredClone(original)
  change(report)
  // The genuine complete recorded report is unchanged except for the single provenance mutation.
  const verdict = evaluateRelease({ report, requirement: TIERS['installed-alpha'], expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures.map(value => ({ code: value.code, caseId: value.caseId, detail: value.detail })) }
}
const positive = evaluate(() => {})
const cases = [{ id: 'ORIGINAL_DECLARED_INSTALLED_ALPHA_POSITIVE', ...positive, status: positive.accepted ? 'PASS' : 'FAIL' }]
const foreign = helperSubject.source !== (installedSubject.source ?? installedSubject.sourceCommit) || helperSubject.buildId !== installedSubject.buildId || helperSubject.tarSha256 !== installedSubject.tarSha256
if (positive.accepted && foreign) {
  const value = evaluate(report => {
    const evidence = safetyEvidence(report)
    evidence.dRoot = app
    evidence.subject = helperSubject
    evidence.moduleSource = helperSubject.source
    evidence.moduleSha256 = moduleSha256
  })
  const focalRefusal = !value.accepted && value.failures.some(failure => failure.caseId === safetyId)
  cases.push({ id: 'SAFETY_HELPER_FOREIGN_TO_INSTALLED_SUBJECT', ...value,
    expected: 'Safety bytes from the verified foreign helper tuple cannot certify the unchanged installed artifact',
    status: focalRefusal ? 'PASS' : 'FAIL' })
} else {
  cases.push({ id: 'SAFETY_HELPER_FOREIGN_TO_INSTALLED_SUBJECT', status: 'NOT_TESTED',
    reason: positive.accepted ? 'Verified helper is no longer foreign to the installed subject' : 'The unchanged full installed-alpha positive control did not pass' })
}
const report = { protocol: 'wave18-installed-safety-subject-admission/1', source, candidateRoot, recordedSource: original.source,
  recordedRun: latest.runDirectory, originalInstalledSubject: installedSubject, originalSafetyRoot: safetyEvidence(original).dRoot,
  foreignHelper: { root: frozen, subject: helperSubject, modulePath, moduleSha256 }, cases,
  passed: cases.filter(value => value.status === 'PASS').length,
  failed: cases.filter(value => value.status === 'FAIL').length,
  notTested: cases.filter(value => value.status === 'NOT_TESTED').length,
  vendorSends: 0, nativeTurns: 0,
  scope: 'Unchanged genuine full installed-alpha report is the declared-PASS gate control, not independent approval of mixed-source safety; only verified safety helper provenance is replaced, no live candidate operation' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.notTested ? 1 : 0
