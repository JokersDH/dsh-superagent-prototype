/**
 * The UnitOfWork: one connection, nested savepoints, rollback, and afterCommit callbacks.
 * Ported from the upstream dsh-superagent Store (src/app/store.ts, MIT, DeepSeek Harness Team):
 * every mutating store shares the same better-sqlite3 connection, so a savepoint opened here
 * spans core rows, product indexes, receipts, queue rows, and event log entries alike.
 *
 * Transactions are strictly synchronous. A callback that returns a thenable is rejected before
 * the savepoint is released — its writes roll back — because a savepoint cannot outlive the
 * synchronous RELEASE and an async continuation must never see its first half committed.
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
   * rolls back its changes. A thenable result is rejected synchronously and its writes roll back:
   * the callback must be fully synchronous, because the savepoint is released before its promise
   * could settle. Post-commit callbacks run only after the outermost transaction commits, and
   * callback errors are reported without failing the committed transaction.
   */
  atomic<T>(operation: () => T): T {
    const level = this.depth++
    const name = `uow_level_${level}`
    this.committed[level] = []
    this.db.exec(`SAVEPOINT ${name}`)
    let value: T
    try {
      const produced: unknown = operation()
      if (isThenable(produced)) {
        // Observe the rejection so an async callback that throws after its await cannot become an
        // unhandled rejection; its writes are about to be rolled back either way.
        void Promise.resolve(produced).catch(() => undefined)
        throw new TypeError('UnitOfWork.atomic requires a synchronous callback; an async callback cannot share the savepoint')
      }
      value = produced as T
      this.db.exec(`RELEASE ${name}`)
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name}`)
      this.db.exec(`RELEASE ${name}`)
      throw error
    } finally {
      this.depth--
    }
    const actions = this.committed.splice(level)[0]!
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
