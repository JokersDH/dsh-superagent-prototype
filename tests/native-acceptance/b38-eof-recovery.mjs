#!/usr/bin/env node
/**
 * Recovery milestone 01 / B: the SAME spawned Runner must survive old coordinator stdin EOF and a
 * closed/broken stdout, then serve a NEW coordinator lease on the same attempt with original IDs.
 *
 * The old stdin EOF and stdout destroy model the coordinator process dying; the old ACK is unknown and
 * stays unresolved. The successor explicitly binds the same registration at the observed generation,
 * receives/replies the SAME fact id, rejects a late reply on the old lease, feeds the original command
 * and performs the original normal cancel. No kill/signal is used by this harness.
 */
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery, runnerResourceManifestDigest, verifiedRunnerInspection } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-ms1-eof-'))
const recoveryRoot = join(root, 'recovery')
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const spec = makeAttemptSpec()
const producer = { source: 'fake-driver', runnerIdentityRef: 'ms1-eof-runner' }
const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const context = { attempt, ...producer }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(process.execPath, [ENTRY, 'waiting-user'], {
  env: { ...process.env, PA_RUNNER_RECOVERY_ROOT: recoveryRoot, PA_RUNNER_RECEIVER_LOG: join(root, 'receiver.jsonl') },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stdoutBrokenByHarness = false
const frames = []
let buffer = ''
child.stdout.on('data', chunk => {
  buffer += chunk.toString()
  for (;;) {
    const nl = buffer.indexOf('\n')
    if (nl < 0) break
    try { frames.push(JSON.parse(buffer.slice(0, nl))) } catch {}
    buffer = buffer.slice(nl + 1)
  }
})
child.stderr.on('data', () => {})
let exited = null
child.on('exit', (code, signal) => { exited = { code, signal } })
const send = frame => child.stdin.write(JSON.stringify({ v: 1, ...frame }) + '\n')
try {
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'), producer })
  for (let index = 0; index < 400 && !frames.some(frame => frame.type === 'ready'); index += 1) await wait(10)
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await wait(20) }
  }
  const old = connectRunnerRecovery(registered, context, 3000)
  const oldState = await old.channelState()
  await old.channelNext('lease-eof-old', oldState.generation)
  const beginCommand = makeCommand('begin', { ...attempt, id: 'cmd-eof-begin', inputRef: 'input-eof', preparedPolicyRef: spec.policySnapshotRef })
  send({ type: 'command', id: beginCommand.id, command: beginCommand })
  let oldFact = null
  for (let index = 0; index < 400 && !oldFact; index += 1) {
    const page = await old.channelNext('lease-eof-old').catch(() => null)
    if (page?.request?.type === 'fact') oldFact = page.request
    else await wait(10)
  }
  log.begin('B38-OLD-STDIN-EOF-STDOUT-CLOSED-SURVIVES', 'the Runner stays alive when the old coordinator stdin ends and stdout closes', 'controlled_process')
  if (!oldFact) throw new Error(`old coordinator received no fact: ${JSON.stringify(frames.slice(-4))}`)
  const oldPid = child.pid
  // The old coordinator dies: close its stdout and stdin. The old fact ACK is unknown.
  child.stdout.destroy()
  stdoutBrokenByHarness = true
  child.stdin.end()
  await wait(300)
  const aliveAfterEof = exited === null && child.exitCode === null
  const oldFactId = oldFact.fact?.factId ?? oldFact.id
  log.evidence({ oldPid, aliveAfterEof, exited, oldFactId })
  if (aliveAfterEof && oldFactId) log.pass(`the same Runner pid ${oldPid} survived old stdin EOF and closed stdout with unresolved fact ${oldFactId}`)
  else log.fail(`the Runner did not survive the old coordinator EOF: ${JSON.stringify({ aliveAfterEof, exited })}`)

  log.begin('B38-NEW-LEASE-SAME-ATTEMPT-ORIGINAL-ID', 'a new coordinator binds the same Runner and resolves the original fact id once', 'controlled_process')
  const successor = connectRunnerRecovery(registered, context, 3000)
  const successorState = await successor.channelState()
  const bound = await successor.channelNext('lease-eof-new', successorState.generation)
  let newFact = null
  for (let index = 0; index < 400 && !newFact; index += 1) {
    const page = await successor.channelNext('lease-eof-new', bound.generation).catch(() => null)
    if (page?.request?.type === 'fact') newFact = page.request
    else await wait(10)
  }
  const newFactId = newFact?.fact?.factId ?? newFact?.id
  const receipt = { factId: newFactId, persisted: true, seq: 1 }
  const accepted = await successor.channelReply('lease-eof-new', { v: 1, type: 'receipt', id: newFactId, factId: newFactId, receipt })
    .then(value => ({ ok: true, value })).catch(error => ({ ok: false, error: error?.serverError ?? String(error?.message ?? error) }))
  const lateOld = await old.channelReply('lease-eof-old', { v: 1, type: 'receipt', id: oldFactId, factId: oldFactId, receipt: { factId: oldFactId, persisted: true, seq: 1 } })
    .then(() => ({ ok: true })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  log.evidence({ newFactId, oldFactId, accepted, lateOld, successorGeneration: bound.generation, pid: child.pid })
  if (newFactId === oldFactId && accepted.ok && !lateOld.ok && lateOld.serverError === 'stale_lease' && child.pid === oldPid) log.pass(`the new lease ${bound.generation} resolved the ORIGINAL fact ${oldFactId} once and the old lease reply was refused (stale_lease) on the same pid`)
  else log.fail(`new-lease continuation failed: ${JSON.stringify({ newFactId, oldFactId, accepted, lateOld })}`)

  log.begin('B38-ORIGINAL-COMMAND-RECEPTION-AFTER-EOF', 'the original deliver command reaches the same attempt with its body after EOF', 'controlled_process')
  const deliverCommand = makeCommand('deliver', { ...attempt, id: 'cmd-eof-deliver', inputRef: 'input-eof' })
  const deliverFeed = await successor.command(deliverCommand, 'lease-eof-new').then(() => 'accepted').catch(error => `refused:${error?.serverError ?? error?.message ?? error}`)
  await wait(150)
  const receiver = (() => { try { return readFileSync(join(root, 'receiver.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) } catch { return [] } })()
  const deliverSeen = receiver.filter(line => line.id === 'cmd-eof-deliver')
  const beginSeen = receiver.filter(line => line.id === 'cmd-eof-begin')
  log.evidence({ deliverFeed, deliverSeen, beginSeen })
  const bodyOk = deliverSeen.length === 1 && deliverSeen[0].body?.inputRef === 'input-eof' && deliverSeen[0].attemptId === attempt.attemptId && deliverSeen[0].kind === 'deliver'
  if (deliverFeed === 'accepted' && bodyOk && beginSeen.length === 1) log.pass(`the original deliver id/body/attempt was received exactly once after EOF and begin was not replayed (${beginSeen.length})`)
  else log.fail(`original command reception after EOF was not proven: ${JSON.stringify({ deliverFeed, deliverSeen, beginSeen })}`)

  log.begin('B38-NORMAL-CANCEL-AND-TERMINAL-BARRIER-COLLECTED', 'the successor normal-cancels and then collects the terminal barrier; the same Runner exits', 'controlled_process')
  const cancel = await successor.cancel(makeCommand('cancel', { ...attempt, id: 'cmd-eof-cancel' }), 'lease-eof-new')
    .then(proof => ({ ok: true, state: verifiedRunnerInspection(proof).value.state })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  // The old stdin is EOF and its owner is gone: the terminal endpoint stays until the successor collects
  // the already-recorded barrier with the original no-lease physical cancel.
  const barrierProof = await successor.cancel(makeCommand('cancel', { ...attempt, id: 'cmd-eof-barrier' }))
    .then(proof => ({ ok: true, value: verifiedRunnerInspection(proof).value }))
    .catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  const barrier = barrierProof.ok ? { ok: true, state: barrierProof.value.state, admission: barrierProof.value.admission } : barrierProof
  const endpointAliveAfterCancel = exited === null && child.exitCode === null
  const finalize = await successor.finalize({ confirmationId: 'confirm-eof-1', resourceManifestDigest: runnerResourceManifestDigest(barrierProof.value.resources), proofRef: 'proof-eof-1' })
    .then(result => ({ ok: true, result })).catch(error => ({ ok: false, serverError: error?.serverError ?? null }))
  for (let index = 0; index < 800 && exited === null; index += 1) await wait(10)
  log.evidence({ cancel, barrier, endpointAliveAfterCancel, finalize, exited, pid: child.pid })
  if (cancel.ok && barrier.ok && barrier.state === 'terminated' && endpointAliveAfterCancel && finalize.ok && finalize.result.finalized === true && exited && exited.code === 0 && exited.signal === null) log.pass(`the cancel only observed/stopped, the endpoint stayed alive, and the postcommit finalize closed it; the same Runner exited ${exited.code} with no signal`)
  else log.fail(`normal cancel/finalize/exit failed: ${JSON.stringify({ cancel, barrier, endpointAliveAfterCancel, finalize, exited })}`)

  log.begin('B38-SCOPE-NOT-NATIVE', 'controlled waiting-user lane; fixture receipt, no installed agent/model/gateway/signal', 'controlled_process')
  log.notTested('no installed agent, model gateway or real signal was used; the receipt is a fixture reply, not original Store durability; original Store/Broker acceptance and physical slots remain main-owned/NOT_REACHED')
} finally {
  if (exited === null) {
    // Never signal the Runner: wait briefly for a natural exit; otherwise retain EVERYTHING (root,
    // journal, payloads, credential) as UNKNOWN material instead of deleting evidence around a refusal.
    for (let index = 0; index < 500 && exited === null; index += 1) await wait(10)
  }
  if (exited !== null) rmSync(root, { recursive: true, force: true })
  else process.stdout.write(`RETAINED_UNKNOWN_ROOT ${root}\n`)
}
const report = writeReport({ cases: log.cases, environment: { note: 'recovery milestone 01 old-coordinator EOF/EPIPE survival', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real spawned Runner; no signal/kill; original Store/Broker main-owned' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(52)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB38-eof totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
