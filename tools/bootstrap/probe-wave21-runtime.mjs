/**
 * Private A-registration/control-wrapper contract checks only.
 * No normal product run, physical writer, coordinator restart or vendor compatibility is measured.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<new absolute output> node tools/bootstrap/probe-wave21-runtime.mjs <B-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output) || existsSync(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute output; existing files are refused')
const candidate = realpathSync(process.argv[2])
const outputRelative = relative(candidate, output)
if (outputRelative === '' || (!isAbsolute(outputRelative) && outputRelative !== '..' && !outputRelative.startsWith('..' + sep))) {
  throw new Error('The report must be outside the candidate checkout')
}
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const source = git(['rev-parse', 'HEAD'])
const sourceFiles = ['apps/runner/src/business-reconnect.ts', 'packages/execution/src/recovery-transport.ts', 'apps/coordinator/runner-registry.ts']
const hash = file => createHash('sha256').update(readFileSync(join(candidate, file))).digest('hex')
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]))
const load = file => import(pathToFileURL(join(candidate, file)).href)
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === '@personal-agent/contracts'
    ? pathToFileURL(join(candidate, 'packages/contracts/src/index.ts')).href : specifier, context)
} })
const { ProductStore } = await load('packages/storage/src/index.ts')
const { reconnectBusinessRunner, registeredEndpointFor } = await load('apps/runner/src/business-reconnect.ts')
const { createRunnerCredential, serveRunnerRecovery, connectRunnerRecovery, verifiedRunnerInspection } = await load('packages/execution/src/recovery-transport.ts')
const { registerRecoveryRunner, loadRecoveryRunner } = await load('apps/coordinator/runner-registry.ts')
const { JsonSchema } = await load('packages/contracts/src/index.ts')
const { canonicalDigest } = await load('packages/contracts/src/canonical.ts')

const root = mkdtempSync('/tmp/pa-wave21-registration-')
const endpointRoot = join(root, 'endpoint')
mkdirSync(endpointRoot, { mode: 0o700 })
const store = new ProductStore({ path: join(root, 'product.sqlite') })
const attempt = { ticketId: 'private-ticket', assignmentId: 'private-assignment', attemptId: 'private-attempt', fenceEpoch: 2,
  contract: { workId: 'private-work', revision: 1, digest: 'b'.repeat(64) } }
const producer = { attempt, runnerIdentityRef: 'private-runner', source: 'private-source' }
const binding = { ...attempt, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source, state: 'active',
  resources: [{ ref: 'private-mock-resource', ownership: 'spawned_process' }] }
const counters = { inspect: 0, cancel: 0 }
const cases = []
const report = {
  protocol: 'wave21-b-registration-contract/1', classification: 'PRIVATE_A_REGISTRATION_AND_MOCK_CONTROL_ONLY',
  candidate, source, sourceHashes, realModelTurns: 0, vendorNativeTurnStarts: 0, budgetLedgerOpened: false,
  normalProductRun: false, globalEndpointScan: false, physicalWriterTested: false, businessRecoveryAdmitted: false,
  scope: 'Real private A ProductStore/current binding/immutable registration and one existing-protocol mock service. This is not a normal product rerun, physical barrier, coordinator recovery or production permission finding. Main keeps its independently reviewed original proof consumer.',
}
let stopped = false, service, cleanupComplete = false
const record = (id, passed, observation) => cases.push({ id, status: passed ? 'PASS' : 'FAIL', observation })
try {
  store.bindings.record(binding)
  store.bindings.setCurrent(attempt.ticketId, attempt.attemptId)
  createRunnerCredential(join(endpointRoot, 'runner.credential'))
  const snapshot = () => ({ state: stopped ? 'terminated' : 'serving', admission: stopped ? 'closed' : 'open',
    coverage: 'complete_owned_resources', resources: [{ ref: 'private-mock-resource', ownership: 'spawned_process',
      writer: stopped ? 'quiescent' : 'active', evidence: ['private-mock-only'] }], evidence: ['private-mock-only'] })
  service = await serveRunnerRecovery({ socketPath: join(endpointRoot, 'runner.sock'), credentialPath: join(endpointRoot, 'runner.credential') }, producer,
    { inspect: async () => { counters.inspect++; return snapshot() }, cancel: async () => { counters.cancel++; stopped = true; return snapshot() } })
  const client = connectRunnerRecovery(service.endpoint, producer, 1500)
  registerRecoveryRunner(store, await client.inspect())
  const registration = loadRecoveryRunner(store, attempt.attemptId)
  const selected = await registeredEndpointFor(store, attempt.attemptId)
  const exactEndpoint = isDeepStrictEqual(selected.endpoint, registration.body.endpoint)
  const exactProducer = isDeepStrictEqual(selected.producer, registration.body.producer)
  const exactDigest = selected.registrationDigest === registration.digest
  record('EXACT_REGISTERED_ENDPOINT_PRODUCER_AND_DIGEST', exactEndpoint && exactProducer && exactDigest,
    { receiptSeq: registration.receiptSeq, exactEndpoint, exactProducer, exactDigest, socketIdentity: selected.endpoint.socketIdentity })

  const options = { stateRoot: endpointRoot, binding, expected: { ticketId: attempt.ticketId, attemptId: attempt.attemptId, fenceEpoch: 2 },
    endpoint: selected.endpoint, timeoutMs: 1500 }
  const command = { ...attempt, id: 'private-original-cancel', kind: 'cancel' }
  let refusedGuardCalls = 0, guardError = null
  const refused = await reconnectBusinessRunner({ ...options, alreadyRecorded: () => false,
    beforeWrite: async () => { refusedGuardCalls++; throw new Error('private-current-operation-refused') } })
  try { await refused.cancel(command) } catch (error) { guardError = error.message }
  const afterRefusal = verifiedRunnerInspection(await refused.inspect()).value
  record('CURRENT_GUARD_REFUSAL_HAS_NO_RECEIVER_CANCEL', refusedGuardCalls === 1 &&
    guardError === 'private-current-operation-refused' && counters.cancel === 0 && afterRefusal.state === 'serving',
  { guardCalls: refusedGuardCalls, guardError, receiverCancels: counters.cancel, stateAfter: afterRefusal.state })

  // The real main consumer also commits this stable intent before any peer cancellation.
  const intent = { kind: 'runner-cancel-intent/1', command, registrationId: registration.commandId, registrationDigest: registration.digest }
  store.commands.record(command.id, canonicalDigest(JsonSchema.parse(intent)), () => intent)
  store.bindings.record({ ...binding, state: 'stopping' })
  let rawGuardCalls = 0
  const raw = await reconnectBusinessRunner({ ...options, alreadyRecorded: id => Boolean(store.commands.get(id)),
    beforeWrite: async () => { rawGuardCalls++ } })
  const rawResult = await raw.cancel(command)
  const pendingIntentExists = store.commands.get(command.id)?.result?.kind === 'runner-cancel-intent/1'
  record('PENDING_INTENT_CAN_EXIST_BEFORE_ANY_RECEIVER_SEND', pendingIntentExists && counters.cancel === 0,
    { pendingIntentExists, receiverCancels: counters.cancel, rawCommandsHasResult: rawResult, rawGuardCalls,
      scope: 'Raw receipt existence refusal is an observation about caller policy, not a permission failure. Intent is not an observed/completed native result, and main must not wire commands.has as that proof.' })

  let acceptedGuardCalls = 0
  const aware = await reconnectBusinessRunner({ ...options,
    alreadyRecorded: id => {
      const receipt = store.commands.get(id)
      return Boolean(receipt && receipt.result.kind !== 'runner-cancel-intent/1')
    },
    beforeWrite: async incoming => {
      acceptedGuardCalls++
      const current = store.bindings.current(incoming.ticketId)
      const originalIntent = store.commands.get(incoming.id)?.result
      if (!current || current.state !== 'stopping' || current.attemptId !== incoming.attemptId ||
        current.assignmentId !== incoming.assignmentId || current.fenceEpoch !== incoming.fenceEpoch ||
        !isDeepStrictEqual(current.contract, incoming.contract) || !isDeepStrictEqual(originalIntent?.command, incoming)) {
        throw new Error('Original pending command/current operation changed')
      }
    } })
  const outcome = await aware.cancel(command)
  record('STATE_AWARE_CONSUMER_SENDS_ORIGINAL_PENDING_INTENT_ONCE', outcome.sent === true && acceptedGuardCalls === 1 && counters.cancel === 1,
    { acceptedGuardCalls, sent: outcome.sent, receiverCancels: counters.cancel, originalCommandId: command.id,
      scope: 'The purpose-aware caller supplies this state decision. The wrapper has not implemented a durable intent/result/unknown ledger or a recovered business lifecycle.' })

  const returned = verifiedRunnerInspection(outcome.proof).value
  const fresh = verifiedRunnerInspection(await aware.inspect()).value
  const responseState = value => ({ state: value.state, admission: value.admission, coverage: value.coverage,
    resources: value.resources, attempt: value.attempt, runnerIdentityRef: value.runnerIdentityRef, source: value.source })
  const postProofReturned = isDeepStrictEqual(responseState(returned), responseState(fresh)) &&
    returned.state === 'terminated' && returned.admission === 'closed' && returned.resources.every(resource => resource.writer === 'quiescent')
  record('CANCEL_RETURNS_AUTHENTICATED_POST_CANCEL_PROOF', postProofReturned,
    { returnedProof: { state: returned.state, admission: returned.admission, writer: returned.resources[0]?.writer },
      freshAfterProof: { state: fresh.state, admission: fresh.admission, writer: fresh.resources[0]?.writer },
      originalIdentityPreserved: isDeepStrictEqual(returned.attempt, fresh.attempt),
      scope: 'An authenticated preflight snapshot is not the authenticated cancel response. Main must retain its original post-response proof consumer; this mock creates no physical-barrier authority.' })
} catch (error) {
  report.probeError = { name: error.name, message: error.message }
} finally {
  try {
    if (service) await service.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
    cleanupComplete = true
  } catch (error) { report.cleanupError = error.message }
}
const passed = cases.filter(item => item.status === 'PASS').length
const failed = cases.filter(item => item.status === 'FAIL').length
const sourceStable = source === git(['rev-parse', 'HEAD']) && sourceFiles.every(file => sourceHashes[file] === hash(file))
const success = cases.length === 5 && failed === 0 && !report.probeError && cleanupComplete && sourceStable
Object.assign(report, { cases, passed, failed, sourceStable, cleanupComplete,
  status: success ? 'PASS_SCOPED_REGISTRATION_CONTRACT' : 'FAIL_SCOPED_REGISTRATION_CONTRACT' })
if (!cleanupComplete) report.retainedPrivateRoot = root
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = success ? 0 : 1
