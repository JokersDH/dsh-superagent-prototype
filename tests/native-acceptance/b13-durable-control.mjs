#!/usr/bin/env node
/**
 * B13: product recovery across an independent coordinator SIGKILL (wave-12 B5-B7).
 *
 * This replaces the wave-11 B13 claim, which was not product recovery: it wrote a test-owned
 * command/epoch table, never drove a Runner, and reopened the file inside the same parent process.
 *
 * Here every element is the real one:
 *   - the durable substrate is A's ProductStore (real SQLite, real migrations, real command receipts);
 *   - the commands go through `store.commands.record`, whose idempotency is the real product rule;
 *   - the Runner is a separate spawned process behind a real authenticated socket;
 *   - the coordinator is a separate spawned process that is SIGKILLed at a named control window;
 *   - recovery is a genuinely new coordinator process over the SAME store and the SAME Runner.
 *
 * Windows: after begin, after a question is registered, after an answer is sent, and after a stop is
 * acknowledged but before the coordinator records its own receipt.
 *
 * Driver scenarios stay fixtures, so every native row remains NOT_TESTED.
 *
 * Usage: node tests/native-acceptance/b13-durable-control.mjs [--record]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { createRunnerCredential } from '../../apps/coordinator/runner-link.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const coordinatorFixture = fileURLToPath(new URL('./fixtures/b13-attempt-process.mjs', import.meta.url))
const runnerFixture = fileURLToPath(new URL('../integration/runner-service.fixture.mjs', import.meta.url))

/** Start the real independent Runner service process and wait for its authenticated endpoint. */
function startRunner(sceneDir) {
  const child = spawn(process.execPath, [runnerFixture, sceneDir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runner did not become ready: ${stderr}`)), 15_000)
    child.once('message', value => { clearTimeout(timer); resolve(value) })
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`runner exited early ${code}/${signal}: ${stderr}`)) })
  })
  return { child, ready }
}

/** Run one coordinator process. Crash modes must die by SIGKILL; recover must exit cleanly. */
function runCoordinator(stateRoot, sceneDir, mode) {
  const result = spawnSync(process.execPath, [coordinatorFixture, stateRoot, sceneDir, mode], { encoding: 'utf8', timeout: 30_000 })
  const output = (result.stdout ?? '').trim().split('\n').filter(Boolean).at(-1)
  return { status: result.status, signal: result.signal, stderr: result.stderr, observation: output ? JSON.parse(output) : null }
}

const root = mkdtempSync(join(tmpdir(), 'pa-wave12-b13-'))
const stateRoot = join(root, 'state')
const sceneDir = join(root, 'scene')
let runner
try {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  mkdirSync(sceneDir, { recursive: true, mode: 0o700 })
  createRunnerCredential(join(sceneDir, 'runner.key'))
  runner = startRunner(sceneDir)
  await runner.ready

  // =============================================================================================
  // The substrate really is the product store plus an independent Runner
  // =============================================================================================
  const { producer } = await import('../integration/runtime-ingress-fixture.ts')
  const expected = { attemptId: producer.attempt.attemptId, fenceEpoch: producer.attempt.fenceEpoch }
  log.begin('B13-PRODUCT-STORE-AND-INDEPENDENT-RUNNER', 'the real store and a separate Runner process', 'controlled_process')
  const first = runCoordinator(stateRoot, sceneDir, 'begin')
  const storeFile = join(stateRoot, 'product.sqlite')
  log.evidence({
    coordinatorPid: first.observation?.pid ?? null,
    runnerPid: runner.child.pid,
    storeCreated: existsSync(storeFile),
    crashSignal: first.signal,
    separateProcesses: (first.observation?.pid ?? 0) !== runner.child.pid,
  })
  if (existsSync(storeFile) && first.signal === 'SIGKILL' && first.observation?.pid !== runner.child.pid) {
    log.pass('a real product database was created and the coordinator died by SIGKILL in its own process, distinct from the Runner')
  } else {
    log.fail(`the substrate or the crash was not real: ${JSON.stringify({ store: existsSync(storeFile), signal: first.signal, stderr: first.stderr?.slice(0, 200) })}`)
  }

  // =============================================================================================
  // Each control window: SIGKILL, then a fresh coordinator recovers the same state
  // =============================================================================================
  const windows = [
    ['after-begin', 'begin', 'B13-CRASH-AFTER-BEGIN'],
    ['after-question', 'question', 'B13-CRASH-AFTER-QUESTION'],
    ['after-answer', 'answer', 'B13-CRASH-AFTER-ANSWER'],
    ['after-stop-ack', 'stop', 'B13-CRASH-AFTER-STOP-ACK'],
  ]
  for (const [window, mode, id] of windows) {
    log.begin(id, `the coordinator is SIGKILLed ${window} and a new process recovers`, 'controlled_process')
    const crashed = runCoordinator(stateRoot, sceneDir, mode)
    const recovered = runCoordinator(stateRoot, sceneDir, 'recover')
    const observed = recovered.observation ?? {}
    const beginReceipts = (observed.found ?? []).filter(entry => entry.id === 'cmd-begin' && entry.seq !== null).length
    log.evidence({ crashSignal: crashed.signal, crashWindow: crashed.observation?.crashed ?? null, recovered: observed })
    if (crashed.signal !== 'SIGKILL') {
      log.fail(`the ${window} window did not actually crash: ${JSON.stringify({ signal: crashed.signal, status: crashed.status, stderr: crashed.stderr?.slice(0, 200) })}`)
      continue
    }
    if (observed.attemptId !== expected.attemptId || observed.fenceEpoch !== expected.fenceEpoch) {
      log.fail(`the recovered process lost the attempt identity: ${JSON.stringify(observed)}`)
      continue
    }
    if (beginReceipts !== 1) {
      log.fail(`the begin receipt was not exactly once after recovery: ${beginReceipts}`)
      continue
    }
    log.pass(`recovered from ${window}: attempt identity and epoch intact, one begin receipt, no second begin`)
  }

  // =============================================================================================
  // Unknown-outcome honesty: the stop was acknowledged but never receipted
  // =============================================================================================
  log.begin('B13-STOP-UNKNOWN-NOT-RESENT-BY-RECOVERY', 'an unrecorded stop is reported unknown rather than resent', 'controlled_process')
  const recoveredAfterStop = runCoordinator(stateRoot, sceneDir, 'recover').observation ?? {}
  const stopReceipt = (recoveredAfterStop.found ?? []).find(entry => entry.id === 'cmd-stop')
  log.evidence({ stopReceiptSeq: stopReceipt?.seq ?? null, runnerState: recoveredAfterStop.runnerState, writer: recoveredAfterStop.writer })
  // The crash happened after the Runner acknowledged the stop but before the coordinator recorded it.
  // The honest state is: the Runner reports its own view, the receipt is absent, and no process
  // invents a stop receipt on recovery.
  if (stopReceipt?.seq === null && recoveredAfterStop.runnerState === 'terminated') {
    log.pass('the recovered process reports the Runner terminated without fabricating a stop receipt for a command it never recorded')
  } else {
    log.fail(`the unknown stop was not handled honestly: ${JSON.stringify({ stopReceipt, state: recoveredAfterStop.runnerState })}`)
  }

  // =============================================================================================
  // Honest scope
  // =============================================================================================
  log.begin('B13-SCOPE-NOT-NATIVE', 'controlled-product evidence, not vendor behaviour', 'controlled_process')
  log.evidence({ driver: 'fixture scenario', realStore: true, independentRunnerProcess: true, independentCoordinatorProcess: true, realSigkill: true, realVendorAgent: false })
  log.notTested('an installed vendor agent was not executed; the Driver scenario is a fixture')
  log.notTested('answer/steer against a real vendor turn and unknown-send reconciliation remain untested')
  log.notTested('multi-slot queue, output caps, backpressure and resource-return matrix are not covered by this file')
} finally {
  if (runner?.child.exitCode === null) runner.child.kill('SIGKILL')
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-12 B13 product recovery across independent coordinator SIGKILL', modelCalls: 0 }, extra: { scope: 'controlled product; native NOT_TESTED' } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b13-durable-control.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(42)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB13 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
