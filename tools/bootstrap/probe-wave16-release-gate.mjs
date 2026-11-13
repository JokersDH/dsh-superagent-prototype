import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3 || !process.env.PA_ADMISSION_REPORT) {
  throw new Error('Usage: PA_ADMISSION_REPORT=<new-output> node tools/bootstrap/probe-wave16-release-gate.mjs <E-root>')
}
const candidateRoot = resolve(process.argv[2])
const output = resolve(process.env.PA_ADMISSION_REPORT)
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
const requirement = { ...TIERS['installed-alpha'], tier: 'coherent-installed-case-audit',
  cases: TIERS['installed-alpha'].cases.filter(value => ids.includes(value.id)) }
const get = (report, id) => {
  const value = report.cases.find(item => item.id === id)
  if (!value) throw new Error(`Recorded positive control is missing ${id}`)
  return value
}
for (const id of ids) get(base, id)
if (requirement.cases.length !== ids.length) throw new Error('The installed tier no longer declares all six audited cases')
const check = mutate => {
  const report = structuredClone(base)
  mutate(report)
  // Historical evidence is evaluated at its recorded time; this is not a fresh release verdict.
  const verdict = evaluateRelease({ report, requirement, expectedSource: report.source.commit, now: Date.parse(report.checkedAt) })
  return { accepted: verdict.ok, failures: verdict.failures.map(value => ({ code: value.code, caseId: value.caseId })) }
}
const positive = check(() => {})
const cases = [{ id: 'ACTUAL_PERSONAL_HTTP_POSITIVE_CONTROL', ...positive, status: positive.accepted ? 'PASS' : 'FAIL' }]
const mutations = [
  {
    id: 'BLOCKED', caseId: 'E6-CURRENT-MAIN-INSTALL', mutate(report) {
      const value = get(report, this.caseId).evidence.currentInstall
      value.observed = 'BLOCKED'
      value.instanceMode = null
      value.health = null
      value.configuration = null
    },
  },
  {
    id: 'FIXTURE', caseId: 'E6-CURRENT-MAIN-INSTALL', mutate(report) {
      get(report, this.caseId).evidence.currentInstall.instanceMode = 'fixture'
    },
  },
  {
    id: 'COPY_NO_EXIT_CODE', caseId: 'E7-OWNERSHIP-COPY', mutate(report) {
      const value = get(report, this.caseId).evidence.ownershipCopy
      delete value.status
      delete value.code
    },
  },
  {
    id: 'STEP_ONLY_FAULT', caseId: 'E4-UPGRADE-FAULTS', mutate(report) {
      for (const window of Object.values(get(report, this.caseId).evidence.upgradeFaults.windows)) {
        window.probe = { steps: ['fault_observed', 'recover', 'recovered_health', 'data_kept'].map(id => ({ id, status: 'PASS' })) }
      }
    },
  },
  {
    id: 'FOREIGN_ABI_PLATFORM_ARCH', caseId: 'E6-CURRENT-MAIN-INSTALL', mutate(report) {
      const value = get(report, this.caseId).evidence.currentInstall.subject
      value.abi = '999'
      value.platform = 'linux'
      value.arch = 'x64'
    },
  },
  {
    id: 'ACTUAL_FAULT_RECOVER_BLOCKED_NONZERO', caseId: 'E4-UPGRADE-FAULTS', mutate(report) {
      const value = get(report, this.caseId).evidence.upgradeFaults.windows.crash_after_stop.probe.recover
      value.exit = 2
      value.status = 'BLOCKED'
      value.code = 'unknown_live_resource'
      value.started = null
    },
  },
]
for (const mutation of mutations) {
  if (!positive.accepted) {
    cases.push({ id: mutation.id, status: 'NOT_TESTED', reason: 'The unchanged actual evidence positive control did not pass' })
    continue
  }
  const result = check(report => mutation.mutate(report))
  const focalRefusal = !result.accepted && result.failures.some(value => value.caseId === mutation.caseId)
  cases.push({ id: mutation.id, ...result, focalCaseId: mutation.caseId, status: focalRefusal ? 'PASS' : 'FAIL' })
}
const current = get(original, 'E6-CURRENT-MAIN-INSTALL').evidence.currentInstall
const report = { protocol: 'wave16-e-admission/1', source, candidateRoot, reportSource: original.source,
  recordedRun: latest.runDirectory, recordedSubject: current?.subject,
  positiveBehavior: { observed: current?.observed, mode: current?.mode, instanceMode: current?.instanceMode, actions: current?.actions },
  cases, passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  notTested: cases.filter(value => value.status === 'NOT_TESTED').length,
  realModelTurns: 0, nativeTurns: 0,
  scope: 'Six actual installed-alpha entries, unchanged actual HTTP positive and focal behavior mutations; canonical artifact retained, no synthetic whole-tier or new installed release PASS' }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || report.notTested ? 1 : 0
