/**
 * The domain aggregate store: the five upstream tables (trigger, disposition, thread, ticket,
 * decision) with the extracted trigger/thread index, extracted from src/app/store.ts
 * (MIT, DeepSeek Harness Team). Aggregates are JSON rows; generated columns express the active
 * working sets so periodic passes scan only live rows.
 *
 * The product's core model types are owned by packages/orchestrator-core (WP-01); this store is
 * deliberately structural over the JSON shapes — the SQL knows the JSON paths it indexes, and
 * nothing else. See docs/rfcs/WP-02/RFC-01-domain-type-binding.md for the binding seam.
 */
import type Database from 'better-sqlite3'

/** A JSON document with the identity field its table is keyed by. */
export type DomainDocument = { [key: string]: unknown }
/** The structural fields the trigger-thread index reads; the rest of the trigger is opaque JSON. */
export interface TriggerIndexInput extends DomainDocument {
  id: string
  at: string
  human: boolean
  threads: readonly { source: string; id: string }[]
}
/** The structural fields the ticket and thread generated columns read. */
export interface TicketDocument extends DomainDocument { id: string }
export interface ThreadDocument extends DomainDocument { key: string }

const json = <T>(value: unknown): T | undefined => (value === undefined ? undefined : JSON.parse(String(value)) as T)

export class DomainStore {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  /** Re-indexes which threads a trigger belongs to, replacing rows from an earlier save of it. */
  private indexThreads(trigger: TriggerIndexInput): void {
    this.db.prepare('DELETE FROM trigger_thread WHERE id = ?').run(trigger.id)
    const insert = this.db.prepare('INSERT OR IGNORE INTO trigger_thread VALUES (?, ?, ?, ?)')
    for (const ref of trigger.threads) insert.run(`${ref.source}:${ref.id}`, trigger.id, trigger.at, trigger.human ? 1 : 0)
  }

  readonly triggers = {
    get: <T = DomainDocument>(id: string): T | undefined => json<T>(this.row('SELECT value FROM trigger WHERE id = ?', id)?.value),
    save: (trigger: TriggerIndexInput): void => {
      this.db.prepare('INSERT INTO trigger (id, value, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, at = excluded.at')
        .run(trigger.id, JSON.stringify(trigger), trigger.at)
      this.indexThreads(trigger)
    },
    disposition: <T = DomainDocument>(id: string): T | undefined => json<T>(this.row('SELECT value FROM disposition WHERE id = ?', id)?.value),
    saveDisposition: (id: string, value: DomainDocument): void => {
      this.db.prepare('INSERT INTO disposition (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(id, JSON.stringify(value))
    },
  }

  readonly threads = {
    get: <T = ThreadDocument>(key: string): T | undefined => json<T>(this.row('SELECT value FROM thread WHERE key = ?', key)?.value),
    save: (thread: ThreadDocument): void => {
      this.db.prepare('INSERT INTO thread (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(thread.key, JSON.stringify(thread))
    },
    list: <T = ThreadDocument>(): T[] => this.values<T>('SELECT value FROM thread ORDER BY rowid'),
    /** Threads with triggers queued for eval or an eval in progress — the generated-column working set. */
    active: <T = ThreadDocument>(): T[] => this.values<T>('SELECT value FROM thread WHERE active = 1 ORDER BY rowid'),
  }

  readonly tickets = {
    get: <T = TicketDocument>(id: string): T | undefined => json<T>(this.row('SELECT value FROM ticket WHERE id = ?', id)?.value),
    save: (ticket: TicketDocument): void => {
      this.db.prepare('INSERT INTO ticket (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(ticket.id, JSON.stringify(ticket))
    },
    list: <T = TicketDocument>(): T[] => this.values<T>('SELECT value FROM ticket ORDER BY rowid DESC'),
    /** Newest first. */
    open: <T = TicketDocument>(): T[] => this.values<T>('SELECT value FROM ticket WHERE open = 1 ORDER BY rowid DESC'),
    /** Tickets with undelivered inputs or a pending or running latest assignment — the generated-column working set. */
    active: <T = TicketDocument>(): T[] => this.values<T>('SELECT value FROM ticket WHERE active = 1 ORDER BY rowid DESC'),
  }

  readonly decisions = {
    get: <T = DomainDocument>(id: string): T | undefined => json<T>(this.row('SELECT value FROM decision WHERE id = ?', id)?.value),
    save: (decision: DomainDocument & { id: string; threadKey: string }): void => {
      this.db.prepare('INSERT INTO decision (id, thread, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, thread = excluded.thread')
        .run(decision.id, decision.threadKey, JSON.stringify(decision))
    },
    byThread: <T = DomainDocument>(threadKey: string): T[] =>
      this.db.prepare('SELECT value FROM decision WHERE thread = ? ORDER BY rowid').all(threadKey).map(item => JSON.parse(String((item as Record<string, unknown>).value)) as T),
  }

  private row(sql: string, ...args: unknown[]): Record<string, unknown> | undefined {
    return this.db.prepare(sql).get(...args) as Record<string, unknown> | undefined
  }
  private values<T>(sql: string): T[] {
    return this.db.prepare(sql).all().map(item => JSON.parse(String((item as Record<string, unknown>).value)) as T)
  }
}
