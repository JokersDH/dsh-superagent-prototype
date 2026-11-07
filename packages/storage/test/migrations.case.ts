/** DATA-06: checksummed migrations — fresh apply, reopen no-op, drift/gap/future refusal, foreign and upstream database refusal. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  applyMigrations, migrationChecksum, MIGRATIONS, PRODUCT_SCHEMA_VERSION, MigrationIntegrityError,
  ProductStore, UnknownDatabaseError, UpstreamApplicationDatabaseError, type Migration,
} from '../src/index.ts'
import { tempDir } from './helpers.ts'

test('a fresh database applies the registered migrations and records every checksum; reopening is a no-op', () => {
  const dir = tempDir()
  const path = join(dir, 'fresh.sqlite')
  try {
    const store = new ProductStore({ path })
    try {
      assert.equal(store.database.productSchema, PRODUCT_SCHEMA_VERSION)
      const recorded = JSON.parse(String((store.db.prepare("SELECT value FROM schema_meta WHERE key = 'migrations'").get() as { value: string }).value)) as { version: number; checksum: string }[]
      assert.deepEqual(recorded.map(entry => entry.version), MIGRATIONS.map(migration => migration.version))
      assert.deepEqual(recorded.map(entry => entry.checksum), MIGRATIONS.map(migrationChecksum))
    } finally { store.close() }
    const reopened = new ProductStore({ path })
    try { assert.equal(reopened.database.productSchema, PRODUCT_SCHEMA_VERSION) } finally { reopened.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an edited migration body is refused after it was applied', () => {
  const dir = tempDir()
  const path = join(dir, 'drift.sqlite')
  try {
    const db = new Database(path)
    db.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta VALUES ('product_schema', '1');`)
    db.prepare("INSERT INTO schema_meta VALUES ('migrations', ?)").run(JSON.stringify([
      { version: 1, name: 'product-v1', checksum: 'a-different-checksum', appliedAt: '2026-11-07T00:00:00.000Z' },
    ]))
    assert.throws(() => applyMigrations(db), MigrationIntegrityError)
    db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a gap in applied migrations and a schema newer than this build are refused', () => {
  const dir = tempDir()
  try {
    const gapPath = join(dir, 'gap.sqlite')
    const gap = new Database(gapPath)
    gap.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta VALUES ('product_schema', '1');`)
    gap.prepare("INSERT INTO schema_meta VALUES ('migrations', ?)").run(JSON.stringify([
      { version: 1, name: 'product-v1', checksum: migrationChecksum(MIGRATIONS[0]!), appliedAt: 'a' },
      { version: 3, name: 'product-v3', checksum: 'x', appliedAt: 'b' },
    ]))
    assert.throws(() => applyMigrations(gap), MigrationIntegrityError)
    gap.close()

    const futurePath = join(dir, 'future.sqlite')
    const future = new Database(futurePath)
    future.exec(`CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO schema_meta VALUES ('product_schema', '7');`)
    future.prepare("INSERT INTO schema_meta VALUES ('migrations', ?)").run(JSON.stringify([
      { version: 1, name: 'product-v1', checksum: migrationChecksum(MIGRATIONS[0]!), appliedAt: 'a' },
      { version: 2, name: 'product-v2', checksum: 'x', appliedAt: 'b' },
    ]))
    assert.throws(() => applyMigrations(future), MigrationIntegrityError)
    future.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a foreign database with tables but no product schema is refused, and the upstream application database is named', () => {
  const dir = tempDir()
  try {
    const foreign = new Database(join(dir, 'foreign.sqlite'))
    foreign.exec('CREATE TABLE something_else (id TEXT PRIMARY KEY)')
    foreign.close()
    assert.throws(() => new ProductStore({ path: join(dir, 'foreign.sqlite') }), UnknownDatabaseError)

    // The upstream dsh-superagent application database (schema 11) carries `kv`; the product must not adopt it in place.
    const upstream = new Database(join(dir, 'upstream.sqlite'))
    upstream.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE effect (kind TEXT, key TEXT, value TEXT, seq INTEGER, PRIMARY KEY (kind, key));`)
    upstream.close()
    assert.throws(() => new ProductStore({ path: join(dir, 'upstream.sqlite') }), UpstreamApplicationDatabaseError)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a failed migration aborts the open unchanged and the same number retries, never skipped', () => {
  const dir = tempDir()
  const path = join(dir, 'failing.sqlite')
  try {
    const failing: Migration = {
      version: 2,
      name: 'failing-v2',
      statements: ['CREATE TABLE will_vanish (id TEXT PRIMARY KEY)', 'CREATE TABLE ticket (id TEXT PRIMARY KEY)'],
    }
    const db = new Database(path)
    db.exec('PRAGMA journal_mode = WAL')
    assert.throws(() => applyMigrations(db, { registry: [MIGRATIONS[0]!, failing] }), /table ticket already exists/)
    assert.equal(
      Number((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'will_vanish'").get() as { n: number }).n),
      0,
      'the failing migration rolled back its earlier statement',
    )
    const recorded = JSON.parse(String((db.prepare("SELECT value FROM schema_meta WHERE key = 'migrations'").get() as { value: string }).value)) as { version: number }[]
    assert.deepEqual(recorded.map(entry => entry.version), [1], 'version 2 was not recorded')
    const repaired: Migration = { version: 2, name: 'failing-v2', statements: ['CREATE TABLE will_vanish (id TEXT PRIMARY KEY)'] }
    assert.equal(applyMigrations(db, { registry: [MIGRATIONS[0]!, repaired] }).applied, 1, 'the same migration number retries and applies')
    db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
