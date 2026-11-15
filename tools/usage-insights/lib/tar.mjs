/**
 * Minimal read-only tar reader for released artifacts.
 *
 * It parses the archive in memory from an explicit path, refuses anything larger than the configured
 * byte budget (checked before reading and again while inflating), and never writes, extracts or
 * executes anything. Only the three entry types a release package uses are modelled; anything else is
 * reported as `other` so an unexpected member cannot be silently treated as a file.
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

export const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const BLOCK = 512

export class ArchiveError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}

const cString = (buffer, start, length) => {
  const slice = buffer.subarray(start, start + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8')
}

const octal = (buffer, start, length) => {
  const text = cString(buffer, start, length).trim()
  return text === '' ? 0 : Number.parseInt(text, 8)
}

const typeOf = flag => {
  if (flag === '0' || flag === '\u0000' || flag === '') return 'file'
  if (flag === '5') return 'directory'
  if (flag === '2') return 'symlink'
  return 'other'
}

/** Read and parse a `.tar` or `.tar.gz` release archive from an explicit absolute path. */
export function readArchive(path, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ARCHIVE_BYTES
  let stat
  try {
    stat = statSync(path)
  } catch {
    throw new ArchiveError('unreadable', 'The archive does not exist or is not readable')
  }
  if (!stat.isFile()) throw new ArchiveError('unreadable', 'The archive must be a regular file')
  if (stat.size > maxBytes) throw new ArchiveError('too_large', `The archive is ${stat.size} bytes, above the ${maxBytes}-byte budget`)
  const compressed = readFileSync(path)
  let buffer
  if (compressed.length > 2 && compressed[0] === 0x1f && compressed[1] === 0x8b) {
    try {
      buffer = gunzipSync(compressed, { maxOutputLength: maxBytes })
    } catch {
      throw new ArchiveError('unreadable', 'The archive could not be inflated within the byte budget')
    }
  } else buffer = compressed
  if (buffer.length > maxBytes) throw new ArchiveError('too_large', 'The inflated archive is above the byte budget')

  const entries = []
  let offset = 0
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK)
    if (header.every(byte => byte === 0)) break
    const name = cString(header, 0, 100)
    const prefix = cString(header, 345, 155)
    const size = octal(header, 124, 12)
    const mode = octal(header, 100, 8)
    const flag = cString(header, 156, 1)
    const linkname = cString(header, 157, 100)
    const stored = octal(header, 148, 8)
    const checksum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (stored !== checksum) throw new ArchiveError('unreadable', `Entry ${name || '(unnamed)'} has an invalid header checksum`)
    const full = prefix ? `${prefix}/${name}` : name
    const start = offset + BLOCK
    if (start + size > buffer.length) throw new ArchiveError('unreadable', `Entry ${full} extends past the archive`)
    entries.push({ name: full, type: typeOf(flag), size, mode, linkname, start })
    offset = start + Math.ceil(size / BLOCK) * BLOCK
  }
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  return {
    sha256: createHash('sha256').update(compressed).digest('hex'),
    bytes: stat.size,
    inflatedBytes: buffer.length,
    entries,
    byName,
    /** Read one member as UTF-8 text; null when it is missing or not a regular file. */
    text(name) {
      const entry = byName.get(name)
      if (!entry || entry.type !== 'file') return null
      return buffer.subarray(entry.start, entry.start + entry.size).toString('utf8')
    },
  }
}
