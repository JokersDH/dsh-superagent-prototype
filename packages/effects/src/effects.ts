/**
 * Durable transactional side-effect queue. Rows are enqueued inside command transactions through a
 * {@link QueueStore} and dispatched after commit; every handler must be idempotent because a crash
 * between commit and completion replays the row. The algorithm is extracted from the upstream
 * dsh-superagent prototype (MIT, DeepSeek Harness Team, src/app/effects.ts) with two product changes:
 * unknown native sends park their row for reconcile instead of retrying, and persistence goes through
 * a port so the queue joins the product's single connection.
 */
import type { HealthSink } from './health.ts'
import type { QueueRow, QueueStore } from './queue-store.ts'

/** Signals that an effect cannot run right now, such as while dispatch is paused or all slots are full; the row reschedules without counting a failure. */
export class Later extends Error {}
/** Signals an unknown native send: the outcome cannot be proven, so the row is parked for reconcile and the generic queue never retries it. */
export class UnknownSend extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}
/** Consecutive failures before an effect kind reports an error through health, matching the upstream poll failure threshold. */
export const FAILURES_BEFORE_ERROR = 3

/** One effect handler; `payload` is the parsed JSON enqueued with the row. */
export type EffectHandler = (payload: unknown, key: string) => Promise<void>
export interface HandlerOptions {
  /** How many may run at once now; 0 holds the kind, such as while dispatch is paused. */
  limit?: () => number
  /** Initial and maximum retry backoff delays, in milliseconds. */
  retry?: readonly [number, number]
  /** Effects run one at a time in queue order, and a failed one holds back later rows of the same kind. */
  ordered?: boolean
  /** When true, repeated failures do not mark the kind's health entry as error (used when failures surface elsewhere). */
  quiet?: boolean
}
interface Registered {
  run: EffectHandler
  limit: () => number
  retry: readonly [number, number]
  ordered: boolean
  quiet: boolean
}
type Task = { kind: string; key: string; done: Promise<void> }

/**
 * Coordinates per-kind handlers, concurrency limits, bounded exponential backoff, ordered kinds,
 * unknown-send parking, and health reporting. Callers enqueue inside transactions, then `start()`
 * after setup; `drain()` stops starting new effects and waits for running ones, leaving waiting rows
 * in storage for the next start.
 */
export class Effects {
  private readonly handlers = new Map<string, Registered>()
  private readonly claims = new Map<string, { set(entry: { state: 'ready' | 'error'; detail: string; at: string }): void } | undefined>()
  private readonly tasks = new Set<Task>()
  /** Kinds whose last dispatch failed; the next dispatch that succeeds refreshes their health. */
  private readonly broken = new Set<string>()
  private seq: number
  private scheduled = false
  /** Effects run only between `start` and `drain`; rows queued before start wait, such as while setup is incomplete. */
  private started = false
  private stopped = false
  private readonly queue: QueueStore
  private readonly health: Pick<HealthSink, 'claim'> | undefined
  private readonly now: () => number
  constructor(queue: QueueStore, health?: Pick<HealthSink, 'claim'>, now: () => number = () => Date.now()) {
    this.queue = queue
    this.health = health
    this.now = now
    this.seq = queue.maxSeq()
  }

  /** Upserts an effect in the caller's transaction, coalescing with a waiting row of the same kind and key while keeping its queue position. */
  enqueue(kind: string, key: string, payload: unknown): void {
    this.queue.enqueue(kind, key, JSON.stringify(payload), ++this.seq, this.now(), new Date(this.now()).toISOString())
    this.kick()
  }
  handle(kind: string, run: EffectHandler, options: HandlerOptions = {}): void {
    if (this.handlers.has(kind)) throw new Error(`The ${kind} effects already have a handler`)
    const claim = this.health?.claim(kind)
    const { limit = () => 1, retry = [2000, 60_000], ordered = false, quiet = false } = options
    this.handlers.set(kind, { run, limit: ordered ? () => Math.min(1, limit()) : limit, retry, ordered, quiet })
    this.claims.set(kind, claim)
    this.report(kind)
    this.kick()
  }
  /** Whether a row of `kind` (optionally of `key`) waits, is running, or is parked. */
  pending(kind: string, key?: string): boolean {
    const rows = this.queue.dueRows(kind, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    const running = [...this.tasks].some(task => task.kind === kind && (key === undefined || task.key === key))
    return running || rows.some(row => key === undefined || row.key === key) || this.queue.parked(kind).some(row => key === undefined || row.key === key)
  }
  /** Drops a queued or parked row by kind and key; if it is already running, that attempt finishes normally. */
  cancel(kind: string, key: string): void {
    this.queue.cancel(kind, key)
    this.report(kind)
  }
  start(): void { this.started = true; this.kick() }
  kick(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => { this.scheduled = false; this.dispatch() })
  }
  /** Resolves once no effect of `kind` (or of any kind) is running and none can start because none is due. */
  async idle(kind?: string): Promise<void> {
    for (;;) {
      this.dispatch()
      const running = [...this.tasks].filter(task => kind === undefined || task.kind === kind).map(task => task.done)
      if (!running.length) return
      await Promise.allSettled(running)
    }
  }
  /** Stops starting new effects and waits for running ones; waiting rows remain in storage for the next start. */
  async drain(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.tasks].map(task => task.done))
  }
  private dispatch(): void {
    if (!this.started || this.stopped) return
    for (const [kind, handler] of this.handlers) {
      try {
        const running = [...this.tasks].filter(task => task.kind === kind)
        const runningKeys = new Set(running.map(task => task.key))
        // Ordered kinds block behind their oldest row even when it is not yet due; limit() is asked only after ready rows exist.
        const ready = handler.ordered
          ? (running.length ? [] : (() => {
            const head = this.queue.oldestRow(kind)
            return head && head.due <= this.now() && !runningKeys.has(head.key) ? [head] : []
          })())
          : this.queue.dueRows(kind, this.now(), 16 + running.length).filter(row => row.due <= this.now() && !runningKeys.has(row.key))
        let room = ready.length ? handler.limit() - running.length : 0
        for (const row of ready) {
          if (room-- <= 0) break
          this.run(kind, handler, row)
        }
        if (this.broken.delete(kind)) this.report(kind)
      } catch (error) { this.failedQueue(kind, error) }
    }
  }
  private run(kind: string, handler: Registered, row: QueueRow): void {
    const task: Task = { kind, key: row.key, done: Promise.resolve() }
    task.done = this.attempt(kind, handler, row)
      .catch((error: unknown) => { this.failedQueue(kind, error) })
      .finally(() => { this.tasks.delete(task); this.kick() })
    this.tasks.add(task)
  }
  private async attempt(kind: string, handler: Registered, row: QueueRow): Promise<void> {
    let failure: { error: unknown } | undefined
    try { await handler.run(JSON.parse(row.payload) as never, row.key) } catch (error) { failure = { error } }
    // Match seq and generation so a row replaced or re-queued while running is not overwritten.
    if (!failure) this.queue.complete(kind, row.key, row.seq, row.generation)
    else if (failure.error instanceof UnknownSend) {
      this.queue.park(kind, row.key, row.seq, row.generation, `${failure.error.code}: ${failure.error.message}`.slice(0, 1000), new Date(this.now()).toISOString())
    }
    // Leave running rows untouched on shutdown so they retry on the next start; a parked row records the truthful unknown outcome either way.
    else if (this.stopped) return
    else if (failure.error instanceof Later) {
      this.queue.reschedule(kind, row.key, row.seq, row.generation, this.now() + handler.retry[0])
    } else {
      const delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))
      this.queue.recordFailure(kind, row.key, row.seq, row.generation, row.attempts + 1, String(failure.error).slice(0, 1000), this.now() + delay)
    }
    this.report(kind)
  }
  private failedQueue(kind: string, error: unknown): void {
    this.broken.add(kind)
    this.claims.get(kind)?.set({ state: 'error', detail: `The effect queue failed: ${String(error)}`, at: new Date(this.now()).toISOString() })
  }
  private report(kind: string): void {
    const claim = this.claims.get(kind)
    if (!claim) return
    const stats = this.queue.stats(kind)
    const failing = stats.maxAttempts >= FAILURES_BEFORE_ERROR && !this.handlers.get(kind)?.quiet
    const detail = stats.waiting ? `${stats.waiting} waiting since ${String(stats.oldestSince)}` : 'Nothing waiting'
    claim.set(failing
      ? { state: 'error', detail: `${detail}; the last failure: ${String(stats.lastError)}`, at: new Date(this.now()).toISOString() }
      : { state: 'ready', detail, at: new Date(this.now()).toISOString() })
  }
}
