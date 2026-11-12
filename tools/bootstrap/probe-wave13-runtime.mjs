import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = resolve(process.argv[2] ?? '')
if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave13-runtime.mjs <B-root>')
const load = path => import(pathToFileURL(join(candidate, path)).href)
const { createReviewSender } = await load('packages/driver-kit/src/review-sender.ts')
const { describeRuntime } = await load('packages/driver-kit/src/runtime-diagnostics.ts')
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(), cases = []
for (const [id, input] of [['NESTED_BIGINT_REFUSES_BEFORE_BUDGET', { value: 1n }], ['NESTED_NONFINITE_REFUSES_BEFORE_BUDGET', { value: NaN }],
  ['SYMBOL_KEYS_CANNOT_BE_SILENTLY_LOST', { prompt: 'same text', [Symbol('required-context')]: 'omitted' }]]) {
  let reservations = 0, fakeSends = 0
  const sender = createReviewSender({ transport: { startTurn: async () => { fakeSends++; return { turnId: 'fake-only' } } },
    hook: { reserve: async () => { reservations++; return { admitted: true, reservationId: 'fake-only' } } },
    grant: { grantId: 'audit-only', owner: 'audit', limit: 1, ledgerPath: '/unused/no-ledger.json' }, costBound: { available: true } })
  const result = await sender.send({ input, gates: { isolation: { satisfied: true } }, modelIdentity: { model: 'fixture', modelProvider: 'fixture' } })
  cases.push({ id, status: !reservations && !fakeSends && !result.sent ? 'PASS' : 'FAIL', observation: { reservations, fakeSends, sent: result.sent } })
}
const privateMarker = '/Users/private-audit-user/secret/runtime.log'
const described = describeRuntime({ binary: '/nonexistent/inert-audit-only', capabilities: { protocol_handshake: { detail: privateMarker, invalidation: privateMarker } },
  modelIdentity: { model: 'fixture', modelProvider: 'fixture', observedFrom: privateMarker } })
cases.push({ id: 'PUBLIC_NESTED_DIAGNOSTICS_REDACT_PRIVATE_PATH', status: JSON.stringify(described).includes(privateMarker) ? 'FAIL' : 'PASS' })
const root = mkdtempSync('/tmp/pa-wave13-version-')
try {
  const file = join(root, 'private-version.cjs')
  writeFileSync(file, `#!${process.execPath}\nconsole.log(__filename)\n`, { mode: 0o700 })
  const result = describeRuntime({ binary: file })
  cases.push({ id: 'PUBLIC_VERSION_OUTPUT_REDACTS_PRIVATE_PATH', status: JSON.stringify(result).includes(file) ? 'FAIL' : 'PASS',
    observation: { binary: result.identity.binary, version: result.identity.version, versionRaw: result.identity.versionRaw } })
} finally { rmSync(root, { recursive: true, force: true }) }
const report = { protocol: 'wave13-b-admission/1', candidate, source, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  realModelTurns: 0, nativeTurnStarts: 0, scope: 'experimental helpers, inert transport/reservation, own version fixture, no budget ledger' }
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'reports/releases/wave13-admission/runtime.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.failed ? 1 : 0
