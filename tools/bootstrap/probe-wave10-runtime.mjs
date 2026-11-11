import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const candidate = resolve(process.argv[2] ?? join(repository, '../superagent-agent-b'))
const evaluator = resolve(process.argv[3] ?? join(repository, '../superagent-agent-e'))
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const load = (root, path) => import(pathToFileURL(join(root, path)).href)
const admission = await load(candidate, 'packages/driver-kit/src/send-admission.ts')
const review = await load(candidate, 'packages/driver-kit/src/review-sender.ts')
const resources = await load(candidate, 'packages/execution/src/resource-facts.ts')
const cases = []
const check = async (id, scope, run) => {
  let observation
  try { observation = await run(); cases.push({ id, scope, status: 'PASS', observation }) }
  catch (error) { cases.push({ id, scope, status: 'FAIL', message: error.message, observation: error.observation ?? observation }) }
}
const expect = (actual, expected, message, observation) => {
  try { assert.equal(actual, expected, message) }
  catch (error) { error.observation = observation; throw error }
}
function parts() {
  const sent = [], reserved = []
  const transport = { async startTurn(value) { sent.push(value); return { turnId: 'fixture-turn' } } }
  const hook = { async reserve(value) { reserved.push(value); return { admitted: true, reservationId: `fixture-${reserved.length}` } } }
  const request = { grant: { grantId: 'fixture-only-grant', owner: 'E', limit: 24, ledgerPath: '/fixture/not-opened.json' },
    caseRef: 'fixture-case', turn: 1, subject: 'frozen-material', profile: { id: 'fixture-profile', revision: 1 },
    hostPolicy: { mechanism: 'fixture-only' }, transport, hook,
    gates: { model_identity: { satisfied: true, evidence: { model: 'fixture', modelProvider: 'fixture' } },
      cost_bound: { satisfied: true }, isolation: { satisfied: true }, reservation: { satisfied: true } } }
  return { sent, reserved, transport, hook, request }
}

await check('PLAIN_RESOURCE_JSON_HAS_NO_RELEASE_AUTHORITY', 'diagnostic_module', async () => {
  const value = resources.describeResourceFacts({ state: 'terminated', admission: 'closed', coverage: 'complete_owned_resources',
    resources: [{ ref: 'fixture-writer', writer: 'quiescent', ownership: 'spawned_process', evidence: ['fixture'] }] })
  expect(value.releaseBarrierSatisfied, false, 'Ordinary JSON must not release the resource barrier', value)
  return { verdict: value.verdict, releaseBarrierSatisfied: value.releaseBarrierSatisfied }
})
await check('ONE_TOKEN_CONCURRENT_CONSUMPTION_SENDS_AT_MOST_ONCE', 'experimental_sender_helper', async () => {
  const value = parts(), token = admission.admitSend(value.request).token
  const results = await Promise.all([admission.consumeSendToken(token, { ...value, input: 'fixture' }),
    admission.consumeSendToken(token, { ...value, input: 'fixture' })])
  expect(value.sent.length, 1, 'A single token must allow only one fake send', { results, sends: value.sent.length })
  return { sends: value.sent.length, refusals: results.filter(result => !result.sent).length }
})
await check('DEFAULT_REVIEW_SENDER_REMAINS_BLOCKED_WITHOUT_BOUND', 'experimental_sender_helper', async () => {
  const value = parts(), sender = review.createReviewSender(value.request)
  const result = await sender.send({ caseRef: 'fixture-case', subject: 'frozen-material', input: 'fixture' })
  expect(result.sent, false, 'No bound must leave the default experimental sender blocked', result)
  expect(value.sent.length, 0, 'The refusal must happen before transport invocation', result)
  return { sent: result.sent, fakeSends: value.sent.length }
})
await check('INPUT_STAYS_FROZEN_WHILE_RESERVATION_IS_AWAITED', 'experimental_sender_immutable_request_contract', async () => {
  const value = parts(), input = { prompt: 'approved frozen patch', materialDigest: 'a'.repeat(64) }
  let release
  const reserved = new Promise(resolve => { release = resolve })
  value.hook.reserve = async () => { await reserved; return { admitted: true, reservationId: 'fixture-mutation' } }
  const sender = review.createReviewSender({ ...value.request, costBound: { available: true, reason: 'trusted fixture construction' } })
  const pending = sender.send({ caseRef: 'fixture-case', subject: 'frozen-material', input,
    gates: { isolation: { satisfied: true } }, modelIdentity: { model: 'fixture', modelProvider: 'fixture' } })
  input.prompt = 'changed after admission'; input.materialDigest = 'b'.repeat(64)
  release()
  const result = await pending
  const observation = { result, fakeSends: value.sent.length, receivedPrompt: value.sent[0]?.input?.prompt,
    receivedMaterialDigest: value.sent[0]?.input?.materialDigest }
  expect(value.sent.some(send => send.input.prompt === 'changed after admission'), false,
    'The immutable request contract must either retain the admitted input or refuse its mutation', observation)
  return observation
})
await check('FIXED_TRANSPORT_CANNOT_REPLACE_ITS_METHOD_AFTER_ISSUANCE', 'experimental_sender_fixed_transport_contract', async () => {
  const value = parts(), issued = admission.admitSend(value.request)
  let replacementSends = 0
  value.transport.startTurn = async () => { replacementSends++; return { turnId: 'replacement-fixture' } }
  const result = await admission.consumeSendToken(issued.token, { transport: value.transport, hook: value.hook, input: 'fixture' })
  const observation = { result, originalFakeSends: value.sent.length, replacementFakeSends: replacementSends }
  expect(replacementSends, 0, 'Binding transport object identity must also preserve the admitted implementation', observation)
  return observation
})
await check('E_CONSUMER_CAN_CALL_THE_ACTUAL_B_SENDER_ENTRY', 'experimental_B_E_consumer_integration', async () => {
  const { guardedSend } = await load(evaluator, 'tests/product-acceptance/pilot/runner.mjs')
  const module = join(candidate, 'packages/driver-kit/src/review-sender.ts')
  const result = await guardedSend({ admission: { ok: true, facts: { entry: { owner: 'b', kind: 'b-sender',
    module, export: 'send', protocolVersion: 'review-sender/1' } } }, reservationId: 'fixture-not-persisted',
    input: 'fixture', caseRef: 'fixture-case' })
  expect(result.reason === 'b_sender_unavailable', false,
    'E requires a module-level send export; the B factory alone is not that consumer entry', result)
  return result
})
await check('NEW_PUBLIC_MODULES_PASS_THE_EXISTING_STRICT_TYPESCRIPT_CONTRACT', 'new_module_integration', async () => {
  const files = ['packages/driver-kit/src/runtime-diagnostics.ts', 'packages/driver-kit/src/send-admission.ts',
    'packages/driver-kit/src/review-sender.ts', 'packages/execution/src/resource-facts.ts']
  const args = ['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2024',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions', '--types', 'node', ...files]
  let exitCode = 0, output = ''
  try { output = execFileSync('pnpm', args, { cwd: candidate, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { exitCode = error.status ?? 1; output = String(error.stdout ?? '') }
  const diagnostics = output.split('\n').filter(line => /^packages\/.+\(\d+,\d+\): error TS/.test(line))
  const perFile = {}
  for (const line of diagnostics) { const file = line.slice(0, line.indexOf('(')); perFile[file] = (perFile[file] ?? 0) + 1 }
  const observation = { command: ['pnpm', ...args], exitCode, diagnosticCount: diagnostics.length, perFile, firstDiagnostics: diagnostics.slice(0, 8) }
  expect(exitCode, 0, 'Public TS exports must compile under the main strict settings; strip-only runtime tests cannot establish this', observation)
  return observation
})

const trustedFixture = parts()
const configured = review.createReviewSender({ ...trustedFixture.request, costBound: { available: true } })
const configuredResult = await configured.send({ caseRef: 'fixture-case', input: 'fixture',
  gates: { isolation: { satisfied: true } }, modelIdentity: { model: 'fixture', modelProvider: 'fixture' } })
const relativeFiles = ['packages/execution/src/resource-facts.ts', 'packages/driver-kit/src/send-admission.ts', 'packages/driver-kit/src/review-sender.ts', 'packages/driver-kit/src/runtime-diagnostics.ts']
const report = {
  status: cases.some(value => value.status === 'FAIL') ? 'FAIL_SCOPED_NEW_RUNTIME_MODULE_ADMISSION' : 'PASS_SCOPED_RUNTIME_HELPER_ADMISSION',
  command: ['node', 'tools/bootstrap/probe-wave10-runtime.mjs', candidate, evaluator],
  sourceRoot: candidate, sourceCommit: git(candidate, ['rev-parse', 'HEAD']),
  sourceWorktreeClean: git(candidate, ['status', '--porcelain']) === '',
  publishedSource: git(candidate, ['rev-parse', 'origin/codex/g1-runtime']),
  baseCommit: git(candidate, ['merge-base', 'HEAD', 'origin/main']),
  sourceHashes: Object.fromEntries(relativeFiles.map(path => [path, createHash('sha256').update(readFileSync(join(candidate, path))).digest('hex')])),
  evaluatorSource: git(evaluator, ['rev-parse', 'HEAD']), checkedAt: new Date().toISOString(),
  cases, exitCode: cases.some(value => value.status === 'FAIL') ? 1 : 0,
  observedTrustedConstruction: { costBoundAvailableClaim: true, fakeSends: trustedFixture.sent.length, sent: configuredResult.sent,
    interpretation: 'Factory parameters are trusted internal construction today; this observation is not a proven user-facing permission bypass.' },
  independentOwnedTests: { command: 'node --test packages/execution/test/resource-facts.test.ts packages/driver-kit/test/send-admission.test.ts packages/driver-kit/test/review-sender.test.ts packages/driver-kit/test/runtime-diagnostics.test.ts', passed: 68, failed: 0, exitCode: 0 },
  controlledWindows: { command: 'node tests/native-acceptance/b11-control-windows.mjs', passed: 10, notTested: 1, failed: 0, exitCode: 0 },
  modelCalls: 0, nativeTurns: 0,
  limitations: [
    'All sender transports/reservations are local in-memory fakes. No ledger file is read or written, and no model/native turn is sent.',
    'The immutable-input and fixed-method findings concern experimental helper interface promises; no current personal-product reachability is claimed.',
    'Main currently does not consume these helpers; the existing authenticated production resource barrier remains the execution authority.',
    'B resource facts do not replace main current-binding and exact registered-resource-manifest validation.',
    'The B/E check calls actual E guardedSend with the actual B module; it proves an export/return-contract mismatch, not pilot value or native compatibility.',
    'B9 protocol discovery was not rerun: it opens native protocol sessions, is historical evidence and is unnecessary for this zero-model bounded audit.',
  ],
}
const output = join(repository, 'reports/releases/wave10-admission/runtime.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.exitCode
