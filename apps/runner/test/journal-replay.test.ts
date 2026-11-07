/**
 * Durable-runner batch 2: file journal recovery, replay and ACK/spool separation.
 * (agent-tasks/g1-agent-b-durable-runner.md)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { FileCriticalJournal, decodeBuffer, encodeRecord, replayJournal } from '../src/index.ts'
import { DriverError } from '../../../packages/driver-kit/src/index.ts'
import { InMemoryFactLedger, makeFact } from '../../../packages/testing/src/index.ts'

const tempDir = () => mkdtemp(join(tmpdir(), 'g1-journal-'))
const fact = (id: string, overrides = {}) => makeFact('turn.ended', `payload-${id}`, { factId: id, ...overrides })
const payload = (id: string) => ({ kind: 'turn.ended', value: { nativeTurnRef: `turn-${id}`, outcome: 'completed', candidateAvailable: false, evidenceRefs: ['e'] } })

test('journal: appends facts with payloads and recovers them in order', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  journal.append(fact('f2'), payload('f2'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  const recovery = await reopened.open()
  assert.equal(recovery.entries.length, 2)
  assert.deepEqual(recovery.entries.map(entry => entry.fact.factId), ['f1', 'f2'])
  assert.deepEqual(recovery.entries[0]!.payload, payload('f1'))
  assert.equal(recovery.lastSeq, 2)
  assert.equal(recovery.partialTailBytes, 0)
  reopened.close()
})

test('journal: a new append continues the sequence instead of restarting at 1', async () => {
  const dir = await tempDir()
  const path = join(dir, 'critical.journal')
  const first = new FileCriticalJournal({ path })
  await first.open()
  first.append(fact('f1'), payload('f1'))
  first.append(fact('f2'), payload('f2'))
  first.close()

  const second = new FileCriticalJournal({ path })
  await second.open()
  const entry = second.append(fact('f3'), payload('f3'))
  assert.equal(entry.seq, 3, 'seq must continue after restart so an old factId is never reused')
  second.close()
})

test('journal: a torn tail is truncated and reported, never replayed', async () => {
  const dir = await tempDir()
  const path = join(dir, 'critical.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  journal.close()

  // Simulate a crash mid-write: append a record prefix and half a body.
  const complete = encodeRecord({ fact: fact('f2'), payload: payload('f2'), seq: 2, at: '2026-11-07T00:00:00.000Z' })
  appendFileSync(path, complete.subarray(0, Math.floor(complete.length / 2)))

  const recovered = new FileCriticalJournal({ path })
  const recovery = await recovered.open()
  assert.equal(recovery.entries.length, 1, 'only the intact record is recovered')
  assert.ok(recovery.partialTailBytes > 0)
  // Writing again must land on a clean record boundary.
  const entry = recovered.append(fact('f3'), payload('f3'))
  assert.equal(entry.seq, 2)
  recovered.close()

  const final = new FileCriticalJournal({ path })
  const finalRecovery = await final.open()
  assert.deepEqual(finalRecovery.entries.map(item => item.fact.factId), ['f1', 'f3'])
  assert.equal(finalRecovery.partialTailBytes, 0)
  final.close()
})

test('journal: a corrupt record stops recovery and is reported with its offset', async () => {
  const dir = await tempDir()
  const path = join(dir, 'critical.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  journal.close()

  // Flip one byte inside the first record body so its checksum no longer matches.
  const bytes = readFileSync(path)
  bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 0xff
  writeFileSync(path, bytes)

  const recovered = new FileCriticalJournal({ path })
  const recovery = await recovered.open()
  assert.equal(recovery.entries.length, 0)
  assert.equal(recovery.corruptAt, 0)
  recovered.close()
})

test('journal: capacity exhaustion refuses the fact instead of dropping it', async () => {
  const dir = await tempDir()
  // One record is a few hundred bytes; this bound fits a couple and then refuses.
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal'), maxBytes: 900, maxRecordBytes: 900 })
  await journal.open()
  let appended = 0
  let rejected: DriverError | undefined
  for (let index = 1; index <= 20; index += 1) {
    try {
      journal.append(fact(`f${index}`), payload(`f${index}`))
      appended += 1
    } catch (error) {
      rejected = error as DriverError
      break
    }
  }
  journal.close()
  assert.ok(rejected, 'the journal must eventually refuse')
  assert.equal(rejected.reason, 'journal_capacity_exhausted')
  assert.ok(appended > 0)
  // Everything that was accepted must still be readable.
  const reopened = new FileCriticalJournal({ path: journal.path, maxBytes: 900, maxRecordBytes: 900 })
  const recovery = await reopened.open()
  assert.equal(recovery.entries.length, appended)
  reopened.close()
})

test('journal: decodeBuffer is pure and reports each recovery state', () => {
  const line = encodeRecord({ fact: fact('f1'), payload: payload('f1'), seq: 1, at: '2026-11-07T00:00:00.000Z' })
  assert.equal(decodeBuffer(line).entries.length, 1)
  assert.equal(decodeBuffer(line.subarray(0, line.length - 10)).partialTailBytes > 0, true)
  const corrupt = Buffer.from(line)
  corrupt[20] = corrupt[20]! ^ 0xff
  assert.equal(decodeBuffer(corrupt).corruptAt, 0)
  assert.equal(decodeBuffer(Buffer.alloc(0)).entries.length, 0)
})

// --- replay -----------------------------------------------------------------

test('replay: resends only facts and is idempotent across repeated replays', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  journal.append(fact('f2'), payload('f2'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()
  const sink = new InMemoryFactLedger()

  const first = await replayJournal(reopened, sink)
  assert.equal(first.replayed, 2)
  assert.equal(sink.count, 2)

  // The sink is idempotent by factId, so a second replay must not create new business effects.
  const second = await replayJournal(reopened, sink)
  assert.equal(second.replayed, 2)
  assert.equal(sink.count, 2, 'a replayed fact must reuse its original receipt')
  reopened.close()
})

test('replay: an exact duplicate factId is de-duplicated at append and sent once', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await journal.open()
  const first = journal.append(fact('f1'), payload('f1'))
  const second = journal.append(fact('f1'), payload('f1'))
  journal.close()

  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true, 'an identical body is idempotent, not a second record')
  assert.equal(second.seq, first.seq)

  const reopened = new FileCriticalJournal({ path: journal.path })
  const recovery = await reopened.open()
  assert.equal(recovery.entries.length, 1, 'only one immutable record exists on disk')
  const sink = new InMemoryFactLedger()
  const result = await replayJournal(reopened, sink)
  assert.equal(result.replayed, 1)
  assert.equal(sink.count, 1)
  reopened.close()
})

test('replay: a conflicting body under one factId is a failure, never a silent duplicate', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  // A different body under the same id is refused: a factId names one immutable body.
  assert.throws(
    () => journal.append(fact('f1'), { ...payload('f1'), value: { ...(payload('f1').value as object), nativeTurnRef: 'different' } }),
    error => (error as { reason?: string }).reason === 'journal_fact_conflict',
  )
  journal.close()
})

test('replay: a stale-epoch fact is refused as business, not retried', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()
  const refusingSink = {
    async record() {
      throw new DriverError('state_indeterminate', 'stale_epoch', 'epoch is no longer current')
    },
  }
  const result = await replayJournal(reopened, refusingSink)
  assert.equal(result.refused, 1)
  assert.equal(result.failures.length, 0, 'a stale epoch is not an unexplained failure')
  reopened.close()
})

test('replay: never issues a begin or other native command', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'critical.journal') })
  await journal.open()
  journal.append(fact('f1'), payload('f1'))
  journal.close()
  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()

  const commands: unknown[] = []
  const sink = {
    async record() {
      // A replay must not touch any command channel; there is none in scope at all.
      commands.push('record')
      return { factId: 'f1', persisted: true as const, seq: 1 }
    },
  }
  await replayJournal(reopened, sink)
  assert.deepEqual(commands, ['record'])
  reopened.close()
})
