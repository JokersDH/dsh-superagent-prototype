/** DATA-05: artifact files — complete-before-reference, digest-verified reads, and grace-period orphan GC. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withStore } from './helpers.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

test('a written artifact is complete before its reference exists, and reads back digest-verified', async () => {
  await withStore(({ store }) => {
    const written = store.artifacts.write(bytes('hello artifact'))
    assert.equal(written.bytes, 14)
    assert.match(written.digest, /^[0-9a-f]{64}$/)
    assert.equal(written.id, written.digest, 'content-addressed')
    store.artifacts.insert(written)
    const read = store.artifacts.read(written.id)!
    assert.equal(new TextDecoder().decode(read.data), 'hello artifact')
    assert.equal(read.record.digest, written.digest)
    // Rewriting identical content reuses the same file and row.
    const again = store.artifacts.write(bytes('hello artifact'))
    store.artifacts.insert(again)
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get() as { n: number }).n, 1)
  })
})

test('a reference never points at a half file: the database row exists only after the rename', async () => {
  await withStore(({ store, dir }) => {
    const written = store.artifacts.write(bytes('complete'))
    // The file is already at its final path and complete when write() returns; the row comes later.
    assert.equal(statSync(join(dir, 'artifacts', written.id)).size, written.bytes)
    assert.equal(store.artifacts.get(written.id), undefined)
    store.artifacts.insert(written)
    assert.ok(store.artifacts.get(written.id))
  })
})

test('GC removes unreferenced and temporary files only after the grace period, never referenced ones', async () => {
  await withStore(({ store, dir }) => {
    const referenced = store.artifacts.write(bytes('referenced'))
    store.artifacts.insert(referenced)
    // Crash windows: a temporary file left before the rename, and a complete file left before its row insert.
    const orphanFile = store.artifacts.write(bytes('orphan after rename'))
    const tmpDir = join(dir, 'artifacts', 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, 'left-before-rename'), bytes('half'))

    const young = store.artifacts.gc(60_000)
    assert.deepEqual(young.removed, [], 'files younger than the grace period are kept')
    assert.ok(young.kept.includes(referenced.id))
    assert.ok(young.kept.includes(orphanFile.id))

    const later = Date.now() + 120_000
    const aged = store.artifacts.gc(60_000, later)
    assert.deepEqual(aged.removed.sort(), [orphanFile.id, 'tmp/left-before-rename'].sort())
    assert.ok(aged.kept.includes(referenced.id), 'a referenced artifact is never deleted')
    assert.equal(readdirSync(join(dir, 'artifacts', 'tmp')).length, 0)
    assert.ok(store.artifacts.read(referenced.id), 'the referenced artifact still reads back')
  })
})
