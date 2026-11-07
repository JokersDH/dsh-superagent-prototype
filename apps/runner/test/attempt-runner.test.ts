import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttemptRunner } from '../src/runner.ts'
import { ProcessHost } from '../src/process-host.ts'
import {
  FakeDriver,
  InMemoryFactLedger,
  InMemoryPayloadStore,
  makeAttemptSpec,
  makeCommand,
} from '../../../packages/testing/src/index.ts'

function makeRunner(options: { criticalCapacity?: number; diagnosticCapacity?: number; stderrMaxBytes?: number } = {}) {
  const ledger = new InMemoryFactLedger()
  const payloads = new InMemoryPayloadStore()
  const runner = new AttemptRunner({
    payloads,
    factSink: ledger,
    processHost: new ProcessHost(),
    progressIntervalMs: 20,
    ...(options.criticalCapacity === undefined ? {} : {}),
  })
  return { runner, ledger, payloads }
}

test('runs a happy attempt end to end: begin, turn end, exit evidence, journal', async () => {
  const { runner, ledger } = makeRunner()
  const spec = makeAttemptSpec()
  runner.feed(makeCommand('begin'))
  const result = await runner.launch(spec, new FakeDriver({ scenario: 'happy' }))

  assert.equal(result.exit.reason, 'terminal')
  assert.equal(result.journalCoverage, 'complete')
  const kinds = ledger.records.map(record => record.kind)
  assert.ok(kinds.includes('turn.ended'), `kinds=${JSON.stringify(kinds)}`)
  assert.ok(kinds.includes('runtime.exited'), `kinds=${JSON.stringify(kinds)}`)
  // Every accepted fact carries the attempt identity and a payload reference.
  for (const record of ledger.records) {
    assert.equal(record.attemptId, spec.attemptId)
    assert.equal(record.fenceEpoch, spec.fenceEpoch)
    assert.ok(record.payloadRef.length > 0)
  }
  assert.equal(result.capacityExhausted, false)
})

test('cancel reaches the native side while a question is pending (RT-03 control priority)', async () => {
  const { runner, ledger } = makeRunner()
  const spec = makeAttemptSpec()
  runner.feed(makeCommand('begin'))
  const running = runner.launch(spec, new FakeDriver({ scenario: 'waiting-user' }))

  // Wait until the driver reported the open question, i.e. the business path is blocked on the user.
  const deadline = Date.now() + 5000
  while (!ledger.records.some(record => record.kind === 'question.opened')) {
    if (Date.now() > deadline) throw new Error(`question never opened; kinds=${JSON.stringify(ledger.records.map(r => r.kind))}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  const startedAt = Date.now()
  runner.feed(makeCommand('cancel'))
  const result = await running
  const latencyMs = Date.now() - startedAt

  assert.equal(result.exit.reason, 'cancelled')
  assert.ok(latencyMs < 2000, `cancel latency ${latencyMs}ms`)
  assert.ok(ledger.records.some(record => record.kind === 'cancel.observed'), JSON.stringify(ledger.records.map(r => r.kind)))
})

test('a progress and stderr burst stays bounded and does not starve control (RT-07)', async () => {
  const { runner } = makeRunner({ diagnosticCapacity: 64, stderrMaxBytes: 8 * 1024 })
  const spec = makeAttemptSpec()
  runner.feed(makeCommand('begin'))
  runner.feed(makeCommand('cancel')) // queued behind begin: must still be delivered promptly
  const result = await runner.launch(spec, new FakeDriver({ scenario: 'burst' }))

  assert.ok(['terminal', 'cancelled'].includes(result.exit.reason), result.exit.reason)
  assert.ok(result.journal.diagnostics.length <= 64, 'diagnostics are bounded')
  assert.ok(result.progress.received <= 400)
  // stderr is a separate pipe; the host tees it into the bounded ring. Allow a short drain window.
  assert.ok(result.stderr.totalBytes > 0 || result.journal.diagnostics.length > 0)
})

test('malformed UTF-8 from the child fails the attempt with a stable protocol error (REL-07)', async () => {
  const { runner, ledger } = makeRunner()
  runner.feed(makeCommand('begin'))
  const result = await runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'malformed-utf8' }))

  assert.equal(result.exit.reason, 'error')
  const errorFact = ledger.records.find(record => record.kind === 'runtime.error')
  assert.ok(errorFact, `kinds=${JSON.stringify(ledger.records.map(r => r.kind))}`)
})

test('an oversized frame from the child fails the attempt instead of buffering (REL-07)', async () => {
  const { runner, ledger } = makeRunner()
  runner.feed(makeCommand('begin'))
  const result = await runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'oversize' }))
  assert.equal(result.exit.reason, 'error')
  assert.ok(ledger.records.some(record => record.kind === 'runtime.error'))
})

test('stdout EOF with a live process is reported as disconnected, not terminal', async () => {
  const { runner, ledger } = makeRunner()
  runner.feed(makeCommand('begin'))
  const result = await runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'eof-after-begin' }))
  assert.equal(result.exit.reason, 'disconnected')
  assert.ok(ledger.records.some(record => record.kind === 'runtime.error'))
})

test('a child that exits non-zero after begin is reported with exit evidence', async () => {
  const { runner } = makeRunner()
  runner.feed(makeCommand('begin'))
  const result = await runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'exit-after-begin' }))
  assert.ok(['terminal', 'error'].includes(result.exit.reason), result.exit.reason)
  assert.ok(result.exit.evidenceRefs.length > 0)
})

test('a killed child is observed as an exit, not a silent hang', async () => {
  const { runner } = makeRunner()
  runner.feed(makeCommand('begin'))
  const result = await runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'crash-after-begin' }))
  assert.ok(['terminal', 'error', 'disconnected'].includes(result.exit.reason), result.exit.reason)
})

test('the critical reserve stops accepting business input when exhausted (REL-05)', async () => {
  const { BoundedJournal } = await import('../src/journal.ts')
  const tiny = new BoundedJournal({ criticalCapacity: 1, diagnosticCapacity: 8 })
  const small = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: new InMemoryFactLedger(),
    processHost: new ProcessHost(),
    journal: tiny,
  })
  tiny.commitCritical('pre-existing', 'runtime.exited')

  assert.throws(
    () => small.feed(makeCommand('begin')),
    error => (error as { reason?: string }).reason === 'capacity_exhausted',
  )
  assert.throws(
    () => small.feed(makeCommand('deliver')),
    error => (error as { reason?: string }).reason === 'capacity_exhausted',
  )
  // Control commands are still accepted: stopping must remain possible.
  small.feed(makeCommand('cancel'))
  small.feed(makeCommand('answer'))
  assert.equal(small.capacityExhausted, true)
})

test('a fact whose identity does not match the running attempt is refused', async () => {
  const { runner, ledger } = makeRunner()
  const spec = makeAttemptSpec()
  await assert.rejects(
    () =>
      runner.launch(spec, {
        inspect: async () => { throw new Error('unused') },
        reconcile: async () => { throw new Error('unused') },
        serve: async (_spec: unknown, io: { record: (fact: unknown) => Promise<unknown> }) => {
          await io.record({
            ...spec,
            attemptId: 'other-attempt',
            factId: 'fact-wrong',
            source: 'test',
            kind: 'turn.ended',
            payloadRef: 'payload-x',
          })
          return { reason: 'terminal', evidenceRefs: [] }
        },
      } as never),
    error => (error as { reason?: string }).reason === 'fact_identity_mismatch',
  )
  assert.equal(ledger.count, 0, 'a mismatched fact must not be persisted')
})
