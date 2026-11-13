import childProcess, { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const classification = 'MAIN_DIAGNOSTIC_NOT_B_SUBMITTED_DELIVERY'
if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<new absolute output> node tools/bootstrap/diagnose-wave18-b-preparation.mjs <B-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output) || existsSync(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute output path; existing files are refused')
const candidate = realpathSync(process.argv[2])
const candidateRelative = relative(candidate, output)
if (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative)) throw new Error('The output must be outside the B checkout')
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
const producer = fileURLToPath(new URL('./fixtures/wave18-fake-codex.mjs', import.meta.url))
const runnerEntry = join(candidate, 'apps/runner/src/runner-service-entry.ts')
const load = file => import(pathToFileURL(join(candidate, file)).href)

// Use this checkout's contracts source if its ignored dist is stale. No file is rewritten.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === '@personal-agent/contracts'
    ? pathToFileURL(join(candidate, 'packages/contracts/src/index.ts')).href : specifier, context)
} })
const { ProductStore } = await load('packages/storage/src/index.ts')
const { createProductRuntime } = await load('apps/coordinator/product/runtime.ts')
const { NativeProjectRegistry, ensureStarterProject } = await load('apps/coordinator/product/project-registry.ts')
const root = mkdtempSync('/tmp/pa-wave18-main-preparation-')
const stateRoot = join(root, 'state'), projectPath = join(root, 'project'), receiverLog = join(root, 'receiver.jsonl')
const environmentKeys = ['PA_RUNNER_SCENARIO', 'PA_RUNNER_RECEIVER_LOG', 'PA_RUNNER_RECOVERY_ROOT', 'PA_RUNNER_ENVIRONMENT_PLAN', 'PA_FAKE_APPROVAL']
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]))
for (const key of environmentKeys) delete process.env[key]
process.env.PA_RUNNER_SCENARIO = 'codex-native'
process.env.PA_RUNNER_RECEIVER_LOG = receiverLog
const ownedRunners = []
const originalSpawn = childProcess.spawn
childProcess.spawn = function (executable, args, options) {
  if (executable !== process.execPath || args?.[0] !== runnerEntry || args?.[1] !== 'codex-native') {
    throw new Error('Unexpected subprocess refused; this diagnostic has no installed-agent fallback')
  }
  const child = originalSpawn.call(this, executable, args, options)
  ownedRunners.push({ child, pid: child.pid, bornAt: new Date().toISOString(), entry: runnerEntry })
  return child
}
syncBuiltinESMExports()

const deadline = async (work, milliseconds, label) => {
  let timer
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
const alive = child => child.exitCode === null && child.signalCode === null
const report = {
  protocol: 'wave18-main-preparation-diagnostic/1', classification, candidate, source, producer,
  creditedToBSubmittedDelivery: false, outcome: 'FAIL', realModelTurns: 0, vendorNativeTurnStarts: 0,
  budgetLedgerOpened: false, automaticFallback: false, physicalBarrierAdmitted: false,
  scope: 'Normal original ProductDriver preparation/begin/question using a main-owned local fake. No recovered business, answer, stop-ACK, vendor enforcement or release admission is measured.',
}
let store, product
try {
  mkdirSync(stateRoot, { mode: 0o700 })
  ensureStarterProject(projectPath)
  const registry = new NativeProjectRegistry(stateRoot)
  const project = registry.prepare({ path: projectPath, displayName: 'Main controlled diagnostic', check: 'node_test' })
  registry.save(project)
  store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
  const profile = { id: 'profile-main-diagnostic', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: 'main-diagnostic-fake-only', executable: process.execPath, argv: [producer], expectedVersion: '0.164.0',
    nativeConfigRef: 'main-diagnostic-config', permissionPolicyRevision: 'main-diagnostic-policy-1', requiredFeatures: [] }
  product = createProductRuntime({ store, principal, stateRoot, scratchProject: projectPath,
    actionSecret: Buffer.alloc(32, 1), projectRegistry: registry,
    projects: [{ id: project.id, scope: registry.scope(project) }],
    native: { profile, projects: [{ id: project.id, path: project.path, check: registry.check(project) }], approvalPolicy: 'on-request' } })
  product.start()
  report.created = await deadline(product.application.dispatch({ commandId: 'main-diagnostic-create-work', conversationId: 'main-diagnostic-conversation',
    kind: 'create_work', projectId: project.id, goal: 'Controlled local preparation diagnostic', profileId: profile.id,
    scope: registry.scope(project), criteria: [{ id: 'main-diagnostic-check', kind: 'machine', required: true,
      description: 'Registered local project check', checkDefinitionRef: registry.check(project).id }] },
  { ...principal, source: 'local_cli' }), 5000, 'create_work deadline exceeded')
  const end = Date.now() + 10_000
  let bindings = [], observations = []
  while (Date.now() < end) {
    bindings = store.db.prepare('SELECT attempt_id FROM runtime_bindings').all().map(row => store.bindings.binding(row.attempt_id))
    observations = bindings.flatMap(binding => store.observations.forAttempt(binding.attemptId))
    if (observations.some(row => row.kind === 'question.opened') || bindings.some(binding => binding.state === 'stopping')) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const names = ['works', 'ticket', 'ticket_links', 'effect', 'fact_receipts', 'dispatch_receipts', 'user_questions', 'answers', 'answer_deliveries', 'runtime_bindings', 'runtime_current']
  report.tables = Object.fromEntries(names.map(name => [name, Number(store.db.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n)]))
  report.bindings = bindings
  report.observations = observations
  report.factKinds = observations.map(row => row.kind)
  report.receiverFrames = existsSync(receiverLog) ? readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  report.questions = (await product.application.inspect({})).questions
  const begins = report.receiverFrames.filter(frame => frame.kind === 'begin')
  report.checks = {
    policyPrepared: report.factKinds.includes('policy.prepared'),
    beginReceivedExactlyOnce: begins.length === 1,
    acceptedDispatch: report.factKinds.includes('dispatch.observed') && report.tables.dispatch_receipts >= 1,
    originalBrokerQuestion: report.factKinds.includes('question.opened') && report.questions.length === 1,
    sameAttempt: bindings.length === 1 && begins[0]?.attemptId === bindings[0].attemptId &&
      report.questions[0]?.targets?.[0]?.attemptId === bindings[0].attemptId,
    durableRows: ['works', 'ticket', 'ticket_links', 'fact_receipts', 'runtime_bindings', 'runtime_current'].every(name => report.tables[name] >= 1),
  }
  report.outcome = Object.values(report.checks).every(Boolean) ? 'PASS' : 'FAIL'
} catch (error) {
  report.error = { name: error.name, message: error.message }
} finally {
  try { await deadline(product?.close() ?? Promise.resolve(), 8000, 'Product cleanup deadline exceeded') }
  catch (error) { report.cleanupError = error.message; report.outcome = 'FAIL' }
  // Only direct ChildProcess handles born in this diagnostic may receive fallback signals.
  for (const { child } of ownedRunners) {
    if (alive(child)) {
      try { child.stdin.end() } catch {}
      await deadline(new Promise(resolve => child.once('exit', resolve)), 2000, 'Owned Runner exit deadline').catch(() => {})
      if (alive(child)) child.kill('SIGKILL')
    }
  }
  report.ownedRunners = ownedRunners.map(({ child, ...birth }) => ({ ...birth, exitCode: child.exitCode, signalCode: child.signalCode }))
  report.cleanupComplete = ownedRunners.every(({ child }) => !alive(child)) && !report.cleanupError
  if (!report.cleanupComplete) report.outcome = 'FAIL'
  store?.close()
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
  for (const key of environmentKeys) {
    if (previousEnvironment[key] === undefined) delete process.env[key]
    else process.env[key] = previousEnvironment[key]
  }
  if (report.cleanupComplete) rmSync(root, { recursive: true, force: true })
  else report.retainedPrivateRoot = root
}
report.sourceStable = source === execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
if (!report.sourceStable) report.outcome = 'FAIL'
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ classification, creditedToBSubmittedDelivery: false, candidate, source,
  outcome: report.outcome, output, checks: report.checks, tables: report.tables, factKinds: report.factKinds,
  receiverFrames: report.receiverFrames, resources: report.bindings?.flatMap(binding => binding.resources),
  ownedRunners: report.ownedRunners, cleanupComplete: report.cleanupComplete, error: report.error,
  realModelTurns: 0, vendorNativeTurnStarts: 0 }, null, 2))
process.exitCode = report.outcome === 'PASS' ? 0 : 1
