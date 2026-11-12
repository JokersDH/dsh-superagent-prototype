import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = resolve(process.argv[2] ?? '')
if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave13-release-gate.mjs <E-root>')
const { TIERS } = await import(pathToFileURL(join(candidate, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const required = new Set(TIERS['installed-alpha'].cases.filter(value => value.required !== false).map(value => value.id))
const cases = ['E7-OWNERSHIP-COPY', 'E4-UPGRADE-FAULTS', 'E6-CURRENT-MAIN-INSTALL'].map(id =>
  ({ id, status: required.has(id) ? 'PASS' : 'FAIL', requiredByInstalledAlpha: required.has(id) }))
const report = { protocol: 'wave13-e-gate-admission/1', candidate,
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(),
  cases, passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  scope: 'required-case classification only, not a synthetic release PASS', realModelTurns: 0, nativeTurnStarts: 0 }
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'reports/releases/wave13-admission/release-gate.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.failed ? 1 : 0
