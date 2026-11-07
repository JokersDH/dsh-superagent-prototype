/**
 * ProductStore: one database connection and every store over it. All mutating stores share the
 * same UnitOfWork, so a command transaction spanning domain rows, receipts, queue rows, events,
 * dispatch records, and answer deliveries commits or rolls back as a whole (DATA-02/DATA-04).
 */
import type Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { ProductDatabase } from './connection.ts'
import { DomainStore } from './domain.ts'
import { SQLiteQueueStore } from './queue-sqlite.ts'
import { CommandReceipts, FactReceipts } from './receipts.ts'
import { EventLog } from './events.ts'
import { DispatchLedger } from './dispatch.ts'
import { ChannelReceipts } from './outbox.ts'
import { Answers } from './answers.ts'
import { ArtifactStore } from './artifacts.ts'
import { UnitOfWork } from './uow.ts'
import { type LockContent, type LockRegistry } from './writer-lock.ts'

export interface ProductStoreOptions {
  /** Path to the product SQLite database; the state directory is its parent. */
  path: string
  /** Overrides the artifact root (default: `<state dir>/artifacts`). */
  artifactsRoot?: string
  /** Receives afterCommit callback errors without failing the committed transaction. */
  report?: (error: unknown) => void
}

export class ProductStore {
  readonly database: ProductDatabase
  readonly db: Database.Database
  readonly uow: UnitOfWork
  readonly domain: DomainStore
  readonly queue: SQLiteQueueStore
  readonly commands: CommandReceipts
  readonly facts: FactReceipts
  readonly events: EventLog
  readonly dispatch: DispatchLedger
  readonly channels: ChannelReceipts
  readonly answers: Answers
  readonly artifacts: ArtifactStore

  constructor(options: ProductStoreOptions) {
    this.database = new ProductDatabase(options.path, options.report ? { report: options.report } : {})
    this.db = this.database.db
    this.uow = this.database.uow
    this.domain = new DomainStore(this.db)
    this.queue = new SQLiteQueueStore(this.db)
    this.events = new EventLog(this.db)
    this.commands = new CommandReceipts(this.db, this.uow, this.events)
    this.facts = new FactReceipts(this.db, this.uow, this.events)
    this.dispatch = new DispatchLedger(this.db)
    this.channels = new ChannelReceipts(this.db)
    this.answers = new Answers(this.db, this.uow)
    this.artifacts = new ArtifactStore(this.db, options.artifactsRoot ?? dirname(options.path))
  }

  close(): void { this.database.close() }
}

/** The database-backed registry WriterLock reads for its nonce/liveness cross-check. */
export class InstanceRegistry implements LockRegistry {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }
  has(nonce: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM coordinator_instances WHERE nonce = ?').get(nonce)
  }
  register(entry: LockContent): void {
    this.db.prepare('INSERT OR REPLACE INTO coordinator_instances (nonce, pid, started_at, heartbeat_at) VALUES (?, ?, ?, ?)')
      .run(entry.nonce, entry.pid, entry.startedAt, new Date().toISOString())
  }
  beat(nonce: string): void {
    this.db.prepare('UPDATE coordinator_instances SET heartbeat_at = ? WHERE nonce = ?').run(new Date().toISOString(), nonce)
  }
}

export { ProductDatabase } from './connection.ts'
export { UnitOfWork } from './uow.ts'
export { DomainStore, type DomainDocument, type TriggerIndexInput, type TicketDocument, type ThreadDocument } from './domain.ts'
export { SQLiteQueueStore } from './queue-sqlite.ts'
export { CommandReceipts, FactReceipts, CommandConflict, FactConflict, type RecordedCommand } from './receipts.ts'
export { EventLog, type EventInput, type EventRow } from './events.ts'
export { DispatchLedger, type DeliveryState, type DispatchRecord } from './dispatch.ts'
export { ChannelReceipts, CHANNEL_SEND_KIND, type ChannelReceipt, type OutboundMessage, type ReplyStatus, type DropReason, type ChannelRef } from './outbox.ts'
export { Answers, AnswerConflict, type DeliveryStatus, type RecordedAnswer } from './answers.ts'
export { ArtifactStore, ensureArtifactRoot, artifactRoot, stateDirOf, type ArtifactRecord, type WrittenArtifact, type GcResult } from './artifacts.ts'
export { backupDatabase, verifyDatabase, type BackupResult, type VerifyResult } from './backup.ts'
export { WriterLock, WriterLockHeld, type LockContent, type LockProbe, type LockRegistry, type LockVerdict } from './writer-lock.ts'
export {
  MIGRATIONS, PRODUCT_SCHEMA_VERSION, applyMigrations, migrationChecksum, refuseUnknownDatabase,
  type Migration, type MigrationRecord, type ApplyMigrationsOptions,
  UnknownDatabaseError, UpstreamApplicationDatabaseError, MigrationIntegrityError,
} from './migrations.ts'
