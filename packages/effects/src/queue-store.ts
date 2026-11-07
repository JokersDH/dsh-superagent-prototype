/**
 * The durable queue surface the Effects algorithm needs. SQLite implements it in
 * `@personal-agent/storage` on the same single product connection, so rows queued
 * inside a command transaction commit or roll back with that command.
 */

/** One durable queue row, as the storage layer keeps it; `payload` stays an opaque string. */
export interface QueueRow {
  readonly kind: string
  readonly key: string
  readonly payload: string
  readonly seq: number
  readonly generation: number
  readonly attempts: number
  readonly error: string
  /** Epoch milliseconds before which the row must not run again. */
  readonly due: number
  readonly since: string
}

/** A row parked by an unknown native send: kept for reconcile, never redispatched by this queue. */
export interface ParkedRow extends QueueRow {
  readonly parkedReason: string
  readonly parkedAt: string
}

/** Queue statistics for per-kind health reporting. */
export interface QueueStats {
  waiting: number
  oldestSince?: string
  maxAttempts: number
  lastError?: string
}

/** The persistence surface of the queue. Every method is synchronous so it joins ambient transactions. */
export interface QueueStore {
  /** Highest queue sequence ever allocated, so a restarting process continues the numbering. */
  maxSeq(): number
  /**
   * Upsert one row, coalescing with a waiting row of the same kind and key: the newer payload replaces
   * the older, the generation increments so the running attempt cannot delete or overwrite it, attempts
   * and error reset, and the queue position (`seq`) stays. Rows that are parked stay parked.
   */
  enqueue(kind: string, key: string, payload: string, seq: number, due: number, since: string): void
  /** Rows of `kind` whose `due` has passed, in queue order, up to `limit`. */
  dueRows(kind: string, now: number, limit: number): QueueRow[]
  /** The oldest row of `kind` regardless of `due`; ordered kinds block behind it until it completes. */
  oldestRow(kind: string): QueueRow | undefined
  /** Remove the row on success; `seq` and `generation` must both match so a row replaced while running survives. */
  complete(kind: string, key: string, seq: number, generation: number): void
  /** Reschedule a row without counting a failure (the `Later` outcome), such as while processing is paused. */
  reschedule(kind: string, key: string, seq: number, generation: number, due: number): void
  /** Record a failure: set `attempts`, keep the truncated message, and set the next `due`. */
  recordFailure(kind: string, key: string, seq: number, generation: number, attempts: number, error: string, due: number): void
  /** Park a row whose external outcome is unknown; it leaves dispatch and stays durable for reconcile. */
  park(kind: string, key: string, seq: number, generation: number, reason: string, at: string): void
  /** Drop a queued or parked row by kind and key; the running attempt, if any, finishes normally. */
  cancel(kind: string, key: string): void
  /** Rows parked for reconcile, oldest first; `kind` optional. */
  parked(kind?: string): ParkedRow[]
  /** Statistics for health reporting; `waiting` excludes parked rows. */
  stats(kind: string): QueueStats
}
