/**
 * Probe 3 — consistent backup and restore (OPS-01).
 *
 * Builds a WAL-mode database with a foreign key and a unique constraint, keeps a second writer
 * connection inserting rows while the backup runs, then restores into a *new directory* through the
 * binding's SQLite online-backup API and checks integrity, foreign keys, schema identity and data
 * digests. This covers the database snapshot only: product artifact files, Runner state and full
 * business recovery are out of scope for G0-B.
 */
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { check, sha256File } from '../lib/util.mjs'

const SCHEMA = `
  CREATE TABLE parent (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE child (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES parent(id),
    payload TEXT NOT NULL UNIQUE
  );
`

const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex')

export async function run({ dir }) {
  const sourcePath = join(dir, 'source.db')
  const restoreDir = join(dir, 'restored')
  const restoredPath = join(restoreDir, 'copy.db')
  await mkdir(restoreDir, { recursive: true })

  const source = new Database(sourcePath)
  source.pragma('journal_mode = WAL')
  source.pragma('foreign_keys = ON')
  source.pragma('synchronous = FULL')
  source.exec(SCHEMA)

  const seed = source.transaction((start, count) => {
    const insertParent = source.prepare('INSERT INTO parent (id, payload) VALUES (?, ?)')
    const insertChild = source.prepare('INSERT INTO child (id, parent_id, payload) VALUES (?, ?, ?)')
    for (let index = start; index < start + count; index += 1) {
      insertParent.run(`p${index}`, `payload-${index}`)
      insertChild.run(`c${index}`, `p${index}`, `child-${index}`)
    }
  })
  seed(0, 200)
  source.pragma('wal_checkpoint(PASSIVE)')
  seed(200, 20) // leave uncheckpointed frames in the WAL on purpose

  const sourceWalBytes = existsSync(`${sourcePath}-wal`) ? statSync(`${sourcePath}-wal`).size : 0

  // A second connection writes while the backup runs: the snapshot must stay internally consistent.
  // Writes happen inside the backup's own progress callback, so they interleave with backup steps
  // deterministically instead of depending on a timer winning a 1 ms race.
  const concurrent = new Database(sourcePath)
  concurrent.pragma('journal_mode = WAL')
  concurrent.pragma('busy_timeout = 5000')
  const insertConcurrent = concurrent.prepare('INSERT INTO parent (id, payload) VALUES (?, ?)')
  const concurrentWrites = { attempted: 0, committed: 0, busy: 0 }

  const started = Date.now()
  await source.backup(restoredPath, {
    progress() {
      concurrentWrites.attempted += 1
      try {
        insertConcurrent.run(`live-${concurrentWrites.attempted}`, 'live-write')
        concurrentWrites.committed += 1
      } catch {
        concurrentWrites.busy += 1
      }
    },
  })
  const backupMs = Date.now() - started
  concurrent.close()

  const sourceFacts = {
    path: sourcePath,
    bytes: statSync(sourcePath).size,
    walBytes: sourceWalBytes,
    parents: source.prepare('SELECT COUNT(*) AS n FROM parent').get().n,
    children: source.prepare('SELECT COUNT(*) AS n FROM child').get().n,
    userVersion: source.pragma('user_version', { simple: true }),
  }
  const schemaSql = source
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
  source.close()

  const restored = new Database(restoredPath, { readonly: true })
  const restoredFacts = {
    path: restoredPath,
    bytes: statSync(restoredPath).size,
    parents: restored.prepare('SELECT COUNT(*) AS n FROM parent').get().n,
    children: restored.prepare('SELECT COUNT(*) AS n FROM child').get().n,
    userVersion: restored.pragma('user_version', { simple: true }),
    integrity: restored.pragma('integrity_check', { simple: true }),
    foreignKeyViolations: restored.pragma('foreign_key_check').length,
    schemaSha256: digest(restored.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()),
    parentDigest: digest(restored.prepare('SELECT id, payload FROM parent ORDER BY id').all()),
    childDigest: digest(restored.prepare('SELECT id, parent_id, payload FROM child ORDER BY id').all()),
    journalMode: restored.pragma('journal_mode', { simple: true }),
  }
  restored.close()

  const sourceSchemaSha256 = digest(schemaSql)
  const checks = [
    check('backup.file-created', existsSync(restoredPath) && restoredFacts.bytes > 0, `${restoredFacts.bytes} bytes in ${restoreDir}`),
    check('backup.integrity-check', restoredFacts.integrity === 'ok', String(restoredFacts.integrity)),
    check('backup.foreign-keys-clean', restoredFacts.foreignKeyViolations === 0, `${restoredFacts.foreignKeyViolations} violations`),
    check(
      'backup.schema-identical',
      restoredFacts.schemaSha256 === sourceSchemaSha256,
      `source=${sourceSchemaSha256.slice(0, 16)}… restored=${restoredFacts.schemaSha256.slice(0, 16)}…`,
    ),
    check(
      'backup.seeded-rows-present',
      restoredFacts.children >= 220 && restoredFacts.parents >= restoredFacts.children,
      `parents=${restoredFacts.parents} children=${restoredFacts.children}`,
    ),
    check(
      'backup.child-rows-reference-present-parents',
      restoredFacts.foreignKeyViolations === 0,
      'foreign_key_check is empty, so every restored child has its parent',
    ),
  ]

  return {
    id: 'backup',
    ok: checks.every(item => item.status !== 'FAIL'),
    checks,
    facts: {
      backupApi: 'better-sqlite3 Database#backup (SQLite online backup API), destination in a new directory',
      backupMs,
      source: sourceFacts,
      restored: restoredFacts,
      concurrentWrites,
      restoredSha256: await sha256File(restoredPath),
      limitations: [
        'Database snapshot only: product artifact files, Runner state, journals and full business recovery are not included.',
        'Restore was verified by opening the copy and running integrity/foreign_key checks; no production migration was run against it.',
        'Concurrent writes were attempted through a second connection to prove the snapshot stays consistent, not to measure backup throughput under load.',
      ],
    },
  }
}
