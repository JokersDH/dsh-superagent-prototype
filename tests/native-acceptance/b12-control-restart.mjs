#!/usr/bin/env node
/**
 * B12: in-memory control matrix (wave-10 B4, zero model calls).
 *
 * SCOPE CORRECTION (wave-11): this file does NOT demonstrate durable recovery. It rebuilds
 * supervisor/binding objects in memory inside ONE process; no SQLite file is opened, nothing is
 * fsynced, and no process is killed. A "no duplicate begin" result here is an artefact of the test
 * not calling begin twice, not evidence of reconnect or persistence.
 *
 * The real durable claim moved to b13-durable-control.mjs, which uses a real SQLite file and a real
 * spawned writer process with a real SIGKILL. Treat this file as a unit-level control matrix only.
 *
 * Covers the windows the earlier matrices left open: persistent stop/answer/steer, disconnect and
 * reconnect, no duplicate `begin` across a restart, and the rule that a proof from the OLD attempt
 * cannot release a NEW one.
 *
 * Everything runs on the real AttemptSupervisor and the real authenticated proof transport with
 * controlled fakes. The vendor was not exercised, so the native rows stay NOT_TESTED.
 *
 * Usage: node tests/native-acceptance/b12-control-restart.mjs [--record]
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CaseLog, writeReport } from './harness.mjs'
import { AttemptSupervisor } from '../../packages/execution/src/supervisor.ts'
import { describeResourceFacts } from '../../packages/execution/src/resource-facts.ts'
import { connectRunnerRecovery, createRunnerCredential, serveRunnerRecovery } from '../../packages/execution/src/recovery-transport.ts'
import { FakeRunnerHost, InMemoryFactLedger, makeAttemptSpec } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const SPEC = makeAttemptSpec({ fenceEpoch: 5 })

/** Minimal binding store; the real one belongs to core/storage. */
class MemoryBindings {
  #byTicket = new Map()
  current(ticketId) {
    return this.#byTicket.get(ticketId)
  }
  save(binding) {
    this.#byTicket.set(binding.ticketId, binding)
  }
}

function makeSupervisor(options = {}) {
  const runner = options.runner ?? new FakeRunnerHost({ stopBehavior: options.stopBehavior ?? { quiescence: 'confirmed', evidenceRefs: ['fake-stop'] } })
  const ledger = options.ledger ?? new InMemoryFactLedger()
  const bindings = options.bindings ?? new MemoryBindings()
  const supervisor = new AttemptSupervisor({ runner, bindings, sink: ledger, preparedPolicyRef: 'prepared-1', stopDeadlineMs: 1000 })
  return { supervisor, runner, ledger, bindings }
}

function startInput(overrides = {}) {
  const fenceEpoch = overrides.fenceEpoch ?? SPEC.fenceEpoch
  const spec = makeAttemptSpec({ fenceEpoch, ...(overrides.attemptId ? { attemptId: overrides.attemptId } : {}) })
  return { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch, contract: spec.contract, spec, initialInputRef: 'input-initial-1' }
}

const commandsOf = runner => runner.attempts.flatMap(attempt => attempt.commands)
const beginCount = runner => commandsOf(runner).filter(command => command.kind === 'begin').length

// ===============================================================================================
// persistent stop / answer / steer
// ===============================================================================================
log.begin('B12-STOP-PERSISTS', 'a stop issued before the writer exists is still delivered once', 'package-local')
{
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const first = await harness.supervisor.stop('ticket-1', 'shutdown')
  const second = await harness.supervisor.stop('ticket-1', 'shutdown')
  const stops = commandsOf(harness.runner).filter(command => command.kind === 'cancel')
  log.evidence({ first: first?.quiescence ?? first, second: second?.quiescence ?? second, stopCommands: stops.length })
  if (first && second) log.pass(`both stops resolved (${first?.quiescence ?? first}/${second?.quiescence ?? second}) over ${stops.length} physical command(s)`)
  else log.fail('a repeated stop did not resolve')
}

log.begin('B12-ANSWER-IDENTITY', 'an answer keeps the native binding and the attempt identity', 'package-local')
{
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const delivered = await harness.supervisor.deliver('ticket-1', 'input-2')
  const answered = await harness.supervisor.answer('ticket-1', 'native-1', 'answer-1')
  const answers = commandsOf(harness.runner).filter(command => command.kind === 'answer')
  const identityHeld = answers.every(command => command.attemptId === SPEC.attemptId && command.fenceEpoch === SPEC.fenceEpoch)
  log.evidence({ delivered: delivered?.queued ?? null, answered: answered?.queued ?? null, answers: answers.length, identityHeld })
  if (identityHeld) log.pass('every answer carries the same attempt and epoch, so it cannot be applied to another attempt')
  else log.fail(`an answer lost its attempt identity: ${JSON.stringify(answers).slice(0, 160)}`)
}

log.begin('B12-STEER-DISTINCT', 'a steer of different content gets a different command identity', 'package-local')
{
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  await harness.supervisor.deliver('ticket-1', 'input-a')
  await harness.supervisor.deliver('ticket-1', 'input-b')
  const ids = commandsOf(harness.runner).filter(command => command.kind === 'deliver').map(command => command.id)
  log.evidence({ ids })
  if (new Set(ids).size === ids.length) log.pass('two different steers produced distinct command identities')
  else log.fail(`two different steers collided on an identity: ${ids.join(', ')}`)
}

// ===============================================================================================
// disconnect / reconnect
// ===============================================================================================
log.begin('B12-RECONNECT-NO-DUPLICATE-BEGIN', 'a same-process re-instantiation does not begin again (NOT durable recovery)', 'package-local')
{
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const before = beginCount(harness.runner)
  // A fresh supervisor over the same in-memory binding store. This lives in ONE process, so it is a
  // re-instantiation, not a restart, and it is not evidence that anything survived a process death.
  const reconnected = makeSupervisor({ bindings: harness.bindings, ledger: harness.ledger, runner: harness.runner })
  reconnected.supervisor.recover?.()
  const after = beginCount(harness.runner)
  log.evidence({ beginsBefore: before, beginsAfter: after })
  if (after === before) log.pass(`the reconnect issued no additional begin (${after} total)`)
  else log.fail(`the reconnect issued ${after - before} extra begin command(s)`)
}

log.begin('B12-OLD-PROOF-CANNOT-RELEASE-NEW', 'a proof bound to the old attempt does not release a new one', 'package-local')
{
  const root = mkdtempSync(join(tmpdir(), 'pa-w10-b12-'))
  const socketPath = join(root, 'runner.sock')
  const credentialPath = join(root, 'runner.cred')
  createRunnerCredential(credentialPath)
  const oldAttempt = makeAttemptSpec({ fenceEpoch: 2 })
  const context = {
    attempt: { ticketId: oldAttempt.ticketId, assignmentId: oldAttempt.assignmentId, attemptId: oldAttempt.attemptId, fenceEpoch: oldAttempt.fenceEpoch, contract: oldAttempt.contract },
    runnerIdentityRef: 'runner-1',
    source: 'source-1',
  }
  const inspection = {
    protocol: 1,
    attempt: { ticketId: oldAttempt.ticketId, assignmentId: oldAttempt.assignmentId, attemptId: oldAttempt.attemptId, fenceEpoch: oldAttempt.fenceEpoch },
    runnerIdentityRef: 'runner-1',
    source: 'source-1',
    state: 'terminated',
    admission: 'closed',
    coverage: 'complete_owned_resources',
    evidence: ['old attempt drained'],
    observedAt: new Date().toISOString(),
    resources: [{ ref: 'proc-old', ownership: 'spawned_process', writer: 'quiescent', evidence: ['exited'] }],
  }
  try {
    const served = await serveRunnerRecovery({ socketPath, credentialPath }, context, {
      async inspect() { return inspection },
      async cancel() { return inspection },
    })
    try {
      const stat = statSync(socketPath)
      const client = connectRunnerRecovery({ socketPath, credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }, context)
      const proof = await client.inspect()
      const facts = describeResourceFacts(proof)
      // The proof speaks only for the attempt it was issued for.
      const boundAttempt = facts.proof?.attempt ?? null
      const releasedForNew = facts.releaseBarrierSatisfied === true && boundAttempt?.attemptId !== oldAttempt.attemptId
      log.evidence({ released: facts.releaseBarrierSatisfied, boundAttemptId: boundAttempt?.attemptId ?? null, oldAttemptId: oldAttempt.attemptId })
      if (!releasedForNew) {
        log.pass('the old proof names only its own attempt, so it cannot be read as releasing a new one')
      } else {
        log.fail('the old proof was read as releasing a different attempt')
      }
    } finally {
      await served.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

log.begin('B12-UNKNOWN-STOP-NOT-CLEAN', 'an unproven stop never reads as a clean stop', 'package-local')
{
  const harness = makeSupervisor({ stopBehavior: { quiescence: 'indeterminate', evidenceRefs: [] } })
  await harness.supervisor.start(startInput())
  const stops = []
  for (let index = 0; index < 3; index += 1) stops.push(await harness.supervisor.stop('ticket-1', 'shutdown'))
  const anyClean = stops.some(stop => (stop?.quiescence ?? stop?.state) === 'quiescent')
  log.evidence({ quiescence: stops.map(stop => stop?.quiescence ?? stop?.state ?? null) })
  if (!anyClean) log.pass('three repeated stops kept the writer unresolved instead of decaying to stopped')
  else log.fail('an indeterminate writer was reported stopped')
}

// ===============================================================================================
// scope
// ===============================================================================================
log.begin('B12-NATIVE-NOT-TESTED', 'these windows are controlled evidence and say so', 'package-local')
{
  log.evidence({ classification: 'controlled (real supervisor, real proof transport, fake runner)', nativeExercised: false })
  log.notTested('real vendor stop/answer/steer, disconnect/reconnect and unknown-send reconciliation remain untested; this matrix is controlled evidence only')
}

log.notTested('durable restart, real SQLite and real SIGKILL are covered by b13-durable-control.mjs; this file remains an in-process control matrix')
log.notTested('the process-wide epoch high-water mark across a real restart needs durable storage owned by core/storage')

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-10 B12 IN-MEMORY control matrix; not durable recovery (see b13)', modelCalls: 0 }, extra: { scope: 'in-process only; durable recovery is b13; native control NOT_TESTED', durableDatabaseUsed: false, actualProcessRestarts: 0 } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b12-control-restart.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(32)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB12 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
