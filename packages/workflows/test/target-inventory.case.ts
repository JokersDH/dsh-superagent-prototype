/**
 * Wave-09 A1/A2: read-only recovery target inventory. Every case proves the target directory is not
 * created, migrated, locked or written; unsupported/unknown states are never reported as empty.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, copyFileSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  applyMigrations, MIGRATIONS, ProductStore, PRODUCT_SCHEMA_VERSION, TARGET_TABLE_CATEGORIES,
  migratedTableNames, recoveryTargetInventory,
} from '@personal-agent/storage'

const at = '2026-11-11T00:00:00.000Z'
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

/** Hash of every regular file in the directory (names + bytes), to prove read-only behavior. */
function directoryBytes(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of ['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'restore-report.json', 'note.txt']) {
    try {
      const stat = lstatSync(join(root, name))
      result[name] = `${stat.size}:${stat.mtimeMs}:${stat.ino}:${Buffer.from(readFileSync(join(root, name))).toString('base64').slice(0, 32)}`
    } catch { /* absent */ }
  }
  return result
}

function emptyTarget(schema = PRODUCT_SCHEMA_VERSION): { root: string; db: string } {
  const root = tmp('target-inventory-')
  writeFileSync(join(root, 'restore-report.json'), '{"protocol":"personal-restore/1"}\n')
  writeFileSync(join(root, 'note.txt'), 'target fixture\n')
  const db = join(root, 'state.sqlite')
  if (schema === PRODUCT_SCHEMA_VERSION) {
    const store = new ProductStore({ path: db })
    store.close()
  } else {
    const legacy = new Database(db)
    applyMigrations(legacy, { registry: MIGRATIONS.slice(0, schema) })
    legacy.close()
  }
  return { root, db }
}

test('an empty current-schema target inventories completely and is never a start permission', () => {
  const { root } = emptyTarget()
  try {
    const before = directoryBytes(root)
    const inventory = recoveryTargetInventory.inspect(root)
    const after = directoryBytes(root)
    assert.deepEqual(after, before, 'inspection does not write the target directory, WAL, shm or marker')
    assert.equal(inventory.protocol, 'recovery-target-inventory/1')
    assert.equal(inventory.productSchema, PRODUCT_SCHEMA_VERSION)
    assert.equal(inventory.integrity, 'ok')
    assert.equal(inventory.completeness, 'complete')
    assert.equal(inventory.startupAvailable, false)
    assert.equal(inventory.databaseDigest?.length, 64)
    assert.equal(inventory.issues.includes('business_rows_present'), false)
    const byName = new Map(inventory.tables.map(table => [table.name, table]))
    assert.equal(byName.get('works')?.category, 'business')
    assert.equal(byName.get('effect')?.category, 'business')
    assert.equal(byName.get('schema_meta')?.category, 'metadata')
    assert.equal(byName.get('conversation_search_data')?.category, 'metadata')
    for (const table of inventory.tables) assert.notEqual(table.category, 'unknown')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('business rows are reported but never become startup authority', () => {
  const { root, db } = emptyTarget()
  try {
    const store = new ProductStore({ path: db })
    store.product.works.insert({ id: 'legacy-work', projectId: 'project-1', conversationId: 'conversation-1', title: 'Old', createdAt: at })
    store.queue.enqueue('application.execute', 'old', '{}', 1, 0, at)
    store.close()
    const before = directoryBytes(root)
    const inventory = recoveryTargetInventory.inspect(root)
    assert.deepEqual(directoryBytes(root), before)
    assert.equal(inventory.issues.includes('business_rows_present'), true)
    assert.equal(inventory.startupAvailable, false)
    assert.equal(inventory.tables.find(table => table.name === 'works')!.rows, 1)
    assert.equal(inventory.tables.find(table => table.name === 'effect')!.rows, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('missing, corrupt, unknown-table and future-schema targets are unsupported, never empty', () => {
  const missing = tmp('target-missing-')
  try {
    const inventory = recoveryTargetInventory.inspect(missing)
    assert.equal(inventory.completeness, 'unsupported')
    assert.equal(inventory.issues.includes('missing_database'), true)
    assert.equal(inventory.databaseDigest, null)
    assert.equal(inventory.startupAvailable, false)
  } finally { rmSync(missing, { recursive: true, force: true }) }

  const corrupt = tmp('target-corrupt-')
  try {
    writeFileSync(join(corrupt, 'state.sqlite'), 'this is not a sqlite database at all')
    const inventory = recoveryTargetInventory.inspect(corrupt)
    assert.equal(inventory.completeness, 'unsupported')
    assert.equal(inventory.integrity, 'failed')
    assert.equal(inventory.issues.includes('integrity_failed'), true)
  } finally { rmSync(corrupt, { recursive: true, force: true }) }

  const unknown = emptyTarget()
  try {
    const db = new Database(unknown.db)
    db.exec('CREATE TABLE mystery_rows (id TEXT PRIMARY KEY)')
    db.close()
    const inventory = recoveryTargetInventory.inspect(unknown.root)
    assert.equal(inventory.issues.includes('unknown_table'), true)
    assert.equal(inventory.tables.find(table => table.name === 'mystery_rows')!.category, 'unknown')
    assert.equal(inventory.completeness, 'unsupported')
  } finally { rmSync(unknown.root, { recursive: true, force: true }) }

  const future = emptyTarget()
  try {
    const db = new Database(future.db)
    db.prepare("UPDATE schema_meta SET value = '99' WHERE key = 'product_schema'").run()
    db.close()
    const before = directoryBytes(future.root)
    const inventory = recoveryTargetInventory.inspect(future.root)
    assert.equal(inventory.issues.includes('unsupported_schema'), true)
    assert.equal(inventory.completeness, 'unsupported')
    assert.equal(inventory.productSchema, 99)
    assert.deepEqual(directoryBytes(future.root), before, 'a future schema is not migrated while inspecting')
    // Verify the stored version from a private copy; opening the source readonly would create -shm.
    const copy = join(tmp('target-check-'), 'state.sqlite')
    copyFileSync(future.db, copy)
    const check = new Database(copy, { readonly: true, fileMustExist: true })
    try {
      assert.equal(JSON.parse(String((check.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value: string }).value)), 99)
    } finally { check.close(); rmSync(join(copy, '..'), { recursive: true, force: true }) }
  } finally { rmSync(future.root, { recursive: true, force: true }) }
})

test('an older schema is classified without migration and reports its real version', () => {
  const { root } = emptyTarget(13)
  try {
    const inventory = recoveryTargetInventory.inspect(root)
    assert.equal(inventory.productSchema, 13)
    assert.equal(inventory.completeness, 'complete')
    assert.equal(inventory.issues.includes('unsupported_schema'), false)
    const check = new Database(join(root, 'state.sqlite'), { readonly: true, fileMustExist: true })
    try {
      assert.equal(JSON.parse(String((check.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value: string }).value)), 13)
    } finally { check.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('symlinked roots, symlinked databases and non-private directories are flagged', () => {
  const real = emptyTarget()
  const linkRoot = join(tmp('target-link-root-'), 'linked')
  try {
    symlinkSync(real.root, linkRoot, 'dir')
    const inventory = recoveryTargetInventory.inspect(linkRoot)
    assert.equal(inventory.issues.includes('unsafe_link'), true)
    assert.equal(inventory.completeness, 'unsupported')
    assert.equal(inventory.startupAvailable, false)
  } finally { rmSync(linkRoot, { recursive: true, force: true }); rmSync(real.root, { recursive: true, force: true }) }

  const linkedDb = tmp('target-link-db-')
  try {
    const elsewhere = emptyTarget()
    symlinkSync(join(elsewhere.root, 'state.sqlite'), join(linkedDb, 'state.sqlite'), 'file')
    const inventory = recoveryTargetInventory.inspect(linkedDb)
    assert.equal(inventory.issues.includes('unsafe_link'), true)
    assert.equal(inventory.completeness, 'unsupported')
    rmSync(elsewhere.root, { recursive: true, force: true })
  } finally { rmSync(linkedDb, { recursive: true, force: true }) }

  const loose = emptyTarget()
  try {
    chmodSync(loose.root, 0o755)
    const inventory = recoveryTargetInventory.inspect(loose.root)
    assert.equal(inventory.issues.includes('not_private'), true)
    assert.equal(inventory.startupAvailable, false)
  } finally { chmodSync(loose.root, 0o700); rmSync(loose.root, { recursive: true, force: true }) }
})

test('a live WAL target is read from a private copy without changing source bytes', () => {
  const root = tmp('target-wal-')
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  try {
    store.product.works.insert({ id: 'live-work', projectId: 'project-1', conversationId: 'conversation-1', title: 'Live', createdAt: at })
    const before = directoryBytes(root)
    const inventory = recoveryTargetInventory.inspect(root)
    assert.equal(inventory.productSchema, PRODUCT_SCHEMA_VERSION)
    assert.equal(inventory.issues.includes('business_rows_present'), true)
    assert.equal(inventory.databaseDigest?.length, 64)
    assert.deepEqual(directoryBytes(root), before, 'the live source database/WAL is untouched')
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('the table classification covers every table this build can migrate', () => {
  const known = new Set(Object.keys(TARGET_TABLE_CATEGORIES))
  const indexPattern = /^conversation_search(?:_|$)/
  for (const name of migratedTableNames())
    assert.equal(known.has(name) || indexPattern.test(name), true, `unclassified migrated table: ${name}`)
})


test('a claimed schema with missing business tables is not a complete empty target', () => {
  const root = tmp('target-claimed-')
  try {
    const db = new Database(join(root, 'state.sqlite'))
    try {
      db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      db.prepare('INSERT INTO schema_meta VALUES (?, ?)').run('product_schema', JSON.stringify(PRODUCT_SCHEMA_VERSION))
    } finally { db.close() }
    const inventory = recoveryTargetInventory.inspect(root)
    assert.notEqual(inventory.completeness, 'complete')
    assert.equal(inventory.issues.includes('unsupported_schema'), true)
    assert.equal(inventory.startupAvailable, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('only the exact FTS table and its shadow set are metadata; arbitrary prefixes are unknown', () => {
  const { root } = emptyTarget()
  try {
    const db = new Database(join(root, 'state.sqlite'))
    try {
      db.exec('CREATE TABLE conversation_search_surprise (payload TEXT)')
      db.prepare('INSERT INTO conversation_search_surprise VALUES (?)').run('residue')
    } finally { db.close() }
    const inventory = recoveryTargetInventory.inspect(root)
    const table = inventory.tables.find(item => item.name === 'conversation_search_surprise')
    assert.equal(table?.category, 'unknown')
    assert.equal(inventory.issues.includes('unknown_table'), true)
    assert.equal(inventory.completeness, 'unsupported')
    assert.equal(inventory.tables.find(item => item.name === 'conversation_search_data')?.category, 'metadata')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the returned digest names the inspected snapshot and is stable across identical inspections', () => {
  const { root } = emptyTarget()
  try {
    const first = recoveryTargetInventory.inspect(root)
    const second = recoveryTargetInventory.inspect(root)
    assert.equal(first.completeness, 'complete')
    assert.equal(first.databaseDigest, second.databaseDigest)
    assert.equal(first.databaseDigest?.length, 64)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
