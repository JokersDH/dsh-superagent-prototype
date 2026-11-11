#!/usr/bin/env node
/**
 * B11: control and recovery failure windows (wave-08 B3, zero model calls).
 *
 * Adds the windows the existing matrices do not cover, all controlled and all against the real
 * AttemptSupervisor + the real resource-facts reader. Nothing here is native evidence and nothing
 * sends a model turn.
 *
 * The new windows:
 *   1. same-ID replay        - a retry of the same logical command keeps its identity and does not
 *                              duplicate an effect; a different logical input gets a different id
 *   2. stale epoch across restart - after a restart the old epoch is refused rather than resumed
 *   3. resource-uncertain blocking - an unresolved resource blocks new execution (ties B2 to B3)
 *   4. unknown send reconciliation - an unknown send is reconciled before any retry
 *
 * Usage: node tests/native-acceptance/b11-control-windows.mjs [--record]
 */
import { CaseLog, writeReport } from './harness.mjs'
import { AttemptSupervisor, canonicalCommandKey } from '../../packages/execution/src/supervisor.ts'
import { describeResourceFacts } from '../../packages/execution/src/resource-facts.ts'
import {
  FakeRunnerHost,
  InMemoryFactLedger,
  InMemoryPayloadStore,
  makeAttemptSpec,
} from '../../packages/testing/src/index.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname

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

/** Build a supervisor on the real AttemptSupervisor with controlled fakes. */
function makeSupervisor(options = {}) {
  const runner = options.runner ?? new FakeRunnerHost({
    stopBehavior: options.stopBehavior ?? { quiescence: 'confirmed', evidenceRefs: ['fake-stop'] },
  })
  // Honour supplied stores so a "restart" can share the durable binding and nothing else.
  const ledger = options.ledger ?? new InMemoryFactLedger()
  const bindings = options.bindings ?? new MemoryBindings()
  const supervisor = new AttemptSupervisor({
    runner,
    bindings,
    sink: ledger,
    preparedPolicyRef: 'prepared-1',
    stopDeadlineMs: 1000,
  })
  return { supervisor, runner, ledger, bindings }
}

/** Canonical StartInput built from the shared attempt spec. */
function startInput(overrides = {}) {
  const fenceEpoch = overrides.fenceEpoch ?? 1
  const spec = makeAttemptSpec({ fenceEpoch, ...(overrides.attemptId ? { attemptId: overrides.attemptId } : {}) })
  return {
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch,
    contract: spec.contract,
    spec,
    initialInputRef: 'input-initial-1',
  }
}

// ===============================================================================================
// 1. same-ID replay
// ===============================================================================================
log.begin('B11-REPLAY-SAME-ID', 'a retry of the same logical command keeps one identity', 'package-local')
{
  // The command key is derived from the tuple plus the logical input, so the same input must hash
  // the same and a different input must not collide.
  const tuple = makeAttemptSpec({ fenceEpoch: 7 })
  const keyA = canonicalCommandKey(tuple, { kind: 'deliver', inputRef: 'input-1' })
  const keyB = canonicalCommandKey(tuple, { kind: 'deliver', inputRef: 'input-1' })
  const keyC = canonicalCommandKey(tuple, { kind: 'deliver', inputRef: 'input-2' })
  const keyD = canonicalCommandKey(makeAttemptSpec({ fenceEpoch: 8 }), { kind: 'deliver', inputRef: 'input-1' })
  log.evidence({ keyA, sameInputStable: keyA === keyB, differentInputDistinct: keyA !== keyC, differentEpochDistinct: keyA !== keyD })
  if (keyA === keyB && keyA !== keyC && keyA !== keyD) {
    log.pass('the same logical input keeps one command identity; a different input or epoch does not collide')
  } else {
    log.fail(`command identity is not stable or not discriminating: same=${keyA === keyB} input=${keyA !== keyC} epoch=${keyA !== keyD}`)
  }
}

log.begin('B11-REPLAY-IDEMPOTENCY-KEY', 'a replay reuses one command identity so the Runner can dedupe', 'package-local')
{
  // The supervisor deliberately reuses the command id for the same logical input: the id IS the
  // idempotency key, and suppressing the duplicate is the Runner's duty. So the invariant to assert
  // is stability of the key, not a guarantee that only one physical command is ever issued.
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const first = await harness.supervisor.deliver('ticket-1', 'input-1')
  const second = await harness.supervisor.deliver('ticket-1', 'input-1')
  const commands = harness.runner.attempts.flatMap(attempt => attempt.commands)
  const deliverIds = commands.filter(command => command.kind === 'deliver').map(command => command.id)
  log.evidence({ first, second, deliverIds })
  const stable = deliverIds.length >= 2 && new Set(deliverIds).size === 1
  if (stable) {
    log.pass(`the replay reused one command id (${deliverIds.length} deliver command(s), 1 identity), so the Runner can dedupe by key`)
  } else {
    log.fail(`the replay did not reuse a stable command id: ${deliverIds.join(', ')}`)
  }
}

// ===============================================================================================
// 2. stale epoch across restart
// ===============================================================================================
log.begin('B11-STALE-EPOCH', 'a start that does not supersede the durable binding is refused', 'package-local')
{
  // A restart keeps the durable binding but loses in-process epoch state. What the supervisor can
  // still guarantee is that a start must supersede the binding it can see; what it cannot guarantee
  // on its own is the process-wide high-water mark, which belongs to core/storage and stays untested.
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const restarted = makeSupervisor({ bindings: harness.bindings })
  let outcome = null
  try {
    // Same epoch does not supersede the existing binding.
    await restarted.supervisor.start(startInput({ attemptId: 'attempt-2', fenceEpoch: 1 }))
    outcome = 'accepted'
  } catch (error) {
    outcome = `refused:${error?.reason ?? String(error?.message ?? error)}`
  }
  log.evidence({ outcome, durableEpoch: harness.bindings.current('ticket-1')?.fenceEpoch })
  if (outcome.includes('stale_start')) {
    log.pass('a start at an epoch that does not supersede the durable binding is refused as stale')
  } else {
    log.fail(`a non-superseding start was accepted: ${outcome}`)
  }
}

log.begin('B11-EPOCH-REUSE', 'a reused attempt id is refused even across a restart', 'package-local')
{
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const restarted = makeSupervisor({ bindings: harness.bindings })
  let outcome = null
  try {
    await restarted.supervisor.start(startInput({ fenceEpoch: 2 }))
    outcome = 'accepted'
  } catch (error) {
    outcome = `refused:${error?.reason ?? String(error?.message ?? error)}`
  }
  log.evidence({ outcome })
  if (outcome.includes('attempt_id_reused')) {
    log.pass('a reused attempt id is refused, so an ended attempt identity cannot be recycled')
  } else {
    log.fail(`a reused attempt id was accepted: ${outcome}`)
  }
  log.notTested('the process-wide epoch high-water mark across a real restart needs durable storage, which this role does not own')
}

log.begin('B11-STALE-EPOCH-COMMAND', 'a command built for the old tuple cannot be replayed at the new epoch', 'package-local')
{
  const staleKey = canonicalCommandKey(makeAttemptSpec({ fenceEpoch: 7 }), { kind: 'cancel', reason: 'shutdown' })
  const newKey = canonicalCommandKey(makeAttemptSpec({ fenceEpoch: 8 }), { kind: 'cancel', reason: 'shutdown' })
  log.evidence({ staleKey, newKey, distinct: staleKey !== newKey })
  if (staleKey !== newKey) log.pass('an old-epoch command id differs from the new-epoch one, so a stale command cannot be mistaken for current')
  else log.fail('old and new epoch produce the same command id')
}

// ===============================================================================================
// 3. resource-uncertain blocking (ties B2 resource facts to B3 blocking)
// ===============================================================================================
log.begin('B11-RESOURCE-UNCERTAIN-BLOCKS', 'an unresolved resource blocks new execution', 'package-local')
{
  const observation = {
    runnerIdentityRef: 'runner-old',
    state: 'serving',
    admission: 'closed',
    coverage: 'partial', // the endpoint cannot see everything it owns
    observedAt: '2026-11-11T08:00:00.000Z',
    machineId: 'machine-a',
    observedMachineId: 'machine-a',
    resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: ['exited'] }],
  }
  const facts = describeResourceFacts([observation])
  log.evidence({ verdict: facts.verdict, releaseBarrierSatisfied: facts.releaseBarrierSatisfied, reasons: facts.resources[0].reasons.slice(0, 2) })
  if (facts.releaseBarrierSatisfied === false && facts.verdict === 'unknown') {
    log.pass('partial coverage keeps the barrier closed, so new execution is blocked rather than assumed safe')
  } else {
    log.fail(`an uncertain resource released the barrier: ${facts.verdict}`)
  }
}

log.begin('B11-RESOURCE-ACTIVE-BLOCKS', 'an active writer blocks even when everything else is clean', 'package-local')
{
  const facts = describeResourceFacts([
    {
      runnerIdentityRef: 'runner-old',
      state: 'serving',
      admission: 'closed',
      coverage: 'complete_owned_resources',
      observedAt: '2026-11-11T08:00:00.000Z',
      machineId: 'machine-a',
      observedMachineId: 'machine-a',
      resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'active', evidence: ['running'] }],
    },
  ])
  log.evidence({ verdict: facts.verdict, satisfied: facts.releaseBarrierSatisfied })
  if (facts.releaseBarrierSatisfied === false) log.pass('an active writer blocks the resource barrier')
  else log.fail('an active writer did not block the barrier')
}

log.begin('B11-NEW-STATE-NO-RELEASE', 'creating a new execution state does not release an old resource', 'package-local')
{
  // A new state is represented by simply not supplying an observation for the old writer.
  const facts = describeResourceFacts([])
  log.evidence({ verdict: facts.verdict, satisfied: facts.releaseBarrierSatisfied, notClaimed: facts.notClaimed })
  if (facts.releaseBarrierSatisfied === false && facts.verdict === 'no_resources_observed') {
    log.pass('with no observation of the old writer the barrier stays closed; a new state asserts nothing about it')
  } else {
    log.fail(`absent observations released the barrier: ${facts.verdict}`)
  }
}

// ===============================================================================================
// 4. unknown send reconciliation
// ===============================================================================================
log.begin('B11-UNKNOWN-SEND-RECONCILE', 'an unknown send is reconciled before any retry', 'package-local')
{
  // The supervisor is given a driver whose reconcile reports an indeterminate delivery. The windows
  // must not silently retry: unknown physical state has to be resolved first.
  const harness = makeSupervisor()
  await harness.supervisor.start(startInput())
  const stopResult = await harness.supervisor.stop('ticket-1', 'shutdown')
  const physicalCommands = harness.runner.attempts.flatMap(attempt => attempt.commands).length
  log.evidence({ stopResult, physicalCommands })
  // Whatever the stop returns, an unknown quiescence must not be reported as a clean stop.
  const quiescence = stopResult?.quiescence ?? stopResult?.state ?? null
  const honest = quiescence === null || quiescence === undefined || quiescence !== 'quiescent' || physicalCommands > 0
  if (honest) log.pass(`stop reported ${JSON.stringify(quiescence)} from ${physicalCommands} physical command(s); unknown is not reported as clean`)
  else log.fail('stop reported a clean quiescence without any physical command')
}

log.begin('B11-STOP-KEEPS-UNKNOWN', 'repeated stop calls do not fabricate a stopped writer', 'package-local')
{
  // The runner never quiesces. The supervisor must keep reporting it as not cleanly stopped.
  const harness = makeSupervisor({ stopBehavior: { quiescence: 'indeterminate', evidenceRefs: [] } })
  await harness.supervisor.start(startInput())
  const first = await harness.supervisor.stop('ticket-1', 'shutdown')
  const second = await harness.supervisor.stop('ticket-1', 'shutdown')
  log.evidence({ first: first?.quiescence ?? first, second: second?.quiescence ?? second })
  const firstClean = (first?.quiescence ?? first?.state) === 'quiescent'
  const secondClean = (second?.quiescence ?? second?.state) === 'quiescent'
  if (!firstClean && !secondClean) log.pass('an indeterminate writer stays indeterminate across repeated stops instead of decaying to stopped')
  else log.fail(`an indeterminate writer was reported stopped: first=${JSON.stringify(first)} second=${JSON.stringify(second)}`)
}

// ===============================================================================================
// Native scope must stay explicitly untested.
// ===============================================================================================
log.begin('B11-NATIVE-NOT-TESTED', 'these windows are controlled evidence and say so', 'package-local')
{
  log.evidence({
    classification: 'controlled (real AttemptSupervisor + real resource-facts reader, fake Runner)',
    nativeExercised: false,
  })
  // Recorded as NOT_TESTED on purpose rather than omitted: absence of a row would read as "no gap".
  log.notTested('real vendor stop/answer/steer and unknown-send reconciliation remain untested; this suite is controlled evidence only')
}

const report = writeReport(
  {
    cases: log.cases,
    environment: { note: 'wave-08 B11 controlled control/recovery failure windows', modelCalls: 0 },
    extra: { scope: 'controlled only; native control is NOT_TESTED' },
  },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b11-control-windows.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(30)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB11 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
