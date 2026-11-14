#!/usr/bin/env node
/**
 * Wave-27 item 3 on a REAL spawned Runner/child.
 *
 * The Runner is the ordinary runner-service process started through RunnerLink with the deterministic
 * fixture driver, so no installed CLI and no gateway is involved. It publishes its own authenticated
 * endpoint. Client A attaches and reads the facts the Runner itself recorded, then leaves; client B
 * attaches to the SAME process and replays the same original fact ids. A's later reply is refused.
 */
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-live-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const producer = { source: 'codex-fake', runnerIdentityRef: 'b27-live-runner' }
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['codex-fake'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p-live', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-live', { inputId: 'input-live', contract: spec.contract, text: 'live dual client', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const facts = []
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })

  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 300 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  log.begin('B27-LIVE-RUNNER-PUBLISHES-ENDPOINT', 'the spawned Runner child serves its own endpoint', 'controlled_process')
  log.evidence({ runnerPid: runner.pid, registered: Boolean(registered) })
  if (registered) log.pass(`the spawned Runner published an authenticated endpoint with pinned dev/ino (pid ${runner.pid})`)
  else log.fail('the Runner published no endpoint')

  await runner.command(makeCommand('begin', { inputRef: 'input-live', preparedPolicyRef: spec.policySnapshotRef }))
  // The fixture driver records a fact when the attempt starts; a delivered turn records more of them.
  await new Promise(resolve => setTimeout(resolve, 300))
  try { await runner.command(makeCommand('deliver', { inputRef: 'input-live' })) } catch {}
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && facts.length < 2) await new Promise(resolve => setTimeout(resolve, 50))
  log.begin('B27-LIVE-REAL-JOURNAL-FACTS', 'the Runner recorded its own facts', 'controlled_process')
  log.evidence({ factCount: facts.length, kinds: facts.map(fact => fact.kind) })
  if (facts.length >= 1) log.pass(`the Runner recorded ${facts.length} real fact(s) of its own (${facts.map(fact => fact.kind).join(', ')})`)
  else log.fail(`the Runner recorded too few facts: ${facts.length}`)

  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const A = connectRunnerRecovery(registered, { attempt, ...producer }, 3000)
  const B = connectRunnerRecovery(registered, { attempt, ...producer }, 3000)

  log.begin('B27-LIVE-A-READS-ORIGINAL-IDS', 'client A reads the original fact ids from the live Runner', 'controlled_process')
  const aPage = await A.facts(0, 16_384)
  const aIds = aPage.frames.map(frame => frame.fact?.factId)
  log.evidence({ frames: aPage.frames.length, aIds })
  if (aIds.length >= 1 && aIds.every(id => typeof id === 'string')) log.pass(`client A read ${aIds.length} fact(s) by their original ids from the live Runner journal`)
  else log.fail(`client A read no usable facts: ${JSON.stringify(aIds)}`)

  log.begin('B27-LIVE-B-REPLAYS-SAME-IDS-AFTER-A-LEAVES', 'client B replays the same original ids', 'controlled_process')
  const aLease = await A.channelNext('lease-live-a')
  const bLease = await B.channelNext('lease-live-b')
  const bPage = await B.facts(0, 16_384)
  const bIds = bPage.frames.map(frame => frame.fact?.factId)
  log.evidence({ aLease: aLease?.generation ?? null, bLease: bLease?.generation ?? null, sameIds: JSON.stringify(aIds) === JSON.stringify(bIds), bIds })
  if (JSON.stringify(aIds) === JSON.stringify(bIds) && bIds.length >= 1) log.pass(`client B replayed the same ${bIds.length} original fact id(s) from the same Runner after A left`)
  else log.fail(`client B did not replay the same ids: ${JSON.stringify({ aIds, bIds })}`)

  log.begin('B27-LIVE-OLD-CLIENT-REFUSED', 'the previous client cannot answer for the new lease', 'controlled_process')
  let stale = null
  try { stale = await A.channelReply('lease-live-a', { id: 'no-such-request', kind: 'write-admission', value: true }) }
  catch (error) { stale = { error: String(error?.message ?? error).slice(0, 90) } }
  log.evidence({ stale })
  if (stale?.error || stale?.accepted === false) log.pass('a reply from the previous lease was refused on the live Runner')
  else log.fail(`the previous lease still answered: ${JSON.stringify(stale)}`)

  log.begin('B27-LIVE-INSPECT-STILL-AUTHENTICATED', 'inspection still requires the registered producer', 'controlled_process')
  const inspection = await B.inspect()
  log.evidence({ state: inspection.inspection.state, attemptId: inspection.inspection.attempt.attemptId })
  if (inspection.inspection.attempt.attemptId === spec.attemptId) log.pass(`inspection returned the same attempt ${spec.attemptId} for the live Runner`)
  else log.fail(`inspection returned another attempt: ${inspection.inspection.attempt.attemptId}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'fixture driver; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 live dual client', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fixture driver process; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(46)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-live totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
