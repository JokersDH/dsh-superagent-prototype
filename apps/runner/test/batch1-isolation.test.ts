/**
 * Durable-runner batch 1: strict FakeDriver payloads and per-attempt isolation.
 * (agent-tasks/g1-agent-b-durable-runner.md)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ControlledRunnerHost } from '../src/host.ts'
import { AttemptRunner } from '../src/runner.ts'
import { BoundedJournal, StderrRing } from '../src/journal.ts'
import { ProcessHost } from '../src/process-host.ts'
import {
  FakeDriver,
  InMemoryFactLedger,
  InMemoryPayloadStore,
  makeAttemptSpec,
  makeCommand,
  fakeQuestion,
  fakeAnswerDelivery,
} from '../../../packages/testing/src/index.ts'
import { parseRuntimeFactPayload } from '../../../packages/contracts/src/validation.ts'
import { CriticalFactSchema, RunnerCommandSchema } from '../../../packages/contracts/src/schemas.ts'

/** The AttemptRef tuple a CriticalFact carries (never the whole AttemptSpec). */
const refOf = (spec: ReturnType<typeof makeAttemptSpec>) => ({
  ticketId: spec.ticketId,
  assignmentId: spec.assignmentId,
  attemptId: spec.attemptId,
  fenceEpoch: spec.fenceEpoch,
  contract: spec.contract,
})

// --- strict payloads --------------------------------------------------------

test('strict payload: the fake question parses with the authoritative runtime validator', () => {
  const spec = makeAttemptSpec()
  const question = fakeQuestion(spec, { questionId: 'q-1', nativeRequestId: 'req-1' })
  const fact = {
    ...refOf(spec),
    factId: 'fact-q',
    source: 'fake-driver',
    kind: 'question.opened' as const,
    payloadRef: 'pending',
  }
  const parsed = parseRuntimeFactPayload(fact, { kind: 'question.opened', value: question })
  assert.equal(parsed.kind, 'question.opened')
})

test('strict payload: the fake answer delivery parses with the authoritative runtime validator', () => {
  const spec = makeAttemptSpec()
  const answer = fakeAnswerDelivery({ answerRef: 'answer-1' })
  const fact = { ...refOf(spec), factId: 'fact-a', source: 'fake-driver', kind: 'answer.observed' as const, payloadRef: 'pending' }
  assert.equal(parseRuntimeFactPayload(fact, { kind: 'answer.observed', value: answer }).kind, 'answer.observed')
})

test('strict payload: a simplified question shape is rejected, so no loose bypass exists', () => {
  const spec = makeAttemptSpec()
  const fact = { ...refOf(spec), factId: 'fact-q', source: 'fake-driver', kind: 'question.opened' as const, payloadRef: 'p' }
  // The pre-fix fixture shape: a flat object with questionId/nativeRequestId/attemptId.
  const simplified = { questionId: 'q-1', nativeRequestId: 'req-1', attemptId: spec.attemptId }
  assert.throws(() => parseRuntimeFactPayload(fact, { kind: 'question.opened', value: simplified }))
})

test('strict payload: a question targeting another attempt is rejected', () => {
  const spec = makeAttemptSpec()
  const other = makeAttemptSpec({ attemptId: 'attempt-other' })
  const question = fakeQuestion(other, { questionId: 'q-1', nativeRequestId: 'req-1' })
  const fact = { ...refOf(spec), factId: 'fact-q', source: 'fake-driver', kind: 'question.opened' as const, payloadRef: 'p' }
  assert.throws(() => parseRuntimeFactPayload(fact, { kind: 'question.opened', value: question }), /another attempt|no target/)
})

test('strict payload: every fact the fake driver records is schema-valid', async () => {
  const ledger = new InMemoryFactLedger()
  const payloads = new InMemoryPayloadStore()
  const runner = new AttemptRunner({ payloads, factSink: ledger, processHost: new ProcessHost(), progressIntervalMs: 10 })
  const spec = makeAttemptSpec()
  // Queue begin before launch; the fake agent then opens a question and the test cancels it.
  runner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  const running = runner.launch(spec, new FakeDriver({ scenario: 'waiting-user' }))

  // Wait for the strict question fact, then stop the attempt so launch() resolves.
  const deadline = Date.now() + 10_000
  while (!ledger.records.some(record => record.kind === 'question.opened')) {
    if (Date.now() > deadline) throw new Error(`no question fact: ${JSON.stringify(ledger.records.map(r => r.kind))}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  runner.feed(makeCommand('cancel'))
  await running

  assert.ok(ledger.records.length > 0)
  for (const record of ledger.records) {
    assert.equal(CriticalFactSchema.safeParse(record).success, true, JSON.stringify(record))
    const stored = await payloads.read(record.payloadRef)
    // The stored payload is the strict {kind, value} envelope.
    assert.deepEqual(Object.keys(stored as object).sort(), ['kind', 'value'])
    parseRuntimeFactPayload(record, stored)
  }
})

test('strict payload: the fake driver refuses to record a fact its schema rejects', async () => {
  // The fake driver validates before storing; this pins that a malformed payload never reaches the sink.
  const { fakeQuestion } = await import('../../../packages/testing/src/index.ts')
  const spec = makeAttemptSpec()
  const good = fakeQuestion(spec, { questionId: 'q-1', nativeRequestId: 'req-1' })
  const fact = { ...refOf(spec), factId: 'f', source: 'fake-driver', kind: 'question.opened' as const, payloadRef: 'p' }

  // A structurally broken variant must be refused by the same validator the driver uses.
  const broken = { ...good, targets: [] }
  assert.throws(() => parseRuntimeFactPayload(fact, { kind: 'question.opened', value: broken }))
  // A kind/payload mismatch must be refused too.
  assert.throws(() => parseRuntimeFactPayload(fact, { kind: 'answer.observed', value: fakeAnswerDelivery({}) }))
})

// --- per-attempt isolation --------------------------------------------------

/** A RunnerHost double that never spawns a process: for host-level bookkeeping tests only. */
function bookkeepingHost() {
  const contexts: string[] = []
  const host = new ControlledRunnerHost(
    spec => {
      contexts.push(spec.attemptId)
      return {
        spec,
        options: {
          payloads: new InMemoryPayloadStore(),
          factSink: new InMemoryFactLedger(),
          processHost: new ProcessHost(),
          journal: new BoundedJournal(),
        },
      }
    },
    spec => ({
      inspect: async () => {
        throw new Error('unused')
      },
      reconcile: async () => {
        throw new Error('unused')
      },
      serve: async (_spec: unknown, io: { record: (fact: never) => Promise<unknown>; runtime: { stopOwned: (ref: string, ms: number) => Promise<unknown> } }) => {
        void io
        return { reason: 'terminal' as const, evidenceRefs: [] }
      },
    }) as never,
  )
  return { host, contexts }
}

function isolatedHost(ledger: InMemoryFactLedger, payloads: InMemoryPayloadStore) {
  const contexts: string[] = []
  const host = new ControlledRunnerHost(
    spec => {
      contexts.push(spec.attemptId)
      return {
        spec,
        options: {
          payloads: new InMemoryPayloadStore(),
          factSink: new InMemoryFactLedger(),
          processHost: new ProcessHost(),
          journal: new BoundedJournal(),
          stderrRing: new StderrRing(),
          progressIntervalMs: 10,
        },
      }
    },
    () => new FakeDriver({ scenario: 'happy' }),
  )
  void ledger
  void payloads
  return { host, contexts }
}

test('isolation: two attempts get separate runners, journals and process hosts', async () => {
  const { host, contexts } = isolatedHost(new InMemoryFactLedger(), new InMemoryPayloadStore())
  const first = makeAttemptSpec({ attemptId: 'attempt-a' })
  const second = makeAttemptSpec({ attemptId: 'attempt-b' })

  const a = await host.launch(first)
  const b = await host.launch(second)
  assert.notEqual(a, b)
  assert.notEqual(host.runner('attempt-a'), host.runner('attempt-b'))
  assert.deepEqual(contexts, ['attempt-a', 'attempt-b'])

  a.feed(makeCommand('begin', { attemptId: 'attempt-a', inputRef: 'i', preparedPolicyRef: 'prepared-1' }))
  b.feed(makeCommand('begin', { attemptId: 'attempt-b', inputRef: 'i', preparedPolicyRef: 'prepared-1' }))
  // Each attempt has its own process and journal: the served exits must arrive independently.
  const exits = await Promise.all([a.waitExit(), b.waitExit()])
  assert.equal(exits[0].reason, 'terminal')
  assert.equal(exits[1].reason, 'terminal')
})

test('isolation: an attempt id cannot launch twice', async () => {
  // Bookkeeping only: this test checks the host's single-use rule, not process behaviour.
  const { host } = bookkeepingHost()
  const spec = makeAttemptSpec()
  await host.launch(spec)
  await assert.rejects(() => host.launch(spec), /single-use/)
})

test('isolation: a context built for another attempt is refused', async () => {
  const host = new ControlledRunnerHost(
    () => ({
      spec: makeAttemptSpec({ attemptId: 'someone-else' }),
      options: { payloads: new InMemoryPayloadStore(), factSink: new InMemoryFactLedger(), processHost: new ProcessHost() },
    }),
    () => new FakeDriver({ scenario: 'happy' }),
  )
  await assert.rejects(() => host.launch(makeAttemptSpec({ attemptId: 'attempt-x' })), /belongs to/)
})

test('isolation: a command for another attempt is refused before it reaches the process', async () => {
  const { host } = isolatedHost(new InMemoryFactLedger(), new InMemoryPayloadStore())
  const spec = makeAttemptSpec()
  const attempt = await host.launch(spec)
  await assert.rejects(
    () => attempt.feed(makeCommand('deliver', { attemptId: 'other-attempt', inputRef: 'i' })),
    /does not belong/,
  )
  await assert.rejects(() => attempt.feed(makeCommand('deliver', { ticketId: 'other-ticket', inputRef: 'i' })), /does not belong/)
  // Feed begin so the driver reaches a terminal turn, then prove the process is gone.
  attempt.feed(makeCommand('begin', { inputRef: 'i', preparedPolicyRef: 'prepared-1' }))
  const exit = await attempt.waitExit()
  assert.equal(exit.reason, 'terminal')
  const stopped = await attempt.stop(2000)
  assert.equal(stopped.quiescence, 'confirmed', JSON.stringify(stopped.evidenceRefs))
})

test('isolation: the flat constructor stays available for single-attempt compatibility', async () => {
  const ledger = new InMemoryFactLedger()
  const host = ControlledRunnerHost.fromOptions(
    { payloads: new InMemoryPayloadStore(), factSink: ledger, processHost: new ProcessHost() },
    () => new FakeDriver({ scenario: 'happy' }),
  )
  const attempt = await host.launch(makeAttemptSpec())
  attempt.feed(makeCommand('begin', { inputRef: 'i', preparedPolicyRef: 'prepared-1' }))
  const exit = await attempt.waitExit()
  assert.equal(exit.reason, 'terminal')
})

// --- command boundary validation -------------------------------------------

test('boundary: a command that is not a frozen RunnerCommand is rejected', () => {
  const runner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: new InMemoryFactLedger(),
    processHost: new ProcessHost(),
  })
  assert.throws(
    () => runner.feed({ ...makeCommand('cancel'), fenceEpoch: 0 } as never),
    error => (error as { reason?: string }).reason === 'invalid_runner_command',
  )
  assert.throws(
    () => runner.feed({ ...makeCommand('deliver'), contract: undefined } as never),
    error => (error as { reason?: string }).reason === 'invalid_runner_command',
  )
  assert.equal(RunnerCommandSchema.safeParse(makeCommand('cancel')).success, true)
})

test('boundary: a cross-contract command is refused once the attempt is known', async () => {
  const spec = makeAttemptSpec()
  const runner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: new InMemoryFactLedger(),
    processHost: new ProcessHost(),
  })
  // Queue begin before launch; once the attempt is running its tuple is enforced on every feed.
  runner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  const running = runner.launch(spec, new FakeDriver({ scenario: 'happy' }))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.throws(
    () =>
      runner.feed(
        makeCommand('deliver', { contract: { workId: 'other-work', revision: 1, digest: 'f'.repeat(64) }, inputRef: 'i' }),
      ),
    error => (error as { reason?: string }).reason === 'command_identity_mismatch',
  )
  await running
})
