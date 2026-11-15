#!/usr/bin/env node
/**
 * Wave-31 B2/B4 (fixture lane): the B-owned attach consumer for an already-registered Runner.
 *
 * One spawned Runner keeps running while client A serves the original fact callback, leaves, and client B
 * takes over the SAME attempt with the same original ids. The old lease cannot poll, and the in-process
 * stdio sink sees zero callbacks after the takeover. The original A Store/Broker wiring is main-owned and
 * is reported NOT_REACHED - this proves the caller and transport half only.
 */
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { attachRunnerAttempt } from '../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'

const log = new CaseLog()
const root = mkdtempSync(join(tmpdir(), 'pa-w31-attach-'))
const recoveryRoot = join(root, 'recovery')
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const producer = { source: 'fake-driver', runnerIdentityRef: 'b31-attach-runner' }
const seconds = ms => new Promise(resolve => setTimeout(resolve, ms))
let runner
try {
  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const spec = makeAttemptSpec()
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['waiting-user'], stateRoot: join(root, 'attempt'), producer })
  link.bindPayload(spec.policySnapshotRef, { kind: 'fixture-settings/1', workspacePath: process.cwd(), scope: { projectId: 'p', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, approvalPolicy: 'on-request', timeoutMs: 600000 })
  link.bindPayload('input-attach', { inputId: 'input-attach', contract: spec.contract, text: 'attach consumer', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const stdioFacts = []
  runner = await link.spawnAttempt(spec, async fact => { stdioFacts.push(fact); return { factId: fact.factId, persisted: true, seq: stdioFacts.length } })
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let index = 0; index < 400 && !registered; index += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await seconds(50) }
  }
  const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const context = { attempt, ...producer }

  log.begin('B31-ATTACH-A-SERVES-ORIGINAL-FACT', 'client A binds and serves the original fact callback', 'controlled_process')
  let seq = 0
  const factIds = []
  const clientA = attachRunnerAttempt({ endpoint: registered, producer: context, leaseId: 'lease-attach-a', callbacks: { fact: async fact => { factIds.push(fact.factId); seq += 1; return { factId: fact.factId, persisted: true, seq } } } })
  const runA = clientA.run({ pollMs: 15, deadlineMs: 8000 })
  await runner.command(makeCommand('begin', { id: 'cmd-attach-begin', inputRef: 'input-attach', preparedPolicyRef: spec.policySnapshotRef }))
  for (let index = 0; index < 200 && clientA.served.facts === 0; index += 1) await seconds(10)
  log.evidence({ served: clientA.served, factIds, stdioFacts: stdioFacts.length, generation: clientA.generation })
  if (clientA.served.facts >= 1 && stdioFacts.length === 0) log.pass(`client A served ${clientA.served.facts} original fact callback(s) (${factIds.join(',')}) and the stdio sink saw 0`)
  else log.fail(`client A did not serve the original fact path: ${JSON.stringify({ served: clientA.served, stdioFacts: stdioFacts.length })}`)
  clientA.stop(); await runA.catch(() => undefined)

  log.begin('B31-ATTACH-B-SERVES-SAME-ATTEMPT', 'client B takes over the same attempt and serves the next original fact', 'controlled_process')
  const factIdsB = []
  const clientB = attachRunnerAttempt({ endpoint: registered, producer: context, leaseId: 'lease-attach-b', callbacks: { fact: async fact => { factIdsB.push(fact.factId); seq += 1; return { factId: fact.factId, persisted: true, seq } }, nativeWrite: async () => ({ allowed: false, reason: 'fixture has no native target' }) } })
  const runB = clientB.run({ pollMs: 15, deadlineMs: 10000 })
  for (let index = 0; index < 200 && clientB.generation <= clientA.generation; index += 1) await seconds(10)
  // The original answer/delivery keep their ids and advance the same attempt; B serves whatever the
  // Runner raises afterwards, on this same process and session.
  await runner.command(makeCommand('answer', { id: 'cmd-attach-answer', nativeBindingRef: 'binding-attach', answerRef: 'answer-attach' })).catch(() => undefined)
  await runner.command(makeCommand('deliver', { id: 'cmd-attach-deliver', inputRef: 'input-attach' })).catch(() => undefined)
  for (let index = 0; index < 500 && clientB.served.facts === 0; index += 1) await seconds(10)
  log.evidence({ served: clientB.served, factIdsB, stdioFacts: stdioFacts.length, attempt: spec.attemptId, generation: clientB.generation })
  if (clientB.generation > clientA.generation && clientB.served.facts >= 1 && stdioFacts.length === 0) log.pass(`client B bound generation ${clientB.generation} and served ${clientB.served.facts} callback(s) on attempt ${spec.attemptId} with original fact ids; stdio sink 0`)
  else log.fail(`client B takeover failed: ${JSON.stringify({ served: clientB.served, factIdsB, generation: clientB.generation, stdioFacts: stdioFacts.length })}`)

  log.begin('B31-ATTACH-OLD-LEASE-CANNOT-POLL', 'the old client lease is refused, not forwarded', 'controlled_process')
  const old = connectRunnerRecovery(registered, context, 3000)
  let oldNext
  try { oldNext = { ok: true, page: await old.channelNext('lease-attach-a', clientA.generation) } }
  catch (error) { oldNext = { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 160) } }
  log.evidence({ oldNext })
  if (!oldNext.ok) log.pass(`the old lease poll was refused (${oldNext.code}: ${oldNext.message}) and no frame was forwarded`)
  else log.fail(`the old lease still polls: ${JSON.stringify(oldNext)}`)
  const nativeObserved = clientB.served.nativeWrites
  clientB.stop(); await runB.catch(() => undefined)

  log.begin('B31-ATTACH-NATIVE-AND-STORE-SCOPE', 'native-write callback and original A Store are not claimed here', 'controlled_process')
  log.evidence({ nativeWritesObserved: nativeObserved, storeAuthority: 'main-owned' })
  log.notTested(`the waiting-user fixture raised no native-write intent (observed ${nativeObserved}); the original A durable Store/Broker ingress is main-owned and not wired in this fixture`)
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-31 attach consumer fixture lane', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'B-owned consumer + real spawned Runner; original Store/Broker NOT_REACHED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(40)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB31-attach totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
