/**
 * Narrow inspect/cancel-wrapper boundaries over private existing-protocol mock services.
 * No real writer, product execution, coordinator recovery or native compatibility is measured.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<new absolute output> node tools/bootstrap/probe-wave20-runtime.mjs <B-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output) || existsSync(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute output; existing files are refused')
const candidate = realpathSync(process.argv[2])
const outputRelative = relative(candidate, output)
if (!outputRelative.startsWith('..') && !isAbsolute(outputRelative)) throw new Error('The output must be outside the candidate checkout')
const git = args => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const source = git(['rev-parse', 'HEAD'])
const sourceFiles = ['apps/runner/src/business-reconnect.ts', 'packages/execution/src/recovery-transport.ts', 'apps/runner/src/recovery-endpoint.ts']
const hash = file => createHash('sha256').update(readFileSync(join(candidate, file))).digest('hex')
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, hash(file)]))
const load = file => import(pathToFileURL(join(candidate, file)).href)
const { reconnectBusinessRunner } = await load('apps/runner/src/business-reconnect.ts')
const { createRunnerCredential, serveRunnerRecovery, connectRunnerRecovery } = await load('packages/execution/src/recovery-transport.ts')
const { RunnerCommandSchema } = await load('packages/contracts/src/index.ts')
const root = mkdtempSync('/tmp/pa-wave20-wrapper-')
const binding = { ticketId: 'private-ticket', assignmentId: 'private-assignment', attemptId: 'private-attempt', fenceEpoch: 2,
  contract: { workId: 'private-work', revision: 1, digest: 'a'.repeat(64) }, runnerIdentityRef: 'private-runner', source: 'private-source' }
const { runnerIdentityRef, source: producerSource, ...attempt } = binding
const producer = { attempt, runnerIdentityRef, source: producerSource }
const expected = { ticketId: binding.ticketId, attemptId: binding.attemptId, fenceEpoch: 2 }
const services = new Set()
const cases = []
const errorOf = error => ({ code: error?.code ?? null, message: String(error?.message ?? error) })

function backend(counter, marker) {
  let closed = false
  const inspect = async () => ({ state: closed ? 'terminated' : 'serving', admission: closed ? 'closed' : 'open',
    coverage: 'complete_owned_resources', evidence: [marker], resources: [{ ref: 'private-mock-resource', ownership: 'spawned_process',
      writer: closed ? 'quiescent' : 'active', evidence: [marker] }] })
  return { inspect, cancel: async () => { counter.cancels++; closed = true; return inspect() } }
}
async function start(directory, counter, marker, credentialPath) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const credential = credentialPath ?? join(directory, 'runner.credential')
  if (!credentialPath) createRunnerCredential(credential)
  const service = await serveRunnerRecovery({ socketPath: join(directory, 'runner.sock'), credentialPath: credential }, producer, backend(counter, marker))
  services.add(service)
  return service
}
async function close(service) { await service.close(); services.delete(service) }
const options = (directory, endpoint) => ({ stateRoot: directory, binding, expected, endpoint, timeoutMs: 1500,
  beforeWrite: async () => {}, alreadyRecorded: () => false })
async function check(id, run) {
  try {
    const { passed, ...observation } = await run()
    cases.push({ id, status: passed ? 'PASS' : 'FAIL', observation })
  } catch (error) { cases.push({ id, status: 'FAIL', observation: { probeError: errorOf(error) } }) }
}

let cleanupComplete = false
try {
  await check('FOREIGN_SOURCE_REFUSES_BEFORE_RECEIVER_CANCEL', async () => {
    const directory = join(root, 'source'), counter = { cancels: 0 }
    const service = await start(directory, counter, 'foreign-source-boundary')
    let guardCalls = 0, result = null, error = null
    try {
      const port = await reconnectBusinessRunner({ ...options(directory, service.endpoint), binding: { ...binding, source: 'foreign-source' },
        beforeWrite: async () => { guardCalls++ } })
      result = await port.cancel({ ...attempt, id: 'private-foreign-source-cancel', kind: 'cancel' })
      port.close()
    } catch (failure) { error = errorOf(failure) }
    return { passed: counter.cancels === 0 && result?.sent !== true,
      receiverCancels: counter.cancels, requiredReceiverCancels: 0, guardCalls, result, error,
      scope: 'Private mock wrapper boundary; a refusal after receiver mutation does not pass. No current-product permission bypass is claimed.' }
  })

  await check('REGISTERED_SOCKET_INODE_MUST_NOT_BE_REPINNED', async () => {
    const directory = join(root, 'endpoint')
    const original = await start(directory, { cancels: 0 }, 'original-private-endpoint')
    const registered = original.endpoint
    const pinned = connectRunnerRecovery(registered, producer, 1500)
    const originalPositive = (await pinned.inspect()).inspection.evidence.includes('original-private-endpoint')
    await close(original)
    writeFileSync(join(directory, 'replacement-marker'), 'private-only')
    const replacement = await start(directory, { cancels: 0 }, 'replacement-private-endpoint', registered.credentialPath)
    const stat = lstatSync(registered.socketPath)
    const replacementIdentity = { dev: stat.dev, ino: stat.ino }
    const inodeChanged = stat.dev !== registered.socketIdentity.dev || stat.ino !== registered.socketIdentity.ino
    const replacementPositive = (await connectRunnerRecovery(replacement.endpoint, producer, 1500).inspect()).inspection.evidence.includes('replacement-private-endpoint')
    let originalError = null
    try { await pinned.inspect() } catch (failure) { originalError = errorOf(failure) }
    let wrapperAcceptedReplacement = false, wrapperError = null
    try {
      const port = await reconnectBusinessRunner(options(directory, registered))
      wrapperAcceptedReplacement = (await port.inspect()).inspection.evidence.includes('replacement-private-endpoint')
      port.close()
    } catch (failure) { wrapperError = errorOf(failure) }
    return { passed: originalPositive && replacementPositive && inodeChanged && originalError?.code === 'identity_mismatch' && !wrapperAcceptedReplacement,
      originalPositive, replacementPositive, inodeChanged, registeredIdentity: registered.socketIdentity, replacementIdentity,
      originalTransportError: originalError, wrapperAcceptedReplacement, wrapperError,
      scope: 'Same private producer/credential, changed socket inode. Original transport rejection is a required control; no global endpoint is discovered or touched.' }
  })

  await check('CURRENT_TWO_ACCEPTS_AND_EXPECTED_OLD_ONE_REFUSES_LOCALLY', async () => {
    const directory = join(root, 'epoch'), counter = { cancels: 0 }
    const service = await start(directory, counter, 'private-positive-epoch-control')
    let currentGuardCalls = 0
    const current = await reconnectBusinessRunner({ ...options(directory, service.endpoint), beforeWrite: async () => { currentGuardCalls++ } })
    const currentCommand = { ...attempt, id: 'private-current-epoch', kind: 'cancel' }
    const currentResult = await current.cancel(currentCommand)
    const beforeOld = counter.cancels
    let oldGuardCalls = 0
    const older = await reconnectBusinessRunner({ ...options(directory, service.endpoint), expected: { ...expected, fenceEpoch: 1 },
      beforeWrite: async () => { oldGuardCalls++ } })
    const oldCommand = { ...attempt, id: 'private-valid-old-epoch', fenceEpoch: 1, kind: 'cancel' }
    const oldResult = await older.cancel(oldCommand)
    const schemasValid = RunnerCommandSchema.safeParse(currentCommand).success && RunnerCommandSchema.safeParse(oldCommand).success
    return { passed: schemasValid && currentResult?.sent === true && currentGuardCalls === 1 && beforeOld === 1 &&
        Boolean(oldResult?.refused) && oldGuardCalls === 0 && counter.cancels === beforeOld,
      currentEpoch: 2, oldEpoch: 1, commandSchemasValid: schemasValid, currentResult, currentGuardCalls,
      cancelsAfterCurrent: beforeOld, oldResult, oldGuardCalls, cancelsAfterOld: counter.cancels,
      scope: 'Construction-time expected/binding mismatch with schema-valid positive values plus current positive control. This is not a runtime epoch advance, cross-coordinator recovery, or stale-command matrix.' }
  })
} finally {
  const cleanup = await Promise.allSettled([...services].map(service => close(service)))
  cleanupComplete = cleanup.every(result => result.status === 'fulfilled')
  if (cleanupComplete) rmSync(root, { recursive: true, force: true })
}
const sourceStable = source === git(['rev-parse', 'HEAD']) && sourceFiles.every(file => sourceHashes[file] === hash(file))
const failed = cases.filter(item => item.status === 'FAIL').length
const report = {
  protocol: 'wave20-b-wrapper-boundaries/1', candidate, source, sourceHashes, sourceStable,
  classification: 'PRIVATE_MOCK_WRAPPER_BOUNDARIES_ONLY', status: failed || !cleanupComplete || !sourceStable ? 'FAIL_SCOPED_WRAPPER_ADMISSION' : 'PASS_SCOPED_WRAPPER_BOUNDARIES',
  cases, passed: cases.length - failed, failed, cleanupComplete,
  realModelTurns: 0, vendorNativeTurnStarts: 0, budgetLedgerOpened: false,
  productExecutionRun: false, globalEndpointScanRun: false, businessRecoveryAdmitted: false,
  scope: 'Existing authenticated protocol in probe-owned private mock services. No physical writer, principal grant, product recovery or installed-agent compatibility is claimed. Main keeps its independently reviewed original endpoint consumer.',
}
if (!cleanupComplete) report.retainedPrivateRoot = root
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = failed || !cleanupComplete || !sourceStable ? 1 : 0
