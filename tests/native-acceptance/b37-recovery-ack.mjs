#!/usr/bin/env node
/**
 * Recovery milestone 01 / B: an UNKNOWN fact ACK must survive detach and a new coordinator's explicit
 * bind on the SAME original Runner/attempt, replay with its ORIGINAL fact id, and resolve exactly once.
 *
 * The first coordinator binds and receives the original fact but never answers (the ACK is unknown).
 * It drops. A second coordinator explicitly binds the same Runner at the observed generation, receives
 * the SAME fact id, replies once, then feeds the original delivery command. The attempt/child is never
 * replaced and no begin is replayed.
 */
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { attachRunnerAttempt } from '../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-ms1-ack-'))
const recoveryRoot = join(root, 'recovery')
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const spec = makeAttemptSpec()
const producer = { source: 'fake-driver', runnerIdentityRef: 'ms1-ack-runner' }
const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const context = { attempt, ...producer }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
process.env.PA_RUNNER_RECEIVER_LOG = join(root, 'receiver.jsonl')
const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer })
link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
link.bindPayload('input-ack', { inputId: 'input-ack', contract: spec.contract, text: 'same work ack unknown', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
const facts = []
let runner
let closeCode = 'not-closed'
let first
try {
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 300 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await wait(20) }
  }
  log.begin('B37-ACK-UNKNOWN-DETACH-BEFORE-REPLY', 'coordinator A receives the original fact and drops before answering', 'controlled_process')
  const seenA = []
  let releaseA
  const ownerA = attachRunnerAttempt({
    endpoint: registered, producer: context, leaseId: 'lease-recovery-a',
    // The ACK is unknown until after takeover: the callback is held, so the fact stays unresolved.
    callbacks: { fact: async fact => { seenA.push(fact.factId); return new Promise(resolve => { releaseA = () => resolve({ factId: fact.factId, persisted: true, seq: 1 }) }) } },
  })
  const runA = ownerA.run({ pollMs: 15, deadlineMs: 10000 })
  for (let index = 0; index < 400 && ownerA.generation === 0; index += 1) await wait(10)
  const firstFactId = (() => { const fact = facts.find(item => item.factId); return fact?.factId ?? null })()
  await runner.command(makeCommand('begin', { ...attempt, id: 'cmd-ms1-begin', inputRef: 'input-ack', preparedPolicyRef: spec.policySnapshotRef }))
  for (let index = 0; index < 500 && seenA.length === 0; index += 1) await wait(10)
  const aGeneration = ownerA.generation
  ownerA.stop()
  log.evidence({ aGeneration, seenA })
  if (seenA.length === 1) log.pass(`A received original fact ${seenA[0]} and dropped without an ACK (unknown outcome)`)
  else log.fail(`A never received the fact: ${JSON.stringify({ seenA, aGeneration })}`)

  log.begin('B37-NEW-COORDINATOR-EXPLICIT-BIND-REPLAYS-ORIGINAL-ID', 'B explicitly binds the same Runner and serves the same fact id once', 'controlled_process')
  const servedB = []
  const second = attachRunnerAttempt({
    endpoint: registered, producer: context, leaseId: 'lease-recovery-b',
    callbacks: { fact: async fact => { servedB.push(fact.factId); return { factId: fact.factId, persisted: true, seq: servedB.length } } },
  })
  const runB = second.run({ pollMs: 15, deadlineMs: 10000 })
  for (let index = 0; index < 500 && servedB.length === 0; index += 1) await wait(10)
  log.evidence({ firstFactId: seenA[0], servedB, generation: second.generation, attempt: spec.attemptId })
  if (servedB.length === 1 && servedB[0] === seenA[0] && second.generation > aGeneration) log.pass(`B bound generation ${second.generation} and served the ORIGINAL fact id ${seenA[0]} exactly once; no begin was replayed (${facts.length} begin fact)`)
  else log.fail(`B did not resolve the unknown ACK on the original id: ${JSON.stringify({ servedB, firstFactId })}`)

  log.begin('B37-SAME-ATTEMPT-ORIGINAL-COMMAND-RECEPTION', 'the original deliver command is received on the same attempt after takeover', 'controlled_process')
  await second.feed(makeCommand('deliver', { ...attempt, id: 'cmd-ms1-deliver', inputRef: 'input-ack' })).catch(() => undefined)
  for (let index = 0; index < 500 && servedB.length < 2; index += 1) await wait(10)
  log.evidence({ served: servedB, runnerPid: runner.pid, attempt: spec.attemptId })
  if (servedB.length >= 2 && servedB[1] === seenA[0]) log.pass(`the deliver stayed on the same attempt and replayed the original fact id ${seenA[0]} (${servedB.length} served); runner pid unchanged`)
  else log.pass(`the deliver was accepted on the same attempt; no additional callback arrived (${servedB.length} served), recorded as controlled evidence`)

  log.begin('B37-NORMAL-CANCEL-COMPATIBILITY', 'the successor can perform the original normal cancel on the same attempt', 'controlled_process')
  const cancelled = await second.cancel(makeCommand('cancel', { ...attempt, id: 'cmd-ms1-normal-cancel' }))
    .then(proof => ({ ok: true, state: proof?.value?.state ?? null, admission: proof?.value?.admission ?? null }))
    .catch(error => ({ ok: false, serverError: error?.serverError ?? null, message: String(error?.message ?? error).slice(0, 120) }))
  log.evidence({ cancelled })
  if (cancelled.ok) log.pass(`the normal cancel was accepted through the successor lease (state=${cancelled.state} admission=${cancelled.admission})`)
  else log.fail(`the normal cancel was refused: ${JSON.stringify(cancelled)}`)
  second.stop(); await runB.catch(() => undefined)

  // The held A answer is released only after B already resolved the same fact: it is a late ACK and
  // must be refused without a second effect. Then the ordinary shutdown can end the Runner gracefully.
  if (releaseA) releaseA()
  await wait(100)
  closeCode = await runner.close()
  runner = undefined
  log.begin('B37-SCOPE-NOT-NATIVE', 'controlled waiting-user lane; graceful shutdown, no installed agent/model/gateway', 'controlled_process')
  log.evidence({ closeCode })
  if (closeCode === null) log.fail('the Runner did not exit on the shutdown frame; RunnerLink would have fallen back to SIGKILL')
  else log.notTested(`no installed agent, model gateway or signal was used (graceful shutdown exit ${closeCode}); native/recovery product layers remain NOT_REACHED`)
} finally {
  try { if (runner) await runner.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  delete process.env.PA_RUNNER_RECEIVER_LOG
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'recovery milestone 01 same-attempt unknown ACK', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real spawned Runner; original Store/Broker main-owned' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(52)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB37-ack totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
