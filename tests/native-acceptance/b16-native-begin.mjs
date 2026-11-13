#!/usr/bin/env node
/**
 * Wave-16 B1 (receiver half): a real spawned Runner actually receives begin.
 *
 * B13's vertical ran the Runner inside the coordinator, so no frame crossed a process boundary and a
 * "receiver begin count" was structurally impossible. This file drives the existing
 * RunnerLink + runner-service-entry as a separate process and selects the Codex Driver against the
 * B-owned in-process fake app-server (no installed agent, no native turn). The begin count is read
 * from a log the Runner process itself writes before any admission check.
 *
 * Usage: node tests/native-acceptance/b16-native-begin.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))

const root = mkdtempSync(join(tmpdir(), 'pa-w16-b1r-'))
const receiverLog = join(root, 'receiver.jsonl')
process.env.PA_RUNNER_SCENARIO = 'codex-fake'
process.env.PA_RUNNER_RECEIVER_LOG = receiverLog

const received = () => {
  if (!existsSync(receiverLog)) return []
  return readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

let runner
try {
  log.begin('B16-RUNNER-SPAWNED-SEPARATE-PROCESS', 'the Runner is a real child process', 'controlled_process')
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['codex-native'], stateRoot: join(root, 'attempt') })
  const spec = makeAttemptSpec()
  // The Driver reads the policy snapshot and the execution input through the bridge, so both refs
  // must resolve to payloads that satisfy the real schemas. Plain ref strings are not JSON, and the
  // Driver parses them before it can send anything - which is why an unbound ref yields no facts.
  link.bindPayload(spec.policySnapshotRef, {
    kind: 'codex-native-settings/1',
    workspacePath: process.cwd(),
    scope: { projectId: 'project-b16', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    approvalPolicy: 'on-request',
    timeoutMs: 600000,
  })
  const inputRef = 'input-b16'
  link.bindPayload(inputRef, {
    inputId: 'input-b16',
    contract: spec.contract,
    text: 'Produce the controlled scratch artifact',
    contextRefs: [],
    sourceMessageRefs: [],
    provenance: 'authorized_work_input',
  })
  const facts = []
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })
  log.evidence({ runnerPid: runner.pid, coordinatorPid: process.pid, attemptId: spec.attemptId, scenario: process.env.PA_RUNNER_SCENARIO })
  if (runner.pid && runner.pid !== process.pid) log.pass(`Runner runs as pid ${runner.pid}, separate from coordinator ${process.pid}`)
  else log.fail(`the Runner did not run in a separate process: ${JSON.stringify({ pid: runner.pid })}`)

  log.begin('B16-BEGIN-REACHES-RECEIVER', 'the real begin frame is received by the Runner process', 'controlled_process')
  await runner.command(makeCommand('begin', { inputRef, preparedPolicyRef: spec.policySnapshotRef }))
  // Give the child a bounded window to write its receiver log and emit facts.
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && received().length === 0) await new Promise(r => setTimeout(r, 50))
  const frames = received()
  const begins = frames.filter(frame => frame.kind === 'begin')
  log.evidence({ receiverFrames: frames, beginCount: begins.length, factKinds: facts.map(fact => fact.kind).slice(0, 8), factCount: facts.length })
  if (begins.length >= 1 && String(begins[0].attemptId) === String(spec.attemptId)) {
    log.pass(`the Runner process received ${begins.length} begin for attempt ${begins[0].attemptId} at epoch ${begins[0].fenceEpoch}`)
  } else {
    log.fail(`no begin reached the Runner process: ${JSON.stringify({ frames, expectedAttempt: spec.attemptId })}`)
  }

  log.begin('B16-RUNNER-EMITS-REAL-FACTS', 'the attempt produces real critical facts over the bridge', 'controlled_process')
  if (facts.length >= 1) {
    log.pass(`the Runner emitted ${facts.length} critical fact(s): ${facts.map(fact => fact.kind).slice(0, 6).join(', ')}`)
  } else {
    log.fail('the Runner emitted no critical facts; the attempt did not really run')
  }

  log.begin('B16-SCOPE-NOT-NATIVE', 'fake app-server lane, not an installed agent', 'controlled_process')
  log.evidence({ driver: 'Codex Driver over in-process fake app-server', installedCodexExecuted: false })
  log.notTested('an installed Codex was not executed')
  log.notTested('the product Application/Broker vertical is not joined to this receiver in this file; that join is the business reconnect port and is NOT_TESTED here')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECEIVER_LOG
  delete process.env.PA_RUNNER_SCENARIO
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-16 B1 receiver half: real spawned Runner, fake app-server', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled fake app-server lane; native NOT_TESTED' } },
  undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(38)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB16 receiver totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
