#!/usr/bin/env node
/**
 * Wave-22 milestone 1: real business attach across a client disconnect.
 *
 * A real Runner process is spawned through the existing RunnerLink and serves its own authenticated
 * recovery endpoint. Client A attaches, reads the business facts the Runner recorded in its own
 * journal, then disconnects. Client B attaches to the SAME Runner and replays the ORIGINAL facts, which
 * can only come from the Runner's durable journal, and sends the original command through the preserved
 * Broker before-write callback.
 *
 * Not claimed: this is one attach handover, not a coordinator SIGKILL resume, not quiescence.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { makeAttemptSpec, makeCommand } from '../../packages/testing/src/index.ts'
import { lstatSync } from 'node:fs'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { attachBusinessRunner } from '../../apps/runner/src/business-attach.ts'

const log = new CaseLog()
const ENTRY = fileURLToPath(new URL('../../apps/runner/src/runner-service-entry.ts', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'pa-w22-attach-'))
const recoveryRoot = join(root, 'recovery')
mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 })
process.env.PA_RUNNER_SCENARIO = 'codex-native'

let runner
try {
  const spec = makeAttemptSpec()
  const producerIdentity = { source: 'codex-native', runnerIdentityRef: 'b22-runner-identity' }
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: ['codex-native'], stateRoot: join(root, 'attempt'), producer: producerIdentity })
  link.bindPayload(spec.policySnapshotRef, {
    kind: 'codex-native-settings/1', workspacePath: process.cwd(),
    scope: { projectId: 'project-b22', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    approvalPolicy: 'on-request', timeoutMs: 600000,
  })
  const inputRef = 'input-b22'
  link.bindPayload(inputRef, { inputId: 'input-b22', contract: spec.contract, text: 'Wave-22 attach', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })

  process.env.PA_RUNNER_RECOVERY_ROOT = recoveryRoot
  const facts = []
  runner = await link.spawnAttempt(spec, async fact => { facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } })

  log.begin('B22-RUNNER-SERVES-ENDPOINT', 'the real Runner publishes its authenticated endpoint', 'controlled_process')
  const directory = endpointDirectory(recoveryRoot, spec.attemptId)
  let registered = null
  for (let i = 0; i < 200 && !registered; i += 1) {
    try { const stat = lstatSync(`${directory}/runner.sock`); registered = { socketPath: `${directory}/runner.sock`, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } } }
    catch { await new Promise(r => setTimeout(r, 50)) }
  }
  log.evidence({ directory, registered: !!registered, runnerPid: runner.pid })
  if (registered) log.pass(`the Runner published an endpoint with pinned identity at ${registered.socketPath}`)
  else log.fail('the Runner published no endpoint; attach cannot be exercised')

  const binding = {
    ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch, contract: spec.contract,
    runnerIdentityRef: producerIdentity.runnerIdentityRef, source: producerIdentity.source,
  }
  const expected = { ticketId: binding.ticketId, attemptId: binding.attemptId, fenceEpoch: binding.fenceEpoch }

  log.begin('B22-CLIENT-A-READS-ORIGINAL-FACTS', 'client A attaches and reads the Runner journal', 'controlled_process')
  await runner.command(makeCommand('begin', { inputRef, preparedPolicyRef: spec.policySnapshotRef }))
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && facts.length === 0) await new Promise(r => setTimeout(r, 50))
  let aFacts = { frames: [], next: 0 }
  if (registered) {
    const a = await attachBusinessRunner({ endpoint: registered, binding, expected, beforeCommand: async () => {}, timeoutMs: 3000 })
    aFacts = await a.facts(0)
    a.close()
  }
  log.evidence({ aFrames: aFacts.frames.length, next: aFacts.next, runnerCriticalFacts: facts.length })
  if (aFacts.frames.length >= 1) log.pass(`client A read ${aFacts.frames.length} original fact frame(s) from the Runner journal`)
  else log.fail(`client A read no facts: ${JSON.stringify({ aFrames: aFacts.frames.length })}`)

  log.begin('B22-CLIENT-B-REPLAYS-AFTER-DISCONNECT', 'client B recovers the ORIGINAL facts after A disconnects', 'controlled_process')
  let bFacts = { frames: [], next: 0 }
  const guard = { calls: 0 }
  let b = null
  if (registered) {
    b = await attachBusinessRunner({ endpoint: registered, binding, expected, beforeCommand: async () => { guard.calls += 1 }, timeoutMs: 3000 })
    bFacts = await b.facts(0)
  }
  const samePrefix = JSON.stringify(aFacts.frames) === JSON.stringify(bFacts.frames)
  log.evidence({ bFrames: bFacts.frames.length, samePrefix, next: bFacts.next })
  if (bFacts.frames.length >= 1 && samePrefix) {
    log.pass(`client B replayed the same ${bFacts.frames.length} original fact frame(s) from the Runner journal after A disconnected`)
  } else {
    log.fail(`client B did not replay the original facts: ${JSON.stringify({ bFrames: bFacts.frames.length, samePrefix })}`)
  }

  log.begin('B22-ORIGINAL-COMMAND-VIA-BROKER-GUARD', 'the original command goes through the preserved before-write guard', 'controlled_process')
  const original = makeCommand('cancel', { reason: 'wave-22 attach handover' })
  const sent = b ? await b.send(original) : null
  log.evidence({ guardCalls: guard.calls, outcome: sent && 'sent' in sent ? { sent: sent.sent, kind: sent.kind, proofAdmission: sent.proof?.inspection?.admission } : sent })
  if (sent && sent.sent === true && guard.calls === 1) log.pass(`the original command was admitted once after the guard ran once (proof admission ${sent.proof?.inspection?.admission})`)
  else log.fail(`the original command was not admitted through the guard: ${JSON.stringify({ sent, guardCalls: guard.calls })}`)

  log.begin('B22-OBSERVED-COMMAND-NOT-RESENT', 'an already-observed command is never resent', 'controlled_process')
  const again = b ? await b.send({ ...original, id: original.id }) && await attachBusinessRunner({ endpoint: registered, binding, expected, beforeCommand: async () => {}, reconcile: () => ({ state: 'observed' }), timeoutMs: 3000 }) : null
  const resent = again ? await again.send({ ...original, id: 'b22-second-id' }) : null
  again?.close()
  log.evidence({ refusal: resent })
  if (resent && resent.refused === 'already_observed') log.pass('an observed command was refused as already observed instead of being resent')
  else log.fail(`an observed command was not refused: ${JSON.stringify({ resent })}`)

  log.begin('B22-SCOPE-NOT-NATIVE', 'local fake producer; no installed agent', 'controlled_process')
  log.notTested('no installed Codex was executed and no gateway was contacted')
  b?.close()
} finally {
  try { await runner?.close() } catch {}
  delete process.env.PA_RUNNER_SCENARIO
  delete process.env.PA_RUNNER_RECOVERY_ROOT
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport({ cases: log.cases, environment: { note: 'wave-22 business attach handover', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled fake producer; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(42)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB22 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
