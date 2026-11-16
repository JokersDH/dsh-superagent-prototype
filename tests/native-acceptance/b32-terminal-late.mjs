#!/usr/bin/env node
/**
 * Wave-32 B: a callback that arrives AFTER terminal shutdown must be refused, not accepted.
 *
 * The Runner is driven directly over its stdio protocol: bind a remote lease, let it receive a real fact
 * request, then shut the attempt down and try to deliver that fact's receipt. The late receipt, a late
 * state read and a late poll must all fail; accepting any of them would make an already-resolved fact
 * look newly acknowledged.
 */
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w32-late-'))
const recoveryRoot = join(root, 'recovery')
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const producer = { source: 'fake-driver', runnerIdentityRef: 'b32-late-runner' }
const seconds = ms => new Promise(resolve => setTimeout(resolve, ms))
const spec = makeAttemptSpec()
let child
try {
  child = spawn(process.execPath, [ENTRY, 'waiting-user'], { env: { ...process.env, PA_RUNNER_RECOVERY_ROOT: recoveryRoot }, stdio: ['pipe', 'pipe', 'pipe'] })
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
  const send = frame => child.stdin.write(JSON.stringify({ v: 1, ...frame }) + '\n')
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'), producer })
  for (let index = 0; index < 300 && !frames.some(frame => frame.type === 'ready'); index += 1) await seconds(10)
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 300 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await seconds(20) }
  }
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const context = { attempt, ...producer }
  const client = connectRunnerRecovery(registered, context, 3000)

  log.begin('B32-FIRST-LEASE-NEVER-BOUND-REFUSED', 'a claimed lease that was never bound cannot feed the original attempt', 'controlled_process')
  const early = connectRunnerRecovery(registered, context, 3000)
  const firstLeaseFeed = await early.command(makeCommand('begin', { id: 'cmd-never-bound', inputRef: 'input-never-bound', preparedPolicyRef: spec.policySnapshotRef }), 'lease-never-bound')
    .then(() => ({ ok: true })).catch(error => ({ ok: false, code: error?.code ?? null, serverError: error?.serverError ?? null }))
  log.evidence({ firstLeaseFeed })
  if (!firstLeaseFeed.ok && firstLeaseFeed.serverError === 'stale_connection') log.pass('the never-bound claimed lease was refused (stale_connection) before any admission')
  else log.fail(`a never-bound lease could feed: ${JSON.stringify(firstLeaseFeed)}`)

  log.begin('B32-LATE-REMOTE-FACT-DISPATCHED', 'a real fact request is dispatched to the remote lease', 'controlled_process')
  const state = await client.channelState()
  const bound = await client.channelNext('lease-late', state.generation)
  send({ type: 'command', id: 'cmd-late-begin', command: makeCommand('begin', { inputRef: 'input-late', preparedPolicyRef: spec.policySnapshotRef }) })
  let pending = null
  for (let index = 0; index < 300 && !pending; index += 1) {
    const page = await client.channelNext('lease-late').catch(() => null)
    if (page?.request) pending = page.request
    else await seconds(10)
  }
  log.evidence({ pendingType: pending?.type ?? null, pendingId: pending?.id ?? null })
  if (pending?.type === 'fact') log.pass(`the remote lease received the original fact request ${pending.id} before shutdown`)
  else log.fail(`no fact request reached the lease: ${JSON.stringify(pending)}`)

  log.begin('B32-LATE-RECEIPT-AFTER-TERMINAL-REFUSED', 'a receipt arriving after shutdown is refused', 'controlled_process')
  send({ type: 'shutdown', id: 'shutdown' })
  for (let index = 0; index < 300 && !frames.some(frame => frame.type === 'exited'); index += 1) await seconds(10)
  const lateReply = await client.channelReply('lease-late', { v: 1, type: 'receipt', id: pending?.id ?? 'fact-late', factId: pending?.fact?.factId ?? pending?.id ?? 'fact-late', receipt: { factId: pending?.fact?.factId ?? 'fact-late', persisted: true, seq: 1 } })
    .then(value => ({ ok: true, value })).catch(error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 160) }))
  log.evidence({ lateReply, exited: frames.some(frame => frame.type === 'exited') })
  if (!lateReply.ok) log.pass(`the late receipt was refused (${lateReply.code}: ${lateReply.message}) after terminal shutdown`)
  else log.fail(`a late receipt was accepted: ${JSON.stringify(lateReply)}`)

  log.begin('B32-STOPPED-FEED-REFUSED-BEFORE-EFFECT', 'a business feed after terminal shutdown is refused before admission', 'controlled_process')
  const stoppedFeed = await client.command(makeCommand('deliver', { id: 'cmd-stopped-feed', inputRef: 'input-after-stop' }))
    .then(() => ({ ok: true })).catch(error => ({ ok: false, code: error?.code ?? null, serverError: error?.serverError ?? null, reason: error?.reason ?? null }))
  log.evidence({ stoppedFeed })
  if (!stoppedFeed.ok && stoppedFeed.serverError === 'stale_connection') log.pass('the stopped Runner refused the raw feed (stale_connection) instead of admitting it')
  else log.fail(`stopped feed was admitted: ${JSON.stringify(stoppedFeed)}`)

  log.begin('B32-LATE-STATE-READONLY-AND-POLL-REFUSED', 'late state reads the last generation without reviving; a late poll is refused', 'controlled_process')
  // The terminal channel keeps its last generation readable (a read is not a rebind); a poll/pull would
  // revive delivery and must be refused.
  const lateState = await client.channelState().then(value => ({ ok: true, value })).catch(error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 160) }))
  const latePoll = await client.channelNext('lease-late').then(value => ({ ok: true, value })).catch(error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 160) }))
  log.evidence({ lateState, latePoll })
  if (!latePoll.ok && lateState.ok && lateState.value.generation === bound.generation) log.pass(`the late poll was refused and the late state read only the unchanged generation ${bound.generation}; nothing was revived`)
  else log.fail(`a late poll/state behaved wrongly: ${JSON.stringify({ lateState, latePoll })}`)

  log.begin('B32-SCOPE-NOT-NATIVE', 'fixture lane; no installed agent or gateway', 'controlled_process')
  log.notTested('no installed agent executed and no gateway contacted')
} finally {
  try { child?.kill('SIGKILL') } catch {}
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-32 terminal late-callback refusal', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'real spawned Runner; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB32-late totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
