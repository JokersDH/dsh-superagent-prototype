/**
 * Probe 4 — minimal post-commit durability across a hard process death (OPS-01 / OPS-02 context).
 *
 * Two child processes SIGKILL themselves: one right after a committed autocommit write, one while an
 * explicit transaction is still open. The parent then reopens each database and records what survived.
 * Scope is intentionally minimal — a single table and a single write — so this cannot be read as
 * evidence for full business recovery (that is OPS-02 and later packages).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { check } from '../lib/util.mjs'

const CHILD = fileURLToPath(new URL('./crash-child.mjs', import.meta.url))

function runChild(dbPath, mode) {
  const result = spawnSync(process.execPath, [CHILD, dbPath, mode], { encoding: 'utf8', timeout: 30_000 })
  return {
    mode,
    status: result.status,
    signal: result.signal,
    stderr: (result.stderr ?? '').trim(),
  }
}

function sideFiles(dbPath) {
  const wal = `${dbPath}-wal`
  const shm = `${dbPath}-shm`
  return {
    walPresent: existsSync(wal),
    walBytes: existsSync(wal) ? statSync(wal).size : 0,
    shmPresent: existsSync(shm),
  }
}

export async function run({ dir }) {
  const checks = []

  // Case 1: commit, then die immediately.
  const committedPath = join(dir, 'crash-commit.db')
  const committedChild = runChild(committedPath, 'commit-then-die')
  const committedSide = sideFiles(committedPath)
  const committedDb = new Database(committedPath)
  const committedRows = committedDb.prepare('SELECT id, note FROM durable ORDER BY id').all()
  const committedIntegrity = committedDb.pragma('integrity_check', { simple: true })
  const committedJournal = committedDb.pragma('journal_mode', { simple: true })
  committedDb.close()

  // Case 2: open a transaction, write, then die before COMMIT.
  const uncommittedPath = join(dir, 'crash-begin.db')
  const uncommittedChild = runChild(uncommittedPath, 'begin-then-die')
  const uncommittedSide = sideFiles(uncommittedPath)
  const uncommittedDb = new Database(uncommittedPath)
  const uncommittedRows = uncommittedDb.prepare('SELECT id FROM durable ORDER BY id').all()
  const uncommittedIntegrity = uncommittedDb.pragma('integrity_check', { simple: true })
  uncommittedDb.close()

  checks.push(
    check(
      'crash.kill-observed',
      committedChild.signal === 'SIGKILL' && uncommittedChild.signal === 'SIGKILL',
      `commit case signal=${committedChild.signal}, begin case signal=${uncommittedChild.signal}`,
    ),
  )
  checks.push(
    check(
      'crash.committed-write-survives',
      committedRows.length === 1 && committedRows[0].id === 'committed-before-crash',
      JSON.stringify(committedRows),
    ),
  )
  checks.push(
    check(
      'crash.open-transaction-rolled-back',
      uncommittedRows.length === 0,
      `${uncommittedRows.length} row(s) from the killed open transaction`,
    ),
  )
  checks.push(
    check(
      'crash.integrity-after-recovery',
      committedIntegrity === 'ok' && uncommittedIntegrity === 'ok',
      `committed=${committedIntegrity} uncommitted=${uncommittedIntegrity}`,
    ),
  )

  return {
    id: 'crash',
    ok: checks.every(item => item.status !== 'FAIL'),
    checks,
    facts: {
      childExecutable: process.execPath,
      committedCase: {
        child: committedChild,
        walBeforeReopen: committedSide,
        recoveredRows: committedRows,
        integrity: committedIntegrity,
        journalModeAfterRecovery: committedJournal,
      },
      uncommittedCase: {
        child: uncommittedChild,
        walBeforeReopen: uncommittedSide,
        recoveredRows: uncommittedRows,
        integrity: uncommittedIntegrity,
      },
      limitations: [
        'Minimal single-table write, not a product transaction or the real Store schema.',
        'Only SIGKILL is exercised; power loss, filesystem failure and network filesystems are NOT_TESTED.',
        'This does not cover Runner/native-process crash recovery or business-level reconciliation (OPS-02 and later).',
      ],
    },
  }
}
