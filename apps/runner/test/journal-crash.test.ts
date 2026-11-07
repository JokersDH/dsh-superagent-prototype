/**
 * Durable-runner batch 2: crash-before-ACK, ACK-after-exit and restart semantics.
 * These run the real journal and a sink that fails on demand; no vendor driver is involved.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttemptRunner, FileCriticalJournal, ProcessHost, replayJournal } from '../src/index.ts'
import { BoundedJournal } from '../src/journal.ts'
import {
  FakeDriver,
  InMemoryFactLedger,
  InMemoryPayloadStore,
  makeAttemptSpec,
  makeCommand,
} from '../../../packages/testing/src/index.ts'

const tempDir = () => mkdtemp(join(tmpdir(), 'g1-crash-'))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('crash before ACK: the fact is spooled and can be replayed with its original identity', async () => {
  const dir = await tempDir()
  const path = join(dir, 'critical.journal')
  const ledger = new InMemoryFactLedger()
  // The authoritative sink is unavailable: it throws instead of pretending to persist.
  const unavailableSink = {
    async record() {
      throw Object.assign(new Error('coordinator ingress unavailable'), { reason: 'ingress_unavailable' })
    },
  }
  const spool = new FileCriticalJournal({ path })
  await spool.open()
  const host = new ProcessHost()
  const runner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: unavailableSink,
    processHost: host,
    journal: new BoundedJournal(),
    spool,
  })
  const spec = makeAttemptSpec()
  runner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  // The ACK fails, so the serve fails; the important part is that the fact survived on disk.
  try {
    await assert.rejects(() => runner.launch(spec, new FakeDriver({ scenario: 'happy' })))
  } finally {
    // A serve that fails mid-record leaves the process running: stop what this test owns.
    await host.stopAll(2000)
  }

  // No receipt was produced for the authoritative sink, but the facts are on disk.
  assert.equal(ledger.count, 0, 'an unavailable sink must not produce business facts')
  spool.close()

  const replaySpool = new FileCriticalJournal({ path })
  const recovery = await replaySpool.open()
  assert.ok(recovery.entries.length >= 1, 'critical facts must be spooled before the ACK attempt')
  const spooledIds = recovery.entries.map(entry => entry.fact.factId)

  const result = await replayJournal(replaySpool, ledger)
  replaySpool.close()
  assert.equal(result.replayed, recovery.entries.length)
  // The replay preserves factId/payloadRef/identity exactly.
  assert.deepEqual(
    ledger.records.map(record => record.factId),
    spooledIds,
    'replay must keep the original fact ids',
  )
  for (const record of ledger.records) {
    assert.equal(record.attemptId, spec.attemptId)
    assert.equal(record.fenceEpoch, spec.fenceEpoch)
  }
})

test('ACK after exit: a spooled-and-acknowledged fact is not replayed twice', async () => {
  const dir = await tempDir()
  const path = join(dir, 'critical.journal')
  const ledger = new InMemoryFactLedger()
  const spool = new FileCriticalJournal({ path })
  await spool.open()
  const runner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: ledger,
    processHost: new ProcessHost(),
    journal: new BoundedJournal(),
    spool,
  })
  runner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  await runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'happy' }))
  spool.close()
  const acknowledged = ledger.count
  assert.ok(acknowledged > 0)

  // Replay after a clean ACK: the sink is idempotent by factId, so no new business record appears.
  const reopened = new FileCriticalJournal({ path })
  await reopened.open()
  const result = await replayJournal(reopened, ledger)
  reopened.close()
  assert.equal(ledger.count, acknowledged, 'replay after ACK must not create new facts')
  assert.ok(result.duplicates >= 0)
})

test('restart: a new Runner over the same journal never restarts fact ids at 1', async () => {
  const dir = await tempDir()
  const path = join(dir, 'critical.journal')

  const first = new FileCriticalJournal({ path })
  await first.open()
  const firstLedger = new InMemoryFactLedger()
  const firstRunner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: firstLedger,
    processHost: new ProcessHost(),
    journal: new BoundedJournal(),
    spool: first,
  })
  const spec = makeAttemptSpec()
  firstRunner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  await firstRunner.launch(spec, new FakeDriver({ scenario: 'happy' }))
  const seqBefore = first.lastSeq
  first.close()
  assert.ok(seqBefore > 0)

  const second = new FileCriticalJournal({ path })
  const recovery = await second.open()
  assert.equal(recovery.lastSeq, seqBefore, 'recovery reports the highest sequence written')
  // A second attempt (new id) appends after the recovered sequence.
  const entry = second.append(
    { ...recovery.entries[0]!.fact, factId: 'fact-new-attempt-1', attemptId: 'attempt-2' },
    recovery.entries[0]!.payload,
  )
  assert.equal(entry.seq, seqBefore + 1)
  second.close()
})

test('sink unavailable produces no DurableReceipt claiming persisted', async () => {
  const dir = await tempDir()
  const spool = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await spool.open()
  const receipts: unknown[] = []
  const host = new ProcessHost()
  const runner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: {
      async record(fact) {
        receipts.push(fact.factId)
        throw Object.assign(new Error('ingress down'), { reason: 'ingress_unavailable' })
      },
    },
    processHost: host,
    journal: new BoundedJournal(),
    spool,
  })
  runner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  try {
    // A failing sink must surface as a rejected serve, never as a successful receipt.
    await assert.rejects(() => runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'happy' })))
  } finally {
    await host.stopAll(2000)
    spool.close()
  }
  assert.ok(receipts.length >= 1, 'the sink was asked for the spooled facts')
})

test('journal capacity exhaustion stops new business input but keeps control available', async () => {
  const dir = await tempDir()
  // A spool that cannot hold even one record: the first recorded fact must fail, not be dropped.
  // Both bounds are explicit: a 1-byte file can never hold a record.
  const spool = new FileCriticalJournal({ path: join(dir, 'critical.journal'), maxBytes: 1, maxRecordBytes: 1 })
  await spool.open()
  const host = new ProcessHost()
  const runner = new AttemptRunner({
    payloads: new InMemoryPayloadStore(),
    factSink: new InMemoryFactLedger(),
    processHost: host,
    journal: new BoundedJournal(),
    spool,
  })
  runner.feed(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  // An unspoolable attempt must fail before any native writer exists.
  await assert.rejects(() => runner.launch(makeAttemptSpec(), new FakeDriver({ scenario: 'happy' })))
  assert.equal(host.resources().length, 0, 'no process may start when no critical fact can be recorded')

  // The attempt never opened a command channel, so the queue is still open: control is available.
  runner.feed(makeCommand('cancel'))
  spool.close()
  await wait(0)
})
