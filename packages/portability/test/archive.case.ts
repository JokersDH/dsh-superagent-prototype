/** Deterministic tar.gz IO refuses malformed, unsafe and oversized archives instead of guessing. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import {
  BUNDLE_LIMITS,
  PortabilityError,
  createHashingSink,
  readTarGz,
  writeTarGz,
  type ArchiveLimits,
} from '../src/index.ts'

const temp = (name: string) => mkdtempSync(join(tmpdir(), `pa-archive-${name}-`))

interface RawEntryOptions {
  name: string
  typeflag?: string
  data?: Buffer
  size?: number
  mode?: string
  mtime?: string
  uid?: string
  gid?: string
  breakChecksum?: boolean
  prefix?: string
}

const rawEntry = ({ name, typeflag = '0', data = Buffer.alloc(0), size, mode = '0000600', mtime = '00000000000', uid = '0000000', gid = '0000000', breakChecksum = false, prefix = '' }: RawEntryOptions) => {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(mode, 100, 7, 'ascii')
  header.write(uid, 108, 7, 'ascii')
  header.write(gid, 116, 7, 'ascii')
  const sizeText = (size ?? data.length).toString(8).padStart(11, '0')
  header.write(sizeText, 124, 11, 'ascii')
  header.write(mtime, 136, 11, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write(typeflag, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write(prefix, 345, prefix.length, 'ascii')
  let sum = header.reduce((total, byte) => total + byte, 0)
  if (breakChecksum) sum += 1
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const pad = (512 - (data.length % 512)) % 512
  return Buffer.concat([header, data, Buffer.alloc(pad)])
}

const craft = (entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))

const readAll = async (path: string, limits?: ArchiveLimits) => {
  const { sink, entries } = createHashingSink()
  await readTarGz(path, sink, limits)
  return entries
}

test('write/read round-trips deterministically with canonical headers', async (t) => {
  const dir = temp('roundtrip')
  try {
    const first = join(dir, 'a.pab')
    const second = join(dir, 'b.pab')
    const entries = [
      { path: 'manifest.json', source: Buffer.from('{"a":1}\n') },
      { path: 'state/state.sqlite', source: Buffer.from('database-bytes') },
      { path: 'artifacts/' + 'a'.repeat(64), source: Buffer.from('artifact') },
    ]
    await writeTarGz(first, entries)
    await writeTarGz(second, entries)
    assert.deepEqual(readFileSync(first), readFileSync(second), 'the same input yields the same archive bytes')
    const read = await readAll(first)
    assert.deepEqual(read.map((entry) => entry.path), entries.map((entry) => entry.path))
    assert.deepEqual(read.map((entry) => entry.size), entries.map((entry) => entry.source.length))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unsafe paths are refused on write', async (t) => {
  const dir = temp('unsafe-write')
  try {
    for (const path of ['../escape', '/absolute', 'a//b', 'a\\b', 'a/./b', 'x'.repeat(120)]) {
      await assert.rejects(() => writeTarGz(join(dir, 'x.pab'), [{ path, source: Buffer.from('x') }]), (error) => {
        return error instanceof PortabilityError && ['archive_unsafe_path', 'archive_limit_exceeded'].includes(error.code)
      }, path)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unsafe or unsupported archive members are refused on read', async (t) => {
  const dir = temp('unsafe-read')
  try {
    const cases = {
      traversal: [rawEntry({ name: '../escape', data: Buffer.from('x') })],
      absolute: [rawEntry({ name: '/etc/passwd', data: Buffer.from('x') })],
      symlink: [rawEntry({ name: 'link', typeflag: '2', data: Buffer.alloc(0) })],
      badChecksum: [rawEntry({ name: 'manifest.json', data: Buffer.from('{}'), breakChecksum: true })],
      duplicate: [
        rawEntry({ name: 'manifest.json', data: Buffer.from('{}') }),
        rawEntry({ name: 'manifest.json', data: Buffer.from('{}') }),
      ],
      nonCanonicalMode: [rawEntry({ name: 'manifest.json', data: Buffer.from('{}'), mode: '000644 ' })],
      nonCanonicalMtime: [rawEntry({ name: 'manifest.json', data: Buffer.from('{}'), mtime: '00000000001' })],
      prefix: [rawEntry({ name: 'manifest.json', data: Buffer.from('{}'), prefix: 'dir' })],
    }
    for (const [name, entries] of Object.entries(cases)) {
      const path = join(dir, `${name}.pab`)
      writeFileSync(path, craft(entries))
      await assert.rejects(() => readAll(path), (error) => error instanceof PortabilityError && error.code.startsWith('archive_'), name)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('truncated gzip, missing end marker and trailing data are refused', async (t) => {
  const dir = temp('truncated')
  try {
    const valid = craft([rawEntry({ name: 'manifest.json', data: Buffer.from('{}') })])
    const truncated = join(dir, 'truncated.pab')
    writeFileSync(truncated, valid.subarray(0, valid.length - 6))
    await assert.rejects(() => readAll(truncated), (error) => error instanceof PortabilityError && error.code === 'archive_invalid')

    const noEnd = join(dir, 'no-end.pab')
    writeFileSync(noEnd, gzipSync(rawEntry({ name: 'manifest.json', data: Buffer.from('{}') })))
    await assert.rejects(() => readAll(noEnd), (error) => error instanceof PortabilityError && error.code === 'archive_invalid')

    const trailing = join(dir, 'trailing.pab')
    writeFileSync(trailing, gzipSync(Buffer.concat([rawEntry({ name: 'manifest.json', data: Buffer.from('{}') }), Buffer.alloc(1024), Buffer.from('junk')])))
    await assert.rejects(() => readAll(trailing), (error) => error instanceof PortabilityError && error.code === 'archive_invalid')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('entry count, per-entry and total size limits bound a decompression bomb', async (t) => {
  const dir = temp('bomb')
  try {
    const many = join(dir, 'many.pab')
    const entries = []
    for (let index = 0; index < 6; index += 1) entries.push(rawEntry({ name: `f${index}`, data: Buffer.from('x') }))
    writeFileSync(many, craft(entries))
    const smallLimits = { ...BUNDLE_LIMITS, maxEntries: 3 }
    await assert.rejects(() => readAll(many, smallLimits), (error) => error instanceof PortabilityError && error.code === 'archive_limit_exceeded')

    const big = join(dir, 'big.pab')
    writeFileSync(big, craft([rawEntry({ name: 'large', data: Buffer.alloc(4096) })]))
    const byteLimits = { ...BUNDLE_LIMITS, maxEntryBytes: 1024 }
    await assert.rejects(() => readAll(big, byteLimits), (error) => error instanceof PortabilityError && error.code === 'archive_limit_exceeded')

    const total = join(dir, 'total.pab')
    writeFileSync(total, craft([
      rawEntry({ name: 'a', data: Buffer.alloc(2048) }),
      rawEntry({ name: 'b', data: Buffer.alloc(2048) }),
    ]))
    const totalLimits = { ...BUNDLE_LIMITS, maxTotalBytes: 3000, maxEntryBytes: 4096 }
    await assert.rejects(() => readAll(total, totalLimits), (error) => error instanceof PortabilityError && error.code === 'archive_limit_exceeded')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
