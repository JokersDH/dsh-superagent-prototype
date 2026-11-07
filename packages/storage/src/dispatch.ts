/**
 * The native dispatch ledger (REL-02). A send is recorded as an intention before it is physically
 * written, so recovery can distinguish a provable `not_sent` from an unknown outcome:
 *
 *   not_sent ──(markWritten, before the physical write)──▶ written ──(markAccepted)──▶ native_accepted
 *        │                                                    │
 *        └──────────(no ack / crash / lost receipt)───────────┴──(markIndeterminate)──▶ indeterminate
 *
 * `beginSend` returns a proceed verdict only when the recorded state is absent or `not_sent`.
 * A `written` or `indeterminate` send must be reconciled first and is never blindly resent —
 * local IDs are not proof of native idempotency (contracts: NativeDispatch).
 */
import type Database from 'better-sqlite3'
import type { NativeDispatch } from '@personal-agent/contracts'

/** The four independent delivery states of one native send (contracts NativeDispatch.delivery). */
export type DeliveryState = NativeDispatch['delivery']

type Row = Record<string, unknown>

export interface DispatchRecord {
  commandId: string
  target: string
  delivery: DeliveryState
  nativeRef?: string
  error?: string
  updatedAt: string
}

export class DispatchLedger {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  get(commandId: string, target: string): DispatchRecord | undefined {
    const row = this.db.prepare('SELECT * FROM dispatch_receipts WHERE command_id = ? AND target = ?').get(commandId, target) as Row | undefined
    if (!row) return undefined
    return {
      commandId: String(row.command_id),
      target: String(row.target),
      delivery: String(row.delivery) as DeliveryState,
      ...(row.native_ref === null ? {} : { nativeRef: String(row.native_ref) }),
      ...(row.error === null ? {} : { error: String(row.error) }),
      updatedAt: String(row.updated_at),
    }
  }

  /**
   * Records the intention to send and reports whether this attempt may proceed:
   * `proceed` only for an absent or `not_sent` record; `reconcile_first` for `written` or
   * `indeterminate`, which must be resolved before any further send.
   */
  beginSend(commandId: string, target: string): { proceed: true; state: 'not_sent' } | { proceed: false; state: 'written' | 'indeterminate' | 'native_accepted' } {
    const existing = this.get(commandId, target)
    if (!existing) {
      this.upsert(commandId, target, 'not_sent')
      return { proceed: true, state: 'not_sent' }
    }
    if (existing.delivery === 'not_sent') return { proceed: true, state: 'not_sent' }
    return { proceed: false, state: existing.delivery }
  }

  /** Marks that the frame was physically written; must happen before the write so a crash after it is `indeterminate`, not a resend. */
  markWritten(commandId: string, target: string): void { this.upsert(commandId, target, 'written') }
  /** Marks the native side acknowledged the command. */
  markAccepted(commandId: string, target: string, nativeRef?: string): void {
    this.upsert(commandId, target, 'native_accepted', nativeRef)
  }
  /** Marks an outcome that cannot be proven; the paired queue row is parked for reconcile. */
  markIndeterminate(commandId: string, target: string, error: string): void {
    this.upsert(commandId, target, 'indeterminate', undefined, error)
  }

  private upsert(commandId: string, target: string, delivery: DeliveryState, nativeRef?: string, error?: string): void {
    this.db.prepare(`INSERT INTO dispatch_receipts (command_id, target, delivery, native_ref, error, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(command_id, target) DO UPDATE SET delivery = excluded.delivery, native_ref = excluded.native_ref, error = excluded.error, updated_at = excluded.updated_at`)
      .run(commandId, target, delivery, nativeRef ?? null, error ?? null, new Date().toISOString())
  }
}
