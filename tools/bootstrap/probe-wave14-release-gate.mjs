import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
if (process.argv.length !== 4) throw new Error('Usage: node tools/bootstrap/probe-wave14-release-gate.mjs <E-root> <verified-frozen-install>')
const eRoot = resolve(process.argv[2]), frozen = resolve(process.argv[3])
const { evaluateRelease } = await import(pathToFileURL(join(eRoot, 'tests/product-acceptance/lib/release.mjs')).href)
const { TIERS } = await import(pathToFileURL(join(eRoot, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest = JSON.parse(readFileSync(join(eRoot, 'tests/product-acceptance/reports/latest.json')))
const original = JSON.parse(readFileSync(join(latest.runDirectory, 'report.json')))
const ids = ['E6-CURRENT-MAIN-INSTALL', 'E4-UPGRADE-FAULTS', 'E7-OWNERSHIP-COPY', 'E6-ARTIFACT-CURRENT-SCOPE', 'E6-INSTALLED-CONTEXT', 'E3-PERSONAL-COLD-START']
const requirement = { ...TIERS['installed-alpha'], tier: 'installed-required-evidence-audit', cases: TIERS['installed-alpha'].cases.filter(c => ids.includes(c.id)) }
const base = structuredClone(original)
delete base.release; delete base.claim
base.cases = base.cases.filter(c => ids.includes(c.id))
for (const item of base.cases) if (ids.slice(0, 3).includes(item.id)) {
  item.status = 'PASS'; item.assertions = [{ id: 'LABEL_ONLY', ok: true }]; item.evidence = {}; delete item.reason
}
const check = mutate => {
  const report = structuredClone(base); mutate(report)
  const verdict = evaluateRelease({ report, requirement, expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures }
}
const byId = (report, id) => report.cases.find(c => c.id === id)
const cases = [
  { id: 'REQUIRED_CURRENT_FAULT_COPY_EMPTY_EVIDENCE', ...check(() => {}) },
  { id: 'VALID_BUT_FOREIGN_ARTIFACT_SOURCE', ...check(r => { byId(r, 'E6-ARTIFACT-CURRENT-SCOPE').evidence.frozenScope.artifact.source = 'f'.repeat(40) }) },
  { id: 'VALID_BUT_FOREIGN_ARTIFACT_SHA', ...check(r => { byId(r, 'E6-ARTIFACT-CURRENT-SCOPE').evidence.frozenScope.artifact.tarSha256 = 'f'.repeat(64) }) },
  { id: 'WRONG_ARTIFACT_BUILD_AND_SIZE', ...check(r => { const a = byId(r, 'E6-ARTIFACT-CURRENT-SCOPE').evidence.frozenScope.artifact; a.buildId = 'foreign-build'; a.tarBytes += 1 }) },
  { id: 'INSTALLED_CONTEXT_FOREIGN_TUPLE', ...check(r => { byId(r, 'E6-INSTALLED-CONTEXT').evidence.installedContext.artifact = { buildId: 'foreign-build', source: 'f'.repeat(40), schema: 99 } }) },
]
const eSource = readFileSync(join(eRoot, 'tests/product-acceptance/cases/e4-install.mjs'), 'utf8')
const line = eSource.split('\n').find(s => s.includes('hasSourcesRoute: /'))
const actualRegex = line ? new RegExp(line.slice(line.indexOf('/') + 1, line.indexOf('/u.test')), 'u') : undefined
const http = readFileSync(join(frozen, 'app/apps/coordinator/http/app.ts'), 'utf8')
const tierReport = JSON.parse(readFileSync(join(eRoot, 'tests/product-acceptance/reports/tier-verdicts.json')))
const report = { protocol: 'wave14-e-admission/1', testHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: eRoot, encoding: 'utf8' }).trim(), testReportSource: original.source,
  scope: 'Bounded mutation checks using the actual installed-alpha requirements for six named entries. No full installed-tier PASS is claimed.',
  actualInstalledTier: { status: tierReport['installed-alpha'].status, failedCaseIds: [...new Set(tierReport['installed-alpha'].failures.map(f => f.caseId))] },
  mutations: cases,
  sourceRouteDetection: { regex: actualRegex?.source ?? null, existsInVerifiedTar: http.includes("'/v1/messages/:id/context/sources'"), detectedByE: actualRegex ? actualRegex.test(http) : null },
  actualRunArtifact: byId(original, 'E6-ARTIFACT-CURRENT-SCOPE')?.evidence?.frozenScope,
  realModelTurns: 0, nativeTurns: 0,
  passed: cases.filter(item => !item.accepted).length, failed: cases.filter(item => item.accepted).length }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave14-admission/release-gate.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
