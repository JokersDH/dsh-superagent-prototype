/**
 * Deterministic tar.gz IO for backup bundles. The archive is a plain ustar stream with fixed
 * metadata (mtime 0, uid/gid 0, mode 0600, no PAX/GNU extensions) gzipped at level 9, so the same
 * manifest and files produce the same archive bytes.
 *
 * The reader is a bounded streaming state machine: it validates every header checksum, refuses
 * absolute/`..`/duplicate/over-deep paths and unsupported entry types, enforces entry/size limits,
 * and never trusts the archive to decide where bytes are written (callers provide the sink).
 */
import { createReadStream, createWriteStream, closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { dirname } from 'node:path'
import { createGunzip, createGzip } from 'node:zlib'
import { BUNDLE_LIMITS, assertSafeEntryPath } from './manifest.ts'
import { PortabilityError } from './errors.ts'

export interface ArchiveEntry {
  readonly path: string
  readonly size: number
  readonly mode: number
}

export interface ArchiveSink {
  start(entry: ArchiveEntry): void | Promise<void>
  chunk(chunk: Uint8Array): void | Promise<void>
  end(): void | Promise<void>
}

export interface ArchiveSource {
  readonly path: string
  /** A file path to stream, or in-memory bytes. */
  readonly source: string | Uint8Array
  readonly mode?: number
}

export interface ArchiveLimits {
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly maxTotalBytes: number
  readonly maxPathLength: number
  readonly maxPathDepth: number
}

const DEFAULT_LIMITS: ArchiveLimits = BUNDLE_LIMITS

const ZERO_BLOCK = Buffer.alloc(512)
const isZero = (block: Buffer) => block.every((byte) => byte === 0)

function tarHeader(path: string, size: number, mode: number, limits: ArchiveLimits): Buffer {
  assertSafeEntryPath(path, limits)
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxEntryBytes)
    throw new PortabilityError('archive_limit_exceeded', 'Archive entry size is out of bounds', { path, size })
  const header = Buffer.alloc(512)
  header.write(path, 0, 100, 'utf8')
  header.write(octal(mode, 7), 100, 7, 'ascii')
  header.write('0000000', 108, 7, 'ascii')
  header.write('0000000', 116, 7, 'ascii')
  header.write(octal(size, 11), 124, 11, 'ascii')
  header.write('00000000000', 136, 11, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

function octal(value: number, digits: number): string {
  const text = value.toString(8)
  if (text.length > digits) throw new PortabilityError('archive_limit_exceeded', 'Archive numeric field overflows')
  return `${'0'.repeat(digits - text.length)}${text}\0`
}

function paddingFor(size: number): Buffer {
  const pad = (512 - (size % 512)) % 512
  return pad === 0 ? Buffer.alloc(0) : Buffer.alloc(pad)
}

/** Write a deterministic tar.gz from ordered entries. The caller supplies the manifest first. */
export async function writeTarGz(outputPath: string, entries: readonly ArchiveSource[], limits: ArchiveLimits = DEFAULT_LIMITS): Promise<void> {
  if (entries.length > limits.maxEntries + 16)
    throw new PortabilityError('archive_limit_exceeded', 'Too many archive entries', { count: entries.length })
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 })
  const temporary = `${outputPath}.${process.pid}.tmp`
  const output = createWriteStream(temporary, { mode: 0o600 })
  const gzip = createGzip({ level: 9 })
  gzip.pipe(output)
  const write = async (buffer: Buffer) => {
    if (buffer.length === 0) return
    if (!gzip.write(buffer)) await once(gzip, 'drain')
  }
  try {
    // Wait for the file to be open before any header is written; this keeps the failure path from
    // leaving a late asynchronous open against an already removed temporary file.
    await once(output, 'open')
    let total = 0
    for (const entry of entries) {
      const source = entry.source
      let size
      if (typeof source === 'string') size = (await stat(source)).size
      else size = source.byteLength
      total += size
      if (size > limits.maxEntryBytes || total > limits.maxTotalBytes)
        throw new PortabilityError('archive_limit_exceeded', 'Archive exceeds the configured size budget', { path: entry.path })
      await write(tarHeader(entry.path, size, entry.mode ?? 0o600, limits))
      if (typeof source === 'string') {
        for await (const chunk of createReadStream(source, { highWaterMark: 64 * 1024 })) await write(chunk)
      } else await write(Buffer.from(source))
      await write(paddingFor(size))
    }
    await write(Buffer.alloc(1024))
    gzip.end()
    await once(output, 'close')
    const fd = openSync(temporary, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, outputPath)
  } catch (error) {
    gzip.destroy()
    output.destroy()
    try { unlinkSync(temporary) } catch { /* absent */ }
    throw error
  }
}

function parseOctal(block: Buffer, offset: number, length: number): number {
  const text = block.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim()
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw new PortabilityError('archive_invalid', 'Archive header has a non-octal numeric field')
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new PortabilityError('archive_invalid', 'Archive header numeric field overflows')
  return value
}

function parseHeader(block: Buffer, limits: ArchiveLimits): ArchiveEntry {
  const stored = block.subarray(148, 156)
  const copy = Buffer.from(block)
  copy.fill(0x20, 148, 156)
  const expected = copy.reduce((sum, byte) => sum + byte, 0)
  const storedText = stored.toString('ascii').replace(/\0.*$/, '').replace(/ /g, '')
  if (!/^[0-7]+$/.test(storedText))
    throw new PortabilityError('archive_invalid', 'Archive header checksum is missing')
  if (Number.parseInt(storedText, 8) !== expected)
    throw new PortabilityError('archive_checksum_mismatch', 'Archive header checksum does not match')
  const magic = block.subarray(257, 263).toString('ascii')
  if (magic !== 'ustar\0') throw new PortabilityError('archive_invalid', 'Only ustar archives are accepted')
  const typeflag = String.fromCharCode(block[156] ?? 0)
  if (typeflag !== '0') throw new PortabilityError('archive_invalid', 'Only regular-file entries are accepted', { typeflag })
  const prefix = block.subarray(345, 500).toString('ascii').replace(/\0.*$/, '')
  if (prefix !== '') throw new PortabilityError('archive_invalid', 'ustar prefix fields are not accepted')
  const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const path = assertSafeEntryPath(rawName, limits)
  const mode = parseOctal(block, 100, 8)
  if (![0o600, 0o700].includes(mode)) throw new PortabilityError('archive_invalid', 'Archive entry mode is not canonical', { path, mode })
  const uid = parseOctal(block, 108, 8)
  const gid = parseOctal(block, 116, 8)
  if (uid !== 0 || gid !== 0) throw new PortabilityError('archive_invalid', 'Archive entry ownership is not canonical', { path })
  const mtime = parseOctal(block, 136, 12)
  if (mtime !== 0) throw new PortabilityError('archive_invalid', 'Archive entry mtime is not canonical', { path })
  const size = parseOctal(block, 124, 12)
  if (size > limits.maxEntryBytes)
    throw new PortabilityError('archive_limit_exceeded', 'Archive entry exceeds the size budget', { path, size })
  return { path, size, mode }
}

/** Stream a tar.gz through a sink. Throws on any structural or limit violation. */
export async function readTarGz(archivePath: string, sink: ArchiveSink, limits: ArchiveLimits = DEFAULT_LIMITS): Promise<void> {
  const input = createReadStream(archivePath, { highWaterMark: 64 * 1024 })
  const gunzip = createGunzip()
  input.pipe(gunzip)
  let buffer = Buffer.alloc(0)
  let active = null
  let remaining = 0
  let padding = 0
  let total = 0
  let count = 0
  let sawEnd = false
  const seen = new Set()
  const invalid = (message: string, detail: Readonly<Record<string, unknown>> = {}) =>
    new PortabilityError('archive_invalid', message, detail)
  try {
    for await (const chunk of gunzip) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      for (;;) {
        if (sawEnd) {
          if (!isZero(buffer)) throw invalid('Archive has data after the end marker')
          buffer = Buffer.alloc(0)
          break
        }
        if (active !== null) {
          if (remaining > 0) {
            if (buffer.length === 0) break
            const take = Math.min(remaining, buffer.length)
            const part = buffer.subarray(0, take)
            buffer = buffer.subarray(take)
            remaining -= take
            total += take
            if (total > limits.maxTotalBytes)
              throw new PortabilityError('archive_limit_exceeded', 'Archive exceeds the total size budget')
            await sink.chunk(part)
            continue
          }
          if (padding > 0) {
            const take = Math.min(padding, buffer.length)
            if (take === 0) break
            buffer = buffer.subarray(take)
            padding -= take
            continue
          }
          await sink.end()
          active = null
          continue
        }
        if (buffer.length < 512) break
        const header = buffer.subarray(0, 512)
        buffer = buffer.subarray(512)
        if (isZero(header)) {
          // The terminating zero blocks and any trailing gzip padding must all be zero.
          sawEnd = true
          continue
        }
        count += 1
        if (count > limits.maxEntries)
          throw new PortabilityError('archive_limit_exceeded', 'Archive has too many entries')
        const entry = parseHeader(header, limits)
        if (seen.has(entry.path))
          throw new PortabilityError('archive_duplicate_entry', 'Archive has a duplicate entry', { path: entry.path })
        seen.add(entry.path)
        await sink.start(entry)
        active = entry
        remaining = entry.size
        padding = (512 - (entry.size % 512)) % 512
      }
    }
  } catch (error) {
    if (error instanceof PortabilityError) throw error
    throw new PortabilityError('archive_invalid', 'Bundle archive is not a valid tar.gz stream', {
      cause: String((error as { message?: string }).message ?? error),
    })
  }
  if (active !== null) throw new PortabilityError('archive_invalid', 'Bundle archive is truncated inside an entry')
  if (buffer.length > 0) throw new PortabilityError('archive_invalid', 'Bundle archive is truncated inside a header')
  if (!sawEnd) throw new PortabilityError('archive_invalid', 'Bundle archive has no end marker')
  if (count === 0) throw new PortabilityError('archive_invalid', 'Bundle archive has no entries')
}

/** In-memory sink used by verification: hashes every entry without writing it anywhere. */
export interface HashedEntry {
  readonly path: string
  readonly size: number
  readonly sha256: string
}

export function createHashingSink(onBytes?: (path: string, data: Uint8Array) => void): { sink: ArchiveSink; entries: HashedEntry[] } {
  const entries: HashedEntry[] = []
  let hash = createHash('sha256')
  let currentPath = ''
  let currentSize = 0
  let written = 0
  const sink: ArchiveSink = {
    start(entry) {
      currentPath = entry.path
      currentSize = entry.size
      written = 0
      hash = createHash('sha256')
    },
    chunk(chunk) {
      written += chunk.byteLength
      hash.update(chunk)
      onBytes?.(currentPath, chunk)
    },
    end() {
      if (written !== currentSize)
        throw new PortabilityError('archive_invalid', 'Archive entry size does not match its header', { path: currentPath })
      entries.push({ path: currentPath, size: currentSize, sha256: hash.digest('hex') })
      currentPath = ''
      currentSize = 0
      written = 0
    },
  }
  return { sink, entries }
}
