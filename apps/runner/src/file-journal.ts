/**
 * FileCriticalJournal — a bounded, crash-safe on-disk spool for critical facts (WP-03).
 *
 * Record framing (one record per line):
 *   `<8 hex length> <space> <16 hex digest> <space> <json> <\n>`
 *
 * Durability:
 * - every append performs a **complete write loop** (short writes are retried until the whole
 *   record is on the file) followed by `fsync` on the file descriptor before it returns;
 * - creating the file and repairing a torn tail also `fsync` the file and, when the directory entry
 *   is new, the containing directory, so the record and its metadata reach stable storage together.
 *   This is a same-machine durability guarantee, not a claim about power-loss behaviour that was
 *   never measured.
 *
 * Integrity and fail-closed rules:
 * - a record whose prefix/body is incomplete is a **partial tail**: it is truncated on open (and the
 *   directory synced) and reported, never replayed;
 * - a record whose digest does not match is **corruption**: `open()` reports `corruptAt` and the
 *   journal becomes permanently **read-only**, because appending after an unreadable record would
 *   silently extend a broken prefix and make `bytes`/`seq` disagree with the file;
 * - all sizes are bounded: a record larger than `maxRecordBytes`, a length prefix beyond the file, or
 *   a file larger than `maxBytes` fails instead of allocating.
 *
 * Immutability:
 * - a `factId` names exactly one immutable body. Appending the same id with a different identity,
 *   `payloadRef` or payload is a conflict. Only an exact duplicate is de-duplicated (and reported).
 *   The same rule is applied when recovering an existing file and when replaying.
 */
import { closeSync, existsSync, fsyncSync, openSync, readSync, statSync, truncateSync, writeSync } from 'node:fs'
import { mkdir, open as openAsync, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import type { CriticalFact } from '../../../packages/contracts/src/types.ts'
import { DriverError } from '../../../packages/driver-kit/src/index.ts'

export type JournalEntry = {
  fact: CriticalFact
  /** The immutable payload `{kind, value}` this fact refers to. */
  payload: unknown
  /** Monotonic sequence within this journal; never reset across restarts. */
  seq: number
  /** Wall-clock time the record was appended. */
  at: string
}

export type JournalRecovery = {
  entries: JournalEntry[]
  /** Bytes discarded because the last record was incomplete. */
  partialTailBytes: number
  /** Offset of the first corrupt record, when one was found. */
  corruptAt: number | null
  /** True when the journal refused to enter append mode (corruption or size limit). */
  readOnly: boolean
  /** Largest sequence recovered; a new append continues from here (never restarts at 1). */
  lastSeq: number
  bytes: number
  capacityBytes: number
}

export type FileJournalOptions = {
  path: string
  /** Maximum file size. Default 8 MiB. */
  maxBytes?: number
  /** Maximum size of a single record. Default 1 MiB. */
  maxRecordBytes?: number
  now?: () => string
}

const PREFIX_LENGTH = 8 + 1 + 16 + 1 // "<len> <digest> "
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024

/** Stable identity of a fact body: everything except the mutable-looking bookkeeping is included. */
export function factDigest(fact: CriticalFact, payload: unknown): string {
  const canonical = JSON.stringify({ fact: sortKeys(fact), payload: sortKeys(payload) })
  return createHash('sha256').update(canonical).digest('hex')
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]))
  }
  return value
}

export class FileCriticalJournal {
  readonly #path: string
  readonly #maxBytes: number
  readonly #maxRecordBytes: number
  readonly #now: () => string
  readonly #identities = new Map<string, string>()
  #fd: number | undefined
  #seq = 0
  #bytes = 0
  #readOnly = false
  #closed = false
  /** Set when an append failed part-way; this handle must not write again until reopened. */
  #poisoned: string | undefined
  #recovery: JournalRecovery | undefined

  constructor(options: FileJournalOptions) {
    this.#path = options.path
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.#maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES
    this.#now = options.now ?? (() => new Date().toISOString())
    if (this.#maxBytes <= 0) throw new RangeError('maxBytes must be positive')
    if (this.#maxRecordBytes <= 0 || this.#maxRecordBytes > this.#maxBytes) throw new RangeError('maxRecordBytes must be positive and <= maxBytes')
  }

  get path(): string {
    return this.#path
  }

  get bytes(): number {
    return this.#bytes
  }

  get maxBytes(): number {
    return this.#maxBytes
  }

  get maxRecordBytes(): number {
    return this.#maxRecordBytes
  }

  get lastSeq(): number {
    return this.#seq
  }

  get readOnly(): boolean {
    return this.#readOnly
  }

  /** Reason this handle refuses further appends after an uncertain I/O failure, if any. */
  get poisoned(): string | undefined {
    return this.#poisoned
  }

  /** The snapshot produced by the last successful `open()`; `undefined` before opening. */
  get recovery(): JournalRecovery | undefined {
    return this.#recovery
  }

  /** Open (or create) the journal, recovering entries and repairing a partial tail. */
  async open(): Promise<JournalRecovery> {
    const existed = existsSync(this.#path)
    await mkdir(dirname(this.#path), { recursive: true })
    const recovery = existed ? await this.#recover() : emptyRecovery(this.#maxBytes)
    for (const entry of recovery.entries) this.#identities.set(entry.fact.factId, factDigest(entry.fact, entry.payload))
    this.#recovery = recovery
    this.#seq = recovery.lastSeq
    this.#bytes = recovery.bytes
    this.#readOnly = recovery.readOnly

    this.#fd = openSync(this.#path, this.#readOnly ? 'r' : 'a')
    if (!existed) {
      // A newly created file: its directory entry must be durable before records are appended.
      fsyncSync(this.#fd)
      await syncDirectory(dirname(this.#path))
    }
    return recovery
  }

  /**
   * Append one critical fact with its payload.
   *
   * Returns the stored entry. Throws (never silently drops) when:
   * - the journal is read-only because of corruption;
   * - the same `factId` already maps to a different body;
   * - the record or the file would exceed its bound.
   *
   * An exact duplicate of an already stored fact is a no-op reported via `duplicate: true`, so a
   * retry of the same logical write stays idempotent.
   */
  append(fact: CriticalFact, payload: unknown): JournalEntry & { duplicate: boolean } {
    if (this.#closed) throw new DriverError('state_indeterminate', 'journal_closed', 'Journal is closed')
    if (this.#fd === undefined) throw new DriverError('state_indeterminate', 'journal_not_open', 'Journal is not open')
    if (this.#readOnly) {
      throw new DriverError('state_indeterminate', 'journal_corrupt_read_only', 'Journal contains a corrupt record; appending would extend a broken prefix')
    }
    if (this.#poisoned !== undefined) {
      // After an uncertain write we cannot know how much reached the disk: never extrapolate a prefix.
      throw new DriverError(
        'state_indeterminate',
        'journal_writer_poisoned',
        `Journal handle refused after an I/O failure (${this.#poisoned}); reopen to recover`,
      )
    }

    const identity = factDigest(fact, payload)
    const known = this.#identities.get(fact.factId)
    if (known !== undefined) {
      if (known !== identity) {
        throw new DriverError(
          'state_indeterminate',
          'journal_fact_conflict',
          `factId ${fact.factId} already names a different body; facts are immutable`,
        )
      }
      return { fact, payload, seq: this.#seq, at: this.#now(), duplicate: true }
    }

    const entry: JournalEntry = { fact, payload, seq: this.#seq + 1, at: this.#now() }
    const line = encodeRecord(entry)
    if (line.length > this.#maxRecordBytes) {
      throw new DriverError('state_indeterminate', 'journal_record_too_large', `Record of ${line.length} bytes exceeds ${this.#maxRecordBytes}`)
    }
    if (this.#bytes + line.length > this.#maxBytes) {
      throw new DriverError(
        'state_indeterminate',
        'journal_capacity_exhausted',
        `Journal holds ${this.#bytes} of ${this.#maxBytes} bytes; refusing to drop a critical fact`,
      )
    }

    try {
      writeAll(this.#fd, line)
      // Durable before returning: the caller may ACK the fact immediately after this call.
      fsyncSync(this.#fd)
    } catch (error) {
      // The bytes may be partially persisted. Do not truncate, retry or reset counters: mark this
      // handle unusable and leave the evidence on disk for recovery to judge.
      this.#poisoned = (error as { code?: string }).code ?? (error as Error).message
      throw new DriverError(
        'state_indeterminate',
        'journal_write_failed',
        `Journal write failed (${this.#poisoned}); the handle is now refusing further appends`,
      )
    }

    this.#seq = entry.seq
    this.#bytes += line.length
    this.#identities.set(fact.factId, identity)
    return { ...entry, duplicate: false }
  }

  /** Read every intact entry (used by replay and by tests). */
  entries(): JournalEntry[] {
    return this.#fd === undefined ? [] : readEntriesSync(this.#path, this.#maxBytes, this.#maxRecordBytes).entries
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    if (this.#fd !== undefined) {
      try {
        fsyncSync(this.#fd)
      } catch {
        // closing a read-only handle needs no sync
      }
      closeSync(this.#fd)
      this.#fd = undefined
    }
  }

  async #recover(): Promise<JournalRecovery> {
    const size = (await stat(this.#path)).size
    if (size === 0) return emptyRecovery(this.#maxBytes)
    if (size > this.#maxBytes) {
      // Never allocate an unbounded buffer from a file that claims to be bounded.
      return { entries: [], partialTailBytes: 0, corruptAt: 0, readOnly: true, lastSeq: 0, bytes: size, capacityBytes: this.#maxBytes }
    }
    const buffer = Buffer.alloc(size)
    const fd = openSync(this.#path, 'r')
    try {
      readAll(fd, buffer)
    } finally {
      closeSync(fd)
    }

    const result = decodeBuffer(buffer, { maxBytes: this.#maxBytes, maxRecordBytes: this.#maxRecordBytes })
    if (result.partialTailBytes > 0 && result.corruptAt === null) {
      truncateSync(this.#path, result.bytes)
      const syncFd = openSync(this.#path, 'r+')
      try {
        fsyncSync(syncFd)
      } finally {
        closeSync(syncFd)
      }
      await syncDirectory(dirname(this.#path))
      result.bytes = result.bytes
      result.readOnly = false
    }
    return result
  }
}

/** Encode one record: `<len> <digest> <json>\n`, where the digest covers the JSON bytes. */
export function encodeRecord(entry: JournalEntry): Buffer {
  const body = Buffer.from(JSON.stringify(entry), 'utf8')
  const checksum = bodyDigest(body)
  const prefix = Buffer.from(`${body.length.toString(16).padStart(8, '0')} ${checksum} `, 'utf8')
  return Buffer.concat([prefix, body, Buffer.from('\n')])
}

function bodyDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

function emptyRecovery(capacityBytes: number): JournalRecovery {
  return { entries: [], partialTailBytes: 0, corruptAt: null, readOnly: false, lastSeq: 0, bytes: 0, capacityBytes }
}

/** Write the whole buffer, retrying short writes. */
function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset)
    if (written <= 0) throw new DriverError('state_indeterminate', 'journal_write_failed', 'Write made no progress')
    offset += written
  }
}

function readAll(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) {
    const read = readSync(fd, bytes, offset, bytes.length - offset, offset)
    if (read <= 0) break
    offset += read
  }
}

async function syncDirectory(directory: string): Promise<void> {
  // Directory fsync makes a newly created or truncated entry durable. Unsupported on some
  // platforms (Windows); there the file fsync is the best available guarantee.
  try {
    const handle = await openAsync(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Directory handles are not syncable everywhere; the file itself was already synced.
  }
}

export type DecodeOptions = { maxBytes?: number; maxRecordBytes?: number }

/** Pure decoder used by both recovery and tests (no I/O). */
export function decodeBuffer(buffer: Buffer, options: DecodeOptions = {}): JournalRecovery {
  const capacityBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES
  const entries: JournalEntry[] = []
  const seen = new Map<string, string>()
  let offset = 0
  let partialTailBytes = 0
  let corruptAt: number | null = null

  while (offset < buffer.length) {
    if (buffer.length - offset < PREFIX_LENGTH) {
      partialTailBytes = buffer.length - offset
      break
    }
    const prefix = buffer.subarray(offset, offset + PREFIX_LENGTH).toString('utf8')
    if (!/^[0-9a-f]{8} [0-9a-f]{16} $/.test(prefix)) {
      // A broken prefix is corruption, not a torn tail: the tail path only applies at end of file.
      corruptAt = offset
      break
    }
    const length = Number.parseInt(prefix.slice(0, 8), 16)
    if (length > maxRecordBytes) {
      corruptAt = offset
      break
    }
    const checksum = prefix.slice(9, 25)
    const bodyStart = offset + PREFIX_LENGTH
    const bodyEnd = bodyStart + length
    if (bodyEnd + 1 > buffer.length) {
      partialTailBytes = buffer.length - offset
      break
    }
    // The terminator is part of the frame: a missing/edited newline is corruption, not a tail.
    if (buffer[bodyEnd] !== 0x0a) {
      corruptAt = offset
      break
    }
    const body = buffer.subarray(bodyStart, bodyEnd)
    if (bodyDigest(body) !== checksum) {
      corruptAt = offset
      break
    }
    let entry: JournalEntry
    try {
      entry = JSON.parse(body.toString('utf8')) as JournalEntry
    } catch {
      corruptAt = offset
      break
    }
    if (!Number.isInteger(entry?.seq) || entry.seq < 1) {
      corruptAt = offset
      break
    }
    if (!isValidRecordEnvelope(entry)) {
      corruptAt = offset
      break
    }
    // The journal's sequence must be contiguous and monotonic from 1. A gap, a backward step or a
    // duplicate (other than an exact re-append of the same body) makes the prefix untrustworthy:
    // the coordinator must not treat a gapped prefix as a verified recovery snapshot.
    const expectedSeq = entries.length + 1
    if (entry.seq !== expectedSeq) {
      if (entry.seq < expectedSeq) {
        const earlier = entries[entry.seq - 1]
        const sameBody = earlier !== undefined && factDigest(earlier.fact, earlier.payload) === factDigest(entry.fact, entry.payload)
        if (!sameBody) {
          corruptAt = offset
          break
        }
        // An exact duplicate of an earlier record is not a new fact; it is dropped from the prefix.
        offset = bodyEnd + 1
        continue
      }
      corruptAt = offset
      break
    }
    const identity = factDigest(entry.fact, entry.payload)
    const known = seen.get(entry.fact.factId)
    if (known !== undefined && known !== identity) {
      // Two different bodies under one id: the prefix is not trustworthy after this point.
      corruptAt = offset
      break
    }
    seen.set(entry.fact.factId, identity)
    entries.push(entry)
    offset = bodyEnd + 1 // skip the trailing newline
  }

  const intact = corruptAt === null
  const bytes = corruptAt !== null ? corruptAt : buffer.length - partialTailBytes
  const lastSeq = entries.reduce((highest, entry) => Math.max(highest, entry.seq), 0)
  return {
    entries,
    partialTailBytes: corruptAt === null ? partialTailBytes : 0,
    corruptAt,
    // Corruption is fail-closed: the journal stays read-only rather than extending a broken prefix.
    readOnly: corruptAt !== null,
    lastSeq,
    bytes,
    capacityBytes,
  }
}

/**
 * A record envelope must carry a complete, well-typed fact and payload.
 *
 * This rejects a structurally broken record (missing identity, unknown kind, non-object payload) as
 * corruption instead of letting it through as a "successful prefix" that later code must re-validate.
 */
export function isValidRecordEnvelope(entry: unknown): entry is JournalEntry {
  if (entry === null || typeof entry !== 'object') return false
  const record = entry as Partial<JournalEntry>
  if (typeof record.at !== 'string' || Number.isNaN(Date.parse(record.at))) return false
  if (!Number.isInteger(record.seq) || (record.seq as number) < 1) return false
  const fact = record.fact as Record<string, unknown> | undefined
  if (!fact || typeof fact !== 'object') return false
  for (const field of ['ticketId', 'assignmentId', 'attemptId', 'factId', 'source'] as const) {
    if (typeof fact[field] !== 'string' || (fact[field] as string).length === 0) return false
  }
  if (!Number.isInteger(fact.fenceEpoch) || (fact.fenceEpoch as number) < 1) return false
  const contract = fact.contract as Record<string, unknown> | undefined
  if (!contract || typeof contract !== 'object') return false
  if (typeof contract.workId !== 'string' || !Number.isInteger(contract.revision) || typeof contract.digest !== 'string') return false
  if (typeof fact.kind !== 'string' || fact.kind.length === 0) return false
  if (typeof fact.payloadRef !== 'string' || fact.payloadRef.length === 0) return false
  const payload = record.payload as Record<string, unknown> | undefined
  if (!payload || typeof payload !== 'object' || payload.kind !== fact.kind) return false
  if (!('value' in payload)) return false
  return true
}

function readEntriesSync(path: string, maxBytes: number, maxRecordBytes: number): JournalRecovery {
  const size = statSyncSafe(path)
  if (size === 0) return emptyRecovery(maxBytes)
  if (size > maxBytes) return { entries: [], partialTailBytes: 0, corruptAt: 0, readOnly: true, lastSeq: 0, bytes: size, capacityBytes: maxBytes }
  const buffer = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    readAll(fd, buffer)
  } finally {
    closeSync(fd)
  }
  return decodeBuffer(buffer, { maxBytes, maxRecordBytes })
}

function statSyncSafe(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
