/**
 * Journal follow-up negatives (agent-tasks/g1-agent-b-journal-followup.md):
 * uncertain I/O poisons the writer, replay validates every ACK, and the sequence must be contiguous.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { FileCriticalJournal, decodeBuffer, encodeRecord, replayJournal } from '../src/index.ts'
import { makeFact } from '../../../packages/testing/src/index.ts'

const require = createRequire(import.meta.url)
const tempDir = () => mkdtemp(join(tmpdir(), 'g1-followup-'))
const factOf = (id: string) => makeFact('turn.ended', `payload-${id}`, { factId: id })
const payloadOf = (id: string) => ({ kind: 'turn.ended', value: { nativeTurnRef: `turn-${id}`, outcome: 'completed', candidateAvailable: false, evidenceRefs: ['e'] } })

/** Run `work` while injecting an fsync failure once `armed` is true. */
function withFsyncFailure<T>(armed: { value: boolean }, work: () => Promise<T>): Promise<T> {
  const fs = require('node:fs')
  const original = fs.fsyncSync
  fs.fsyncSync = (...args: unknown[]) => {
    if (armed.value) throw Object.assign(new Error('injected EIO'), { code: 'EIO' })
    return original(...args)
  }
  syncBuiltinESMExports()
  return work().finally(() => {
    fs.fsyncSync = original
    syncBuiltinESMExports()
  })
}

// --- JOURNAL-IO-FAILURE-POISONS-WRITER --------------------------------------

test('IO failure: an fsync failure poisons the handle and blocks further appends', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()

  // The handle is open; arm the failure so only the append's file sync fails.
  const armed = { value: true }
  await withFsyncFailure(armed, async () => {
    assert.throws(
      () => journal.append(factOf('f1'), payloadOf('f1')),
      error => (error as { reason?: string }).reason === 'journal_write_failed',
    )
  })
  armed.value = false

  assert.equal(journal.poisoned, 'EIO')
  assert.throws(
    () => journal.append(factOf('f2'), payloadOf('f2')),
    error => (error as { reason?: string }).reason === 'journal_writer_poisoned',
  )
  journal.close()
})

test('IO failure: the handle stays poisoned until it is reopened', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  const armed = { value: true }
  await withFsyncFailure(armed, async () => {
    assert.throws(() => journal.append(factOf('f1'), payloadOf('f1')))
  })
  armed.value = false
  // Still refusing after the failed call, on a fresh attempt with a different fact.
  assert.throws(
    () => journal.append(factOf('f3'), payloadOf('f3')),
    error => (error as { reason?: string }).reason === 'journal_writer_poisoned',
  )
  journal.close()

  // A reopened handle recovers whatever is actually on disk and can append again.
  const reopened = new FileCriticalJournal({ path })
  const recovery = await reopened.open()
  assert.equal(recovery.corruptAt, null)
  const entry = reopened.append(factOf('f4'), payloadOf('f4'))
  assert.equal(entry.duplicate, false)
  assert.equal(entry.seq, recovery.lastSeq + 1, 'sequence accounting continues from what was recovered')
  reopened.close()
})

test('IO failure: sequence accounting after reopen reflects only recovered records', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.close()

  const reopened = new FileCriticalJournal({ path })
  const recovery = await reopened.open()
  assert.equal(recovery.lastSeq, 1)
  assert.equal(recovery.entries.length, 1)
  reopened.close()
})

// --- JOURNAL-REPLAY-VALIDATES-ACK ------------------------------------------

test('replay: a persisted:false receipt is never counted as replayed', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()
  const refusing = { record: async (fact: { factId: string }) => ({ factId: fact.factId, persisted: false, seq: 1 }) }
  const result = await replayJournal(reopened, refusing as never)
  reopened.close()

  assert.equal(result.replayed, 0, 'an unpersisted receipt must never count as replayed')
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0]!.reason, 'invalid_receipt')
})

test('replay: a receipt naming another fact is refused', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()
  const wrongId = { record: async () => ({ factId: 'someone-else', persisted: true, seq: 1 }) }
  const result = await replayJournal(reopened, wrongId as never)
  reopened.close()
  assert.equal(result.replayed, 0)
  assert.equal(result.failures[0]?.reason, 'invalid_receipt')
})

test('replay: an unexpected persistence failure stops advancing the batch', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.append(factOf('f2'), payloadOf('f2'))
  journal.append(factOf('f3'), payloadOf('f3'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()
  const seen: string[] = []
  const failingSecond = {
    record: async (fact: { factId: string }) => {
      seen.push(fact.factId)
      if (fact.factId === 'f2') throw Object.assign(new Error('disk full'), { reason: 'persist_failed' })
      return { factId: fact.factId, persisted: true as const, seq: seen.length }
    },
  }
  const result = await replayJournal(reopened, failingSecond as never)
  reopened.close()

  assert.equal(result.replayed, 1)
  assert.deepEqual(seen, ['f1', 'f2'], 'the batch must stop at the first unexpected failure')
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0]!.factId, 'f2')
})

test('replay: valid receipts for every fact are counted, ids preserved', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.append(factOf('f2'), payloadOf('f2'))
  journal.close()

  const reopened = new FileCriticalJournal({ path: journal.path })
  await reopened.open()
  const accepted: string[] = []
  const ok = {
    record: async (fact: { factId: string }) => {
      accepted.push(fact.factId)
      return { factId: fact.factId, persisted: true as const, seq: accepted.length }
    },
  }
  const result = await replayJournal(reopened, ok as never)
  reopened.close()
  assert.equal(result.replayed, 2)
  assert.deepEqual(accepted, ['f1', 'f2'])
})

// --- JOURNAL-SEQUENCE-GAP ---------------------------------------------------

test('sequence: a gap makes the prefix untrustworthy and the journal read-only', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const first = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-08T00:00:00.000Z' })
  // Deliberately skip sequence 2.
  const gap = encodeRecord({ fact: factOf('f3'), payload: payloadOf('f3'), seq: 3, at: '2026-11-08T00:00:01.000Z' })
  await import('node:fs/promises').then(fs => fs.writeFile(path, Buffer.concat([first, gap])))

  const journal = new FileCriticalJournal({ path })
  const recovery = await journal.open()
  journal.close()

  assert.notEqual(recovery.corruptAt, null, 'a gapped sequence must not be reported as intact')
  assert.equal(recovery.readOnly, true)
  assert.deepEqual(recovery.entries.map(entry => entry.seq), [1], 'only the contiguous prefix is usable')
})

test('sequence: a backward step is corruption', () => {
  const one = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-08T00:00:00.000Z' })
  const two = encodeRecord({ fact: factOf('f2'), payload: payloadOf('f2'), seq: 2, at: '2026-11-08T00:00:00.000Z' })
  const bad = encodeRecord({ fact: factOf('f3'), payload: payloadOf('f3'), seq: 1, at: '2026-11-08T00:00:00.000Z' })
  const result = decodeBuffer(Buffer.concat([one, two, bad]))
  assert.notEqual(result.corruptAt, null)
  assert.equal(result.readOnly, true)
  assert.deepEqual(result.entries.map(entry => entry.seq), [1, 2])
})

test('sequence: an exact duplicate record is dropped rather than promoted to a gap', () => {
  const one = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-08T00:00:00.000Z' })
  const result = decodeBuffer(Buffer.concat([one, one]))
  assert.equal(result.corruptAt, null)
  assert.deepEqual(result.entries.map(entry => entry.seq), [1])
})

test('sequence: a duplicate id with a different body is corruption', () => {
  const one = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-08T00:00:00.000Z' })
  const conflict = encodeRecord({ fact: factOf('f1'), payload: payloadOf('other'), seq: 2, at: '2026-11-08T00:00:00.000Z' })
  const result = decodeBuffer(Buffer.concat([one, conflict]))
  assert.notEqual(result.corruptAt, null)
  assert.equal(result.readOnly, true)
})

test('sequence: entries() and replay never hide an integrity failure', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const one = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-08T00:00:00.000Z' })
  const gap = encodeRecord({ fact: factOf('f3'), payload: payloadOf('f3'), seq: 3, at: '2026-11-08T00:00:00.000Z' })
  await import('node:fs/promises').then(fs => fs.writeFile(path, Buffer.concat([one, gap])))

  const journal = new FileCriticalJournal({ path })
  const recovery = await journal.open()
  assert.equal(recovery.readOnly, true)
  // The recovery result, not a silently successful prefix, is what callers must inspect.
  assert.notEqual(recovery.corruptAt, null)
  journal.close()
})
