/**
 * The single migration entry. Storage owns every product table and an unbroken sequence of
 * migration numbers; other packages submit schema requests, the storage owner folds them into
 * new migration versions. Each migration body carries a checksum recorded in `schema_meta`,
 * so an edited body or a skipped, interrupted, or future-versioned database refuses to open
 * instead of silently drifting (DATA-06).
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  /** DDL and data statements, applied in order inside one transaction. */
  statements: readonly string[]
}

export interface MigrationRecord {
  version: number
  name: string
  checksum: string
  appliedAt: string
}

/** Refuses to open a database this build cannot interpret. */
export class UnknownDatabaseError extends Error {}
/** The upstream dsh-superagent application database, which this product must not adopt in place. */
export class UpstreamApplicationDatabaseError extends Error {}
/** Recorded migrations do not match this build's registered migrations (drift, gap, or future version). */
export class MigrationIntegrityError extends Error {}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
/** Content checksum of a migration body; recorded on apply and verified on every open. */
export const migrationChecksum = (migration: Migration): string => sha256(`${migration.statements.join(';\n')};\n`)

/**
 * Product schema v1. Domain aggregate tables, generated columns, and partial indexes are the
 * extracted upstream SQL (src/app/store.ts): JSON rows keep the aggregates, generated columns
 * express the active working sets so periodic scans stay independent of history length.
 */
const V1: Migration = {
  version: 1,
  name: 'product-v1',
  statements: [
    `CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE coordinator_instances (nonce TEXT PRIMARY KEY, pid INTEGER NOT NULL, started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL)`,
    `CREATE TABLE trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL)`,
    `CREATE TABLE disposition (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE thread (key TEXT PRIMARY KEY, value TEXT NOT NULL,
      active INTEGER AS (CASE WHEN json_array_length(value, '$.pending') > 0 OR value -> '$.evaluating' IS NOT NULL THEN 1 END),
      subscribed TEXT AS (CASE WHEN json_array_length(value, '$.subscriptions') > 0 THEN value ->> '$.ref.source' END))`,
    `CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL,
      open INTEGER AS (CASE WHEN value -> '$.ended' IS NULL THEN 1 END),
      active INTEGER AS (CASE WHEN json_array_length(value, '$.undelivered') > 0 OR value ->> '$.assignments[#-1].state' IN ('pending', 'running') THEN 1 END))`,
    `CREATE TABLE decision (id TEXT PRIMARY KEY, thread TEXT NOT NULL, value TEXT NOT NULL)`,
    `CREATE TABLE trigger_thread (thread TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, human INTEGER NOT NULL, PRIMARY KEY (thread, id))`,
    `CREATE INDEX trigger_at ON trigger (at)`,
    `CREATE INDEX trigger_thread_at ON trigger_thread (thread, at)`,
    `CREATE INDEX thread_active ON thread (active) WHERE active IS NOT NULL`,
    `CREATE INDEX thread_subscribed ON thread (subscribed) WHERE subscribed IS NOT NULL`,
    `CREATE INDEX ticket_open ON ticket (open) WHERE open IS NOT NULL`,
    `CREATE INDEX ticket_active ON ticket (active) WHERE active IS NOT NULL`,
    `CREATE INDEX decision_thread ON decision (thread)`,
    `CREATE TABLE effect (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, seq INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      due INTEGER NOT NULL, since TEXT NOT NULL, parked_reason TEXT, parked_at TEXT, PRIMARY KEY (kind, key))`,
    `CREATE INDEX effect_due ON effect (kind, due, seq)`,
    `CREATE INDEX effect_parked ON effect (parked_at) WHERE parked_at IS NOT NULL`,
    `CREATE TABLE command_receipts (command_id TEXT PRIMARY KEY, payload_digest TEXT NOT NULL, status TEXT NOT NULL, seq INTEGER NOT NULL, result TEXT, recorded_at TEXT NOT NULL)`,
    `CREATE TABLE fact_receipts (fact_id TEXT PRIMARY KEY, payload_digest TEXT NOT NULL, seq INTEGER NOT NULL, recorded_at TEXT NOT NULL)`,
    `CREATE TABLE event_log (seq INTEGER PRIMARY KEY, topic TEXT NOT NULL, entity_ref TEXT NOT NULL, payload TEXT, payload_ref TEXT, at TEXT NOT NULL,
      CHECK (payload IS NOT NULL OR payload_ref IS NOT NULL))`,
    `CREATE INDEX event_topic ON event_log (topic, seq)`,
    `CREATE TABLE dispatch_receipts (command_id TEXT NOT NULL, target TEXT NOT NULL, delivery TEXT NOT NULL, native_ref TEXT, error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (command_id, target))`,
    `CREATE TABLE channel_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL,
      pending TEXT AS (CASE WHEN value ->> '$.status' = 'pending' AND value ->> '$.ticketId' IS NOT NULL THEN (value ->> '$.ticketId') || ' ' || (value ->> '$.channel.thread') END))`,
    `CREATE TABLE answers (answer_id TEXT PRIMARY KEY, question_id TEXT NOT NULL, expected_version INTEGER NOT NULL, answer_digest TEXT NOT NULL, answer TEXT NOT NULL, recorded_at TEXT NOT NULL)`,
    `CREATE TABLE answer_deliveries (answer_id TEXT NOT NULL REFERENCES answers (answer_id), target_binding_id TEXT NOT NULL, status TEXT NOT NULL, evidence TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (answer_id, target_binding_id))`,
    `CREATE TABLE artifacts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, bytes INTEGER NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL)`,
  ],
}

/**
 * v2: the single-row writer claim. Ownership is decided by atomic INSERT/CAS/DELETE on this one
 * row, so two concurrent acquirers or stale takers can never both become owner (REL-03).
 */
const V2: Migration = {
  version: 2,
  name: 'writer-claim',
  statements: [
    `CREATE TABLE writer_claim (id INTEGER PRIMARY KEY CHECK (id = 1), nonce TEXT NOT NULL, pid INTEGER NOT NULL, started_at TEXT NOT NULL)`,
  ],
}

/**
 * v3: production runtime-ingress storage (WP-01 ingress store request). Bindings are retained by
 * attempt for history, with a separate current-by-ticket pointer; `runtime_authority` holds the
 * enabled contract revisions used for the current-authorization check; `ingress_payloads` records
 * immutable, content-addressed payload references. Normalized observation reducers stay in the
 * composition bridge; this owner supplies the durable pieces.
 */
const V3: Migration = {
  version: 3,
  name: 'runtime-ingress-storage',
  statements: [
    `CREATE TABLE runtime_bindings (attempt_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL)`,
    `CREATE INDEX runtime_bindings_ticket ON runtime_bindings (ticket_id)`,
    `CREATE TABLE runtime_current (ticket_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL)`,
    `CREATE TABLE runtime_authority (work_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (work_id, revision, digest))`,
    `CREATE TABLE ingress_payloads (ref TEXT PRIMARY KEY, sha256 TEXT NOT NULL, artifact_id TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  ],
}

/**
 * v4: runtime-state invariants. At most one enabled contract revision per Work (the current
 * authorization), and one digest per Work/revision (a re-issued revision with different content is
 * a conflict). The unique indexes are the database-level backstop for the storage invariants; the
 * application methods report the conflict explicitly. A pre-v4 database that already holds
 * conflicting authority rows fails to upgrade rather than silently choosing one.
 */
const V4: Migration = {
  version: 4,
  name: 'runtime-state-invariants',
  statements: [
    `CREATE UNIQUE INDEX runtime_authority_one_enabled ON runtime_authority (work_id) WHERE enabled = 1`,
    `CREATE UNIQUE INDEX runtime_authority_revision ON runtime_authority (work_id, revision)`,
  ],
}

/**
 * v5: runtime observations. Every accepted runtime fact leaves one attempt-level observation row
 * (identity, contract, kind, disposition, original fact/payload references and the normalized
 * non-authoritative detail) and, for physical payloads, one row per resource it reports. Rows are
 * append-only evidence: nothing here releases resources, changes the current pointer or grants
 * authorization; cancel ACK, exit and writer facts stay independent.
 */
const V5: Migration = {
  version: 5,
  name: 'runtime-observations',
  statements: [
    `CREATE TABLE runtime_observations (fact_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL, fence_epoch INTEGER NOT NULL, contract TEXT NOT NULL, kind TEXT NOT NULL,
      disposition TEXT NOT NULL, payload_ref TEXT NOT NULL, payload_sha256 TEXT NOT NULL, detail TEXT NOT NULL,
      observed_at TEXT NOT NULL)`,
    `CREATE INDEX runtime_observations_attempt ON runtime_observations (attempt_id, observed_at)`,
    `CREATE INDEX runtime_observations_ticket ON runtime_observations (ticket_id, observed_at)`,
    `CREATE TABLE resource_observations (fact_id TEXT NOT NULL REFERENCES runtime_observations (fact_id),
      attempt_id TEXT NOT NULL, resource_ref TEXT NOT NULL, ownership TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT, exit_code INTEGER, signal TEXT, observed_at TEXT NOT NULL, PRIMARY KEY (fact_id, resource_ref))`,
    `CREATE INDEX resource_observations_resource ON resource_observations (resource_ref, observed_at)`,
    `CREATE INDEX resource_observations_attempt ON resource_observations (attempt_id, resource_ref)`,
  ],
}

/**
 * v6: trusted completion evidence (WP-04). Immutable records the core CompletionVerifier reads on
 * the same connection: a Verification bound to the candidate/artifact/criteria digest, candidate-bound
 * quiescence whose evidence is derived from runtime observations at record time, and a human
 * acceptance record. Nothing here decides completion; the core gate judges these records.
 */
const V6: Migration = {
  version: 6,
  name: 'completion-evidence',
  statements: [
    `CREATE TABLE completion_verifications (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
      candidate_generation INTEGER NOT NULL, contract TEXT NOT NULL, artifact_digest TEXT NOT NULL,
      criteria_digest TEXT NOT NULL, environment_ref TEXT NOT NULL, verifier_identity_ref TEXT NOT NULL,
      results TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX completion_verifications_candidate ON completion_verifications (ticket_id, assignment_id, candidate_generation)`,
    `CREATE TABLE completion_quiescence (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
      candidate_generation INTEGER NOT NULL, contract TEXT NOT NULL, artifact_digest TEXT NOT NULL,
      attempt_id TEXT NOT NULL, resource_refs TEXT NOT NULL, evidence TEXT NOT NULL, observed_at TEXT NOT NULL)`,
    `CREATE INDEX completion_quiescence_candidate ON completion_quiescence (ticket_id, assignment_id, candidate_generation)`,
    `CREATE TABLE completion_acceptances (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
      candidate_generation INTEGER NOT NULL, contract TEXT NOT NULL, artifact_digest TEXT NOT NULL,
      criterion_ids TEXT NOT NULL, actor_ref TEXT NOT NULL, accepted_at TEXT NOT NULL)`,
    `CREATE INDEX completion_acceptances_candidate ON completion_acceptances (ticket_id, assignment_id, candidate_generation)`,
  ],
}

/**
 * v7: product records for the application/Broker (wave-02 A2). Frozen Work identity, contract
 * revisions, contract↔Ticket links (one primary per revision), persisted conversation messages with
 * a per-conversation sequence, user questions with a validity/version CAS, and the manual dispatch
 * switch. Status/phase transitions stay with core and the Broker; these tables only hold records.
 */
const V7: Migration = {
  version: 7,
  name: 'product-records',
  statements: [
    `CREATE TABLE works (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX works_project ON works (project_id, created_at DESC, id)`,
    `CREATE TABLE contract_revisions (work_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL,
      authority_ref TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (work_id, revision, digest))`,
    `CREATE INDEX contract_revisions_work ON contract_revisions (work_id, revision DESC)`,
    `CREATE TABLE ticket_links (work_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, ticket_id TEXT NOT NULL,
      role TEXT NOT NULL, authority_ref TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (work_id, revision, digest, ticket_id))`,
    `CREATE UNIQUE INDEX ticket_links_primary ON ticket_links (work_id, revision, digest) WHERE role = 'primary'`,
    `CREATE INDEX ticket_links_work ON ticket_links (work_id, revision DESC)`,
    `CREATE TABLE conversation_messages (conversation_id TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (conversation_id, sequence))`,
    `CREATE TABLE user_questions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, work_id TEXT NOT NULL, revision INTEGER NOT NULL,
      digest TEXT NOT NULL, validity TEXT NOT NULL, opened_at TEXT NOT NULL, value TEXT NOT NULL)`,
    `CREATE INDEX user_questions_open ON user_questions (validity, work_id, opened_at DESC)`,
    `CREATE TABLE dispatch_controls (scope TEXT PRIMARY KEY, paused INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
  ],
}


/**
 * v8: durable conversation catalog and bounded search. Conversations are identity/title/index rows;
 * messages remain in `conversation_messages`. FTS5 trigram matches bounded substrings (including
 * Chinese and short ASCII), while archive only changes catalog visibility. Backfill makes a v7
 * database usable without rewriting message identities.
 */
const V8: Migration = {
  version: 8,
  name: 'conversation-catalog',
  statements: [
    `CREATE TABLE conversations (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, title_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
      archive_revision INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX conversations_catalog ON conversations (archived_at, updated_at DESC, id DESC)`,
    `CREATE INDEX conversations_project ON conversations (project_id, archived_at, updated_at DESC, id DESC)`,
    `CREATE VIRTUAL TABLE conversation_search USING fts5(
      conversation_id UNINDEXED, message_id UNINDEXED, title, text, tokenize='trigram')`,
    `INSERT OR IGNORE INTO conversations (id, project_id, title, title_revision, created_at, updated_at)
      SELECT conversation_id, project_id, json_extract(value, '$.title'), 1, created_at, created_at FROM works`,
    `INSERT OR IGNORE INTO conversations (id, project_id, title, title_revision, created_at, updated_at)
      SELECT conversation_id, NULL, 'Conversation', 1, MIN(created_at), MAX(created_at)
      FROM conversation_messages GROUP BY conversation_id`,
    `UPDATE conversations SET project_id = COALESCE(project_id,
      (SELECT project_id FROM works WHERE works.conversation_id = conversations.id ORDER BY created_at, id LIMIT 1))
      WHERE project_id IS NULL`,
    `UPDATE conversations SET title = COALESCE(NULLIF(
      (SELECT substr(json_extract(value, '$.text'), 1, 120) FROM conversation_messages
       WHERE conversation_id = conversations.id ORDER BY sequence LIMIT 1), ''), title)
      WHERE title = 'Conversation'`,
    `INSERT INTO conversation_search (conversation_id, message_id, title, text)
      SELECT id, '', title, '' FROM conversations`,
    `INSERT INTO conversation_search (conversation_id, message_id, title, text)
      SELECT conversation_id, id, '', json_extract(value, '$.text') FROM conversation_messages`,
  ],
}

/**
 * v9: versioned project settings. Old settings stay as immutable history; a separate current row
 * carries the active revision and archive CAS. It stores a source digest/reference, never a model
 * credential or a second Work lifecycle.
 */
const V9: Migration = {
  version: 9,
  name: 'project-settings',
  statements: [
    `CREATE TABLE project_settings_versions (
      project_id TEXT NOT NULL, revision INTEGER NOT NULL, display_name TEXT, path_digest TEXT NOT NULL,
      check_kind TEXT NOT NULL, environment TEXT, source_ref TEXT NOT NULL, value TEXT NOT NULL,
      digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, revision))`,
    `CREATE INDEX project_settings_history ON project_settings_versions (project_id, revision DESC)`,
    `CREATE TABLE project_settings_current (
      project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, archived_at TEXT,
      archive_revision INTEGER NOT NULL DEFAULT 0)`,
  ],
}

/**
 * v10: explicit user decisions. Versions are append-only; revocation appends a newer version with
 * `revokedAt`, and scope/project/source are queryable. This table records decisions; it does not
 * infer rules or grant execution authority.
 */
const V10: Migration = {
  version: 10,
  name: 'user-decisions',
  statements: [
    `CREATE TABLE user_decision_versions (
      id TEXT NOT NULL, version INTEGER NOT NULL, project_id TEXT NOT NULL, content TEXT NOT NULL,
      authority_ref TEXT NOT NULL, supersedes TEXT, revoked_at TEXT, value TEXT NOT NULL,
      digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (id, version))`,
    `CREATE INDEX user_decisions_project ON user_decision_versions (project_id, version DESC, id)`,
    `CREATE INDEX user_decisions_current ON user_decision_versions (id, version DESC)`,
  ],
}


/**
 * v11: assistant-state persistence beside the existing decision ledger. Decision metadata references
 * the same (id, version) UserDecision row, so this is not a second decision authority; proposals are
 * append-only versions. Legacy decisions without metadata stay readable through the old ledger and
 * are never presented as having verified source evidence.
 */
const V11: Migration = {
  version: 11,
  name: 'assistant-state',
  statements: [
    `CREATE TABLE assistant_decision_versions (
      id TEXT NOT NULL, version INTEGER NOT NULL, project_id TEXT NOT NULL,
      source_message_id TEXT NOT NULL, source_text_digest TEXT NOT NULL, conversation_id TEXT NOT NULL,
      actor_ref TEXT NOT NULL, recorded_at TEXT NOT NULL, revoked_by TEXT, value_digest TEXT NOT NULL,
      PRIMARY KEY (id, version),
      FOREIGN KEY (id, version) REFERENCES user_decision_versions (id, version))`,
    `CREATE INDEX assistant_decisions_project ON assistant_decision_versions (project_id, id, version DESC)`,
    `CREATE TABLE assistant_proposal_versions (
      proposal_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL,
      project_id TEXT NOT NULL, conversation_id TEXT NOT NULL, source_message_id TEXT NOT NULL,
      source_text_digest TEXT NOT NULL, actor_ref TEXT NOT NULL, grant_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      effect_command_id TEXT, superseded_by TEXT, value TEXT NOT NULL, digest TEXT NOT NULL,
      PRIMARY KEY (proposal_id, version))`,
    `CREATE INDEX assistant_proposals_project ON assistant_proposal_versions (project_id, proposal_id, version DESC)`,
    `CREATE INDEX assistant_proposals_conversation ON assistant_proposal_versions (conversation_id, updated_at DESC)`,
  ],
}

/**
 * v12: indexed conversation membership. A conversation can be referenced by multiple projects
 * through its messages/works; an empty authorized project list means no rows, never global discovery.
 * The explicit discovery methods are separately named in the workflow port.
 */
const V12: Migration = {
  version: 12,
  name: 'conversation-members',
  statements: [
    `CREATE TABLE conversation_members (
      conversation_id TEXT NOT NULL, project_id TEXT NOT NULL,
      PRIMARY KEY (conversation_id, project_id))`,
    `CREATE INDEX conversation_members_project ON conversation_members (project_id, conversation_id)`,
    `CREATE INDEX works_conversation ON works (conversation_id, created_at DESC, id DESC)`,
    `INSERT OR IGNORE INTO conversation_members (conversation_id, project_id)
      SELECT id, project_id FROM conversations WHERE project_id IS NOT NULL`,
    `INSERT OR IGNORE INTO conversation_members (conversation_id, project_id)
      SELECT conversation_id, project_id FROM works WHERE project_id IS NOT NULL`,
    `INSERT OR IGNORE INTO conversation_members (conversation_id, project_id)
      SELECT conversation_id, json_extract(value, '$.projectId') FROM conversation_messages
      WHERE json_extract(value, '$.projectId') IS NOT NULL`,
  ],
}


/**
 * v13: routing/review/outcome evidence. Immutable, append-only facts from trusted producers. The
 * projection layer decides currentness; this table never rewrites a record or infers a review PASS,
 * acceptance, current profile or model reward.
 */
const V13: Migration = {
  version: 13,
  name: 'routing-evidence',
  statements: [
    `CREATE TABLE route_advice (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      source_ref TEXT NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL)`,
    `CREATE INDEX route_advice_project ON route_advice (project_id, created_at DESC, id DESC)`,
    `CREATE TABLE review_evidence (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, subject_digest TEXT NOT NULL, subject_value TEXT NOT NULL,
      layer TEXT NOT NULL, disposition TEXT NOT NULL, observed_at TEXT NOT NULL,
      report_artifact_ref TEXT NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL)`,
    `CREATE INDEX review_evidence_project ON review_evidence (project_id, observed_at DESC, id DESC)`,
    `CREATE INDEX review_evidence_subject ON review_evidence (project_id, subject_digest, observed_at DESC)`,
    `CREATE TABLE execution_outcome (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_key TEXT NOT NULL, attempt_key TEXT NOT NULL,
      layer TEXT NOT NULL, acceptance TEXT NOT NULL, observed_at TEXT NOT NULL, value TEXT NOT NULL, digest TEXT NOT NULL)`,
    `CREATE INDEX execution_outcome_project ON execution_outcome (project_id, observed_at DESC, id DESC)`,
    `CREATE INDEX execution_outcome_profile ON execution_outcome (project_id, profile_key, observed_at DESC, id DESC)`,
  ],
}


/**
 * v14: recovery intent facts. One immutable intent per plan, keyed by the caller's command receipt.
 * This is an audit fact for main's planned activation protocol, not an execution authorization: the
 * row alone never grants native work, deletes a restore marker or consumes an old queue.
 */
const V14: Migration = {
  version: 14,
  name: 'recovery-intents',
  statements: [
    `CREATE TABLE recovery_intents (
      command_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE, plan_digest TEXT NOT NULL,
      inspection_fingerprint TEXT NOT NULL, source_fingerprint TEXT NOT NULL, user_id TEXT NOT NULL,
      actor_ref TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
    `CREATE INDEX recovery_intents_source ON recovery_intents (source_fingerprint, created_at DESC)`,
    `CREATE INDEX recovery_intents_created ON recovery_intents (created_at DESC, plan_id)`,
  ],
}

/** The registry this build applies, in order; the highest version is the product schema version. */
export const MIGRATIONS: readonly Migration[] = [V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11, V12, V13, V14]
export const PRODUCT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

const row = (db: Database.Database, sql: string, ...args: unknown[]): Record<string, unknown> | undefined =>
  db.prepare(sql).get(...args) as Record<string, unknown> | undefined

const readMeta = (db: Database.Database): { productSchema?: number; migrations: MigrationRecord[] } => {
  const schema = row(db, 'SELECT value FROM schema_meta WHERE key = ?', 'product_schema')
  const migrations = row(db, 'SELECT value FROM schema_meta WHERE key = ?', 'migrations')
  return {
    ...(schema ? { productSchema: Number(JSON.parse(String(schema.value))) } : {}),
    migrations: migrations ? JSON.parse(String(migrations.value)) as MigrationRecord[] : [],
  }
}

const writeMeta = (db: Database.Database, key: string, value: string): void => {
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

const userTables = (db: Database.Database): string[] =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
    .map(item => String((item as Record<string, unknown>).name))

/**
 * Refuses databases this build must not adopt: the upstream dsh-superagent application
 * database (its `kv` table marks it), and any database with user tables but no `schema_meta`.
 */
export function refuseUnknownDatabase(db: Database.Database): void {
  const tables = userTables(db)
  if (!tables.length) return
  if (tables.includes('kv')) {
    throw new UpstreamApplicationDatabaseError(
      'This is an original dsh-superagent application database; the product cannot open it in place. Use a new state directory or follow the documented migration path.',
    )
  }
  if (!tables.includes('schema_meta')) {
    throw new UnknownDatabaseError(`This database has tables but no product schema_meta: ${tables.join(', ')}.`)
  }
}

const verifyApplied = (registry: readonly Migration[], applied: MigrationRecord[]): void => {
  const recorded = new Map(applied.map(entry => [entry.version, entry]))
  let previous = 0
  for (const entry of applied) {
    if (entry.version !== previous + 1) throw new MigrationIntegrityError(`Applied migrations have a gap at version ${entry.version}`)
    previous = entry.version
    const migration = registry[entry.version - 1]
    if (!migration || migration.version !== entry.version) {
      throw new MigrationIntegrityError(`Applied migration ${entry.version} is not registered in this build`)
    }
    if (entry.name !== migration.name || entry.checksum !== migrationChecksum(migration)) {
      throw new MigrationIntegrityError(`Migration ${entry.version} (${entry.name}) changed after being applied; a new migration version is required`)
    }
  }
  if (previous > registry.length) {
    throw new MigrationIntegrityError(`The database is at schema ${previous}, newer than this build's ${registry.length}; refuse to open`)
  }
}

export interface ApplyMigrationsOptions {
  /** Registry override, for tests; defaults to this build's registry. */
  registry?: readonly Migration[]
  now?: () => Date
}

/**
 * Verifies recorded migrations against the registry, then applies each pending migration in one
 * transaction, recording its checksum in `schema_meta` in the same commit. An interrupted
 * migration rolls back and re-applies cleanly on the next open; a failing migration aborts the
 * open with the database unchanged, never skipped.
 */
export function applyMigrations(db: Database.Database, options: ApplyMigrationsOptions = {}): { applied: number; productSchema: number } {
  const registry = options.registry ?? MIGRATIONS
  const now = options.now ?? (() => new Date())
  refuseUnknownDatabase(db)
  const hasMeta = userTables(db).includes('schema_meta')
  const meta = hasMeta ? readMeta(db) : { migrations: [] }
  verifyApplied(registry, meta.migrations)
  const applied = meta.migrations.length
  for (const migration of registry.slice(applied)) {
    const at = now().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const statement of migration.statements) db.exec(statement)
      const records: MigrationRecord[] = [
        ...meta.migrations,
        { version: migration.version, name: migration.name, checksum: migrationChecksum(migration), appliedAt: at },
      ]
      writeMeta(db, 'product_schema', JSON.stringify(migration.version))
      writeMeta(db, 'migrations', JSON.stringify(records))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    meta.migrations.push({ version: migration.version, name: migration.name, checksum: migrationChecksum(migration), appliedAt: at })
  }
  return { applied: registry.length - applied, productSchema: registry[registry.length - 1]!.version }
}
