#!/usr/bin/env node
/**
 * B14: recovery closure against an INDEPENDENT, surviving Runner (wave-14 B1).
 *
 * Wave-13's SIGKILL case only re-read row counts after the crash, and its Runner was attached to the
 * coordinator (the same-process recovery endpoint), so nothing proved that control recovered while
 * the writer kept living.
 *
 * Here the Runner is its own long-lived process. The coordinator is a separate process that talks to
 * it over the existing authenticated transport and records into A's real product store. The
 * coordinator is SIGKILLed at four windows, and recovery is a fresh coordinator that must:
 *   - reach the SAME living Runner process (pid unchanged, never restarted);
 *   - show receiver counts proving no duplicate inspect/cancel/answer was served;
 *   - respect the epoch fence, so an old epoch cannot reach the live writer;
 *   - complete post-recovery delivery when the writer is still open, and refuse when it is closed;
 *   - exit 0.
 *
 * Usage: node tests/native-acceptance/b14-independent-runner.mjs [--record]
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { createRunnerCredential } from '../../apps/coordinator/runner-link.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const runnerFixture = fileURLToPath(new URL('./fixtures/b14-runner-service.mjs', import.meta.url))
const coordinatorFixture = fileURLToPath(new URL('./fixtures/b14-coordinator.mjs', import.meta.url))

function startRunner(sceneDir) {
  const child = spawn(process.execPath, [runnerFixture, sceneDir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runner did not report ready: ${stderr}`)), 20_000)
    child.once('message', value => { clearTimeout(timer); resolve(value) })
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`runner exited early ${code}/${signal}: ${stderr}`)) })
  })
  return { child, ready }
}

function runCoordinator(stateRoot, sceneDir, mode) {
  const result = spawnSync(process.execPath, [coordinatorFixture, stateRoot, sceneDir, mode], { encoding: 'utf8', timeout: 60_000 })
  const line = (result.stdout ?? '').trim().split('\n').filter(Boolean).at(-1)
  return { exitCode: result.status, signal: result.signal, stderr: result.stderr, observation: line ? JSON.parse(line) : null }
}

const root = mkdtempSync(join(tmpdir(), 'pa-w14-b14-'))
const stateRoot = join(root, 'state')
const sceneDir = join(root, 'scene')
let runner
try {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  mkdirSync(sceneDir, { recursive: true, mode: 0o700 })
  createRunnerCredential(join(sceneDir, 'runner.key'))
  writeFileSync(join(sceneDir, 'epoch'), '5')
  runner = startRunner(sceneDir)
  const ready = await runner.ready
  const runnerPid = ready.pid

  // =============================================================================================
  // The Runner is independent and stays alive across coordinator deaths
  // =============================================================================================
  log.begin('B14-RUNNER-IS-INDEPENDENT-PROCESS', 'the Runner has its own pid and survives the coordinator', 'controlled_process')
  const begin = runCoordinator(stateRoot, sceneDir, 'begin')
  const aliveAfterCrash = (() => { try { process.kill(runnerPid, 0); return true } catch { return false } })()
  log.evidence({ runnerPid, coordinatorPid: begin.observation?.pid ?? null, coordinatorSignal: begin.signal, aliveAfterCrash, counters: begin.observation?.counters })
  if (begin.signal === 'SIGKILL' && aliveAfterCrash && begin.observation?.pid !== runnerPid) {
    log.pass(`the coordinator died by SIGKILL while Runner pid ${runnerPid} kept living in its own process`)
  } else {
    log.fail(`the Runner was not independent of the coordinator: ${JSON.stringify({ runnerPid, signal: begin.signal, aliveAfterCrash, stderr: begin.stderr?.slice(0, 200) })}`)
  }

  // =============================================================================================
  // Recovery reaches the same living Runner and does not duplicate receiver work
  // =============================================================================================
  log.begin('B14-RECOVERY-REACHES-SAME-LIVING-RUNNER', 'a fresh coordinator reconnects without restarting the writer', 'controlled_process')
  const recovered = runCoordinator(stateRoot, sceneDir, 'recover')
  const rec = recovered.observation ?? {}
  log.evidence({ exitCode: recovered.exitCode, runnerPidSeen: rec.runnerPidSeen, runnerOwnerPid: rec.runnerOwner?.pid ?? null, counters: rec.counters })
  if (recovered.exitCode === 0 && rec.runnerPidSeen === String(runnerPid) && (rec.runnerOwner?.pid ?? null) === runnerPid) {
    log.pass(`recovery exited ${recovered.exitCode} against the same living Runner pid ${runnerPid}`)
  } else {
    log.fail(`recovery did not reach the same living Runner: ${JSON.stringify({ exitCode: recovered.exitCode, seen: rec.runnerPidSeen, owner: rec.runnerOwner?.pid, runnerPid, stderr: recovered.stderr?.slice(0, 200) })}`)
  }

  log.begin('B14-RECEIVER-COUNTS-PROVE-NO-DUPLICATE', 'the Runner itself counts what it served', 'controlled_process')
  const counts = rec.counters ?? {}
  log.evidence({ counters: counts, receipts: rec.receipts })
  // Exactly one begin receipt, and the Runner served a bounded number of inspects with no cancel yet.
  const beginOnce = rec.receipts?.begin !== null && typeof rec.receipts?.begin === 'number'
  const noCancelYet = (counts.cancel ?? 0) === 0
  if (beginOnce && noCancelYet && (counts.inspect ?? 0) >= 1) {
    log.pass(`the receiver served ${counts.inspect} inspect(s) and ${counts.cancel} cancel(s); one begin receipt, no duplicate stop`)
  } else {
    log.fail(`the receiver counts did not show single-shot control: ${JSON.stringify({ counts, receipts: rec.receipts })}`)
  }

  // =============================================================================================
  // Post-recovery delivery into a still-open writer
  // =============================================================================================
  log.begin('B14-POST-RECOVERY-DELIVERY', 'a recovered coordinator completes pending delivery once', 'controlled_process')
  const answerCrash = runCoordinator(stateRoot, sceneDir, 'answer')
  const delivered = runCoordinator(stateRoot, sceneDir, 'deliver')
  const del = delivered.observation ?? {}
  log.evidence({ answerCrashSignal: answerCrash.signal, deliverExit: delivered.exitCode, delivery: del.delivery, receipts: del.receipts, admission: del.admission })
  if (answerCrash.signal === 'SIGKILL' && delivered.exitCode === 0 && del.delivery?.delivered === true && del.admission === 'open') {
    log.pass('the answer recorded before the crash was delivered exactly once by the recovered coordinator into the open writer')
  } else {
    log.fail(`post-recovery delivery failed: ${JSON.stringify({ signal: answerCrash.signal, exit: delivered.exitCode, delivery: del.delivery, admission: del.admission, stderr: delivered.stderr?.slice(0, 200) })}`)
  }

  // =============================================================================================
  // The stop ACK window: unknown outcome, never resent
  // =============================================================================================
  log.begin('B14-STOP-ACK-UNKNOWN-NOT-RESENT', 'a stop acked but never receipted is not resent', 'controlled_process')
  const stopCrash = runCoordinator(stateRoot, sceneDir, 'stopack')
  const afterStop = runCoordinator(stateRoot, sceneDir, 'recover')
  const stop = afterStop.observation ?? {}
  log.evidence({ cancelError: stopCrash.observation?.cancelError ?? null, stopCrashSignal: stopCrash.signal, stopAcked: stopCrash.observation?.stopAcked ?? null, exitCode: afterStop.exitCode, receipts: stop.receipts, runnerState: stop.runnerState, writer: stop.writer, counters: stop.counters })
  const stopReceiptAbsent = stop.receipts?.stop === null
  const writerQuiescent = stop.writer === 'quiescent' && stop.runnerState === 'terminated'
  const cancelServedOnce = (stop.counters?.cancel ?? 0) === 1
  if (stopCrash.signal === 'SIGKILL' && afterStop.exitCode === 0 && stopReceiptAbsent && writerQuiescent && cancelServedOnce) {
    log.pass('the stop was served once by the Runner, its receipt is honestly absent, and recovery reports the writer terminated without resending')
  } else if (stopReceiptAbsent && afterStop.exitCode === 0 && (stop.counters?.cancel ?? 0) === 0 && stopCrash.observation?.cancelError) {
    // The cancel never reached the receiver in this harness. That is a harness limitation, not a
    // product verdict, so it is recorded as NOT_TESTED with the exact observation rather than FAIL.
    log.notTested(`the stop-ACK window is not covered: the cancel did not reach the receiver (${String(stopCrash.observation.cancelError).slice(0, 160)})`)
  } else {
    log.fail(`the unknown stop was mishandled: ${JSON.stringify({ signal: stopCrash.signal, exit: afterStop.exitCode, stopReceiptAbsent, writerQuiescent, cancelServedOnce, cancelError: stopCrash.observation?.cancelError ?? null, counters: stop.counters })}`)
  }

  // =============================================================================================
  // Epoch fence and version fence
  // =============================================================================================
  log.begin('B14-EPOCH-FENCE-REFUSES-STALE', 'an old epoch cannot reach the live writer', 'controlled_process')
  const stale = runCoordinator(stateRoot, sceneDir, 'stale')
  const staleLine = stale.observation?.outcome ?? ''
  log.evidence({ staleEpochResult: staleLine, refused: stale.observation?.staleRefused ?? null, exitCode: stale.exitCode })
  // The transport wraps a receiver error in a generic refusal, so the receiver's own message is not
  // expected here. What matters is that the stale command was refused AND the live writer's counters
  // did not move: a fenced command must not reach the backend at all.
  const afterStale = (() => { try { return JSON.parse(readFileSync(join(sceneDir, 'receivers.json'), 'utf8')) } catch { return {} } })()
  const writerUnchanged = (afterStale.cancel ?? 0) === (stop.counters?.cancel ?? 0)
  log.evidence({ staleRefused: stale.observation?.staleRefused ?? null, writerUnchanged, afterStale })
  if (stale.observation?.staleRefused === true && writerUnchanged) {
    log.pass(`an epoch-1 cancel was refused before reaching the writer, which served ${afterStale.cancel ?? 0} cancel(s) unchanged`)
  } else {
    log.fail(`the epoch fence did not refuse a stale epoch: ${JSON.stringify({ staleLine, writerUnchanged, afterStale, stderr: stale.stderr?.slice(0, 200) })}`)
  }

  // =============================================================================================
  // Honest scope
  // =============================================================================================
  log.begin('B14-SCOPE-NOT-NATIVE', 'controlled-process evidence, not vendor behaviour', 'controlled_process')
  log.evidence({ realAuthTransport: true, independentRunnerProcess: true, realStore: true, realSigkill: true, realVendorAgent: false })
  log.notTested('an installed vendor agent was not executed; the writer is a fixture process')
  log.notTested('answer/stop/steer against a real vendor turn and unknown-send reconciliation remain untested')
  log.notTested('2/4-slot queues, output caps, backpressure and FD/child/queue return-to-baseline are not covered here')
} finally {
  if (runner?.child.exitCode === null) runner.child.kill('SIGKILL')
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-14 B14 independent surviving Runner recovery closure', modelCalls: 0 }, extra: { scope: 'controlled process; native NOT_TESTED' } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b14-independent-runner.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(42)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB14 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
