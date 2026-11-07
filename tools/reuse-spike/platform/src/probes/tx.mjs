/**
 * Probe 2 — SQLite transactional semantics on a throwaway database (probe only, not the product Store).
 *
 * Verifies WAL mode, foreign-key enforcement, a unique constraint, an explicit rollback, nested
 * savepoints, and same-connection atomicity of the three records a command would write together
 * (state + queued effect + delivery receipt). A deliberate throw inside the transaction is the
 * rollback breakpoint: after it, none of the three may survive.
 */
import { existsSync } from 'node:fs'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { check } from '../lib/util.mjs'

const SCHEMA = `
  CREATE TABLE ticket (id TEXT PRIMARY KEY, state TEXT NOT NULL);
  CREATE TABLE effect (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE receipt (id TEXT PRIMARY KEY, status TEXT NOT NULL);
  CREATE TABLE child (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES ticket(id),
    label TEXT NOT NULL UNIQUE
  );
`

export async function run({ dir }) {
  const dbPath = join(dir, 'tx.db')
  const db = new Database(dbPath)
  const checks = []

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = FULL')
  db.pragma('busy_timeout = 5000')
  const pragmas = {
    journalMode: db.pragma('journal_mode', { simple: true }),
    foreignKeys: db.pragma('foreign_keys', { simple: true }),
    synchronous: db.pragma('synchronous', { simple: true }),
    busyTimeout: db.pragma('busy_timeout', { simple: true }),
  }
  checks.push(check('tx.wal-mode', pragmas.journalMode === 'wal', `journal_mode=${pragmas.journalMode}`))
  checks.push(check('tx.foreign-keys-on', pragmas.foreignKeys === 1, `foreign_keys=${pragmas.foreignKeys}`))
  checks.push(check('tx.synchronous-full', pragmas.synchronous === 2, `synchronous=${pragmas.synchronous} (FULL)`))

  db.exec(SCHEMA)
  const insertTicket = db.prepare('INSERT INTO ticket (id, state) VALUES (?, ?)')
  const insertChild = db.prepare('INSERT INTO child (id, ticket_id, label) VALUES (?, ?, ?)')
  const count = (table, column, value) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value).n

  // Foreign-key enforcement.
  let foreignKeyError = null
  try {
    insertChild.run('orphan', 'missing-ticket', 'orphan')
  } catch (error) {
    foreignKeyError = error.code
  }
  checks.push(
    check('tx.foreign-key-enforced', foreignKeyError === 'SQLITE_CONSTRAINT_FOREIGNKEY', `error code ${foreignKeyError}`),
  )

  // Unique constraint.
  insertTicket.run('t1', 'open')
  insertChild.run('c1', 't1', 'unique-label')
  let uniqueError = null
  try {
    insertChild.run('c2', 't1', 'unique-label')
  } catch (error) {
    uniqueError = error.code
  }
  checks.push(check('tx.unique-enforced', uniqueError === 'SQLITE_CONSTRAINT_UNIQUE', `error code ${uniqueError}`))

  // Explicit rollback.
  db.exec('BEGIN')
  insertChild.run('c3', 't1', 'rolled-back')
  db.exec('ROLLBACK')
  checks.push(check('tx.rollback', count('child', 'id', 'c3') === 0, 'row absent after ROLLBACK'))

  // Nested savepoints: roll back an inner savepoint, keep the outer work.
  db.exec('BEGIN')
  insertTicket.run('t2', 'open')
  db.exec('SAVEPOINT sp1')
  insertChild.run('c4', 't2', 'kept')
  db.exec('SAVEPOINT sp2')
  insertChild.run('c5', 't2', 'dropped')
  // Roll back only the inner savepoint: c4 stays, c5 disappears, and later work goes in below sp1.
  db.exec('ROLLBACK TO sp2')
  db.exec('RELEASE sp2')
  insertChild.run('c6', 't2', 'after-inner-rollback')
  db.exec('RELEASE sp1')
  db.exec('COMMIT')
  const nested = {
    kept: count('child', 'id', 'c4'),
    dropped: count('child', 'id', 'c5'),
    after: count('child', 'id', 'c6'),
  }
  checks.push(
    check(
      'tx.nested-savepoint',
      nested.kept === 1 && nested.dropped === 0 && nested.after === 1,
      JSON.stringify(nested),
    ),
  )

  // Same-connection atomicity: state + effect + receipt commit together.
  const insertEffect = db.prepare('INSERT INTO effect (id, kind, payload) VALUES (?, ?, ?)')
  const insertReceipt = db.prepare('INSERT INTO receipt (id, status) VALUES (?, ?)')
  db.exec('BEGIN')
  insertTicket.run('t3', 'open')
  insertEffect.run('e3', 'reply', '{"ticket":"t3"}')
  insertReceipt.run('r3', 'pending')
  db.exec('COMMIT')
  const committed = {
    ticket: count('ticket', 'id', 't3'),
    effect: count('effect', 'id', 'e3'),
    receipt: count('receipt', 'id', 'r3'),
  }
  checks.push(
    check('tx.state-effect-receipt-commit', committed.ticket === 1 && committed.effect === 1 && committed.receipt === 1, JSON.stringify(committed)),
  )

  // Rollback breakpoint: the same three writes, then an injected throw before COMMIT.
  let injected = null
  db.exec('BEGIN')
  try {
    insertTicket.run('t4', 'open')
    insertEffect.run('e4', 'reply', '{"ticket":"t4"}')
    insertReceipt.run('r4', 'pending')
    throw new Error('injected rollback breakpoint')
  } catch (error) {
    injected = error.message
    db.exec('ROLLBACK')
  }
  const rolledBack = {
    ticket: count('ticket', 'id', 't4'),
    effect: count('effect', 'id', 'e4'),
    receipt: count('receipt', 'id', 'r4'),
  }
  checks.push(
    check(
      'tx.breakpoint-rolls-back-all',
      injected === 'injected rollback breakpoint' &&
        rolledBack.ticket === 0 &&
        rolledBack.effect === 0 &&
        rolledBack.receipt === 0,
      JSON.stringify({ injected, ...rolledBack }),
    ),
  )

  // A second connection sees only committed rows (writer/reader isolation on one file).
  const reader = new Database(dbPath, { readonly: true })
  const readerSees = {
    committedTicket: reader.prepare('SELECT COUNT(*) AS n FROM ticket WHERE id = ?').get('t3').n,
    rolledBackTicket: reader.prepare('SELECT COUNT(*) AS n FROM ticket WHERE id = ?').get('t4').n,
  }
  reader.close()
  checks.push(
    check(
      'tx.reader-sees-committed-only',
      readerSees.committedTicket === 1 && readerSees.rolledBackTicket === 0,
      JSON.stringify(readerSees),
    ),
  )

  // WAL side files exist while the connection holds uncheckpointed frames.
  const walPath = `${dbPath}-wal`
  const sideFiles = {
    walPresent: existsSync(walPath),
    walBytes: existsSync(walPath) ? statSync(walPath).size : 0,
    shmPresent: existsSync(`${dbPath}-shm`),
  }

  const integrity = db.pragma('integrity_check', { simple: true })
  const foreignKeyCheck = db.pragma('foreign_key_check')
  const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()

  checks.push(check('tx.integrity-check', integrity === 'ok', String(integrity)))
  checks.push(check('tx.foreign-key-check', Array.isArray(foreignKeyCheck) && foreignKeyCheck.length === 0, `${foreignKeyCheck?.length ?? 'n/a'} violations`))

  return {
    id: 'tx',
    ok: checks.every(item => item.status !== 'FAIL'),
    checks,
    facts: {
      databaseFile: dbPath,
      pragmas,
      sideFiles,
      checkpointResult: checkpoint,
      integrityCheck: integrity,
      foreignKeyViolations: foreignKeyCheck?.length ?? null,
      committed,
      rolledBackAtBreakpoint: rolledBack,
      nested,
      limitations: [
        'This is a throwaway schema, not the product Store or its migrations.',
        'Only one process/one connection writes; multi-process fencing is covered by separate product work.',
        'afterCommit ordering is a product wrapper concept and is not exercised here.',
      ],
    },
  }
}
