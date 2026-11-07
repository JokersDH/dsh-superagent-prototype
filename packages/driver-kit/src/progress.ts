/**
 * Bounded progress publication (WP-03, RT-07).
 *
 * Progress is diagnostic, so it is coalesced instead of queued: at most one pending update per
 * window, newest wins, and the counters say how many were merged. Critical facts never pass through
 * here — they use `AttemptIO.record`, which owns the durable receipt.
 */
import type { ProgressUpdate } from '../../contracts/src/types.ts'

export type Scheduler = {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type ProgressCoalescerOptions = {
  publish: (update: ProgressUpdate) => void
  /** Coalescing window in milliseconds. Default 100. */
  windowMs?: number
  /** Maximum pending publishes per window. `1` keeps only the newest. Default 1. */
  maxPerWindow?: number
  scheduler?: Scheduler
  now?: () => number
}

export type ProgressStats = {
  received: number
  published: number
  coalesced: number
  rejected: number
}

export class ProgressCoalescer {
  #pending: ProgressUpdate[] = []
  #timer: unknown = undefined
  #stats: ProgressStats = { received: 0, published: 0, coalesced: 0, rejected: 0 }
  readonly #publish: (update: ProgressUpdate) => void
  readonly #windowMs: number
  readonly #maxPerWindow: number
  readonly #scheduler: Scheduler
  readonly #now: () => number

  constructor(options: ProgressCoalescerOptions) {
    this.#publish = options.publish
    this.#windowMs = options.windowMs ?? 100
    this.#maxPerWindow = options.maxPerWindow ?? 1
    this.#scheduler = options.scheduler ?? defaultScheduler()
    this.#now = options.now ?? Date.now
  }

  push(update: ProgressUpdate): void {
    this.#stats.received += 1
    if (this.#pending.length >= this.#maxPerWindow) {
      // Keep the newest update and drop the oldest pending one: progress is not a ledger.
      this.#pending.shift()
      this.#stats.coalesced += 1
    }
    this.#pending.push(update)
    if (this.#timer === undefined) {
      this.#timer = this.#scheduler.setTimeout(() => this.#flush(), this.#windowMs)
    }
  }

  /** Publish everything pending immediately; used at turn boundaries and by tests. */
  flush(): void {
    this.#flush()
  }

  stats(): ProgressStats & { pending: number; lastPublishAt: number | null } {
    return { ...this.#stats, pending: this.#pending.length, lastPublishAt: this.#lastPublishAt }
  }

  #lastPublishAt: number | null = null

  #flush(): void {
    if (this.#timer !== undefined) {
      this.#scheduler.clearTimeout(this.#timer)
      this.#timer = undefined
    }
    // Publish the newest pending update only.
    const latest = this.#pending.at(-1)
    if (latest === undefined) return
    this.#pending = []
    this.#stats.published += 1
    this.#lastPublishAt = this.#now()
    this.#publish(latest)
  }
}

function defaultScheduler(): Scheduler {
  return {
    setTimeout: (callback, ms) => {
      const handle = globalThis.setTimeout(callback, ms)
      // Progress timers must never keep a runner process alive on their own.
      if (typeof (handle as { unref?: () => void }).unref === 'function') (handle as { unref: () => void }).unref()
      return handle
    },
    clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}
