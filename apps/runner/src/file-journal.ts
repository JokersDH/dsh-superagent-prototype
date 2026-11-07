/**
 * FileCriticalJournal — a bounded, crash-safe on-disk spool for critical facts (WP-03 batch 2).
 *
 * Format: append-only JSON Lines, one record per line, each prefixed with a length and checksum so a
 * torn tail is detectable and repairable:
 *
 *   <8 hex length> <16 hex crc-ish checksum> <json>\n
 *
 * Recovery rules:
 * - a record whose prefix or body is incomplete (crash mid-write) is a **partial tail**; it is
 *   truncated on open and reported, never replayed;
 * - a record whose checksum does not match is corrupt: recovery stops at it and reports the offset;
 * - the file is bounded by `maxBytes`; when the next append would exceed it, `append()` fails with
 *   `journal_capacity_exhausted` so the Runner can stop accepting business input instead of silently
 *   dropping a critical fact.
 *
 * The journal stores the fact **and its immutable payload**, so a fact can be replayed with the same
 * `factId`/`payloadRef`/identity after a crash without any in-memory state.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readSync, statSync, truncateSync, writeSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
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
  /** Largest sequence recovered; a new append continues from here (never restarts at 1). */
  lastSeq: number
  bytes: number
  capacityBytes: number
}

export type FileJournalOptions = {
  path: string
  maxBytes?: number
  now?: () => string
}

const PREFIX_LENGTH = 8 + 1 + 16 + 1 // "<len> <sum> "
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export class FileCriticalJournal {
  readonly #path: string
  readonly #maxBytes: number
  readonly #now: () => string
  #fd: number | undefined
  #seq = 0
  #bytes = 0
  #closed = false

  constructor(options: FileJournalOptions) {
    this.#path = options.path
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.#now = options.now ?? (() => new Date().toISOString())
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

  get lastSeq(): number {
    return this.#seq
  }

  /** Open (or create) the journal, recovering entries and repairing a partial tail. */
  async open(): Promise<JournalRecovery> {
    await mkdir(dirname(this.#path), { recursive: true })
    const recovery = existsSync(this.#path) ? await recoverFile(this.#path, this.#maxBytes) : emptyRecovery(this.#maxBytes)
    this.#fd = openSync(this.#path, 'a')
    this.#seq = recovery.lastSeq
    this.#bytes = recovery.bytes
    return recovery
  }

  /**
   * Append one critical fact with its payload. A failed append never advances the sequence, so a
   * retry writes the same logical record.
   */
  append(fact: CriticalFact, payload: unknown): JournalEntry {
    if (this.#closed) throw new DriverError('state_indeterminate', 'journal_closed', 'Journal is closed')
    if (this.#fd === undefined) throw new DriverError('state_indeterminate', 'journal_not_open', 'Journal is not open')
    const entry: JournalEntry = { fact, payload, seq: this.#seq + 1, at: this.#now() }
    const line = encodeRecord(entry)
    if (this.#bytes + line.length > this.#maxBytes) {
      throw new DriverError(
        'state_indeterminate',
        'journal_capacity_exhausted',
        `Journal holds ${this.#bytes} of ${this.#maxBytes} bytes; refusing to drop a critical fact`,
      )
    }
    writeSync(this.#fd, line)
    this.#seq = entry.seq
    this.#bytes += line.length
    return entry
  }

  /** Read every intact entry (used by replay and by tests). */
  entries(): JournalEntry[] {
    return this.#fd === undefined ? [] : readEntriesSync(this.#path, this.#maxBytes).entries
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    if (this.#fd !== undefined) {
      closeSync(this.#fd)
      this.#fd = undefined
    }
  }
}

/** Encode one record: `<len> <checksum> <json>\n`, where checksum covers the JSON bytes. */
export function encodeRecord(entry: JournalEntry): Buffer {
  const body = Buffer.from(JSON.stringify(entry), 'utf8')
  const checksum = digest(body)
  const prefix = Buffer.from(`${body.length.toString(16).padStart(8, '0')} ${checksum} `, 'utf8')
  return Buffer.concat([prefix, body, Buffer.from('\n')])
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

function emptyRecovery(capacityBytes: number): JournalRecovery {
  return { entries: [], partialTailBytes: 0, corruptAt: null, lastSeq: 0, bytes: 0, capacityBytes }
}

async function recoverFile(path: string, capacityBytes: number): Promise<JournalRecovery> {
  const size = (await stat(path)).size
  if (size === 0) return emptyRecovery(capacityBytes)

  const buffer = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, size, 0)
  } finally {
    closeSync(fd)
  }

  const result = decodeBuffer(buffer, capacityBytes)
  if (result.partialTailBytes > 0) {
    // Repair: drop the torn tail so the next append starts on a record boundary.
    truncateSync(path, result.bytes)
  }
  return result
}

/** Pure decoder used by both recovery and tests (no I/O). */
export function decodeBuffer(buffer: Buffer, capacityBytes = DEFAULT_MAX_BYTES): JournalRecovery {
  const entries: JournalEntry[] = []
  let offset = 0
  let partialTailBytes = 0
  let corruptAt: number | null = null

  while (offset < buffer.length) {
    if (buffer.length - offset < PREFIX_LENGTH) {
      partialTailBytes = buffer.length - offset
      break
    }
    const lengthText = buffer.subarray(offset, offset + 8).toString('utf8')
    const length = Number.parseInt(lengthText, 16)
    if (!Number.isFinite(length) || length < 0) {
      corruptAt = offset
      break
    }
    const checksum = buffer.subarray(offset + 9, offset + 25).toString('utf8')
    const bodyStart = offset + PREFIX_LENGTH
    const bodyEnd = bodyStart + length
    if (bodyEnd + 1 > buffer.length) {
      // Incomplete record: the process died mid-write.
      partialTailBytes = buffer.length - offset
      break
    }
    const body = buffer.subarray(bodyStart, bodyEnd)
    if (digest(body) !== checksum) {
      corruptAt = offset
      break
    }
    try {
      entries.push(JSON.parse(body.toString('utf8')) as JournalEntry)
    } catch {
      corruptAt = offset
      break
    }
    offset = bodyEnd + 1 // skip the trailing newline
  }

  const intact = corruptAt === null && partialTailBytes === 0
  const bytes = intact ? buffer.length : corruptAt ?? buffer.length - partialTailBytes
  const lastSeq = entries.reduce((highest, entry) => Math.max(highest, entry.seq), 0)
  return { entries, partialTailBytes, corruptAt, lastSeq, bytes, capacityBytes }
}

function readEntriesSync(path: string, capacityBytes: number): JournalRecovery {
  const size = statSyncSafe(path)
  if (size === 0) return emptyRecovery(capacityBytes)
  const buffer = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, size, 0)
  } finally {
    closeSync(fd)
  }
  return decodeBuffer(buffer, capacityBytes)
}

function statSyncSafe(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
