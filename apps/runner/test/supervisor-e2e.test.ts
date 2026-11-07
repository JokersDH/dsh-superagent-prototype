/**
 * End-to-end seam test: AttemptSupervisor -> ControlledRunnerHost -> AttemptRunner -> ProcessHost
 * -> fake native agent. This is the wiring the real coordinator will use; the durable ACK, atomic
 * fence and crash recovery are still NOT_TESTED because core/storage are not wired in this batch.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttemptSupervisor } from '../../../packages/execution/src/supervisor.ts'
import type { AttemptBinding } from '../../../packages/execution/src/contracts.ts'
import { ControlledRunnerHost } from '../src/host.ts'
import { ProcessHost } from '../src/process-host.ts'
import { BoundedJournal } from '../src/journal.ts'
import {
  FakeDriver,
  InMemoryFactLedger,
  InMemoryPayloadStore,
  makeAttemptSpec,
} from '../../../packages/testing/src/index.ts'

class MemoryBindings {
  readonly #byTicket = new Map<string, AttemptBinding>()
  current(ticketId: string): AttemptBinding | undefined {
    return this.#byTicket.get(ticketId)
  }
  save(binding: AttemptBinding): void {
    this.#byTicket.set(binding.ticketId, binding)
  }
}

function wire(scenario: string) {
  const ledger = new InMemoryFactLedger()
  const payloads = new InMemoryPayloadStore()
  // Per-attempt factory: each attempt gets its own runner context (journal, stderr ring, process host).
  const host = new ControlledRunnerHost(
    spec => ({
      spec,
      options: {
        payloads,
        factSink: ledger,
        processHost: new ProcessHost(),
        journal: new BoundedJournal(),
        progressIntervalMs: 10,
      },
    }),
    () => new FakeDriver({ scenario }),
  )
  const bindings = new MemoryBindings()
  const supervisor = new AttemptSupervisor({
    runner: host,
    bindings,
    sink: ledger,
    preparedPolicyRef: 'prepared-1',
    stopDeadlineMs: 2000,
  })
  return { supervisor, host, ledger, bindings }
}

const spec = () => makeAttemptSpec()

test('a real attempt runs begin -> turn end through every layer', async () => {
  const { supervisor, ledger } = wire('happy')
  const input = {
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: spec().contract,
    spec: spec(),
    initialInputRef: 'input-initial-1',
  }
  await supervisor.start(input)
  const exit = await supervisor.waitExit('ticket-1')
  assert.equal(exit.reason, 'terminal')

  // Facts recorded by the driver itself are fenced by the Supervisor.
  const kinds = ledger.records.map(record => record.kind)
  assert.ok(kinds.includes('turn.ended'), `kinds=${JSON.stringify(kinds)}`)
  assert.ok(ledger.records.every(record => record.attemptId === 'attempt-1' && record.fenceEpoch === 1))
  assert.ok(ledger.records.every(record => record.factId.length > 0))
})

test('stop while waiting for the user proves physical quiescence', async () => {
  const { supervisor, ledger, bindings } = wire('waiting-user')
  await supervisor.start({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: spec().contract,
    spec: spec(),
    initialInputRef: 'input-initial-1',
  })

  const deadline = Date.now() + 5000
  while (!ledger.records.some(record => record.kind === 'question.opened')) {
    if (Date.now() > deadline) throw new Error(`question never opened: ${JSON.stringify(ledger.records.map(r => r.kind))}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const stopped = await supervisor.stop('ticket-1', 'user_requested')
  assert.equal(stopped.quiescence, 'confirmed', JSON.stringify(stopped.evidenceRefs))
  assert.equal(stopped.state, 'ended')
  assert.equal(bindings.current('ticket-1')?.state, 'ended')
  // Physical evidence must name the group state, not merely a leader exit.
  assert.ok(stopped.evidenceRefs.includes('group-quiescent'), JSON.stringify(stopped.evidenceRefs))
})

test('an attempt that frames garbage fails without producing business facts', async () => {
  const { supervisor, ledger } = wire('malformed-utf8')
  await supervisor.start({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: spec().contract,
    spec: spec(),
    initialInputRef: 'input-initial-1',
  })
  const exit = await supervisor.waitExit('ticket-1')
  assert.equal(exit.reason, 'error')
  assert.ok(!ledger.records.some(record => record.kind === 'turn.ended'), 'no turn.ended from a broken stream')
  assert.ok(ledger.records.some(record => record.kind === 'runtime.error'))
})

test('a fact recorded twice keeps one durable receipt (idempotent factId)', async () => {
  const { supervisor, ledger } = wire('happy')
  await supervisor.start({
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: spec().contract,
    spec: spec(),
    initialInputRef: 'input-initial-1',
  })
  await supervisor.waitExit('ticket-1')

  const duplicated = {
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    attemptId: 'attempt-1',
    fenceEpoch: 1,
    contract: { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) },
    factId: 'fact-duplicate-1',
    source: 'test',
    kind: 'turn.ended' as const,
    payloadRef: 'payload-x',
  }
  const first = await supervisor.record(duplicated, false)
  const second = await supervisor.record(duplicated, false)
  assert.deepEqual(first, second)
  assert.equal(ledger.records.filter(record => record.factId === 'fact-duplicate-1').length, 1)
})
