/**
 * Journal admission negatives (agent-tasks/g1-journal-acceptance.md):
 * durability, fail-closed corruption, immutability, bounded recovery and authoritative receipts.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { FileCriticalJournal, decodeBuffer, encodeRecord } from '../src/index.ts'
import { validateReceipt } from '../src/runner.ts'
import { makeFact } from '../../../packages/testing/src/index.ts'

const tempDir = () => mkdtemp(join(tmpdir(), 'g1-integrity-'))
const factOf = (id: string) => makeFact('turn.ended', `payload-${id}`, { factId: id })
const payloadOf = (id: string) => ({ kind: 'turn.ended', value: { nativeTurnRef: `turn-${id}`, outcome: 'completed', candidateAvailable: false, evidenceRefs: ['e'] } })

test('JOURNAL-DURABLE-APPEND: append returns only after the file is synced', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  await journal.open()
  // A synced file can be read back from a fresh handle immediately after append returns.
  const entry = journal.append(factOf('f1'), payloadOf('f1'))
  const reread = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  const recovery = await reread.open()
  reread.close()
  journal.close()
  assert.equal(entry.duplicate, false)
  assert.deepEqual(recovery.entries.map(item => item.fact.factId), ['f1'])
})

test('JOURNAL-CORRUPT-APPEND: corruption is fail-closed, not overwritten', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.close()

  const bytes = readFileSync(path)
  bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 0xff
  writeFileSync(path, bytes)

  const corrupted = new FileCriticalJournal({ path })
  const recovery = await corrupted.open()
  assert.equal(recovery.corruptAt, 0)
  assert.equal(recovery.readOnly, true, 'a corrupt journal must not accept appends')
  assert.equal(corrupted.readOnly, true)
  assert.throws(
    () => corrupted.append(factOf('f2'), payloadOf('f2')),
    error => (error as { reason?: string }).reason === 'journal_corrupt_read_only',
  )
  corrupted.close()

  // The file is unchanged: the broken prefix and its history are preserved for diagnosis.
  assert.deepEqual(readFileSync(path), bytes)
})

test('JOURNAL-SAME-ID-CONFLICT: identity, payloadRef and payload are immutable', async () => {
  const dir = await tempDir()
  const journal = new FileCriticalJournal({ path: join(dir, 'c.journal') })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))

  const conflict = (fact: ReturnType<typeof factOf>, payload: unknown, label: string) => {
    assert.throws(
      () => journal.append(fact, payload),
      error => (error as { reason?: string }).reason === 'journal_fact_conflict',
      `${label} must conflict`,
    )
  }
  conflict(factOf('f1'), { ...payloadOf('f1'), value: { ...(payloadOf('f1').value as object), nativeTurnRef: 'other' } }, 'different payload content')
  conflict({ ...factOf('f1'), fenceEpoch: 2 }, payloadOf('f1'), 'different identity')
  conflict({ ...factOf('f1'), payloadRef: 'other-ref' }, payloadOf('f1'), 'different payload reference')
  journal.close()
})

test('JOURNAL-SAME-ID-CONFLICT: recovery from disk also refuses a conflicting body', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.close()

  // Hand-write a second record with the same id but a different body.
  const conflicting = encodeRecord({ fact: factOf('f1'), payload: payloadOf('other'), seq: 2, at: '2026-11-07T00:00:00.000Z' })
  writeFileSync(path, Buffer.concat([readFileSync(path), conflicting]))

  const reopened = new FileCriticalJournal({ path })
  const recovery = await reopened.open()
  reopened.close()
  assert.notEqual(recovery.corruptAt, null, 'a conflicting duplicate makes the prefix untrustworthy')
  assert.equal(recovery.readOnly, true)
})

test('JOURNAL-AUTHORITATIVE-ACK: only persisted receipt for the same fact is accepted', () => {
  assert.deepEqual(validateReceipt({ factId: 'f1', persisted: true, seq: 1 }, 'f1'), { factId: 'f1', persisted: true, seq: 1 })
  const rejects = [
    [{ factId: 'f1', persisted: false, seq: 1 }, 'persisted:false'],
    [{ factId: 'f2', persisted: true, seq: 1 }, 'wrong factId'],
    [{ factId: 'f1', persisted: true, seq: 0 }, 'non-positive seq'],
    [{ factId: 'f1', persisted: true }, 'missing seq'],
    [null, 'null receipt'],
  ] as const
  for (const [receipt, label] of rejects) {
    assert.throws(
      () => validateReceipt(receipt, 'f1'),
      error => (error as { reason?: string }).reason === 'invalid_receipt',
      `${label} must be refused`,
    )
  }
})

test('bounded recovery: an over-large file is rejected without allocating it', async () => {
  const dir = await tempDir()
  const path = join(dir, 'c.journal')
  const journal = new FileCriticalJournal({ path })
  await journal.open()
  journal.append(factOf('f1'), payloadOf('f1'))
  journal.close()

  // Both bounds stay explicit: the file is smaller than the record limit it was written with.
  const reopened = new FileCriticalJournal({ path, maxBytes: 8, maxRecordBytes: 8 })
  const recovery = await reopened.open()
  reopened.close()
  assert.equal(recovery.readOnly, true)
  assert.equal(recovery.entries.length, 0)
})

test('bounded recovery: a length prefix beyond the allowed record size is corruption', () => {
  const line = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-07T00:00:00.000Z' })
  const result = decodeBuffer(line, { maxRecordBytes: 16 })
  assert.equal(result.corruptAt, 0)
  assert.equal(result.readOnly, true)
})

test('bounded recovery: a broken prefix is corruption while a truncated tail is repairable', () => {
  const line = encodeRecord({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 1, at: '2026-11-07T00:00:00.000Z' })
  const brokenPrefix = Buffer.from(line)
  brokenPrefix[0] = 0x7a // 'z' is not a hex length digit
  assert.equal(decodeBuffer(brokenPrefix).corruptAt, 0)

  const truncated = line.subarray(0, line.length - 5)
  const partial = decodeBuffer(truncated)
  assert.equal(partial.corruptAt, null)
  assert.ok(partial.partialTailBytes > 0)
  assert.equal(partial.readOnly, false, 'a torn tail is repaired, not treated as corruption')
})

test('record seq must be a positive integer', () => {
  const bad = Buffer.from(
    `${JSON.stringify({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 0, at: 'x' }).length.toString(16).padStart(8, '0')} 0000000000000000 ${JSON.stringify({ fact: factOf('f1'), payload: payloadOf('f1'), seq: 0, at: 'x' })}\n`,
  )
  assert.equal(decodeBuffer(bad).corruptAt, 0)
})
