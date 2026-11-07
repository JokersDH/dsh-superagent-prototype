/**
 * Text channel receipts: the upstream outbox pattern (src/app/store.ts receipts, MIT, DeepSeek
 * Harness Team) extracted onto the product connection. A message is recorded as a pending receipt
 * before its send effect is queued, so message IDs are idempotent and settlement survives a
 * restart. Answer deliveries are separate (see answers.ts): a native answer's written/applied
 * state is not a text channel ACK.
 */
import type Database from 'better-sqlite3'

/** The effect kind the application registers its channel sender under; `behind` reads its attempts for the weak-FIFO rule. */
export const CHANNEL_SEND_KIND = 'channel_send'

export type ChannelRef = { source: string; thread: string; address: Record<string, string> }
export type ReplyStatus = 'pending' | 'sent' | 'dropped'
export type DropReason = 'channelGone' | 'channelIgnored'
export interface OutboundMessage {
  id: string
  channel: ChannelRef
  text: string
  kind: 'acknowledgement' | 'reply' | 'notice'
  ticketId?: string
}
export interface ChannelReceipt extends OutboundMessage {
  status: ReplyStatus
  dropped?: { at: string; reason: DropReason }
}

type Row = Record<string, unknown>

export class ChannelReceipts {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  get(id: string): ChannelReceipt | undefined {
    const row = this.db.prepare('SELECT value FROM channel_receipts WHERE id = ?').get(id) as Row | undefined
    return row ? JSON.parse(String(row.value)) as ChannelReceipt : undefined
  }
  status(id: string): ReplyStatus | undefined { return this.get(id)?.status }

  /** Pending message receipts, oldest first. */
  waiting(): ChannelReceipt[] {
    return (this.db.prepare("SELECT value FROM channel_receipts WHERE value ->> '$.status' = 'pending' ORDER BY rowid").all() as Row[])
      .map(row => JSON.parse(String(row.value)) as ChannelReceipt)
  }

  /**
   * True when an earlier message for the same ticket and conversation is still pending with fewer
   * than `failures` consecutive failed send attempts: later messages wait behind it, except after
   * the head keeps failing.
   */
  behind(id: string, failures: number): boolean {
    return !!this.db.prepare(`SELECT 1 FROM channel_receipts earlier
      JOIN channel_receipts message ON message.id = ? LEFT JOIN effect ON effect.kind = ? AND effect.key = earlier.id
      WHERE earlier.pending = message.pending AND earlier.rowid < message.rowid AND IFNULL(effect.attempts, 0) < ? LIMIT 1`)
      .get(id, CHANNEL_SEND_KIND, failures)
  }

  /**
   * Records a new pending receipt; an already-recorded message ID keeps its original receipt.
   * @returns whether the message ID was newly recorded.
   */
  add(message: OutboundMessage): boolean {
    const receipt: ChannelReceipt = { ...message, status: 'pending' }
    const result = this.db.prepare('INSERT OR IGNORE INTO channel_receipts (id, value) VALUES (?, ?)').run(message.id, JSON.stringify(receipt))
    return Number(result.changes) > 0
  }

  /** Marks a pending receipt sent or dropped (with reason and timestamp); a receipt recreated if withdrawn while sending keeps the ID unavailable to a new queue entry. */
  settle(message: OutboundMessage, outcome: 'sent' | DropReason): void {
    const settled: ChannelReceipt = outcome === 'sent'
      ? { ...message, status: 'sent' }
      : { ...message, status: 'dropped', dropped: { at: new Date().toISOString(), reason: outcome } }
    const updated = this.db.prepare("UPDATE channel_receipts SET value = ? WHERE id = ? AND value ->> '$.status' = 'pending'")
      .run(JSON.stringify(settled), message.id)
    if (!Number(updated.changes)) {
      this.db.prepare('INSERT OR IGNORE INTO channel_receipts (id, value) VALUES (?, ?)').run(message.id, JSON.stringify(settled))
    }
  }

  /** Withdraws a pending message that has not been sent; @returns whether a pending receipt was removed. */
  withdraw(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM channel_receipts WHERE id = ? AND value ->> '$.status' = 'pending'").run(id).changes) > 0
  }
}
