/**
 * Controlled normal-path acceptance of B's submitted local producer.
 * Covers original preparation, Broker native_applied and authenticated physical stop only.
 * It does not establish reconnect/crash recovery, installed-agent compatibility or release admission.
 */
import childProcess, { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<new absolute output> node tools/bootstrap/probe-wave19-runtime.mjs <B-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output) || existsSync(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute output; existing files are refused')
const candidate = realpathSync(process.argv[2])
const candidateRelative = relative(candidate, output)
if (!candidateRelative.startsWith('..') && !isAbsolute(candidateRelative)) throw new Error('The report must be outside the candidate checkout')
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const source = git(['rev-parse', 'HEAD'])
const producerRelative = 'tests/native-acceptance/fixtures/fake-codex-producer.mjs'
const producer = join(candidate, producerRelative)
const producerBytes = readFileSync(producer)
if (!producerBytes.equals(execFileSync('git', ['show', `HEAD:${producerRelative}`], { cwd: candidate }))) {
  throw new Error('The producer must exactly match the submitted HEAD, not an untracked or modified substitute')
}
const producerHash = createHash('sha256').update(producerBytes).digest('hex')
execFileSync(process.execPath, ['--check', producer], { cwd: candidate, timeout: 3000, stdio: 'pipe' })
const producerVersion = execFileSync(process.execPath, [producer, '--version'], { cwd: candidate, timeout: 3000, encoding: 'utf8' }).trim()
if (producerVersion !== 'codex-cli 0.164.0') throw new Error('Unexpected local producer version; no installed-agent fallback is allowed')
const load = file => import(pathToFileURL(join(candidate, file)).href)
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === '@personal-agent/contracts'
    ? pathToFileURL(join(candidate, 'packages/contracts/src/index.ts')).href : specifier, context)
} })
const { ProductStore } = await load('packages/storage/src/index.ts')
const { createProductRuntime } = await load('apps/coordinator/product/runtime.ts')
const { NativeProjectRegistry, ensureStarterProject } = await load('apps/coordinator/product/project-registry.ts')
const { storedAttemptPayloads } = await load('apps/coordinator/stored-ingress.ts')
const { ownedResourceManifestDigest } = await load('apps/coordinator/resource-barrier.ts')
const root = mkdtempSync('/tmp/pa-wave19-normal-')
const stateRoot = join(root, 'state'), projectPath = join(root, 'project')
const receiverLog = join(root, 'receiver.jsonl'), producerLog = join(root, 'producer.jsonl')
const environmentKeys = ['PA_RUNNER_SCENARIO', 'PA_RUNNER_RECEIVER_LOG', 'PA_RUNNER_RECOVERY_ROOT', 'PA_RUNNER_ENVIRONMENT_PLAN', 'PA_FAKE_APPROVAL', 'PA_PRODUCER_LOG', 'PA_PRODUCER_HOLD']
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]))
for (const key of environmentKeys) delete process.env[key]
Object.assign(process.env, { PA_RUNNER_SCENARIO: 'codex-native', PA_RUNNER_RECEIVER_LOG: receiverLog, PA_PRODUCER_LOG: producerLog, PA_PRODUCER_HOLD: '1' })
const runnerEntry = join(candidate, 'apps/runner/src/runner-service-entry.ts')
const originalSpawn = childProcess.spawn
const ownedRunners = []
childProcess.spawn = function (executable, args, options) {
  if (executable !== process.execPath || args?.[0] !== runnerEntry || args?.[1] !== 'codex-native') throw new Error('Unexpected coordinator subprocess refused; no real CLI fallback exists')
  const child = originalSpawn.call(this, executable, args, options)
  ownedRunners.push({ child, pid: child.pid, bornAt: new Date().toISOString(), entry: runnerEntry })
  return child
}
syncBuiltinESMExports()

const bounded = async (work, milliseconds, label) => {
  let timer
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
const until = async (read, predicate, label) => {
  const end = Date.now() + 8000
  while (Date.now() < end) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(label)
}
const frames = () => existsSync(receiverLog) ? readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
const alive = child => child.exitCode === null && child.signalCode === null
const report = {
  protocol: 'wave19-b-normal-control-repro/1', classification: 'B_SUBMITTED_PRODUCER_CONTROLLED_NORMAL_ONLY',
  candidate, source, producer, producerHash, producerVersion, producerMatchesCommit: true,
  mainDiagnosticProducerUsed: false, outcome: 'FAIL', realModelTurns: 0, vendorNativeTurnStarts: 0,
  budgetLedgerOpened: false, automaticFallback: false, businessRecoveryAdmitted: false,
  scope: 'Original App/A Store/Runner/Broker normal Q&A and registered-owned physical stop with B submitted local producer. No coordinator crash, recovered business feed, orphan/pre-record resource coverage, vendor/native compatibility or release admission.',
}
let store, product
try {
  mkdirSync(stateRoot, { mode: 0o700 })
  ensureStarterProject(projectPath)
  const registry = new NativeProjectRegistry(stateRoot)
  const project = registry.prepare({ path: projectPath, displayName: 'Submitted producer acceptance', check: 'node_test' })
  registry.save(project)
  store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
  const profile = { id: 'profile-wave19-controlled', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: 'B-submitted-local-producer-only', executable: process.execPath, argv: [producer], expectedVersion: '0.164.0',
    nativeConfigRef: 'wave19-controlled-config', permissionPolicyRevision: 'wave19-controlled-policy-1', requiredFeatures: [] }
  product = createProductRuntime({ store, principal, stateRoot, scratchProject: projectPath, actionSecret: Buffer.alloc(32, 1), projectRegistry: registry,
    projects: [{ id: project.id, scope: registry.scope(project) }], native: { profile,
      projects: [{ id: project.id, path: project.path, check: registry.check(project) }], approvalPolicy: 'on-request' } })
  product.start()
  let sequence = 0
  const command = body => bounded(product.application.dispatch({ commandId: `wave19-control-${++sequence}`, conversationId: 'wave19-control-conversation', ...body },
    { ...principal, source: 'local_cli' }), 5000, 'Application command deadline exceeded')
  report.created = await command({ kind: 'create_work', projectId: project.id, goal: 'Controlled submitted producer acceptance', profileId: profile.id,
    scope: registry.scope(project), criteria: [{ id: 'wave19-check', kind: 'machine', required: true,
      description: 'Registered local project check', checkDefinitionRef: registry.check(project).id }] })
  const question = (await until(() => product.application.inspect({}), value => value.questions.length === 1, 'Original Broker question deadline exceeded')).questions[0]
  const binding = store.bindings.current(question.targets[0].ticketId)
  report.question = question
  report.bindingBeforeAnswer = binding
  report.observationsBeforeAnswer = store.observations.forAttempt(binding.attemptId)
  report.answer = await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version,
    answer: { kind: 'choices', optionIds: ['accept'] } })
  report.deliveriesBeforeStop = await until(() => product.application.questions.currentDeliveries(question.id),
    value => value.length === 1 && value[0].status === 'native_applied' && value[0].targetBindingId === question.targets[0].id,
    'Original answer target did not reach native_applied')
  report.observationsAfterAnswer = store.observations.forAttempt(binding.attemptId)
  report.stop = await command({ kind: 'stop_work', workId: report.created.workId })
  report.bindingAfterStop = await until(() => store.bindings.binding(binding.attemptId), value => value.state === 'ended', 'Physical barrier did not end the original binding')
  report.barrierEvents = store.events.after(0).filter(event => event.topic === 'runtime.barrier.confirmed' && event.entityRef === binding.attemptId)
  report.barrierProofs = await Promise.all(report.barrierEvents.map(event => storedAttemptPayloads(store).read(event.payload.proofRef)))
  report.resourceStates = binding.resources.map(resource => {
    const pid = Number(/^res-(\d+)-/.exec(resource.ref)?.[1])
    let isAlive = null
    // PID is used only for a read-only liveness observation. Cleanup never signals a parsed PID.
    if (pid > 0) { try { process.kill(pid, 0); isAlive = true } catch (error) { if (error.code === 'ESRCH') isAlive = false } }
    return { ref: resource.ref, pid, alive: isAlive }
  })
  report.observationsAfterStop = store.observations.forAttempt(binding.attemptId)
  report.receiverFrames = frames()
  report.producerMessages = existsSync(producerLog) ? readFileSync(producerLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []
  report.workAfterStop = (await product.application.inspect({ workId: report.created.workId })).works[0]
  const names = ['works', 'ticket', 'ticket_links', 'effect', 'fact_receipts', 'dispatch_receipts', 'user_questions', 'answers', 'answer_deliveries', 'runtime_bindings', 'runtime_current']
  report.tables = Object.fromEntries(names.map(name => [name, Number(store.db.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n)]))
  const begins = report.receiverFrames.filter(frame => frame.kind === 'begin')
  const answers = report.receiverFrames.filter(frame => frame.kind === 'answer')
  const inspection = report.barrierProofs[0]?.inspection
  const sameAttempt = value => value?.attemptId === binding.attemptId && value?.assignmentId === binding.assignmentId &&
    value?.ticketId === binding.ticketId && value?.fenceEpoch === binding.fenceEpoch &&
    value?.contract?.digest === binding.contract.digest && value?.contract?.workId === binding.contract.workId && value?.contract?.revision === binding.contract.revision
  report.checks = {
    policyPrepared: report.observationsBeforeAnswer.some(row => row.kind === 'policy.prepared'),
    beginExactlyOnce: begins.length === 1 && begins[0].attemptId === binding.attemptId,
    originalQuestionIdentity: question.targets.length === 1 && sameAttempt(question.targets[0]),
    answerExactlyOnce: answers.length === 1 && answers[0].attemptId === binding.attemptId,
    nativeApplied: report.answer.status === 'recorded' && report.deliveriesBeforeStop[0].evidenceRefs.length > 0 && report.observationsAfterAnswer.some(row => row.kind === 'answer.observed'),
    stopRecorded: report.stop.status === 'recorded' && report.workAfterStop.phase === 'ended',
    authenticatedBarrierCommitted: report.barrierEvents.length === 1 && report.barrierEvents[0].payload.scope === 'registered_owned_resources_only',
    originalCompleteProof: sameAttempt(inspection?.attempt) && inspection?.state === 'terminated' && inspection?.admission === 'closed' &&
      inspection?.coverage === 'complete_owned_resources' && inspection.resources.length > 0 && inspection.resources.every(resource => resource.writer === 'quiescent' && resource.evidence.length > 0) &&
      ownedResourceManifestDigest(inspection.resources) === ownedResourceManifestDigest(binding.resources),
    actualChildExited: report.resourceStates.length > 0 && report.resourceStates.every(resource => resource.alive === false),
    durableRows: ['works', 'ticket', 'ticket_links', 'fact_receipts', 'dispatch_receipts', 'user_questions', 'answers', 'answer_deliveries', 'runtime_bindings', 'runtime_current'].every(name => report.tables[name] >= 1),
  }
  report.stopObservationChannel = 'Existing authenticated recovery cancel -> stopPhysical -> committed registered-owned barrier; no business cancel/turn-interrupt requirement'
  report.outcome = Object.values(report.checks).every(Boolean) ? 'PASS' : 'FAIL'
} catch (error) { report.error = { name: error.name, message: error.message } }
finally {
  try { await bounded(product?.close() ?? Promise.resolve(), 8000, 'Product cleanup deadline exceeded') }
  catch (error) { report.cleanupError = error.message; report.outcome = 'FAIL' }
  // Fallback signals target only direct ChildProcess handles born in this probe.
  for (const { child } of ownedRunners) {
    if (alive(child)) {
      try { child.stdin.end() } catch {}
      await bounded(new Promise(resolve => child.once('exit', resolve)), 2000, 'Owned Runner exit deadline').catch(() => {})
      if (alive(child)) {
        child.kill('SIGKILL')
        await bounded(new Promise(resolve => child.once('exit', resolve)), 2000, 'Owned Runner kill deadline').catch(() => {})
      }
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
report.sourceStable = source === git(['rev-parse', 'HEAD']) && producerHash === createHash('sha256').update(readFileSync(producer)).digest('hex')
if (!report.sourceStable) report.outcome = 'FAIL'
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ classification: report.classification, source, producer, producerMatchesCommit: true,
  outcome: report.outcome, output, checks: report.checks, tables: report.tables,
  factKinds: report.observationsAfterStop?.map(row => row.kind), receiverKinds: report.receiverFrames?.map(frame => frame.kind),
  answerDelivery: report.deliveriesBeforeStop, bindingState: report.bindingAfterStop?.state,
  resourceStates: report.resourceStates, barrierCount: report.barrierEvents?.length,
  cleanupComplete: report.cleanupComplete, sourceStable: report.sourceStable, error: report.error,
  businessRecoveryAdmitted: false, realModelTurns: 0, vendorNativeTurnStarts: 0 }, null, 2))
process.exitCode = report.outcome === 'PASS' ? 0 : 1
