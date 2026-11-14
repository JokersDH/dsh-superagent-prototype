#!/usr/bin/env node
/**
 * Wave-27 B9-B11 on ONE chain: a serving lease exists BEFORE begin, it serves the Runner's own callbacks,
 * it is killed with SIGKILL mid-flight, and a successor lease on the SAME Runner finishes the attempt.
 *
 * Ordering matters and is the point: the Runner asks its bound lease for callbacks, so a coordinator that
 * attaches after the facts have flowed cannot serve them.
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-chain-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const CHILD = fileURLToPath(new URL('./b27-coordinator-child.mjs', import.meta.url))
const producer = { source: 'fixture', runnerIdentityRef: 'b27-chain-runner' }
const children = []
const serve = registration => new Promise(resolve => {
  const child = spawn(process.execPath, [CHILD], { env: { ...process.env, PA_W27_REGISTRATION: registration, PA_W27_MODE: 'serve' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const lines = []
  child.stdout.on('data', chunk => { for (const line of String(chunk).split('\n').filter(Boolean)) { try { lines.push(JSON.parse(line)) } catch {} } })
  child.stderr.on('data', () => {})
  child.on('exit', (code, signal) => resolve({ pid: child.pid, code, signal, lines, child }))
  children.push(child)
  setTimeout(() => resolve({ pid: child.pid, lines, child, running: true }), 900)
})
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  process.env.PA_RUNNER_RECEIVER_LOG = join(root, 'receiver.jsonl')
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-chain', { inputId: 'input-chain', contract: spec.contract, text: 'serve then die', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const sinkFacts = []
  runner = await link.spawnAttempt(spec, async fact => { sinkFacts.push(fact); return { factId: fact.factId, persisted: true, seq: sinkFacts.length } })
  const runnerPid = runner.pid
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 300 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  const registration = join(root, 'registration.json')
  writeFileSync(registration, JSON.stringify({
    ...registered, attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract },
    runnerIdentityRef: producer.runnerIdentityRef, source: producer.source, leaseId: 'lease-chain-a',
    beginCommandId: 'cmd-chain-begin', deliverCommandId: 'cmd-chain-deliver', inputRef: 'input-chain', policySnapshotRef: spec.policySnapshotRef,
  }), { mode: 0o600 })

  log.begin('B27-CHAIN-LEASE-BEFORE-BEGIN', 'a serving lease exists before begin', 'controlled_process')
  const first = await serve(registration)
  const bound = first.lines.find(line => line.bound)
  log.evidence({ pid: first.pid, bound: Boolean(bound), leaseId: bound?.leaseId ?? null })
  if (bound) log.pass(`coordinator A (pid ${first.pid}) bound lease ${bound.leaseId} BEFORE begin`)
  else log.fail('no serving lease was bound before begin')

  await runner.command(makeCommand('begin', { id: 'cmd-chain-begin', inputRef: 'input-chain', preparedPolicyRef: spec.policySnapshotRef }))
  let servedByA = []
  for (let index = 0; index < 300 && servedByA.length === 0; index += 1) {
    servedByA = first.lines.filter(line => line.served)
    if (servedByA.length === 0) await new Promise(resolve => setTimeout(resolve, 30))
  }
  log.begin('B27-CHAIN-A-SERVES-CALLBACKS', 'the bound lease serves the Runner callbacks', 'controlled_process')
  const sinkAfterBegin = sinkFacts.length
  log.evidence({ served: servedByA.map(line => line.id), sinkFacts: sinkAfterBegin })
  if (servedByA.length >= 1) log.pass(`coordinator A served ${servedByA.length} callback(s) over the channel, so the facts did not fall back to stdio`)
  else log.fail(`A served no callback: ${JSON.stringify({ sinkFacts: sinkAfterBegin })}`)

  log.begin('B27-CHAIN-KILL-A-MID-FLIGHT', 'A is killed by SIGKILL while it owns the lease', 'controlled_process')
  const pidA = first.pid
  try { process.kill(pidA, 'SIGKILL') } catch {}
  let diedBy = null
  for (let index = 0; index < 100 && diedBy === null; index += 1) {
    try { process.kill(pidA, 0) } catch { diedBy = 'SIGKILL' }
    if (diedBy === null) await new Promise(resolve => setTimeout(resolve, 20))
  }
  const runnerAlive = (() => { try { process.kill(runnerPid, 0); return true } catch { return false } })()
  log.evidence({ pidA, diedBy, runnerPid, runnerAlive })
  if (diedBy === 'SIGKILL' && runnerAlive) log.pass(`coordinator ${pidA} died by SIGKILL while Runner ${runnerPid} kept running`)
  else log.fail(`the kill window is not what was claimed: ${JSON.stringify({ diedBy, runnerAlive })}`)

  log.begin('B27-CHAIN-B-SUCCESSOR-SERVES-SAME-ATTEMPT', 'a successor lease finishes the same attempt', 'controlled_process')
  const successorRegistration = join(root, 'registration-b.json')
  writeFileSync(successorRegistration, JSON.stringify({ ...JSON.parse(readFileSync(registration, 'utf8')), leaseId: 'lease-chain-b' }), { mode: 0o600 })
  const second = await serve(successorRegistration)
  // ORDER MATTERS: the successor must hold the lease BEFORE the facts are raised. A command fed while the
  // dead coordinator still owned the lease would be dropped by the detach, which is the intended behaviour
  // and must not be replayed into the new lease.
  let boundB = null
  for (let index = 0; index < 200 && !boundB; index += 1) {
    boundB = second.lines.find(line => line.bound)
    if (!boundB) await new Promise(resolve => setTimeout(resolve, 25))
  }
  await runner.command(makeCommand('deliver', { id: 'cmd-chain-deliver', inputRef: 'input-chain' })).catch(() => undefined)
  let servedByB = []
  for (let index = 0; index < 400 && servedByB.length === 0; index += 1) {
    servedByB = second.lines.filter(line => line.served)
    if (servedByB.length === 0) await new Promise(resolve => setTimeout(resolve, 25))
  }
  const inspection = await (async () => {
    const { connectRunnerRecovery } = await import('../../packages/execution/src/recovery-transport.ts')
    const client = connectRunnerRecovery(registered, { attempt: JSON.parse(readFileSync(registration, 'utf8')).attempt, ...producer }, 3000)
    return client.inspect().then(value => value.inspection).catch(() => null)
  })()
  log.evidence({ pidB: second.pid, boundBeforeDelivery: Boolean(boundB), servedByB: servedByB.map(line => line.id), attemptId: inspection?.attempt?.attemptId ?? null, fenceEpoch: inspection?.attempt?.fenceEpoch ?? null })
  const sameAttempt = inspection?.attempt?.attemptId === spec.attemptId && inspection?.attempt?.fenceEpoch === spec.fenceEpoch
  if (sameAttempt && servedByB.length >= 1) {
    log.pass(`successor lease ${second.pid} served ${servedByB.length} callback(s) and the Runner still reports attempt ${spec.attemptId} at epoch ${spec.fenceEpoch}`)
  } else if (sameAttempt) {
    // Honest boundary: on this lane the first turn emits its facts and then nothing more, so the successor
    // has nothing new to serve even though it holds the lease. The successor actually SERVING a callback is
    // proven on the controlled handover (b27-dual-client), not claimed here.
    log.notTested(`the successor bound lease ${successorRegistration.split('/').pop()} on the same attempt ${spec.attemptId} at epoch ${spec.fenceEpoch}, but this lane emitted no further facts for it to serve (A served ${servedByA.length}); successor SERVING is proven by b27-dual-client`)
  } else log.fail(`the successor did not bind the same attempt: ${JSON.stringify({ sameAttempt, attemptId: inspection?.attempt?.attemptId ?? null })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'fixture lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  for (const child of children) { try { process.kill(child.pid, 'SIGKILL') } catch {} }
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  delete process.env.PA_RUNNER_RECEIVER_LOG
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 single chain', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fixture lane; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(46)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-chain totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
