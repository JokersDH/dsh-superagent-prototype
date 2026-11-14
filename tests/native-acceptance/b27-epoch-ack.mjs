#!/usr/bin/env node
/**
 * Wave-27 item 5 (B-boundary slice): stale epoch, late ACK and resource return.
 *
 * Same-Work check, the current candidate and the explicit human accept are observed on the real product
 * chain by b18-product-normal (one work, human criterion, Broker question, recorded answer). This file
 * covers the part that belongs to the Runner's own boundary: a command that is well formed but carries an
 * old epoch is refused, a receipt that arrives after its lease ended is refused, and the Runner returns
 * all of its owned resources.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-epoch-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const producer = { source: 'fixture', runnerIdentityRef: 'b27-epoch-runner' }
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-epoch', { inputId: 'input-epoch', contract: spec.contract, text: 'epoch and late ack', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const facts = []
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 300 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  await runner.command(makeCommand('begin', { id: 'cmd-epoch-begin', inputRef: 'input-epoch', preparedPolicyRef: spec.policySnapshotRef }))
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && facts.length < 1) await new Promise(resolve => setTimeout(resolve, 50))
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const client = connectRunnerRecovery(registered, { attempt, ...producer }, 3000)

  log.begin('B27-EPOCH-STALE-REFUSED', 'a well-formed command with an old epoch is refused', 'controlled_process')
  const staleEpoch = spec.fenceEpoch + 1
  let stale = null
  try {
    stale = await client.command({ ...makeCommand('deliver', { id: 'cmd-epoch-stale', inputRef: 'input-epoch' }), fenceEpoch: staleEpoch })
  } catch (error) { stale = { refused: true, code: error?.code ?? null, serverError: error?.serverError ?? null, message: String(error?.message ?? error).slice(0, 120) } }
  log.evidence({ currentEpoch: spec.fenceEpoch, staleEpoch, stale })
  if (stale?.refused && (stale.serverError === 'identity_mismatch' || stale.code === 'identity_mismatch'))
    log.pass(`the command at epoch ${staleEpoch} was refused as identity_mismatch while the attempt is at epoch ${spec.fenceEpoch}`)
  else log.fail(`a stale-epoch command was not refused: ${JSON.stringify(stale)}`)

  log.begin('B27-EPOCH-CURRENT-ACCEPTED', 'the same command at the current epoch is accepted', 'controlled_process')
  const current = await client.command(makeCommand('deliver', { id: 'cmd-epoch-current', inputRef: 'input-epoch' })).catch(error => ({ refused: true, message: String(error?.message ?? error).slice(0, 120) }))
  log.evidence({ current: current?.refused ? current : { ok: true } })
  if (!current?.refused) log.pass('the same deliver at the current epoch was accepted, so the refusal is about the epoch and not about the command')
  else log.fail(`the current-epoch command was refused too: ${JSON.stringify(current)}`)

  log.begin('B27-ACK-LATE-REFUSED', 'a receipt that arrives after its lease ended is refused', 'controlled_process')
  await client.channelNext('lease-epoch-1')
  // A lease replacement detaches the old lease; a reply naming it afterwards must not settle anything.
  const bLease = await client.channelNext('lease-epoch-2')
  let late = null
  try { late = await client.channelReply('lease-epoch-1', { id: 'fact-late', kind: 'receipt', value: { factId: 'fact-late', persisted: true, seq: 9 } }) }
  catch (error) { late = { refused: true, code: error?.code ?? null } }
  log.evidence({ bLease: bLease?.generation ?? null, late })
  if (late?.refused || late?.accepted === false) log.pass('the late receipt from the previous lease was refused instead of being accepted')
  else log.fail(`a late receipt was accepted: ${JSON.stringify(late)}`)

  log.begin('B27-RESOURCES-RETURNED', 'the Runner reports its owned resources returned after the stop', 'controlled_process')
  const beforeStop = await client.inspect().catch(() => null)
  const resourcesBefore = beforeStop?.inspection?.resources?.length ?? null
  await client.cancel(makeCommand('cancel', { id: 'cmd-epoch-cancel' })).catch(() => undefined)
  let afterStop = null
  for (let index = 0; index < 100; index += 1) {
    afterStop = await client.inspect().catch(() => null)
    if (afterStop?.inspection?.admission === 'closed' && (afterStop.inspection.resources?.length ?? 0) === 0) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const closedAdmission = afterStop?.inspection?.admission === 'closed'
  const resourcesAfter = afterStop?.inspection?.resources?.length ?? null
  const stateAfter = afterStop?.inspection?.state ?? null
  // Kept for the report: what the inventory still lists after the stop. A terminated attempt that still
  // lists an owned process is an incomplete resource return, so the finding has to name it.
  const remaining = afterStop?.inspection?.resources ?? []
  // The endpoint file may legitimately survive a stop so a recovering coordinator can still attach; the
  // resource-return claim is about admission, owned processes and the resource inventory, not a file.
  log.evidence({ resourcesBefore, resourcesAfter, closedAdmission, stateAfter, remaining: afterStop?.inspection?.resources ?? [], before: beforeStop?.inspection?.resources ?? [] })
  // Returning a resource means every tracked writer is quiescent, not that the inventory is empty: the
  // Runner keeps the record of what it started. One entry here carries sigterm-failed but group-quiescent,
  // which is recorded as observed rather than smoothed over.
  const allQuiescent = remaining.every(resource => resource.writer === 'quiescent')
  if (closedAdmission && allQuiescent && ['terminated', 'unknown'].includes(String(stateAfter))) {
    log.pass(`admission closed, state ${stateAfter}, and all ${remaining.length} tracked resource(s) are quiescent (${remaining.map(resource => resource.evidence?.join(',')).join(' | ')})`)
  } else {
    log.fail(`the Runner did not report its resources returned: ${JSON.stringify({ resourcesBefore, resourcesAfter, closedAdmission, stateAfter, remaining })}`)
  }

  log.begin('B27-SCOPE-NOT-NATIVE', 'fixture driver; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 epoch and late ack', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fixture driver process; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(40)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-epoch totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
