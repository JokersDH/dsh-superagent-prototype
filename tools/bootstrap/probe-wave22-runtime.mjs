/** Private control-state branch checks. Passing is not business resume or durable exactly-once proof. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<new absolute output> node tools/bootstrap/probe-wave22-runtime.mjs <B-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output) || existsSync(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute output; existing files are refused')
const candidate = realpathSync(process.argv[2])
const outputRelative = relative(candidate, output)
if (outputRelative === '' || (!isAbsolute(outputRelative) && outputRelative !== '..' && !outputRelative.startsWith('..' + sep))) {
  throw new Error('The report must be outside the candidate checkout')
}
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const source = git(['rev-parse', 'HEAD'])
const sourceFiles = ['apps/runner/src/business-reconnect.ts', 'packages/execution/src/recovery-transport.ts']
const hash = file => createHash('sha256').update(readFileSync(join(candidate, file))).digest('hex')
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]))
const load = path => import(pathToFileURL(join(candidate, path)).href)
const { reconnectBusinessRunner } = await load('apps/runner/src/business-reconnect.ts')
const { createRunnerCredential, serveRunnerRecovery, verifiedRunnerInspection } = await load('packages/execution/src/recovery-transport.ts')
const root = mkdtempSync('/tmp/pa-wave22-control-states-')
const cases = []
const openServices = new Set()
let cleanupComplete = false
try {
  for (const state of ['not_seen', 'intent_recorded', 'observed', 'unknown']) {
    let service
    try {
      const directory = join(root, state)
      mkdirSync(directory, { mode: 0o700 })
      createRunnerCredential(join(directory, 'runner.credential'))
      const attempt = { ticketId: 'private-ticket', assignmentId: 'private-assignment', attemptId: `private-${state}`, fenceEpoch: 2,
        contract: { workId: 'private-work', revision: 1, digest: 'c'.repeat(64) } }
      const producer = { attempt, runnerIdentityRef: 'private-runner', source: 'private-source' }
      let inspections = 0, cancels = 0, guardCalls = 0, reconciliationCalls = 0, legacyCalls = 0, stopped = false
      const snapshot = () => ({ state: stopped ? 'terminated' : 'serving', admission: stopped ? 'closed' : 'open',
        coverage: 'complete_owned_resources', resources: [{ ref: 'private-mock-resource', ownership: 'spawned_process',
          writer: stopped ? 'quiescent' : 'active', evidence: ['private-mock-only'] }], evidence: ['private-mock-only'] })
      service = await serveRunnerRecovery({ socketPath: join(directory, 'runner.sock'), credentialPath: join(directory, 'runner.credential') }, producer,
        { inspect: async () => { inspections++; return snapshot() }, cancel: async () => { cancels++; stopped = true; return snapshot() } })
      openServices.add(service)
      const originalCommand = { ...attempt, id: 'private-original-command', kind: 'cancel' }
      const port = await reconnectBusinessRunner({ stateRoot: directory, endpoint: service.endpoint,
        binding: { ...attempt, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source },
        expected: { ticketId: attempt.ticketId, attemptId: attempt.attemptId, fenceEpoch: attempt.fenceEpoch },
        timeoutMs: 1500,
        alreadyRecorded: () => { legacyCalls++; return true },
        reconcile: id => {
          reconciliationCalls++
          if (id !== originalCommand.id) throw new Error('Original command identity changed')
          return state === 'unknown' ? { state, detail: 'prior write outcome unavailable' } : { state }
        },
        beforeWrite: async command => {
          guardCalls++
          if (!isDeepStrictEqual(command, originalCommand)) throw new Error('Current original operation refused')
        } })
      const result = await port.cancel(originalCommand)
      const inspectionsAtReturn = inspections
      const maySend = state === 'not_seen' || state === 'intent_recorded'
      const proof = result.sent ? verifiedRunnerInspection(result.proof).value : null
      const fresh = maySend ? verifiedRunnerInspection(await port.inspect()).value : null
      const postState = value => value && ({ state: value.state, admission: value.admission, coverage: value.coverage,
        resources: value.resources, attempt: value.attempt, source: value.source, runnerIdentityRef: value.runnerIdentityRef })
      const completePostProof = proof?.state === 'terminated' && proof?.admission === 'closed' && proof?.coverage === 'complete_owned_resources' &&
        isDeepStrictEqual(proof.attempt, attempt) && proof.source === producer.source && proof.runnerIdentityRef === producer.runnerIdentityRef &&
        proof.resources.length === 1 && proof.resources[0].writer === 'quiescent' && proof.resources[0].evidence.length > 0 &&
        isDeepStrictEqual(postState(proof), postState(fresh))
      const passed = reconciliationCalls === 1 && legacyCalls === 0 && (maySend
        ? result.sent === true && inspectionsAtReturn === 1 && guardCalls === 1 && cancels === 1 && completePostProof
        : result.refused === (state === 'observed' ? 'already_recorded' : 'indeterminate') &&
          inspectionsAtReturn === 0 && guardCalls === 0 && cancels === 0 && !stopped)
      cases.push({ id: state, status: passed ? 'PASS' : 'FAIL', observation: {
        reconciliationCalls, legacyCalls, inspectionsAtCancelReturn: inspectionsAtReturn, guardCalls, receiverCancels: cancels,
        result: result.sent ? { sent: result.sent, postProof: postState(proof), agreesWithIndependentFreshInspect: completePostProof } : result,
        serverStateAtReturn: stopped ? 'terminated/closed/quiescent' : 'serving/open/active',
      } })
      port.close()
    } catch (error) {
      cases.push({ id: state, status: 'FAIL', observation: { error: { name: error.name, message: error.message } } })
    } finally {
      if (service) { await service.close(); openServices.delete(service) }
    }
  }
} finally {
  const cleanup = await Promise.allSettled([...openServices].map(service => service.close()))
  cleanupComplete = cleanup.every(result => result.status === 'fulfilled')
  if (cleanupComplete) rmSync(root, { recursive: true, force: true })
}
const sourceStable = source === git(['rev-parse', 'HEAD']) && sourceFiles.every(file => sourceHashes[file] === hash(file))
const passed = cases.filter(item => item.status === 'PASS').length
const failed = cases.filter(item => item.status === 'FAIL').length
const success = cases.length === 4 && failed === 0 && cleanupComplete && sourceStable
const report = {
  protocol: 'wave22-b-reconciliation-states/1', classification: 'PRIVATE_INSPECT_CANCEL_STATE_BRANCHES_ONLY',
  candidate, source, sourceHashes, sourceStable, status: success ? 'PASS_SCOPED_CONTROL_STATE_BRANCHES' : 'FAIL_SCOPED_CONTROL_STATE_BRANCHES',
  cases, passed, failed, cleanupComplete,
  realModelTurns: 0, vendorNativeTurnStarts: 0, budgetLedgerOpened: false,
  normalProductRun: false, globalEndpointScan: false, physicalWriterTested: false, businessRecoveryAdmitted: false,
  scope: 'Trusted reconcile callback inputs over private existing-protocol mocks only. not_seen/intent_recorded are test preconditions, not inferred from missing receipts. No A-state classifier, durable exactly-once replay, native compatibility, real writer or business attach/resume is established. Next B work starts at actual business attachment; closed control defects and normal producer are not reopened.',
}
if (!cleanupComplete) report.retainedPrivateRoot = root
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = success ? 0 : 1
