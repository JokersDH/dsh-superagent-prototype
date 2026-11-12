import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const candidate = resolve(process.argv[2] ?? join(root, '../superagent-agent-b'))
const evaluator = resolve(process.argv[3] ?? join(root, '../superagent-agent-e'))
const load = (base, path) => import(pathToFileURL(join(base, path)).href)
const git = (base, args) => execFileSync('git', args, { cwd: base, encoding: 'utf8' }).trim()
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const command = (args, cwd = candidate, executable = process.execPath) => {
  try { return { exitCode: 0, stdout: execFileSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (error) { return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') } }
}
const initialSource = git(candidate, ['rev-parse', 'HEAD'])
const sourceFiles = ['packages/driver-kit/src/send-admission.ts', 'packages/driver-kit/src/review-sender.ts',
  'packages/driver-kit/src/runtime-diagnostics.ts', 'packages/execution/src/resource-facts.ts', 'tests/native-acceptance/b12-control-restart.mjs']
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, sha(join(candidate, path))]))

// Reuse the exact previous seven dynamic cases without invoking its historical report writer.
// Only harness bookkeeping is changed in memory; all B/E production imports stay unchanged.
const legacyPath = join(root, 'tools/bootstrap/probe-wave10-runtime.mjs')
const original = readFileSync(legacyPath, 'utf8')
const repositoryLine = "const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')"
const writerLine = "const output = join(repository, 'reports/releases/wave10-admission/runtime.json')"
assert.equal(original.split(repositoryLine).length, 2, 'Legacy harness repository anchor changed')
assert.equal(original.split(writerLine).length, 2, 'Legacy harness report anchor changed')
let replay = original.replace(repositoryLine, `const repository = ${JSON.stringify(root)}`)
replay = `${replay.slice(0, replay.indexOf(writerLine))}\nexport default report;\n`
const legacy = (await import(`data:text/javascript;base64,${Buffer.from(replay).toString('base64')}`)).default
const cases = legacy.cases.map(value => ({ ...value, origin: 'previous_seven_case_probe' }))
const check = async (id, scope, action) => {
  try { cases.push({ id, scope, status: 'PASS', observation: await action() }) }
  catch (error) { cases.push({ id, scope, status: 'FAIL', message: error.message, observation: error.observation }) }
}
const requireObservation = (condition, message, observation) => {
  if (!condition) throw Object.assign(new Error(message), { observation })
}
const review = await load(candidate, 'packages/driver-kit/src/review-sender.ts')
const diagnostics = await load(candidate, 'packages/driver-kit/src/runtime-diagnostics.ts')
const { guardedSend } = await load(evaluator, 'tests/product-acceptance/pilot/runner.mjs')

await check('PUBLIC_MODULES_MATCH_MAIN_EXACT_OPTIONAL_PROPERTY_POLICY', 'actual_main_consumer_type_policy', async () => {
  const args = ['exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--skipLibCheck',
    '--target', 'ES2024', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions', '--types', 'node',
    'packages/driver-kit/src/runtime-diagnostics.ts', 'packages/driver-kit/src/send-admission.ts',
    'packages/driver-kit/src/review-sender.ts', 'packages/execution/src/resource-facts.ts']
  const result = command(args, candidate, 'pnpm')
  const diagnostics = result.stdout.split('\n').filter(line => /^packages\/.+\(\d+,\d+\): error TS/.test(line))
  const observation = { command: ['pnpm', ...args], exitCode: result.exitCode, diagnosticCount: diagnostics.length, diagnostics }
  requireObservation(result.exitCode === 0, 'Standalone --strict omits the main consumer exactOptionalPropertyTypes rule', observation)
  return observation
})

await check('UNCLONEABLE_INPUT_REFUSES_BEFORE_RESERVATION_AND_TRANSPORT', 'experimental_sender_input_contract', async () => {
  let reservations = 0, sends = 0, received, result, thrown
  const sender = review.createReviewSender({
    grant: { grantId: 'fixture-only', owner: 'E', limit: 24, ledgerPath: '/fixture/not-opened.json' },
    hook: { async reserve() { reservations++; return { admitted: true, reservationId: 'fixture-only' } } },
    transport: { async startTurn(value) { sends++; received = value; return { turnId: 'fixture-only' } } },
    costBound: { available: true, reason: 'trusted fake construction only' },
  })
  try { result = await sender.send({ caseRef: 'uncloneable', input: { prompt: 'frozen', callback() {} },
    gates: { isolation: { satisfied: true } }, modelIdentity: { model: 'fixture', modelProvider: 'fixture' } }) }
  catch (error) { thrown = error.name }
  const observation = { reservations, fakeSends: sends, receivedInput: received?.input, result, thrown }
  requireObservation(reservations === 0 && sends === 0, 'A clone failure must refuse, not reserve and send a refusal sentinel as model input', observation)
  return observation
})

await check('AGREED_E_BINDING_REACHES_B_DEFAULT_REFUSAL_NOT_ENTRY_MISMATCH', 'experimental_B_E_consumer_contract', async () => {
  const result = await guardedSend({ admission: { ok: true, facts: { entry: { owner: 'b', kind: 'b-sender',
    module: join(candidate, 'packages/driver-kit/src/review-sender.ts'), export: 'send', protocolVersion: 'review-sender/1' } } },
    reservationId: 'fixture-echo', caseRef: 'fixture-case', input: 'fixture' })
  const validRefusal = result.ok === true && result.result?.sent === false && result.result?.status === 'no_send' &&
    result.result?.reservationId === 'fixture-echo' && !String(result.result?.reason).includes('does not name')
  requireObservation(validRefusal, 'The actual E caller omits the admission envelope B expects; export presence alone does not close this signature mismatch', result)
  return result
})

await check('RUNTIME_IDENTITY_SUPPORTS_VALID_ABSOLUTE_EXECUTABLE_WITH_SPACES', 'new_diagnostic_module_path_handling', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-wave11-identity-'))
  try {
    const binary = join(directory, 'agent with spaces')
    symlinkSync(process.execPath, binary)
    const value = diagnostics.resolveRuntimeIdentity({ binary })
    const observation = { declaredPath: value.declaredPath, realPath: value.realPath, version: value.version,
      expectedDeclaredPath: binary, expectedRealPath: realpathSync(process.execPath) }
    requireObservation(value.declaredPath === binary && value.realPath === observation.expectedRealPath && !!value.digest,
      'Shell tokenization loses a valid operator-selected executable path containing spaces', observation)
    return observation
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

const { AttemptSupervisor } = await load(candidate, 'packages/execution/src/supervisor.ts')
const { FakeRunnerHost, InMemoryFactLedger, makeAttemptSpec } = await load(candidate, 'packages/testing/src/index.ts')
const byTicket = new Map()
const bindings = { current: id => byTicket.get(id), save: value => byTicket.set(value.ticketId, value) }
const runner = new FakeRunnerHost(), sink = new InMemoryFactLedger(), spec = makeAttemptSpec({ fenceEpoch: 5 })
const options = { runner, bindings, sink, preparedPolicyRef: 'prepared-1' }
const first = new AttemptSupervisor(options)
await first.start({ ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId,
  fenceEpoch: spec.fenceEpoch, contract: spec.contract, spec, initialInputRef: 'initial' })
const reconstructed = new AttemptSupervisor(options)
const delivery = await reconstructed.deliver(spec.ticketId, 'after-reconstruction')
const controlledScope = { status: 'NOT_TESTED_DURABLE_RESTART', b12SourceHash: sourceHashes['tests/native-acceptance/b12-control-restart.mjs'],
  recoveryMethodType: typeof reconstructed.recover, reconstructedDelivery: delivery,
  inMemoryBindingCount: byTicket.size, actualProcessRestarts: 0, durableDatabaseUsed: false,
  begins: runner.attempts.flatMap(value => value.commands).filter(value => value.kind === 'begin').length,
  interpretation: 'The current B12 reconstructs memory-only objects and optional-calls a missing recover method. No duplicate begin by itself does not prove reconnect or persistence; this is a source-bound evidence limitation, not a requirement to add recover to this class.' }

const owned = command(['--test', 'packages/execution/test/resource-facts.test.ts', 'packages/driver-kit/test/send-admission.test.ts',
  'packages/driver-kit/test/review-sender.test.ts', 'packages/driver-kit/test/runtime-diagnostics.test.ts'])
const b11 = command(['tests/native-acceptance/b11-control-windows.mjs'])
const b12 = command(['tests/native-acceptance/b12-control-restart.mjs'])
const parseTotals = (output, label) => JSON.parse(output.match(new RegExp(`${label} totals: (\\{[^\\n]+\\})`))?.[1] ?? 'null')
const tests = { owned: { exitCode: owned.exitCode, passed: Number(owned.stdout.match(/\u2139 pass (\d+)/)?.[1] ?? 0),
  failed: Number(owned.stdout.match(/\u2139 fail (\d+)/)?.[1] ?? 0) },
  b11: { exitCode: b11.exitCode, totals: parseTotals(b11.stdout, 'B11') },
  b12: { exitCode: b12.exitCode, totals: parseTotals(b12.stdout, 'B12'), evidenceClassification: controlledScope.status } }
const sourcesStable = initialSource === git(candidate, ['rev-parse', 'HEAD']) && sourceFiles.every(path => sourceHashes[path] === sha(join(candidate, path)))
const failures = cases.filter(value => value.status === 'FAIL')
const report = { status: failures.length ? 'FAIL_SCOPED_NEW_B_HELPER_ADMISSION' : 'PASS_SCOPED_B_HELPER_ADMISSION',
  command: ['node', 'tools/bootstrap/probe-wave11-runtime.mjs', candidate, evaluator],
  sourceRoot: candidate, sourceCommit: initialSource, publishedSource: git(candidate, ['rev-parse', 'origin/codex/g1-runtime']),
  sourceWorktreeClean: git(candidate, ['status', '--porcelain']) === '', baseCommit: git(candidate, ['merge-base', 'HEAD', 'origin/main']),
  evaluatorSource: git(evaluator, ['rev-parse', 'HEAD']), evaluatorTestSourceClean: git(evaluator, ['status', '--porcelain', '--', 'tests/product-acceptance/pilot/runner.mjs']) === '',
  checkedAt: new Date().toISOString(), sourceHashes, sourcesStable, legacyProbeHash: sha(legacyPath),
  legacyProbeOldCasesPassed: legacy.cases.filter(value => value.status === 'PASS').length,
  legacyStrict: legacy.cases.find(value => value.id === 'NEW_PUBLIC_MODULES_PASS_THE_EXISTING_STRICT_TYPESCRIPT_CONTRACT')?.observation,
  cases, totals: { passed: cases.filter(value => value.status === 'PASS').length, failed: failures.length },
  controlledScope, independentCommands: tests,
  references: { uncloneableInput: 'packages/driver-kit/src/review-sender.ts:200',
    exactOptionalPolicy: 'packages/driver-kit/src/review-sender.ts:134',
    senderSignature: 'packages/driver-kit/src/review-sender.ts:225', evaluatorSignature: 'tests/product-acceptance/pilot/runner.mjs:451',
    executablePath: 'packages/driver-kit/src/runtime-diagnostics.ts:196', claimedReconnect: 'tests/native-acceptance/b12-control-restart.mjs:98' },
  modelCalls: 0, nativeTurns: 0, exitCode: failures.length || !sourcesStable || owned.exitCode || b11.exitCode || b12.exitCode ? 1 : 0,
  limitations: [
    'Existing seven dynamic probes are reused in memory with its historical writer removed; wave10 evidence is not overwritten.',
    'The exact-optional isolated compile separates real source errors from stale dist exports seen in the unbuilt candidate coordinator check.',
    'All sender transports, reservations and the reconstruction exercise are in-memory fakes; no budget ledger is opened.',
    'The whitespace-path fixture invokes a temporary symlink to the current Node executable with --version only, not a vendor protocol or model.',
    'B12 missing recovery/persistence is an observed evidence limitation of this source, not a future hard gate requiring a new method on AttemptSupervisor.',
    'Main currently does not consume the experimental helpers; these findings do not establish a current personal-product permission bypass.',
    'The B/E entry remains inert. This checks correct refusal protocol recognition, not a working native sender or review value.',
    'No user or native-account credential contents are read. Authenticated proof unit cases use their own temporary test credentials; diagnostics perform permitted --version and Seatbelt checks. User services and installed artifacts remain untouched.'
  ] }
const output = join(root, 'reports/releases/wave11-admission/runtime.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.exitCode
