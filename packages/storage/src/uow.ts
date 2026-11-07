/**
 * The UnitOfWork: one connection, nested savepoints, rollback, and afterCommit callbacks.
 * Ported from the upstream dsh-superagent Store (src/app/store.ts, MIT, DeepSeek Harness Team):
 * every mutating store shares the same better-sqlite3 connection, so a savepoint opened here
 * spans core rows, product indexes, receipts, queue rows, and event log entries alike.
 *
 * Transactions are strictly synchronous:
 * - A native `async` function (including bound async) is refused **before it is invoked**, so its
 *   body never starts and no continuation can run against the connection after rollback.
 * - A plain function that returns a thenable is also rejected; the savepoint rolls back before
 *   release and the returned promise's rejection is observed.
 * - A plain function that hides asynchronous work inside a closure is a prohibited usage: neither
 *   the savepoint nor this guard can cancel work the closure already started. Do not schedule
 *   async work and return `undefined`; return the promise or await outside the transaction.
 */

import type Database from 'better-sqlite3'

/**
 * The synchronous callback shape for a transaction. Typed call sites can use it to rule out
 * Promise-returning callbacks; the generic `Repositories.atomic` adapter pattern cannot be
 * constrained this way without rejecting generic pass-through, so `atomic` additionally rejects
 * thenables at runtime and rolls the savepoint back.
 */
export type SyncOperation<T> = () => T extends PromiseLike<unknown> ? never : T

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'

/**
 * Whether the value is a native async function. `Object.prototype.toString` reports
 * `[object AsyncFunction]` for async functions and for bound async functions (the bound function
 * inherits the target's prototype chain, hence its `@@toStringTag`).
 */
const isNativeAsyncFunction = (value: unknown): boolean =>
  typeof value === 'function' && Object.prototype.toString.call(value) === '[object AsyncFunction]'

export class UnitOfWork {
  private readonly db: Database.Database
  private readonly report: (error: unknown) => void
  /** Current savepoint nesting depth; 0 outside any transaction. */
  private depth = 0
  /** Callbacks queued to run once the outermost transaction commits, indexed by savepoint level; rolling back a level discards its callbacks. */
  private readonly committed: (() => void)[][] = []

  constructor(db: Database.Database, report: (error: unknown) => void = () => {}) {
    this.db = db
    this.report = report
  }

  /** Current nesting depth, so callers can assert same-connection transaction participation. */
  get nesting(): number { return this.depth }

  /**
   * Executes `operation` in a savepoint transaction, nested inside the current one if any; a failure
   * rolls back its changes. A native async callback is refused before it starts; a thenable result
   * is rejected synchronously and its writes roll back. Post-commit callbacks run only after the
   * outermost transaction commits, and callback errors are reported without failing the committed
   * transaction. If opening or releasing the savepoint fails, nesting depth and the callback stack
   * are restored so the UnitOfWork stays usable.
   */
  atomic<T>(operation: () => T): T {
    if (isNativeAsyncFunction(operation)) {
      throw new TypeError('UnitOfWork.atomic cannot run a native async function: the transaction is synchronous and a continuation that resumed after rollback would autocommit')
    }
    const level = this.depth
    const name = `uow_level_${level}`
    // Opening the savepoint outside the write try: if it throws, nothing was opened and no
    // depth or callback slot may be left behind.
    this.db.exec(`SAVEPOINT ${name}`)
    this.committed[level] = []
    this.depth = level + 1
    let value: T
    try {
      const produced: unknown = operation()
      if (isThenable(produced)) {
        // Observe the rejection so a callback that later throws cannot become an unhandled
        // rejection; its writes are about to be rolled back either way.
        void Promise.resolve(produced).catch(() => undefined)
        throw new TypeError('UnitOfWork.atomic requires a synchronous callback; a callback that returns a Promise/thenable cannot share the savepoint')
      }
      value = produced as T
      this.db.exec(`RELEASE ${name}`)
    } catch (error) {
      try {
        this.db.exec(`ROLLBACK TO ${name}`)
        this.db.exec(`RELEASE ${name}`)
      } catch { /* keep the original failure; the connection may already be gone */ }
      delete this.committed[level]
      this.depth = level
      throw error
    }
    this.depth = level
    const actions = this.committed.splice(level)[0] ?? []
    if (level) this.committed[level - 1]!.push(...actions)
    else for (const action of actions) { try { action() } catch (error) { this.report(error) } }
    return value
  }

  /**
   * Schedules `action` to run once the outermost transaction commits, or immediately outside a
   * transaction; callbacks queued inside a transaction that rolls back are discarded and never run.
   * Use afterCommit for in-memory follow-ups to a committed write; use the durable queue for side
   * effects that must survive a crash.
   */
  afterCommit(action: () => void): void {
    if (this.depth) this.committed[this.depth - 1]!.push(action)
    else action()
  }
}
