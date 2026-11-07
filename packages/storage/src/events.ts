/**
 * The append-only event log. Every event is appended in the same transaction as the state change
 * it describes, and its `seq` is a rowid alias, so a rolled-back transaction leaves no gap: the
 * cursor never advances past a change that did not happen (DATA-08's storage half).
 */
import type Database from 'better-sqlite3'

export interface EventInput {
  topic: string
  entityRef: string
  /** Small inline payload as JSON; larger data goes to the artifact store and its reference here. */
  payload?: unknown
  payloadRef?: string
}
export interface EventRow {
  seq: number
  topic: string
  entityRef: string
  payload: unknown
  payloadRef: string | null
  at: string
}

const nowIso = (): string => new Date().toISOString()

export class EventLog {
  private readonly db: Database.Database
  private readonly at: () => string
  constructor(db: Database.Database, at: () => string = nowIso) { this.db = db; this.at = at }

  /** Appends one event inside the caller's transaction and returns its gap-free sequence number. */
  append(input: EventInput): number {
    const payload = 'payload' in input ? JSON.stringify(input.payload) : null
    const payloadRef = 'payloadRef' in input ? input.payloadRef ?? null : null
    if (payload === null && payloadRef === null) throw new Error('An event needs an inline payload or a payload reference')
    const result = this.db
      .prepare('INSERT INTO event_log (topic, entity_ref, payload, payload_ref, at) VALUES (?, ?, ?, ?, ?)')
      .run(input.topic, input.entityRef, payload, payloadRef, this.at())
    return Number(result.lastInsertRowid)
  }

  /** Events after `afterSeq` in sequence order, for resumable cursors. */
  after(afterSeq: number, limit = 100): EventRow[] {
    const rows = this.db.prepare('SELECT * FROM event_log WHERE seq > ? ORDER BY seq LIMIT ?').all(afterSeq, limit) as Record<string, unknown>[]
    return rows.map(row => ({
      seq: Number(row.seq),
      topic: String(row.topic),
      entityRef: String(row.entity_ref),
      payload: row.payload === null ? null : JSON.parse(String(row.payload)),
      payloadRef: row.payload_ref === null ? null : String(row.payload_ref),
      at: String(row.at),
    }))
  }

  /** The current cursor: the highest committed sequence number. */
  cursor(): number {
    return Number((this.db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM event_log').get() as Record<string, unknown>).seq)
  }
}
