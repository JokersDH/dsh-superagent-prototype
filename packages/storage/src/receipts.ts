/**
 * Command and fact receipts (DATA-03). A receipt records that a command or critical fact was
 * accepted, keyed by its stable ID with the digest of the payload it was accepted for: replaying
 * the same ID with the same payload returns the recorded result and never re-applies, replaying
 * it with a different payload is refused as a conflict, and both halves live in one transaction
 * with the work they guard (DATA-02's all-or-nothing scope).
 */
import type Database from 'better-sqlite3'
import type { DurableReceipt } from '@personal-agent/contracts'
import { EventLog } from './events.ts'
import { UnitOfWork } from './uow.ts'

/** A command ID replayed with a different payload; the recorded receipt is not overwritten. */
export class CommandConflict extends Error {}
/** A fact ID replayed with a different payload. */
export class FactConflict extends Error {}

type Row = Record<string, unknown>

export interface RecordedCommand<R> {
  /** True when a receipt already existed and `apply` did not run. */
  replayed: boolean
  result: R
  seq: number
}

export class CommandReceipts {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  private readonly events: EventLog
  constructor(db: Database.Database, uow: UnitOfWork, events: EventLog) {
    this.db = db
    this.uow = uow
    this.events = events
  }

  get(commandId: string): { payloadDigest: string; status: string; seq: number; result: unknown; recordedAt: string } | undefined {
    const row = this.db.prepare('SELECT * FROM command_receipts WHERE command_id = ?').get(commandId) as Row | undefined
    if (!row) return undefined
    return {
      payloadDigest: String(row.payload_digest),
      status: String(row.status),
      seq: Number(row.seq),
      result: row.result === null ? null : JSON.parse(String(row.result)),
      recordedAt: String(row.recorded_at),
    }
  }

  /**
   * Records the acceptance of `commandId` in one transaction with `apply`'s work: core rows,
   * product indexes, queue rows, and events written by `apply` commit with the receipt or roll
   * back with it. A replay with the same digest returns the recorded result without re-applying.
   */
  record<R>(commandId: string, payloadDigest: string, apply: () => R, status: 'recorded' | 'rejected' = 'recorded'): RecordedCommand<R> {
    return this.uow.atomic(() => {
      const existing = this.get(commandId)
      if (existing) {
        if (existing.payloadDigest !== payloadDigest) throw new CommandConflict(`Command ${commandId} was recorded with payload digest ${existing.payloadDigest}; refusing the different digest ${payloadDigest}`)
        return { replayed: true, result: existing.result as R, seq: existing.seq }
      }
      const result = apply()
      const seq = this.events.append({ topic: 'command', entityRef: commandId, payload: { status } })
      this.db.prepare('INSERT INTO command_receipts (command_id, payload_digest, status, seq, result, recorded_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(commandId, payloadDigest, status, seq, JSON.stringify(result ?? null), new Date().toISOString())
      return { replayed: false, result, seq }
    })
  }
}

export class FactReceipts {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  private readonly events: EventLog
  constructor(db: Database.Database, uow: UnitOfWork, events: EventLog) {
    this.db = db
    this.uow = uow
    this.events = events
  }

  /**
   * Records the acceptance of `factId` in one transaction with `apply`'s work and returns its
   * durable receipt, whose `seq` is the event log position the acceptance occupies. Same-ID
   * replay with the same digest deduplicates; a different digest is refused.
   */
  record(factId: string, payloadDigest: string, apply: () => void): DurableReceipt {
    return this.uow.atomic(() => {
      const row = this.db.prepare('SELECT payload_digest, seq FROM fact_receipts WHERE fact_id = ?').get(factId) as Row | undefined
      if (row) {
        if (String(row.payload_digest) !== payloadDigest) throw new FactConflict(`Fact ${factId} was recorded with payload digest ${String(row.payload_digest)}; refusing the different digest ${payloadDigest}`)
        return { factId, persisted: true as const, seq: Number(row.seq) }
      }
      apply()
      const seq = this.events.append({ topic: 'fact', entityRef: factId, payload: { payloadDigest } })
      this.db.prepare('INSERT INTO fact_receipts (fact_id, payload_digest, seq, recorded_at) VALUES (?, ?, ?, ?)')
        .run(factId, payloadDigest, seq, new Date().toISOString())
      return { factId, persisted: true as const, seq }
    })
  }

  get(factId: string): { payloadDigest: string; seq: number; recordedAt: string } | undefined {
    const row = this.db.prepare('SELECT * FROM fact_receipts WHERE fact_id = ?').get(factId) as Row | undefined
    if (!row) return undefined
    return { payloadDigest: String(row.payload_digest), seq: Number(row.seq), recordedAt: String(row.recorded_at) }
  }
}
