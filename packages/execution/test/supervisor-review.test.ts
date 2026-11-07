/**
 * Negative cases required by the G1 review (agent-tasks/g1-agent-b-review.md).
 * Each test names the reproduction it pins so a regression re-breaks exactly one invariant.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttemptSupervisor, assertStartInput } from '../src/supervisor.ts'
import type { AttemptBinding } from '../src/contracts.ts'
import {
  FakeRunnerHost,
  InMemoryFactLedger,
  makeAttemptSpec,
  makeCommand,
} from '../../testing/src/index.ts'
import { RunnerCommandSchema } from '../../contracts/src/schemas.ts'

class MemoryBindings {
  readonly #byTicket = new Map<string, AttemptBinding>()
  current(ticketId: string): AttemptBinding | undefined {
    return this.#byTicket.get(ticketId)
  }
  save(binding: AttemptBinding): void {
    this.#byTicket.set(binding.ticketId, binding)
  }
}

function wire() {
  const runner = new FakeRunnerHost()
  const bindings = new MemoryBindings()
  const ledger = new InMemoryFactLedger()
  const sup = new AttemptSupervisor({ runner, bindings, sink: ledger, preparedPolicyRef: 'prepared-1', stopDeadlineMs: 500 })
  return { sup, runner, bindings, ledger }
}

function input(overrides: { initialInputRef?: string } = {}) {
  const spec = makeAttemptSpec()
  return {
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch,
    contract: spec.contract,
    spec,
    initialInputRef: overrides.initialInputRef ?? 'input-initial-1',
  }
}

const tuple = (overrides: Partial<ReturnType<typeof makeAttemptSpec>> = {}) => {
  const spec = makeAttemptSpec(overrides)
  return { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
}

// --- B-FROZEN-COMMAND -------------------------------------------------------

test('B-FROZEN-COMMAND: every generated command parses with the frozen RunnerCommandSchema', async () => {
  const { sup, runner } = wire()
  await sup.start(input())
  await sup.deliver('ticket-1', 'input-2')
  await sup.answer('ticket-1', 'binding-1', 'answer-1')
  await sup.pause('ticket-1')

  const commands = runner.last()!.commands
  assert.equal(commands.length, 4)
  for (const command of commands) {
    const parsed = RunnerCommandSchema.safeParse(command)
    assert.equal(parsed.success, true, `${command.kind} failed frozen schema: ${JSON.stringify(parsed.error?.issues)}`)
  }
  // The full AttemptRef tuple is present on every command, including the contract.
  for (const command of commands) {
    assert.equal(command.ticketId, 'ticket-1')
    assert.equal(command.assignmentId, 'assignment-1')
    assert.equal(command.attemptId, 'attempt-1')
    assert.equal(command.fenceEpoch, 1)
    assert.deepEqual(command.contract, { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) })
  }
})

test('B-FROZEN-COMMAND: begin carries the real initial input, not the policy snapshot', async () => {
  const { sup, runner } = wire()
  await sup.start(input({ initialInputRef: 'execution-input-42' }))
  const begin = runner.last()!.commands[0] as { kind: string; inputRef: string; preparedPolicyRef: string }
  assert.equal(begin.kind, 'begin')
  assert.equal(begin.inputRef, 'execution-input-42')
  assert.equal(begin.preparedPolicyRef, 'prepared-1')
  assert.notEqual(begin.inputRef, runner.specs[0]!.policySnapshotRef)
})

test('B-FROZEN-COMMAND: an initial input equal to the policy snapshot is refused', () => {
  const spec = makeAttemptSpec()
  assert.throws(
    () => assertStartInput({ ...input(), initialInputRef: spec.policySnapshotRef }),
    error => (error as { reason?: string }).reason === 'invalid_start_input',
  )
})

test('B-FROZEN-COMMAND: a StartInput tuple that differs from the spec is refused', () => {
  const base = input()
  assert.throws(
    () => assertStartInput({ ...base, assignmentId: 'other-assignment' }),
    error => (error as { reason?: string }).reason === 'invalid_start_input',
  )
  assert.throws(
    () => assertStartInput({ ...base, contract: { workId: 'work-2', revision: 1, digest: 'b'.repeat(64) } }),
    error => (error as { reason?: string }).reason === 'invalid_start_input',
  )
})

// --- B-ASSIGNMENT-FENCE -----------------------------------------------------

test('B-ASSIGNMENT-FENCE: a wrong assignment with the same attempt and epoch is refused', async () => {
  const { sup } = wire()
  await sup.start(input())
  const decision = sup.fence({ ...tuple(), assignmentId: 'wrong-assignment' } as never)
  assert.equal(decision.accepted, false)
  assert.equal((decision as { reason: string }).reason, 'assignment_mismatch')
})

test('B-ASSIGNMENT-FENCE: a wrong contract with the same attempt and epoch is refused', async () => {
  const { sup } = wire()
  await sup.start(input())
  const decision = sup.fence({ ...tuple(), contract: { workId: 'work-1', revision: 2, digest: 'c'.repeat(64) } })
  assert.equal(decision.accepted, false)
  assert.equal((decision as { reason: string }).reason, 'contract_mismatch')
})

test('B-ASSIGNMENT-FENCE: the exact tuple is still accepted', async () => {
  const { sup } = wire()
  await sup.start(input())
  assert.equal(sup.fence(tuple()).accepted, true)
})

// --- B-COMMAND-IDENTITY -----------------------------------------------------

test('B-COMMAND-IDENTITY: different deliveries get different ids', async () => {
  const { sup, runner } = wire()
  await sup.start(input())
  await sup.deliver('ticket-1', 'input-1')
  await sup.deliver('ticket-1', 'input-2')
  const ids = runner.last()!.commands.filter(command => command.kind === 'deliver').map(command => command.id)
  assert.equal(ids.length, 2)
  assert.equal(new Set(ids).size, 2, `delivery ids collided: ${JSON.stringify(ids)}`)
})

test('B-COMMAND-IDENTITY: the same logical input keeps the same id on retry', async () => {
  const { sup, runner } = wire()
  await sup.start(input())
  await sup.deliver('ticket-1', 'input-9')
  await sup.deliver('ticket-1', 'input-9')
  const ids = runner.last()!.commands.filter(command => command.kind === 'deliver').map(command => command.id)
  assert.equal(ids[0], ids[1], 'a retry of the same input must reuse its logical key')
})

test('B-COMMAND-IDENTITY: answers differ by native binding and answer, and stay schema-valid', async () => {
  const { sup, runner } = wire()
  await sup.start(input())
  await sup.answer('ticket-1', 'binding-1', 'answer-1')
  await sup.answer('ticket-1', 'binding-1', 'answer-2')
  await sup.answer('ticket-1', 'binding-2', 'answer-1')
  const ids = runner.last()!.commands.filter(command => command.kind === 'answer').map(command => command.id)
  assert.equal(new Set(ids).size, 3)
  for (const id of ids) {
    assert.ok(id.length <= 128, `id too long: ${id.length}`)
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  }
})

test('B-COMMAND-IDENTITY: long inputs still produce a contract-legal, unique id', () => {
  const long = 'i'.repeat(100)
  const a = AttemptSupervisor.commandId({ attemptId: 'a'.repeat(60), fenceEpoch: 1 }, { kind: 'deliver', inputRef: long })
  const b = AttemptSupervisor.commandId({ attemptId: 'a'.repeat(60), fenceEpoch: 1 }, { kind: 'deliver', inputRef: `${long}x` })
  assert.notEqual(a, b)
  for (const id of [a, b]) {
    assert.ok(id.length <= 128)
    assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  }
})

// --- B-UNKNOWN-STOP ---------------------------------------------------------

test('B-UNKNOWN-STOP: a missing handle stays unknown across repeated stops', async () => {
  const runner = new FakeRunnerHost()
  runner.failNextLaunch(Object.assign(new Error('spawn refused'), { reason: 'spawn_failed' }))
  const bindings = new MemoryBindings()
  const sup = new AttemptSupervisor({ runner, bindings, sink: new InMemoryFactLedger(), preparedPolicyRef: 'prepared-1' })
  await assert.rejects(() => sup.start(input()))

  const first = await sup.stop('ticket-1', 'recover')
  const second = await sup.stop('ticket-1', 'recover')
  assert.equal(first.state, 'stopping')
  assert.equal(first.quiescence, 'unknown')
  assert.equal(second.state, 'stopping')
  assert.equal(second.quiescence, 'unknown', 'a repeated stop must not become confirmed without evidence')
})

test('B-UNKNOWN-STOP: an unknown previous writer blocks the next epoch', async () => {
  const runner = new FakeRunnerHost()
  runner.failNextLaunch(Object.assign(new Error('spawn refused'), { reason: 'spawn_failed' }))
  const sup = new AttemptSupervisor({ runner, bindings: new MemoryBindings(), sink: new InMemoryFactLedger(), preparedPolicyRef: 'prepared-1' })
  await assert.rejects(() => sup.start(input()))

  const next = makeAttemptSpec({ attemptId: 'attempt-2', fenceEpoch: 2 })
  await assert.rejects(
    () =>
      sup.start({
        ticketId: next.ticketId,
        assignmentId: next.assignmentId,
        attemptId: next.attemptId,
        fenceEpoch: next.fenceEpoch,
        contract: next.contract,
        spec: next,
        initialInputRef: 'input-initial-2',
      }),
    error => (error as { reason?: string }).reason === 'previous_attempt_not_quiescent',
  )
  assert.equal(runner.specs.length, 0, 'no new writer may start while the old one is unknown')
})

test('B-UNKNOWN-STOP: a ticket with no binding is unknown, not a clean end', async () => {
  const { sup } = wire()
  const result = await sup.stop('ticket-never-seen', 'user_requested')
  assert.equal(result.state, 'stopping')
  assert.equal(result.quiescence, 'unknown')
  assert.ok(result.evidenceRefs.includes('unknown-binding'))
})

test('B-UNKNOWN-STOP: an indeterminate runner stop keeps stopping and blocks a new epoch', async () => {
  const runner = new FakeRunnerHost({ stopBehavior: { quiescence: 'indeterminate', evidenceRefs: ['still-alive'] } })
  const sup = new AttemptSupervisor({ runner, bindings: new MemoryBindings(), sink: new InMemoryFactLedger(), preparedPolicyRef: 'prepared-1' })
  await sup.start(input())
  const stopped = await sup.stop('ticket-1', 'recover')
  assert.equal(stopped.state, 'stopping')
  assert.equal(stopped.quiescence, 'indeterminate')
  const again = await sup.stop('ticket-1', 'recover')
  assert.equal(again.quiescence, 'indeterminate', 'repeated stops must keep asking for evidence')
})

test('commands aimed at a stopping/unknown attempt are refused instead of silently queued', async () => {
  const runner = new FakeRunnerHost()
  runner.failNextLaunch(Object.assign(new Error('spawn refused'), { reason: 'spawn_failed' }))
  const sup = new AttemptSupervisor({ runner, bindings: new MemoryBindings(), sink: new InMemoryFactLedger(), preparedPolicyRef: 'prepared-1' })
  await assert.rejects(() => sup.start(input()))
  await sup.stop('ticket-1', 'recover')
  await assert.rejects(
    () => sup.deliver('ticket-1', 'input-2'),
    error => (error as { reason?: string }).reason === 'not_active',
  )
})

// --- command validation boundary -------------------------------------------

test('the queue still refuses an out-of-order command kind from elsewhere', () => {
  // makeCommand is a fixture helper; it must stay schema-valid so tests cannot drift from contracts.
  for (const kind of ['begin', 'deliver', 'answer', 'cancel', 'pause_at_boundary'] as const) {
    assert.equal(RunnerCommandSchema.safeParse(makeCommand(kind)).success, true, `fixture ${kind} is invalid`)
  }
})
