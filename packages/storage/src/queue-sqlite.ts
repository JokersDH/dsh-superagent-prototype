/**
 * The SQLite QueueStore: the durable effect table on the product connection, implementing the
 * port declared in @personal-agent/effects. The upsert, conditional updates, and coalescing SQL
 * are the extracted upstream queue semantics (src/app/store.ts + src/app/effects.ts, MIT,
 * DeepSeek Harness Team), plus the parked classification for unknown native sends.
 */
import type Database from 'better-sqlite3'
import type { ParkedRow, QueueRow, QueueStats, QueueStore } from '@personal-agent/effects'

type Row = Record<string, unknown>
const asQueueRow = (row: Row): QueueRow => ({
  kind: String(row.kind),
  key: String(row.key),
  payload: String(row.value),
  seq: Number(row.seq),
  generation: Number(row.generation),
  attempts: Number(row.attempts),
  error: String(row.error),
  due: Number(row.due),
  since: String(row.since),
})
const asParkedRow = (row: Row): ParkedRow => ({
  ...asQueueRow(row),
  parkedReason: String(row.parked_reason),
  parkedAt: String(row.parked_at),
})

export class SQLiteQueueStore implements QueueStore {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  maxSeq(): number {
    return Number((this.db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM effect').get() as Row).seq)
  }

  /** Coalescing upsert: a waiting row of the same kind and key takes the newer payload and a bumped generation, keeping its queue position; a parked row stays parked for reconcile. */
  enqueue(kind: string, key: string, payload: string, seq: number, due: number, since: string): void {
    this.db.prepare(`INSERT INTO effect (kind, key, value, seq, due, since) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, key) DO UPDATE SET value = excluded.value, generation = generation + 1, attempts = 0, error = '', due = excluded.due
      WHERE effect.parked_at IS NULL`).run(kind, key, payload, seq, due, since)
  }

  dueRows(kind: string, now: number, limit: number): QueueRow[] {
    return this.db.prepare('SELECT * FROM effect WHERE kind = ? AND due <= ? AND parked_at IS NULL ORDER BY seq LIMIT ?')
      .all(kind, now, limit).map(item => asQueueRow(item as Row))
  }

  oldestRow(kind: string): QueueRow | undefined {
    const row = this.db.prepare('SELECT * FROM effect WHERE kind = ? AND parked_at IS NULL ORDER BY seq LIMIT 1').get(kind) as Row | undefined
    return row ? asQueueRow(row) : undefined
  }

  /** Deletes on success only when `seq` and `generation` both match, so a row replaced while running survives for a fresh dispatch. */
  complete(kind: string, key: string, seq: number, generation: number): void {
    this.db.prepare('DELETE FROM effect WHERE kind = ? AND key = ? AND seq = ? AND generation = ? AND parked_at IS NULL')
      .run(kind, key, seq, generation)
  }

  reschedule(kind: string, key: string, seq: number, generation: number, due: number): void {
    this.db.prepare('UPDATE effect SET due = ? WHERE kind = ? AND key = ? AND seq = ? AND generation = ? AND parked_at IS NULL')
      .run(due, kind, key, seq, generation)
  }

  recordFailure(kind: string, key: string, seq: number, generation: number, attempts: number, error: string, due: number): void {
    this.db.prepare('UPDATE effect SET attempts = ?, error = ?, due = ? WHERE kind = ? AND key = ? AND seq = ? AND generation = ? AND parked_at IS NULL')
      .run(attempts, error, due, kind, key, seq, generation)
  }

  park(kind: string, key: string, seq: number, generation: number, reason: string, at: string): void {
    this.db.prepare('UPDATE effect SET parked_reason = ?, parked_at = ? WHERE kind = ? AND key = ? AND seq = ? AND generation = ?')
      .run(reason, at, kind, key, seq, generation)
  }

  parked(kind?: string): ParkedRow[] {
    const rows = kind === undefined
      ? this.db.prepare('SELECT * FROM effect WHERE parked_at IS NOT NULL ORDER BY seq').all() as Row[]
      : this.db.prepare('SELECT * FROM effect WHERE kind = ? AND parked_at IS NOT NULL ORDER BY seq').all(kind) as Row[]
    return rows.map(asParkedRow)
  }

  cancel(kind: string, key: string): void {
    this.db.prepare('DELETE FROM effect WHERE kind = ? AND key = ?').run(kind, key)
  }

  stats(kind: string): QueueStats {
    const row = this.db.prepare(`SELECT COUNT(*) AS waiting, MIN(since) AS since, MAX(attempts) AS attempts,
      (SELECT error FROM effect WHERE kind = ? AND attempts > 0 AND parked_at IS NULL ORDER BY seq DESC LIMIT 1) AS error
      FROM effect WHERE kind = ? AND parked_at IS NULL`).get(kind, kind) as Row
    const stats: QueueStats = { waiting: Number(row.waiting), maxAttempts: Number(row.attempts) }
    if (row.since !== null) stats.oldestSince = String(row.since)
    if (row.error !== null) stats.lastError = String(row.error)
    return stats
  }
}
