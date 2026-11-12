import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = resolve(process.argv[2] ?? '')
if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave12-runtime.mjs <B-root>')
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
const { createReviewSender } = await import(pathToFileURL(join(candidate, 'packages/driver-kit/src/review-sender.ts')).href)
const { describeRuntime } = await import(pathToFileURL(join(candidate, 'packages/driver-kit/src/runtime-diagnostics.ts')).href)
const cases = []
for (const [kind, input] of [['function', () => {}], ['symbol', Symbol('uncloneable')]]) {
  let reservations = 0, fakeSends = 0
  const sender = createReviewSender({
    transport: { startTurn: async () => { fakeSends++; return { turnId: 'fixture-turn', sent: true } } },
    hook: { reserve: async () => { reservations++; return { admitted: true, reservationId: 'fixture-reservation' } } },
    grant: { grantId: 'probe-only', owner: 'probe', limit: 1, ledgerPath: '/unused/probe-only.json', scope: 'fixture' },
    costBound: { available: true, reason: 'inert fixture only, no real allowance' }, hostPolicy: { mechanism: 'fixture' },
  })
  const result = await sender.send({ caseRef: 'probe', input, gates: { isolation: { satisfied: true } },
    modelIdentity: { model: 'fixture', modelProvider: 'fixture' } })
  const observation = { reservations, fakeSends, sent: result.sent }
  cases.push({ id: `TOP_LEVEL_${kind.toUpperCase()}_REFUSES_BEFORE_RESERVE`,
    status: !reservations && !fakeSends && !result.sent ? 'PASS' : 'FAIL', observation })
}
const selected = '/tmp/independent-audit-private-home/agent-missing'
const description = describeRuntime({ binary: selected })
const leaked = JSON.stringify(description).includes('/tmp/independent-audit-private-home')
cases.push({ id: 'DEFAULT_PUBLIC_DESCRIPTION_REDACTS_ALL_PRIVATE_PATH_FIELDS', status: leaked ? 'FAIL' : 'PASS',
  observation: { leaked, binary: description.identity?.binary, versionError: description.identity?.versionError } })
const report = { protocol: 'wave12-b-admission/1', candidate, source, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  realModelTurns: 0, nativeTurnStarts: 0, scope: 'experimental helper only; fake reserve/send; no ledger touched' }
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'reports/releases/wave12-admission/runtime.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
assert.equal(report.failed, 0, 'Candidate helper boundaries remain open')
