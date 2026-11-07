import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttemptSupervisor } from '../src/supervisor.ts'
import type { AttemptBinding } from '../src/contracts.ts'
import type { FakeStopBehavior } from '../../testing/src/fakes.ts'
import {
  FakeClock,
  FakeRunnerHost,
  InMemoryFactLedger,
  InMemoryPayloadStore,
  makeAttemptSpec,
  makeFact,
} from '../../testing/src/index.ts'

/** Minimal binding store: the real one belongs to core/storage. */
class MemoryBindings {
  readonly #byTicket = new Map<string, AttemptBinding>()
  current(ticketId: string): AttemptBinding | undefined {
    return this.#byTicket.get(ticketId)
  }
  save(binding: AttemptBinding): void {
    this.#byTicket.set(binding.ticketId, binding)
  }
}

function supervisor(options: { stopBehavior?: FakeStopBehavior } = {}) {
  const runner = new FakeRunnerHost({ stopBehavior: options.stopBehavior ?? { quiescence: 'confirmed', evidenceRefs: ['fake-stop'] } })
  const ledger = new InMemoryFactLedger()
  const bindings = new MemoryBindings()
  const clock = new FakeClock(1_760_000_000_000)
  const sup = new AttemptSupervisor({
    runner,
    bindings,
    sink: ledger,
    preparedPolicyRef: 'prepared-1',
    stopDeadlineMs: 1000,
    now: clock.now,
  })
  return { sup, runner, ledger, bindings, clock }
}

const startInput = (overrides: { attemptId?: string; fenceEpoch?: number; initialInputRef?: string } = {}) => {
  const attemptId = overrides.attemptId ?? 'attempt-1'
  const fenceEpoch = overrides.fenceEpoch ?? 1
  const spec = makeAttemptSpec({ attemptId, fenceEpoch })
  return {
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId,
    fenceEpoch,
    contract: spec.contract,
    spec,
    initialInputRef: overrides.initialInputRef ?? 'input-initial-1',
  }
}

test('start launches one attempt and queues begin with the prepared policy ref', async () => {
  const { sup, runner } = supervisor()
  const { binding } = await sup.start(startInput())
  assert.equal(binding.state, 'active')
  assert.equal(runner.specs.length, 1)
  const commands = runner.last()!.commands
  assert.equal(commands.length, 1)
  assert.equal(commands[0]!.kind, 'begin')
  const begin = commands[0] as Extract<typeof commands[number], { kind: 'begin' }>
  assert.equal(begin.preparedPolicyRef, 'prepared-1')
  assert.equal(begin.inputRef, 'input-initial-1', 'begin must carry the initial ExecutionInput, not the policy snapshot')
  assert.notEqual(begin.inputRef, runner.specs[0]!.policySnapshotRef)
})

test('deliver and answer are forwarded only while the binding is active', async () => {
  const { sup, runner } = supervisor()
  await sup.start(startInput())
  await sup.deliver('ticket-1', 'input-2')
  await sup.answer('ticket-1', 'binding-1', 'answer-1')
  const kinds = runner.last()!.commands.map(command => command.kind)
  assert.deepEqual(kinds, ['begin', 'deliver', 'answer'])
})

test('a fact from a superseded epoch is refused and never applied (RT-01)', async () => {
  const { sup, ledger } = supervisor()
  await sup.start(startInput({ attemptId: 'attempt-2', fenceEpoch: 2 }))

  const stale = makeFact('turn.ended', 'payload-stale', { attemptId: 'attempt-1', fenceEpoch: 1 })
  const result = await sup.record(stale)
  assert.deepEqual(result, { refused: 'attempt_mismatch' })
  assert.equal(ledger.count, 0, 'a stale fact must not reach the sink')

  const sameAttemptOldEpoch = makeFact('turn.ended', 'payload-stale', { attemptId: 'attempt-2', fenceEpoch: 1 })
  assert.deepEqual(await sup.record(sameAttemptOldEpoch), { refused: 'stale_epoch' })
  assert.equal(ledger.count, 0)

  const current = makeFact('turn.ended', 'payload-current', { attemptId: 'attempt-2', fenceEpoch: 2 })
  const receipt = await sup.record(current)
  assert.equal((receipt as { persisted: boolean }).persisted, true)
  assert.equal(ledger.count, 1)
})

test('a fact for an ended binding is refused as not_active', async () => {
  const { sup, ledger } = supervisor()
  await sup.start(startInput())
  const stopped = await sup.stop('ticket-1', 'user_requested')
  assert.equal(stopped.state, 'ended')
  assert.deepEqual(await sup.record(makeFact('turn.ended')), { refused: 'not_active' })
  assert.equal(ledger.count, 0)
})

test('an unknown binding is refused rather than created by a fact', async () => {
  const { sup, ledger } = supervisor()
  assert.deepEqual(await sup.record(makeFact('turn.ended', 'p', { ticketId: 'ticket-unseen' })), { refused: 'unknown_binding' })
  assert.equal(ledger.count, 0)
})

test('stop moves to stopping and only a physical proof ends it (RT-06)', async () => {
  const { sup, bindings, runner } = supervisor()
  await sup.start(startInput())
  const stopped = await sup.stop('ticket-1', 'user_requested')
  assert.equal(stopped.quiescence, 'confirmed')
  assert.equal(stopped.state, 'ended')
  assert.equal(bindings.current('ticket-1')?.state, 'ended')
  assert.equal(runner.last()!.stopCalls.length, 1, 'the runner was asked to prove a physical stop')
  // cancel is queued before the physical stop so the driver can acknowledge it.
  assert.ok(runner.last()!.commands.some(command => command.kind === 'cancel'))
})

test('an indeterminate physical stop keeps the binding in stopping', async () => {
  const { sup, bindings } = supervisor({ stopBehavior: { quiescence: 'indeterminate', evidenceRefs: ['still-alive'] } })
  await sup.start(startInput())
  const stopped = await sup.stop('ticket-1', 'user_requested')
  assert.equal(stopped.quiescence, 'indeterminate')
  assert.equal(stopped.state, 'stopping')
  assert.equal(bindings.current('ticket-1')?.state, 'stopping')
})

test('a new epoch refuses to start until the previous attempt is quiescent (REL-04)', async () => {
  const { sup, runner, bindings } = supervisor({ stopBehavior: { quiescence: 'indeterminate', evidenceRefs: ['still-alive'] } })
  await sup.start(startInput({ attemptId: 'attempt-1', fenceEpoch: 1 }))
  await assert.rejects(
    () => sup.start(startInput({ attemptId: 'attempt-2', fenceEpoch: 2 })),
    error => (error as { reason?: string }).reason === 'previous_attempt_not_quiescent',
  )
  assert.equal(runner.specs.length, 1, 'no second physical attempt was started')
  assert.equal(bindings.current('ticket-1')?.attemptId, 'attempt-1')
})

test('a new epoch supersedes a quiescent previous attempt', async () => {
  const { sup, runner, bindings } = supervisor()
  await sup.start(startInput({ attemptId: 'attempt-1', fenceEpoch: 1 }))
  const { binding } = await sup.start(startInput({ attemptId: 'attempt-2', fenceEpoch: 2 }))
  assert.equal(binding.attemptId, 'attempt-2')
  assert.equal(binding.fenceEpoch, 2)
  assert.equal(runner.specs.length, 2)
  assert.equal(bindings.current('ticket-1')?.fenceEpoch, 2)
})

test('a start whose epoch does not advance is refused', async () => {
  const { sup } = supervisor()
  await sup.start(startInput({ attemptId: 'attempt-1', fenceEpoch: 2 }))
  await assert.rejects(
    () => sup.start(startInput({ attemptId: 'attempt-2', fenceEpoch: 2 })),
    error => (error as { reason?: string }).reason === 'stale_start',
  )
})

test('a start that fails to launch leaves the binding active but no attempt handle', async () => {
  const { sup, runner } = supervisor()
  runner.failNextLaunch(Object.assign(new Error('spawn refused'), { reason: 'spawn_failed' }))
  await assert.rejects(() => sup.start(startInput()))
  // The Supervisor must not silently pretend the attempt is running.
  const stopped = await sup.stop('ticket-1', 'launch_failed')
  assert.equal(stopped.state, 'stopping')
  assert.equal(stopped.quiescence, 'unknown')
  assert.ok(stopped.evidenceRefs.includes('no-attempt-handle'), JSON.stringify(stopped.evidenceRefs))
  // B-UNKNOWN-STOP: repeated calls must not turn that into a confirmed end.
  const again = await sup.stop('ticket-1', 'launch_failed')
  assert.equal(again.state, 'stopping')
  assert.equal(again.quiescence, 'unknown')
})

test('an unknown send is reconciled first and never retried as same-key safe (RT-04)', async () => {
  const { sup } = supervisor()
  const result = await sup.reconcileUnknownSend({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) },
    ownership: 'spawned_process',
    runnerIdentityRef: 'runner-1',
    connectionEpoch: 1,
  })
  assert.equal(result.retry, 'reconcile_first')
  assert.equal(result.status, 'indeterminate')
})

test('stop on a ticket without a binding stays unknown, never a clean end', async () => {
  const { sup } = supervisor()
  const first = await sup.stop('ticket-none', 'user_requested')
  const second = await sup.stop('ticket-none', 'user_requested')
  assert.equal(first.state, 'stopping')
  assert.equal(first.quiescence, 'unknown')
  assert.equal(second.state, 'stopping', 'a repeated stop must not become confirmed')
  assert.equal(second.quiescence, 'unknown')
})

test('the payload store keeps critical and diagnostic refs apart and bounds capacity', async () => {
  const store = new InMemoryPayloadStore({ maxEntries: 2 })
  const critical = await store.store({ kind: 'turn.ended', value: { ok: true } }, 'critical')
  const diagnostic = await store.store({ note: 'x' }, 'diagnostic')
  assert.equal(store.classificationOf(critical), 'critical')
  assert.equal(store.classificationOf(diagnostic), 'diagnostic')
  await assert.rejects(() => store.store({ note: 'overflow' }, 'diagnostic'), error => (error as { reason?: string }).reason === 'payload_store_full')
})
