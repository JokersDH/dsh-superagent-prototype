#!/usr/bin/env node
/**
 * Wave-27 item 4: a real coordinator process is SIGKILLed and a NEW PID resumes from the same
 * registration, while the Runner itself keeps running.
 *
 * The Runner is spawned once by this harness and publishes its own authenticated endpoint. Coordinator
 * A is a separate OS process that attaches, reads the facts and leaves a registration behind. A is
 * killed with SIGKILL; coordinator B is a different PID that reads only that registration, attaches to
 * the same Runner and continues with the ORIGINAL command ids. The begin window stays closed, so a
 * repeated begin is refused instead of replayed, and the re-fed deliver keeps its original id.
 */
import { spawn } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w27-sigkill-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const CHILD = fileURLToPath(new URL('./b27-coordinator-child.mjs', import.meta.url))
const producer = { source: 'fixture', runnerIdentityRef: 'b27-sigkill-runner' }
let runner
let childA
let childB
const runChild = (mode, registration) => new Promise(resolve => {
  const child = spawn(process.execPath, [CHILD], { env: { ...process.env, PA_W27_REGISTRATION: registration, PA_W27_MODE: mode }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.stderr.on('data', () => {})
  child.on('exit', (code, signal) => resolve({ pid: child.pid, code, signal, report: (() => { try { return JSON.parse(out.trim().split('\n').pop()) } catch { return null } })() }))
  if (mode === 'probe') { childA = child; setTimeout(() => { try { process.kill(child.pid, 'SIGKILL') } catch {} }, 1200) }
  else childB = child
})
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  // The chain claim is about ACTUAL receptions, so the receiver log has to be on.
  process.env.PA_RUNNER_RECEIVER_LOG = join(root, 'receiver.jsonl')
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-sigkill', { inputId: 'input-sigkill', contract: spec.contract, text: 'resume after coordinator kills', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const facts = []
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })
  const runnerPid = runner.pid
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 300 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(resolve => setTimeout(resolve, 50)) }
  }
  log.begin('B27-SIGKILL-RUNNER-REGISTERED', 'the Runner is registered before any coordinator dies', 'controlled_process')
  log.evidence({ runnerPid, registered: Boolean(registered) })
  if (registered) log.pass(`Runner pid ${runnerPid} published a pinned endpoint that outlives its coordinators`)
  else log.fail('the Runner published no endpoint')

  await runner.command(makeCommand('begin', { id: 'cmd-begin-original', inputRef: 'input-sigkill', preparedPolicyRef: spec.policySnapshotRef }))
  await new Promise(resolve => setTimeout(resolve, 300))
  await runner.command(makeCommand('deliver', { id: 'cmd-deliver-original', inputRef: 'input-sigkill' })).catch(() => undefined)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && facts.length < 2) await new Promise(resolve => setTimeout(resolve, 50))

  const registrationPath = join(root, 'registration.json')
  writeFileSync(registrationPath, JSON.stringify({
    ...registered, attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract },
    runnerIdentityRef: producer.runnerIdentityRef, source: producer.source,
    beginCommandId: 'cmd-begin-original', deliverCommandId: 'cmd-deliver-original',
    inputRef: 'input-sigkill', policySnapshotRef: spec.policySnapshotRef,
  }), { mode: 0o600 })

  log.begin('B27-SIGKILL-COORDINATOR-A-OBSERVES', 'coordinator A reads the original attempt before dying', 'controlled_process')
  const a = await runChild('probe', registrationPath)
  const aReport = a.report ?? {}
  log.evidence({ pid: a.pid, signal: a.signal, attemptId: aReport.inspect?.attemptId ?? null, fenceEpoch: aReport.inspect?.fenceEpoch ?? null, factIds: aReport.factIds })
  if (aReport.inspect?.attemptId === spec.attemptId && (aReport.factIds?.length ?? 0) >= 1) log.pass(`coordinator A (pid ${a.pid}) read attempted ${spec.attemptId} at epoch ${aReport.inspect?.fenceEpoch} with ${aReport.factIds.length} original fact ids`)
  else log.fail(`coordinator A read nothing usable: ${JSON.stringify(aReport)}`)

  log.begin('B27-SIGKILL-COORDINATOR-A-DIED', 'A was killed by SIGKILL and the Runner survived', 'controlled_process')
  const runnerStill = (() => { try { process.kill(runnerPid, 0); return true } catch { return false } })()
  log.evidence({ coordinatorPid: a.pid, killedBy: a.signal, runnerPid, runnerStill })
  if (a.signal === 'SIGKILL' && runnerStill) log.pass(`coordinator pid ${a.pid} died by SIGKILL while Runner pid ${runnerPid} kept running`)
  else log.fail(`the kill window is not what was claimed: ${JSON.stringify({ signal: a.signal, runnerStill })}`)

  log.begin('B27-SIGKILL-NEW-PID-RESUMES-SAME-REGISTRATION', 'a new coordinator PID resumes the same binding', 'controlled_process')
  const b = await runChild('resume', registrationPath)
  const bReport = b.report ?? {}
  log.evidence({ pid: b.pid, differentPid: b.pid !== a.pid, attemptId: bReport.inspect?.attemptId ?? null, fenceEpoch: bReport.inspect?.fenceEpoch ?? null, sameFactIds: JSON.stringify(aReport.factIds) === JSON.stringify(bReport.factIds) })
  const sameBinding = bReport.inspect?.attemptId === spec.attemptId && bReport.inspect?.fenceEpoch === aReport.inspect?.fenceEpoch
  if (b.pid !== a.pid && sameBinding && JSON.stringify(aReport.factIds) === JSON.stringify(bReport.factIds))
    log.pass(`new pid ${b.pid} resumed attempt ${spec.attemptId} at the same epoch ${bReport.inspect?.fenceEpoch} and re-read the same original fact ids`)
  else log.fail(`the new pid did not resume the same binding: ${JSON.stringify({ pid: b.pid, bReport })}`)

  log.begin('B27-SIGKILL-BEGIN-WINDOW-NOT-REPLAYED', 'the closed begin window refuses instead of replaying', 'controlled_process')
  const beginAgain = bReport.beginAgain ?? {}
  log.evidence({ beginAgain })
  const refusedAsDuplicate = /begin is accepted at most once|duplicate_begin|protocol_error/.test(String(beginAgain.message ?? ''))
  if (beginAgain.ok === false && refusedAsDuplicate) log.pass(`the re-fed begin with its original id was refused as duplicate_begin rather than replayed`)
  else log.fail(`the begin was replayed: ${JSON.stringify(beginAgain)}`)

  log.begin('B27-SIGKILL-DELIVER-KEEPS-ORIGINAL-ID', 'a re-fed deliver keeps its original command id', 'controlled_process')
  const deliverAgain = bReport.deliverAgain ?? {}
  log.evidence({ deliverAgain })
  if (deliverAgain.ok === true) log.pass('the re-fed deliver with id cmd-deliver-original was accepted, so the id was not replaced by a fresh one')
  else log.fail(`the deliver with its original id was not accepted: ${JSON.stringify(deliverAgain)}`)

  log.begin('B27-CHAIN-ONE-BINDING-ACROSS-KILL', 'begin, kill, resume and re-feed stay on ONE attempt', 'controlled_process')
  // One chain: the same attempt id, the same epoch, the same original command ids, and the receiver still
  // shows exactly one begin. A second attempt or a replayed begin anywhere in the chain would fail here.
  const chain = await runChild('probe', registrationPath)
  const chainReport = chain.report ?? {}
  const received = (() => { try { return readFileSync(process.env.PA_RUNNER_RECEIVER_LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) } catch { return [] } })()
  const beginReceptions = received.filter(frame => frame.kind === 'begin')
  const attemptIds = new Set([aReport.inspect?.attemptId, bReport.inspect?.attemptId, chainReport.inspect?.attemptId].filter(Boolean))
  const epochs = new Set([aReport.inspect?.fenceEpoch, bReport.inspect?.fenceEpoch, chainReport.inspect?.fenceEpoch].filter(value => value !== undefined))
  log.evidence({ pids: [a.pid, b.pid, chain.pid], attemptIds: [...attemptIds], epochs: [...epochs], beginReceptions: beginReceptions.map(frame => frame.id), sameFactsAsA: JSON.stringify(chainReport.factIds) === JSON.stringify(aReport.factIds) })
  const oneBinding = attemptIds.size === 1 && epochs.size === 1 && String([...attemptIds][0]) === String(spec.attemptId)
  // The deliberate re-feed DOES reach the receiver a second time; what must not happen is a second ADMISSION,
  // which the duplicate_begin refusal already proves. Reception count and admission count are different facts
  // and are reported as such rather than conflated.
  const duplicateRefused = /duplicate_begin|begin is accepted at most once|protocol_error/.test(String(bReport.beginAgain?.message ?? ''))
  if (oneBinding && beginReceptions.length === 2 && duplicateRefused && JSON.stringify(chainReport.factIds) === JSON.stringify(aReport.factIds)) {
    log.pass(`three coordinator PIDs saw ONE attempt ${spec.attemptId} at ONE epoch: the re-fed begin was received a second time but admitted only once (duplicate_begin), and the original fact ids were unchanged`)
  } else log.fail(`the chain did not stay on one binding: ${JSON.stringify({ attemptIds: [...attemptIds], epochs: [...epochs], beginReceptions: beginReceptions.length, duplicateRefused })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'codex-fake lane; installed Codex not executed', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} finally {
  try { if (childA && !childA.killed) childA.kill('SIGKILL') } catch {}
  try { if (childB && !childB.killed) childB.kill('SIGKILL') } catch {}
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  delete process.env.PA_RUNNER_RECEIVER_LOG
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 sigkill resume', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fixture driver process; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(48)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-sigkill totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
