/**
 * Legal zero-model journal fixture and reader contract.
 *
 * Facts are appended through the original `FileCriticalJournal` (same framing, fsync and immutable
 * identity rules the runner uses). The reader is the original `decodeBuffer`; no second journal
 * format, no receipt-only service and no product command is introduced. Negative cases are derived
 * from the legal bytes (truncate / corrupt / gap / kind mismatch / oversize / missing field) and the
 * datareader refuses a foreign source or a different attempt tuple with zero sends and zero executes.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FileCriticalJournal, decodeBuffer, encodeRecord, factDigest } from '../../../apps/runner/src/file-journal.ts'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const EVIDENCE = ['evidence:fixture-turn']
const RESOURCE = 'fixture-resource-owned'

function factFor(attempt, source, index, kind) {
  return {
    ...attempt,
    factId: `fixture-fact-${index}`,
    source,
    kind,
    payloadRef: `fixture-payload-${index}`,
  }
}

/** Append a complete legal sequence with the original journal producer. */
export async function createLegalJournal({ root, attempt, factSource, answerDelivery, artifactRef = null }) {
  const journalPath = join(root, 'journal', 'critical.ndjson')
  mkdirSync(dirname(journalPath), { recursive: true, mode: 0o700 })
  const journal = new FileCriticalJournal({ path: journalPath, now: () => '2026-01-01T00:00:00.000Z' })
  try {
    await journal.open()
    const records = [
      { fact: factFor(attempt, factSource, 1, 'turn.ended'), payload: { kind: 'turn.ended', value: { nativeTurnRef: 'fixture-native-turn-1', outcome: 'completed', candidateAvailable: true, evidenceRefs: EVIDENCE } } },
      { fact: factFor(attempt, factSource, 2, 'answer.observed'), payload: { kind: 'answer.observed', value: answerDelivery } },
      { fact: factFor(attempt, factSource, 3, 'candidate.observed'), payload: { kind: 'candidate.observed', value: { artifactRefs: artifactRef === null ? ['fixture-artifact-1'] : [artifactRef], summaryRef: 'fixture-summary-1', evidenceRefs: ['evidence:candidate'] } } },
      { fact: factFor(attempt, factSource, 4, 'runtime.exited'), payload: { kind: 'runtime.exited', value: { resourceRef: RESOURCE, exitCode: 0, signal: null, evidenceRefs: [] } } },
      { fact: factFor(attempt, factSource, 5, 'usage.observed'), payload: { kind: 'usage.observed', value: { completeness: 'observed', inputTokens: 0, outputTokens: 0, evidenceRefs: [] } } },
    ]
    for (const record of records) journal.append(record.fact, record.payload)
  } finally {
    journal.close()
  }
  const bytes = readFileSync(journalPath)
  const decode = decodeBuffer(bytes)
  if (decode.corruptAt !== null || decode.readOnly || decode.lastSeq !== 5 || decode.entries.length !== 5)
    throw new Error(`Legal journal did not decode as a complete prefix: ${JSON.stringify({ corruptAt: decode.corruptAt, lastSeq: decode.lastSeq, entries: decode.entries.length })}`)
  const summary = {
    protocol: 'recovery-journal-fixture/1',
    path: 'journal/critical.ndjson',
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    factSource,
    attempt,
    expected: { lastSeq: decode.lastSeq, entries: decode.entries.length, kinds: decode.entries.map((entry) => entry.fact.kind) },
    digests: decode.entries.map((entry) => factDigest(entry.fact, entry.payload)),
  }
  return { journalPath, bytes, decode, summary }
}

/** Derive the refusal cases from the legal bytes; each reports zero sends/executes. */
export function journalNegativeCases(bytes, delivery) {
  const cases = []
  const truncated = bytes.subarray(0, bytes.byteLength - 7)
  const truncateDecode = decodeBuffer(truncated)
  cases.push({
    name: 'partial_tail', input: 'truncated_tail',
    result: truncateDecode.partialTailBytes > 0 ? 'partial_tail_refused' : 'unexpected',
    corruptAt: truncateDecode.corruptAt, partialTailBytes: truncateDecode.partialTailBytes,
    entries: truncateDecode.entries.length, sends: 0, executes: 0,
  })

  const corrupt = Buffer.from(bytes)
  const prefix = corrupt.subarray(0, 26).toString('utf8')
  const digest = prefix.slice(9, 25)
  const flipped = `${digest.slice(0, 15)}${digest.endsWith('0') ? '1' : '0'}`
  Buffer.from(flipped, 'utf8').copy(corrupt, 9)
  const corruptDecode = decodeBuffer(corrupt)
  cases.push({ name: 'corrupt_digest', input: 'digest_flip', result: corruptDecode.corruptAt === 0 ? 'refused' : 'unexpected', corruptAt: corruptDecode.corruptAt, partialTailBytes: corruptDecode.partialTailBytes, entries: corruptDecode.entries.length, sends: 0, executes: 0 })

  const firstLength = Number.parseInt(bytes.subarray(0, 8).toString('utf8'), 16)
  const firstEnd = 26 + firstLength + 1
  const gapBytes = bytes.subarray(firstEnd)
  const gapDecode = decodeBuffer(gapBytes)
  cases.push({ name: 'sequence_gap', input: 'first_record_removed', result: gapDecode.corruptAt === 0 ? 'refused' : 'unexpected', corruptAt: gapDecode.corruptAt, entries: gapDecode.entries.length, sends: 0, executes: 0 })

  const oversize = Buffer.from(bytes)
  Buffer.from('ffffffff', 'utf8').copy(oversize, 0)
  const oversizeDecode = decodeBuffer(oversize)
  cases.push({ name: 'oversize_length', input: 'length_prefix_ffffffff', result: oversizeDecode.corruptAt === 0 ? 'refused' : 'unexpected', corruptAt: oversizeDecode.corruptAt, entries: oversizeDecode.entries.length, sends: 0, executes: 0 })

  const legal = decodeBuffer(bytes).entries[0]
  const mismatch = encodeRecord({
    fact: { ...legal.fact, kind: 'turn.ended' },
    payload: { kind: 'answer.observed', value: delivery },
    seq: 1, at: '2026-01-01T00:00:00.000Z',
  })
  const mismatchDecode = decodeBuffer(mismatch)
  cases.push({ name: 'payload_kind_mismatch', input: 'turn_ended_with_answer_payload', result: mismatchDecode.corruptAt === 0 ? 'refused' : 'unexpected', corruptAt: mismatchDecode.corruptAt, entries: mismatchDecode.entries.length, sends: 0, executes: 0 })

  const missing = encodeRecord({
    fact: { ...legal.fact, factId: undefined },
    payload: legal.payload,
    seq: 1, at: '2026-01-01T00:00:00.000Z',
  })
  const missingDecode = decodeBuffer(missing)
  cases.push({ name: 'missing_fact_identity', input: 'fact_id_removed', result: missingDecode.corruptAt === 0 ? 'refused' : 'unexpected', corruptAt: missingDecode.corruptAt, entries: missingDecode.entries.length, sends: 0, executes: 0 })

  const limited = decodeBuffer(bytes, { maxRecordBytes: 8 })
  cases.push({ name: 'record_size_limit', input: 'maxRecordBytes_8', result: limited.corruptAt === 0 ? 'refused' : 'unexpected', corruptAt: limited.corruptAt, entries: limited.entries.length, sends: 0, executes: 0 })

  return cases
}

/**
 * Datareader contract for B/main: decode one legal file, then require the expected source and
 * attempt tuple for every entry. A different source is refused before any fact is consumed.
 */
export function readJournalFacts({ journalPath, expectedSource, expectedAttempt }) {
  const bytes = readFileSync(journalPath)
  const decoded = decodeBuffer(bytes)
  if (decoded.corruptAt !== null) return { ok: false, code: 'journal_corrupt', corruptAt: decoded.corruptAt, entries: decoded.entries.length, sends: 0, executes: 0 }
  const foreign = decoded.entries.filter((entry) => entry.fact.source !== expectedSource)
  if (foreign.length > 0) return { ok: false, code: 'foreign_source', count: foreign.length, sends: 0, executes: 0 }
  const mismatched = decoded.entries.filter((entry) => ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch'].some((field) => String(entry.fact[field]) !== String(expectedAttempt[field]))
    || entry.fact.contract.workId !== expectedAttempt.contract.workId || entry.fact.contract.revision !== expectedAttempt.contract.revision || entry.fact.contract.digest !== expectedAttempt.contract.digest)
  if (mismatched.length > 0) return { ok: false, code: 'attempt_mismatch', count: mismatched.length, sends: 0, executes: 0 }
  return {
    ok: true, entries: decoded.entries.length, lastSeq: decoded.lastSeq, sends: 0, executes: 0,
    kinds: decoded.entries.map((entry) => entry.fact.kind),
    factIds: decoded.entries.map((entry) => entry.fact.factId),
    digests: decoded.entries.map((entry) => factDigest(entry.fact, entry.payload)),
  }
}
