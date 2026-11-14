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
import { ImmutablePayloads, RuntimeAuthority, RuntimeBindings } from './ingress.ts'
import { RuntimeObservations } from './observations.ts'
import { ProductRecords } from './product.ts'
import { WorkflowRecords } from './workflows.ts'
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
  /** Runtime-ingress storage: binding history/current, enabled-contract authority, immutable payloads. */
  readonly bindings: RuntimeBindings
  readonly authority: RuntimeAuthority
  readonly payloads: ImmutablePayloads
  /** Append-only runtime observations and the read-only reducer for the composition root. */
  readonly observations: RuntimeObservations
  /** Frozen application/Broker records: works, contracts, links, messages, questions, dispatch switch. */
  readonly product: ProductRecords
  /** Wave-03 A: conversation catalog/search/archive, project settings, decisions and read index. */
  readonly workflows: WorkflowRecords

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
    this.bindings = new RuntimeBindings(this.db)
    this.authority = new RuntimeAuthority(this.db)
    this.payloads = new ImmutablePayloads(this.db, this.artifacts)
    this.observations = new RuntimeObservations(this.db, this.uow, this.bindings)
    this.product = new ProductRecords(this.db, this.uow)
    this.workflows = new WorkflowRecords(this.db, this.uow, this.artifacts)
  }

  close(): void { this.database.close() }
}

/** The database-backed registry WriterLock uses for its atomic claim and nonce/liveness cross-check. */
export class InstanceRegistry implements LockRegistry {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }
  current(): LockContent | undefined {
    const row = this.db.prepare('SELECT nonce, pid, started_at FROM writer_claim WHERE id = 1').get() as Record<string, unknown> | undefined
    return row ? { nonce: String(row.nonce), pid: Number(row.pid), startedAt: String(row.started_at) } : undefined
  }
  has(nonce: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM coordinator_instances WHERE nonce = ?').get(nonce)
  }
  /** Atomic claim: one statement decides between every concurrent acquirer. */
  claim(entry: LockContent): boolean {
    const result = this.db.prepare('INSERT OR IGNORE INTO writer_claim (id, nonce, pid, started_at) VALUES (1, ?, ?, ?)')
      .run(entry.nonce, entry.pid, entry.startedAt)
    return Number(result.changes) === 1
  }
  /** Atomic stale takeover: only the taker that observed the same dead nonce can replace it. */
  takeOver(observedNonce: string, entry: LockContent): boolean {
    const result = this.db.prepare('UPDATE writer_claim SET nonce = ?, pid = ?, started_at = ? WHERE id = 1 AND nonce = ?')
      .run(entry.nonce, entry.pid, entry.startedAt, observedNonce)
    return Number(result.changes) === 1
  }
  /** Atomic conditional release: a holder taken over meanwhile matches no row. */
  release(nonce: string): boolean {
    return Number(this.db.prepare('DELETE FROM writer_claim WHERE id = 1 AND nonce = ?').run(nonce).changes) === 1
  }
  /** Audit row for instance history; never grants ownership. */
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
export {
  ProductRecords, ProductWorks, ProductContracts, ProductLinks, ProductMessages, ProductQuestions, ProductDispatchControls,
  ProductConflict, DispatchConflict, type NewConversationMessage, type DispatchControl,
} from './product.ts'
export {
  WorkflowRecords, ProductConversations, ProductProjects, ProductDecisions, WorkflowIndex, WorkflowConflict,
  type Conversation, type ConversationPage, type ConversationSearchHit, type ConversationSearchPage,
  type ProjectCheck, type ProjectEnvironment, type ProjectSettings, type ProjectVersion, type ProjectCurrent,
  type DecisionRecord, type WorkIndexEntry, type SourceMessageMetadata, type WorkflowStateFacts, type TimelineEntry, type EvidencePage,
} from './workflows.ts'
export { AssistantState, type LegacyDecisionRecord } from './assistant-state.ts'
export { AssistantContextBindingStore } from './assistant-context.ts'
export { AssistantContextHistoryStore } from './assistant-context-history.ts'
export { AssistantReplyResultStore } from './assistant-reply-results.ts'
export { RecoverySourceStore } from './recovery-source.ts'
export { inspectSchemaInventory, type SchemaInventory } from './schema-inventory.ts'
export { requiredSchemaObjects, TARGET_INDEX_TABLES } from './target-inventory.ts'
export { RoutingEvidence, type RoutingEvidenceSources } from './routing-evidence.ts'
export { AcceptanceOutcomeProjection, type AcceptanceProjectionInput, type AcceptanceProjectionResult } from './acceptance-outcome.ts'
export { RecoveryIntents, type RecoveryIntentInput, type RecoveryIntentRecord, type RecoveryIntentPage } from './recovery-intents.ts'
export { RecoveryActivations } from './recovery-activations.ts'
export {
  RecoveryTargetInventoryReaderImpl, TARGET_TABLE_CATEGORIES, createRecoveryTargetInventoryReader,
  migratedTableNames, recoveryTargetInventory,
} from './target-inventory.ts'
export { ArtifactStore, ensureArtifactRoot, artifactRoot, stateDirOf, type ArtifactRecord, type WrittenArtifact, type GcResult } from './artifacts.ts'
export {
  RuntimeBindings, RuntimeAuthority, ImmutablePayloads, BindingConflict, PayloadConflict, AuthorityConflict,
  canonicalJson, canonicalDigest, type BindingIdentity,
} from './ingress.ts'
export {
  RuntimeObservations, ObservationConflict, type ObservationDisposition, type ObservationInput,
  type RuntimeObservationRow, type ResourceObservationRow, type ResourceObservationSummary,
  type AttemptObservationSummary, type WriterStatus,
} from './observations.ts'
export {
  backupDatabase, verifyDatabase, readArtifactRegistry, readRoutingArtifactRefs, readWorkflowEvidence, EVIDENCE_FAMILY_SET_VERSION,
  type ArtifactRegistryRow, type WorkflowEvidenceFamily, type WorkflowEvidenceSummary, type BackupResult, type VerifyResult,
} from './backup.ts'
export { WriterLock, WriterLockHeld, type LockContent, type LockProbe, type LockRegistry, type LockVerdict } from './writer-lock.ts'
export {
  MIGRATIONS, PRODUCT_SCHEMA_VERSION, applyMigrations, migrationChecksum, refuseUnknownDatabase,
  type Migration, type MigrationRecord, type ApplyMigrationsOptions,
  UnknownDatabaseError, UpstreamApplicationDatabaseError, MigrationIntegrityError,
} from './migrations.ts'

export { readWorkflowContent, CONTENT_PROOF_PROTOCOL, CONTENT_OMITTED_TABLES, DEFAULT_CONTENT_PROOF_LIMITS, type ContentCollection, type ContentProofLimits, type WorkflowContentSummary } from './content-proof.ts'
