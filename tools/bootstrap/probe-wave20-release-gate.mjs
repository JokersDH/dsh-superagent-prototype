import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

if (process.argv.length !== 4 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node tools/bootstrap/probe-wave20-release-gate.mjs <E-root> <verified-ee-install>')
}
const candidateRoot = resolve(process.argv[2])
const foreignInstall = realpathSync(resolve(process.argv[3]))
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const expected = JSON.parse(readFileSync(join(repository, 'reports/releases/wave20-admission/delivery.json'), 'utf8')).newArtifact
const hash = body => createHash('sha256').update(body).digest('hex')
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const releasePath = join(candidateRoot, 'tests/product-acceptance/lib/release.mjs')
const { evaluateRelease } = await import(pathToFileURL(releasePath).href)
const { TIERS, INSTALL_CASES } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest = JSON.parse(readFileSync(join(candidateRoot, 'tests/product-acceptance/reports/latest.json'), 'utf8'))
const original = JSON.parse(readFileSync(join(latest.runDirectory, 'report.json'), 'utf8'))
const identity = original.cases.find(value => value.id === 'E4-INSTALL-ARTIFACT-IDENTITY')?.evidence?.artifact?.tuple?.target
assert(identity, 'Original report must contain its canonical installed subject')
const safetyId = 'E5-D-OWNERSHIP-MOCKS'
const safetyEvidence = report => {
  const value = report.cases.find(item => item.id === safetyId)?.evidence?.ownershipMocks
  assert(value, `Original report must contain ${safetyId} evidence`)
  return value
}

// E's actual tuple comparison determines the field audit, including its source/schema aliases.
const ts = createRequire(join(candidateRoot, 'package.json'))('typescript')
const releaseText = readFileSync(releasePath, 'utf8')
const ast = ts.createSourceFile(releasePath, releaseText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const loops = []
const declarations = []
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) declarations.push(node)
  if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer) && ts.isArrayLiteralExpression(node.expression) &&
    node.expression.elements.every(value => ts.isStringLiteral(value))) {
    const binding = node.initializer.declarations[0]?.name
    if (binding && ts.isIdentifier(binding)) {
      const calls = new Map()
      const scan = value => {
        if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.arguments.length === 2 &&
          ts.isIdentifier(value.arguments[0]) && ts.isIdentifier(value.arguments[1]) && value.arguments[1].text === binding.text) {
          const operands = calls.get(value.expression.text) ?? new Set()
          operands.add(value.arguments[0].text)
          calls.set(value.expression.text, operands)
        }
        ts.forEachChild(value, scan)
      }
      scan(node.statement)
      for (const [name, operands] of calls) if (operands.has('subject') && operands.has('canonicalTuple')) loops.push({ node, name })
    }
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.equal(loops.length, 1, 'Expected one actual installed-subject tuple comparison loop')
const fields = loops[0].node.expression.elements.map(value => value.text)
const normalizer = declarations.filter(value => value.name.text === loops[0].name && value.pos < loops[0].node.pos).at(-1)
assert(normalizer, 'Actual tuple normalizer must be present')
const normalize = runInNewContext(`(${normalizer.initializer.getText(ast)})`, Object.create(null), { timeout: 1000 })
assert.equal(typeof normalize, 'function')
const subjectFor = (item, entry) => {
  if (entry.id === 'E4-INSTALL-ARTIFACT-IDENTITY') return identity
  if (item?.evidence?.subject) return item.evidence.subject
  for (const key of entry.evidence ?? []) {
    const value = item?.evidence?.[key]
    if (value?.subject) return value.subject
    if (key === 'frozenScope' && value?.artifact) return value.artifact
  }
  return undefined
}
const tupleAudit = INSTALL_CASES.map(entry => {
  const item = original.cases.find(value => value.id === entry.id)
  const subject = subjectFor(item, entry)
  return { id: entry.id, status: item?.status, missing: !subject,
    mismatches: fields.filter(key => String(normalize(subject, key) ?? '') !== String(normalize(identity, key) ?? '')) }
})
const missingCanonicalFields = fields.filter(key => normalize(identity, key) === undefined || normalize(identity, key) === null || normalize(identity, key) === '')

const proof = safetyEvidence(original)
const canonicalTar = readFileSync(identity.tarPath)
assert.equal(hash(canonicalTar), identity.tarSha256)
assert.equal(canonicalTar.length, identity.tarBytes)
const archiveEntries = execFileSync('tar', ['-tzf', identity.tarPath], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }).trim().split('\n')
const packagedHelper = path => {
  const parts = path.split('/')
  if (parts[0] === 'install') parts.shift()
  const suffix = parts.join('/')
  const entry = archiveEntries.find(value => value === suffix || value.endsWith(`/${suffix}`))
  assert(entry && !isAbsolute(entry) && !entry.split('/').includes('..'), 'Expected a safe helper entry in the canonical tar')
  return execFileSync('tar', ['-xOzf', identity.tarPath, entry], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
}
const ownUpgrade = packagedHelper(proof.helper.upgradePath)
const ownInstance = packagedHelper(proof.helper.instancePath)
const helperAudit = {
  upgradeMatches: hash(ownUpgrade) === proof.helper.upgradeSha256,
  instanceMatches: hash(ownInstance) === proof.helper.instanceSha256,
  upgradeBytesMatch: ownUpgrade.length === proof.helper.upgradeBytes && ownUpgrade.length === proof.helper.upgradeBytesFromTar,
  instanceBytesMatch: ownInstance.length === proof.helper.instanceBytes && ownInstance.length === proof.helper.instanceBytesFromTar,
  sourceMatches: proof.helper.sourceCommit === normalize(identity, 'source'),
  tarMatches: proof.helper.tarSha256 === identity.tarSha256,
  buildMatches: proof.helper.buildId === identity.buildId,
}

const foreignRaw = readFileSync(join(foreignInstall, 'install.json'))
const foreignManifest = JSON.parse(foreignRaw)
const foreignTar = readFileSync(expected.tarPath)
assert.equal(hash(foreignTar), expected.tarSha256)
assert.equal(foreignTar.length, expected.tarBytes)
assert.equal(hash(foreignRaw), expected.installManifestSha256)
assert.equal(hash(readFileSync(join(foreignInstall, 'var/config/release.json'))), expected.releaseManifestSha256)
assert.equal(foreignManifest.source.commit, expected.source)
assert.equal(foreignManifest.buildId, expected.buildId)
assert.equal(foreignManifest.producer.productSchema, expected.productSchemaActualExport)
const foreignApp = realpathSync(resolve(foreignInstall, foreignManifest.appRoot ?? 'app'))
assert(foreignApp.startsWith(`${foreignInstall}/`))
const foreignHelper = name => {
  const path = join(foreignApp, `apps/launcher/lib/${name}.mjs`)
  const bytes = readFileSync(path)
  assert.equal(hash(bytes), foreignManifest.files.find(value => value.path === relative(foreignInstall, path))?.sha256)
  return { path, sha256: hash(bytes), bytes: bytes.length }
}
const foreignUpgrade = foreignHelper('upgrade')
const foreignInstance = foreignHelper('instance')
const foreignSubject = { source: foreignManifest.source.commit, buildId: foreignManifest.buildId, schema: foreignManifest.producer.productSchema,
  tarSha256: hash(foreignTar), tarBytes: foreignTar.length, platform: foreignManifest.producer.platform,
  arch: foreignManifest.producer.arch, abi: foreignManifest.producer.abi }
assert(fields.some(key => String(normalize(foreignSubject, key) ?? '') !== String(normalize(identity, key) ?? '')), 'Verified ee provenance must differ from the installed b911 subject')

const evaluate = change => {
  const report = structuredClone(original)
  change(report)
  // This is the genuine whole recorded report at its original time, not a new installed run.
  const verdict = evaluateRelease({ report, requirement: TIERS['installed-alpha'], expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures.map(value => ({ code: value.code, caseId: value.caseId, detail: value.detail })) }
}
const positive = evaluate(() => {})
const cases = [{ id: 'ACTUAL_FULL_B911_INSTALLED_ALPHA_POSITIVE', ...positive, status: positive.accepted ? 'PASS' : 'FAIL' }]
if (positive.accepted) {
  const value = evaluate(report => {
    const evidence = safetyEvidence(report)
    evidence.subject = foreignSubject
    evidence.helper = { ...evidence.helper, upgradeSha256: foreignUpgrade.sha256, instanceSha256: foreignInstance.sha256,
      upgradeBytes: foreignUpgrade.bytes, instanceBytes: foreignInstance.bytes,
      upgradeBytesFromTar: foreignUpgrade.bytes, instanceBytesFromTar: foreignInstance.bytes,
      sourceCommit: foreignSubject.source, buildId: foreignSubject.buildId, tarSha256: foreignSubject.tarSha256, tarPath: expected.tarPath }
    evidence.productSource = { artifact: basename(expected.tarPath, '.tar.gz'), source: foreignSubject.source, buildId: foreignSubject.buildId, tarSha256: foreignSubject.tarSha256 }
  })
  const focalRefusal = !value.accepted && value.failures.some(failure => failure.caseId === safetyId && failure.code === 'subject_mismatch')
  cases.push({ id: 'ONE_TRUE_EE_HELPER_PROVENANCE_MUTATION', ...value, status: focalRefusal ? 'PASS' : 'FAIL' })
} else {
  cases.push({ id: 'ONE_TRUE_EE_HELPER_PROVENANCE_MUTATION', status: 'BLOCKED_BY_CONTROL', reason: 'Original whole installed-alpha positive failed; no negative is credited' })
}
const tupleFailures = tupleAudit.filter(value => value.missing || value.mismatches.length)
const report = { protocol: 'wave20-same-subject-release-gate/1', source, candidateRoot, recordedSource: original.source,
  recordedRun: latest.runDirectory, installedSubject: identity, foreignSubject,
  fieldSource: { path: releasePath, sha256: hash(Buffer.from(releaseText)), parser: `typescript${ts.version}`, fields },
  requiredInstalledCasesAudited: tupleAudit.length, missingCanonicalFields, helperAudit, tupleAudit, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  blockedByControl: !positive.accepted, tupleFailureCount: tupleFailures.length,
  vendorSends: 0, nativeTurns: 0, liveCandidateOperations: 0,
  scope: 'Unchanged actual full b911 installed report positive plus one verified ee subject/helper/productSource mutation; required cases and comparison fields derived from E actual code, no live candidate operations or new installed release claim' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.blockedByControl || tupleFailures.length || missingCanonicalFields.length || !Object.values(helperAudit).every(Boolean) ? 1 : 0
