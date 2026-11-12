import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave14-runtime.mjs <B-root>')
const candidate = resolve(process.argv[2])
const load = file => import(pathToFileURL(`${candidate}/${file}`).href)
const { createReviewSender } = await load('packages/driver-kit/src/review-sender.ts')
const { describeRuntime, redactPrivatePaths } = await load('packages/driver-kit/src/runtime-diagnostics.ts')
const cases = []

async function checkInput(id, input, extra = () => ({})) {
  let reservations = 0, fakeSends = 0, received
  const sender = createReviewSender({
    transport: { async startTurn(frame) { fakeSends++; received = frame.input; return { turnId: 'inert-only' } } },
    hook: { async reserve() { reservations++; return { admitted: true, reservationId: 'inert-only' } } },
    grant: { grantId: 'audit-only', owner: 'audit', limit: 1, ledgerPath: '/unused/no-ledger-opened.json' },
    costBound: { available: true, reason: 'trusted inert construction only' },
  })
  const result = await sender.send({ input, gates: { isolation: { satisfied: true } },
    modelIdentity: { model: 'fixture', modelProvider: 'fixture' } })
  let serialized, serializationError
  try { serialized = JSON.stringify(received) } catch (error) { serializationError = error.message }
  cases.push({ id, status: !reservations && !fakeSends && !result.sent ? 'PASS' : 'FAIL',
    observation: { reservations, fakeSends, sent: result.sent, serialized, serializationError, ...extra(received) } })
}

let getterReads = 0
await checkInput('VALIDATION_MUST_COVER_ACTUAL_CLONED_ACCESSOR_VALUE', {
  get value() { return ++getterReads === 1 ? 1 : 1n },
}, received => ({ getterReads, clonedValueType: typeof received?.value }))

const symbolArray = ['prompt']
symbolArray[Symbol('required-context')] = 'must not be silently dropped'
await checkInput('ARRAY_SYMBOL_KEY_MUST_NOT_BYPASS_JSON_VALIDATION', symbolArray,
  received => ({ originalSymbolKeys: Object.getOwnPropertySymbols(symbolArray).length,
    receivedSymbolKeys: Object.getOwnPropertySymbols(received ?? {}).length }))

await checkInput('MAP_MODEL_CONTEXT_MUST_NOT_SILENTLY_SERIALIZE_EMPTY', new Map([['prompt', 'required context']]),
  received => ({ receivedMap: received instanceof Map, receivedMapSize: received instanceof Map ? received.size : null }))

const windowsPath = 'C:\\Users\\PrivateAudit\\secret.log'
const publicText = redactPrivatePaths(windowsPath)
const description = describeRuntime({ binary: '/nonexistent/inert-only',
  capabilities: { protocol_handshake: { detail: windowsPath } } })
cases.push({ id: 'PUBLIC_WINDOWS_PATH_MUST_REDACT_ACCOUNT_AND_TRAILING_COMPONENTS',
  status: JSON.stringify(description).includes('PrivateAudit') ? 'FAIL' : 'PASS',
  observation: { publicText, publicDetail: description.capabilities.find(row => row.id === 'protocol_handshake')?.detail,
    pathRedacted: description.pathRedacted } })

const report = { candidate, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim(),
  cases, passed: cases.filter(item => item.status === 'PASS').length,
  failed: cases.filter(item => item.status === 'FAIL').length, realModelTurns: 0, nativeTurnStarts: 0,
  ledgerOpened: false }

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave14-admission/runtime.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
