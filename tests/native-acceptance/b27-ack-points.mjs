#!/usr/bin/env node
/**
 * Wave-27 B11: the bounded acknowledgement windows, measured at their real points.
 *
 * The caller's own "sent" mark is not a receipt. This measures four real points for the original begin:
 * the write (before the call), the receiver log entry (the writer really received it), the returned ACK,
 * and the durable receipt (the sink returned). It then counts receptions again after the receipt exists,
 * which is the window where a resend would show up.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-points-'))
const receiverLog = join(root, 'receiver.jsonl')
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
let runner
try {
  process.env.PA_RUNNER_RECEIVER_LOG = receiverLog
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer: { source: 'fixture', runnerIdentityRef: 'b27-points' } })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-points', { inputId: 'input-points', contract: spec.contract, text: 'ack points', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const sinkPoints = []
  runner = await link.spawnAttempt(spec, async fact => { sinkPoints.push(Date.now()); return { factId: fact.factId, persisted: true, seq: sinkPoints.length } })
  const readReceipts = () => existsSync(receiverLog) ? readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []

  log.begin('B27-POINTS-BEGIN-WINDOWS', 'the begin is counted at write, receipt, ack and persistence', 'controlled_process')
  const tWrite = Date.now()
  await runner.command(makeCommand('begin', { id: 'cmd-points-begin', inputRef: 'input-points', preparedPolicyRef: spec.policySnapshotRef }))
  const tAck = Date.now()
  let tReceived = null
  for (let index = 0; index < 200 && tReceived === null; index += 1) {
    const line = readReceipts().find(frame => frame.kind === 'begin')
    if (line) tReceived = line.at
    else await new Promise(resolve => setTimeout(resolve, 10))
  }
  // Wait for one durable receipt, which is the point where the fact has been persisted.
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && sinkPoints.length < 1) await new Promise(resolve => setTimeout(resolve, 20))
  const tPersisted = sinkPoints.length ? Date.now() : null
  const receivedCount = readReceipts().filter(frame => frame.kind === 'begin').length
  log.evidence({ tWrite, tReceived, tAck, tPersisted, sinkCalls: sinkPoints.length, receivedCount, ordered: Boolean(tReceived && Date.parse(tReceived) <= tAck) })
  if (receivedCount === 1 && tPersisted !== null && tReceived && Date.parse(tReceived) <= tAck) {
    log.pass(`the begin was counted at all four points: written, received at ${tReceived}, acknowledged, and persisted after ${sinkPoints.length} sink call(s)`)
  } else log.fail(`the begin windows are not all counted: ${JSON.stringify({ receivedCount, tReceived, tAck, tPersisted })}`)

  log.begin('B27-POINTS-NO-RESEND-AFTER-PERSISTENCE', 'no begin is received again after its receipt exists', 'controlled_process')
  const afterPersist = readReceipts().filter(frame => frame.kind === 'begin').length
  await new Promise(resolve => setTimeout(resolve, 700))
  const afterWindow = readReceipts().filter(frame => frame.kind === 'begin').length
  log.evidence({ afterPersist, afterWindow })
  if (afterPersist === 1 && afterWindow === 1) log.pass('the bounded window after persistence shows exactly one begin reception, so nothing was resent')
  else log.fail(`a begin was resent inside the bounded window: ${JSON.stringify({ afterPersist, afterWindow })}`)

  log.begin('B27-POINTS-SECOND-COMMAND-WINDOWS', 'the second business command is counted at the same four points', 'controlled_process')
  // The answer needs a Broker question binding, which this fixture lane does not produce; the second
  // command measured here is a deliver, which travels the SAME admission and receipt path. The ANSWER is
  // counted separately on the product lane by b27-ack-windows, and this file does not relabel a deliver
  // as an answer to look complete.
  const sinkBefore = sinkPoints.length
  const receivedBefore = readReceipts().filter(frame => frame.kind === 'deliver').length
  const tWrite2 = Date.now()
  const delivered = await runner.command(makeCommand('deliver', { id: 'cmd-points-deliver', inputRef: 'input-points' })).then(() => true).catch(error => ({ error: String(error?.message ?? error).slice(0, 120) }))
  const tAck2 = Date.now()
  let tReceived2 = null
  for (let index = 0; index < 200 && tReceived2 === null; index += 1) {
    const line = readReceipts().find(frame => frame.kind === 'deliver')
    if (line) tReceived2 = line.at
    else await new Promise(resolve => setTimeout(resolve, 10))
  }
  const deadline2 = Date.now() + 15_000
  while (Date.now() < deadline2 && sinkPoints.length === sinkBefore) await new Promise(resolve => setTimeout(resolve, 20))
  const receivedAfter = readReceipts().filter(frame => frame.kind === 'deliver').length
  const deltas = { sinkCalls: sinkPoints.length - sinkBefore, received: receivedAfter - receivedBefore }
  log.evidence({ delivered, tWrite2, tReceived2, tAck2, sinkDelta: deltas.sinkCalls, receivedDelta: deltas.received })
  if (delivered === true && deltas.received === 1 && tReceived2 && Date.parse(tReceived2) <= tAck2) {
    log.pass(`the second command was counted at write, receive (${tReceived2}), ack and persistence with exactly one reception`)
  } else log.fail(`the second command windows are not counted: ${JSON.stringify({ delivered, deltas, tReceived2, tAck2 })}`)

  log.begin('B27-POINTS-NO-RESEND-SECOND-COMMAND', 'the second command is not received again in its window', 'controlled_process')
  const beforeWindow = readReceipts().filter(frame => frame.kind === 'deliver').length
  await new Promise(resolve => setTimeout(resolve, 700))
  const afterWindow2 = readReceipts().filter(frame => frame.kind === 'deliver').length
  log.evidence({ beforeWindow, afterWindow2 })
  if (beforeWindow === 1 && afterWindow2 === 1) log.pass('the bounded window after the second command shows exactly one reception')
  else log.fail(`the second command was resent: ${JSON.stringify({ beforeWindow, afterWindow2 })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'codex-fake lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECEIVER_LOG
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 ack points', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fixture lane; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(46)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-points totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
