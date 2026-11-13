import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3 || !process.env.PA_ADMISSION_REPORT || !isAbsolute(process.env.PA_ADMISSION_REPORT)) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-absolute-output> node tools/bootstrap/probe-wave17-release-gate.mjs <E-root>')
}
const candidateRoot = resolve(process.argv[2])
const output = process.env.PA_ADMISSION_REPORT
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot, encoding: 'utf8' }).trim()
const { evaluateRelease } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release.mjs')).href)
const { TIERS } = await import(pathToFileURL(join(candidateRoot, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest = JSON.parse(readFileSync(join(candidateRoot, 'tests/product-acceptance/reports/latest.json'), 'utf8'))
const original = JSON.parse(readFileSync(join(latest.runDirectory, 'report.json'), 'utf8'))
const ids = ['E4-INSTALL-ARTIFACT-IDENTITY', 'E6-ARTIFACT-CURRENT-SCOPE', 'E6-CURRENT-MAIN-INSTALL', 'E4-UPGRADE-FAULTS', 'E7-OWNERSHIP-COPY', 'E6-INSTALLED-CONTEXT']
const base = structuredClone(original)
delete base.release
delete base.claim
base.cases = base.cases.filter(value => ids.includes(value.id))
for (const id of ids) if (!base.cases.some(value => value.id === id)) throw new Error(`Recorded positive is missing ${id}`)
const requirement = { ...TIERS['installed-alpha'], tier: 'coherent-recovery-evidence-audit',
  cases: TIERS['installed-alpha'].cases.filter(value => ids.includes(value.id)) }
if (requirement.cases.length !== ids.length) throw new Error('The installed tier no longer declares all six audited cases')
const faults = report => report.cases.find(value => value.id === 'E4-UPGRADE-FAULTS').evidence.upgradeFaults
const evaluate = change => {
  const report = structuredClone(base)
  change(report)
  // This validates recorded evidence at its original time, not a fresh whole-tier release claim.
  const verdict = evaluateRelease({ report, requirement, expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures.map(value => ({ code: value.code, caseId: value.caseId, detail: value.detail })) }
}
const positive = evaluate(() => {})
const cases = [{ id: 'ACTUAL_PERSONAL_HTTP_AND_FAULT_POSITIVE', ...positive, status: positive.accepted ? 'PASS' : 'FAIL' }]
const mutations = [
  {
    id: 'NO_OP_WITH_EXIT_ONE',
    ready() {
      const value = faults(base).windows.target_unhealthy.probe.recover
      return value.status === 'NO_OP' && value.exit === 0
    },
    change(report) { faults(report).windows.target_unhealthy.probe.recover.exit = 1 },
    expected: 'The recorded NO_OP/exit0 positive changes only to exit1; NO_OP requires exit0 in both the tested old tuple and current CLI',
  },
  {
    id: 'POINTER_EVIDENCE_MISSING',
    ready() {
      const value = faults(base).windows.crash_after_stop.probe
      return Object.hasOwn(value, 'pointerBefore') && Object.hasOwn(value, 'pointerAfter') &&
        typeof value.pointerBefore === 'string' && value.pointerBefore.length > 0 && value.pointerBefore === value.pointerAfter
    },
    change(report) {
      const value = faults(report).windows.crash_after_stop.probe
      delete value.pointerBefore
      delete value.pointerAfter
    },
    expected: 'Deleting only the two previously present valid pointer observations must not establish pointer consistency',
  },
]
for (const mutation of mutations) {
  if (!positive.accepted || !mutation.ready()) {
    cases.push({ id: mutation.id, status: 'NOT_TESTED', reason: positive.accepted
      ? 'The original evidence no longer has the focal positive shape needed for this mutation'
      : 'The unchanged actual six-case positive control did not pass' })
    continue
  }
  const result = evaluate(report => mutation.change(report))
  const focalRefusal = !result.accepted && result.failures.some(value => value.caseId === 'E4-UPGRADE-FAULTS')
  cases.push({ id: mutation.id, ...result, expected: mutation.expected, status: focalRefusal ? 'PASS' : 'FAIL' })
}
const recordedCurrent = original.cases.find(value => value.id === 'E6-CURRENT-MAIN-INSTALL').evidence.currentInstall
const report = { protocol: 'wave17-e-admission/1', source, candidateRoot, recordedSource: original.source,
  recordedRun: latest.runDirectory, recordedSubject: recordedCurrent.subject,
  cases, passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  notTested: cases.filter(value => value.status === 'NOT_TESTED').length,
  vendorSends: 0, nativeTurns: 0,
  scope: 'Actual unchanged six-case installed evidence positive with exact NO_OP exit and pointer-presence mutations; canonical artifact retained, no synthetic whole-tier or new installed release PASS' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.notTested ? 1 : 0
