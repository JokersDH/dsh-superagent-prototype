#!/usr/bin/env node
/**
 * Recovery milestone 01 / B: the real spawned entry must keep its authenticated terminal endpoint alive
 * long enough for a successor to read the original proof and collect the barrier when the old
 * coordinator exits after the terminal state but before recording that barrier.
 *
 * Scenario: coordinator A binds, begins, ACKs the original fact, performs the physical cancel (terminal),
 * then dies (stdout destroyed + stdin EOF) without recording the barrier. The SAME Runner must stay alive
 * and serve the successor's inspect + no-lease cancel; then it exits gracefully. A second child covers the
 * ordinary terminal path where the coordinator stays until explicit shutdown.
 */
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../../packages/execution/src/recovery-transport.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const roots = []
const spawned = []

async function spawnRunner(label) {
  const root = mkdtempSync(join(tmpdir(), `pa-ms1-term-${label}-`))
  roots.push(root)
  const recoveryRoot = join(root, 'recovery')
  const spec = makeAttemptSpec()
  const producer = { source: 'fake-driver', runnerIdentityRef: `ms1-term-${label}` }
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const child = spawn(process.execPath, [ENTRY, 'waiting-user'], {
    env: { ...process.env, PA_RUNNER_RECOVERY_ROOT: recoveryRoot, PA_RUNNER_RECEIVER_LOG: join(root, 'receiver.jsonl') },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const frames = []
  let buffer = ''
  let exited = null
  child.stdout.on('data', chunk => {
    if (exited === null && child.stdout.destroyed) return
    try {
      buffer += chunk.toString()
      for (;;) {
        const nl = buffer.indexOf('\n')
        if (nl < 0) break
        try { frames.push(JSON.parse(buffer.slice(0, nl))) } catch {}
        buffer = buffer.slice(nl + 1)
      }
    } catch {}
  })
  child.stderr.on('data', () => {})
  child.on('exit', (code, signal) => { exited = { code, signal } })
  spawned.push({ child, root, getExit: () => exited })
  const send = frame => { try { child.stdin.write(JSON.stringify({ v: 1, ...frame }) + '\n') } catch {} }
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'), producer })
  for (let index = 0; index < 400 && !frames.some(frame => frame.type === 'ready'); index += 1) await wait(10)
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await wait(20) }
  }
  const context = { attempt, ...producer }
  const client = connectRunnerRecovery(registered, context, 3000)
  const state = await client.channelState()
  await client.channelNext('lease-terminal', state.generation)
  const begin = makeCommand('begin', { ...attempt, id: 'cmd-terminal-begin', inputRef: 'input-terminal', preparedPolicyRef: spec.policySnapshotRef })
  send({ type: 'command', id: begin.id, command: begin })
  let fact = null
  for (let index = 0; index < 300 && !fact; index += 1) {
    const page = await client.channelNext('lease-terminal').catch(() => null)
    if (page?.request?.type === 'fact') fact = page.request
    else await wait(10)
  }
  const factId = fact?.fact?.factId ?? fact?.id
  await client.channelReply('lease-terminal', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } })
  return { root, child, frames, client, context, attempt, spec, registered, factId, exited: () => exited, send, getExit: () => exited }
}

try {
  log.begin('B39-TERMINAL-ENDPOINT-SURVIVES-OWNER-EXIT', 'the real entry keeps its terminal endpoint after the old coordinator exits before recording the barrier', 'controlled_process')
  const a = await spawnRunner('owner-exit')
  const oldPid = a.child.pid
  const cancelCommand = makeCommand('cancel', { ...a.attempt, id: 'cmd-terminal-cancel' })
  const cancel = await a.client.cancel(cancelCommand, 'lease-terminal').then(proof => ({ ok: true, state: verifiedRunnerInspection(proof).value.state })).catch(error => ({ ok: false, error: String(error?.message ?? error) }))
  for (let index = 0; index < 400 && !a.frames.some(frame => frame.type === 'exited'); index += 1) await wait(10)
  const terminalSeen = a.frames.some(frame => frame.type === 'exited')
  // The old coordinator dies AFTER the terminal state but BEFORE recording the barrier.
  a.child.stdout.removeAllListeners('data')
  a.child.stdout.destroy()
  a.child.stdin.end()
  await wait(600)
  const aliveAfterOwnerExit = a.getExit() === null && a.child.exitCode === null
  log.evidence({ oldPid, cancel, terminalSeen, factId: a.factId, aliveAfterOwnerExit, exit: a.getExit() })
  if (cancel.ok && terminalSeen && aliveAfterOwnerExit) log.pass(`terminal state was reached and cancelled; after the owner exited the same Runner pid ${oldPid} still serves its endpoint (barrier not yet recorded)`)
  else log.fail(`terminal endpoint lifetime failed: ${JSON.stringify({ cancel, terminalSeen, aliveAfterOwnerExit, exit: a.getExit() })}`)

  log.begin('B39-SUCCESSOR-READS-ORIGINAL-PROOF-AND-BARRIER', 'a successor inspects the original terminal proof and collects the barrier with a no-lease cancel', 'controlled_process')
  let successor = null
  for (let index = 0; index < 100 && !successor; index += 1) {
    try {
      successor = connectRunnerRecovery(a.registered, a.context, 3000)
      await successor.inspect()
    } catch { successor = null; await wait(20) }
  }
  const proof = await successor.inspect()
  const inspection = verifiedRunnerInspection(proof).value
  const finalCancel = await successor.cancel(makeCommand('cancel', { ...a.attempt, id: 'cmd-terminal-barrier' }))
    .then(value => ({ ok: true, state: verifiedRunnerInspection(value).value.state, admission: verifiedRunnerInspection(value).value.admission }))
    .catch(error => ({ ok: false, error: String(error?.message ?? error) }))
  for (let index = 0; index < 800 && a.getExit() === null; index += 1) await wait(10)
  const exit = a.getExit()
  log.evidence({ inspection: { state: inspection.state, admission: inspection.admission, resources: inspection.resources?.length ?? 0 }, finalCancel, exit, pid: a.child.pid })
  if (inspection.state === 'terminated' && inspection.admission === 'closed' && finalCancel.ok && exit && exit.code === 0 && exit.signal === null) {
    log.pass(`the successor read the original terminated/closed proof and collected the barrier; the same Runner exited ${exit.code} with no signal`)
  } else log.fail(`successor barrier collection failed: ${JSON.stringify({ state: inspection.state, admission: inspection.admission, finalCancel, exit })}`)

  log.begin('B39-ORDINARY-TERMINAL-EXPLICIT-SHUTDOWN', 'the ordinary terminal path with a live coordinator still exits on explicit shutdown', 'controlled_process')
  const b = await spawnRunner('ordinary')
  const ordinaryCancel = await b.client.cancel(makeCommand('cancel', { ...b.attempt, id: 'cmd-ordinary-cancel' }), 'lease-terminal')
    .then(() => 'accepted').catch(error => `refused:${error?.serverError ?? error?.message ?? error}`)
  for (let index = 0; index < 400 && !b.frames.some(frame => frame.type === 'exited'); index += 1) await wait(10)
  b.send({ type: 'shutdown', id: 'shutdown' })
  b.child.stdin.end()
  for (let index = 0; index < 800 && b.getExit() === null; index += 1) await wait(10)
  const ordinaryExit = b.getExit()
  log.evidence({ ordinaryCancel, ordinaryExit })
  if (ordinaryCancel === 'accepted' && ordinaryExit && ordinaryExit.code === 0 && ordinaryExit.signal === null) log.pass(`the ordinary terminal path exited ${ordinaryExit.code} on explicit shutdown with no lingering endpoint wait`)
  else log.fail(`ordinary terminal path failed: ${JSON.stringify({ ordinaryCancel, ordinaryExit })}`)

  log.begin('B39-SCOPE-NOT-NATIVE', 'controlled waiting-user lane; no installed agent/model/gateway/signal', 'controlled_process')
  log.notTested('no installed agent, model gateway or real signal was used; physical crash recovery and original 2/4 slots remain NOT_REACHED; receipts are controlled')
} finally {
  // UNKNOWN retention: if any spawned Runner's exit is unconfirmed, keep its root (journal, payloads,
  // credentials) instead of deleting evidence.
  const unconfirmed = spawned.filter(entry => entry.getExit() === null)
  for (const entry of spawned) {
    if (entry.getExit() === null) continue
    try { rmSync(entry.root, { recursive: true, force: true }) } catch {}
  }
  if (unconfirmed.length > 0) process.stdout.write(`RETAINED_UNKNOWN_ROOTS ${unconfirmed.map(entry => entry.root).join(',')}\n`)
}
const report = writeReport({ cases: log.cases, environment: { note: 'recovery milestone 01 terminal endpoint lifetime', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real spawned entry; no signal/kill' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(52)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB39-terminal totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
