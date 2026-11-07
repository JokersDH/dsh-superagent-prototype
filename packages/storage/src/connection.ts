/**
 * The one product database connection. Opens with WAL and strict durability pragmas, refuses
 * foreign or upstream application databases, applies the migration entry, and exposes the
 * UnitOfWork every store shares (DATA-02/DATA-04: one connection, one transaction scope).
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { UnitOfWork } from './uow.ts'
import { applyMigrations, PRODUCT_SCHEMA_VERSION } from './migrations.ts'

export interface OpenReport {
  /** Receives errors thrown by afterCommit callbacks without failing the committed transaction. */
  report?: (error: unknown) => void
}

/** One better-sqlite3 connection with the product schema applied and a UnitOfWork over it. */
export class ProductDatabase {
  readonly db: Database.Database
  readonly uow: UnitOfWork
  readonly productSchema: number
  readonly path: string

  /**
   * Opens or creates the product SQLite database at `path`. On any refusal — upstream application
   * database, unknown tables, failed migration — the handle is closed and the file left unchanged.
   */
  constructor(path: string, options: OpenReport = {}) {
    this.path = path
    const report = options.report ?? (() => {})
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new Database(path)
    try {
      chmodSync(path, 0o600)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('busy_timeout = 5000')
      const outcome = applyMigrations(this.db)
      this.productSchema = outcome.productSchema
      this.uow = new UnitOfWork(this.db, report)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /** SQLite engine version, as the G0 admission check requires it to be reported. */
  get engine(): { sqlite: string; productSchema: number } {
    return {
      sqlite: String((this.db.prepare('SELECT sqlite_version() AS version').get() as Record<string, unknown>).version),
      productSchema: this.productSchema,
    }
  }

  /** Integrity and foreign-key checks, as backup/restore acceptance requires them. */
  checkIntegrity(): { integrity: 'ok' | string; foreignKeyViolations: number } {
    const integrity = String((this.db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check)
    const violations = this.db.prepare('PRAGMA foreign_key_check').all().length
    return { integrity: integrity === 'ok' ? 'ok' : integrity, foreignKeyViolations: violations }
  }

  close(): void { this.db.close() }
}

export { PRODUCT_SCHEMA_VERSION }
