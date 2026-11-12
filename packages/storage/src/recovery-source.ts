/**
 * Wave-11 A1/A2: bounded logical recovery-source snapshot over the existing product connection.
 * It reads logical business/resource/queue rows and the stable writer identity, never marker/host/
 * profile data or startup authority. A complete snapshot is still not proof that a physical writer
 * stopped. Only one exact, already-committed recovery confirmation may be excluded; everything else
 * (including receipts, events and resources) stays visible.
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { RecoveryActivationCommitSchema, RecoverySourceCheckpointSchema, RecoverySourceCheckpointQuerySchema } from '@personal-agent/contracts'
import type { RecoveryActivationCommit, RecoverySourceCheckpoint, RecoverySourceCheckpointQuery, RecoverySourceReader } from '@personal-agent/contracts'
import { MIGRATIONS, PRODUCT_SCHEMA_VERSION } from './migrations.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'

const INDEX_TABLES = new Set([
  'conversation_search', 'conversation_search_data', 'conversation_search_idx',
  'conversation_search_content', 'conversation_search_docsize', 'conversation_search_config',
])
const DEFAULT_MAX_ROWS = 20000
const DEFAULT_MAX_ROWS_PER_FAMILY = 10000

/** Logical families: every necessary business/resource/queue row plus the stable writer identity. */
const FAMILIES = [
  'coordinator_instances', 'writer_claim', 'trigger', 'disposition', 'thread', 'ticket', 'decision',
  'trigger_thread', 'effect', 'dispatch_receipts', 'channel_receipts', 'answers', 'answer_deliveries',
  'command_receipts', 'fact_receipts', 'event_log', 'artifacts', 'ingress_payloads',
  'runtime_bindings', 'runtime_current', 'runtime_authority', 'runtime_observations', 'resource_observations',
  'completion_verifications', 'completion_quiescence', 'completion_acceptances',
  'works', 'contract_revisions', 'ticket_links', 'conversation_messages', 'user_questions', 'dispatch_controls',
  'conversations', 'conversation_members', 'project_settings_versions', 'project_settings_current',
  'user_decision_versions', 'assistant_decision_versions', 'assistant_proposal_versions',
  'route_advice', 'review_evidence', 'execution_outcome',
  'recovery_intents', 'recovery_activations', 'assistant_context_bindings', 'assistant_reply_results',
] as const

const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

type Row = Record<string, unknown>
interface Exclusions {
  activationId: string
  commandId: string
  receiptSeq: number
  recoveryPayloadDigest: string
}

function expectedTables(): Set<string> {
  const names = new Set<string>(INDEX_TABLES)
  for (const migration of MIGRATIONS)
    for (const statement of migration.statements) {
      const match = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(statement)
      if (match?.[1]) names.add(match[1])
    }
  return names
}

/** Stable, order-independent row text; only the fixed heartbeat column is volatile. */
function rowText(table: string, row: Row): string {
  const entries = Object.keys(row).filter(key => !(table === 'coordinator_instances' && key === 'heartbeat_at'))
    .sort().map(key => {
      const value = row[key]
      if (value === null || value === undefined) return [key, null]
      if (value instanceof Uint8Array) return [key, { bytes: Buffer.from(value).toString('base64') }]
      if (typeof value === 'bigint') return [key, value.toString()]
      return [key, value]
    })
  return JSON.stringify(entries)
}

function excluded(table: string, row: Row, exclusions: Exclusions | undefined): boolean {
  if (!exclusions) return false
  if (table === 'recovery_activations') return String(row.activation_id) === exclusions.activationId
  if (table === 'command_receipts') return String(row.command_id) === exclusions.commandId
  if (table === 'event_log') {
    const seq = Number(row.seq)
    if (seq === exclusions.receiptSeq && String(row.topic) === 'command' && String(row.entity_ref) === exclusions.commandId) return true
    return String(row.topic) === 'application.recovery.intent' && String(row.entity_ref) === exclusions.activationId &&
      shaPayload(row.payload === null ? null : String(row.payload)) === exclusions.recoveryPayloadDigest
  }
  return false
}
/** The event body is the intent JSON; its canonical digest must equal the check used to exclude it. */
function shaPayload(payload: string | null): string {
  if (payload === null) return ''
  try { return digest(JSON.parse(payload)) } catch { return '' }
}

export class RecoverySourceStore implements RecoverySourceReader {
  private readonly db: Database.Database
  constructor(db: Database.Database) { this.db = db }

  private productSchema(): number | null {
    try {
      const row = this.db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as Row | undefined
      if (!row) return null
      const parsed = JSON.parse(String(row.value))
      return typeof parsed === 'number' && Number.isSafeInteger(parsed) ? parsed : null
    } catch { return null }
  }

  /** Verifies the exact A fact, original receipt and both exact events before excluding anything. */
  private exclusionsFor(input: RecoveryActivationCommit | undefined): Exclusions | undefined {
    if (!input) return undefined
    let commit: RecoveryActivationCommit
    try { commit = RecoveryActivationCommitSchema.parse(input) } catch (error) {
      throw new WorkflowConflict(`Illegal recovery confirmation exclusion: ${String(error)}`)
    }
    const activation = this.db.prepare('SELECT * FROM recovery_activations WHERE activation_id = ?').get(commit.intent.activationId) as Row | undefined
    if (!activation || String(activation.command_id) !== commit.intent.commandId ||
      String(activation.digest) !== digest(commit.intent) || String(activation.value) !== JSON.stringify(commit.intent))
      throw new WorkflowConflict('Recovery confirmation exclusion does not name an exact committed A fact')
    const receipt = this.db.prepare('SELECT * FROM command_receipts WHERE command_id = ?').get(commit.intent.commandId) as Row | undefined
    if (!receipt || Number(receipt.seq) !== commit.sourceReceipt.seq || String(receipt.status) !== 'recorded' ||
      String(receipt.payload_digest) !== digest({ intent: commit.intent, actor: { ...commit.intent.principal, source: 'local_ui' } }) &&
      String(receipt.payload_digest) !== digest({ intent: commit.intent, actor: { ...commit.intent.principal, source: 'local_cli' } }) ||
      String(receipt.result) !== JSON.stringify(commit.intent))
      throw new WorkflowConflict('Recovery confirmation exclusion does not match the original receipt')
    const commandEvent = this.db.prepare('SELECT * FROM event_log WHERE seq = ?').get(commit.sourceReceipt.seq) as Row | undefined
    if (!commandEvent || String(commandEvent.topic) !== 'command' || String(commandEvent.entity_ref) !== commit.intent.commandId)
      throw new WorkflowConflict('Recovery confirmation exclusion does not match the original command event')
    const intentEvent = this.db.prepare("SELECT * FROM event_log WHERE topic = 'application.recovery.intent' AND entity_ref = ?")
      .get(commit.intent.activationId) as Row | undefined
    if (!intentEvent || String(intentEvent.payload) !== JSON.stringify(commit.intent))
      throw new WorkflowConflict('Recovery confirmation exclusion does not match the exact intent event')
    return { activationId: commit.intent.activationId, commandId: commit.intent.commandId,
      receiptSeq: commit.sourceReceipt.seq, recoveryPayloadDigest: digest(commit.intent) }
  }

  inspect(input: RecoverySourceCheckpointQuery = {}): RecoverySourceCheckpoint {
    const query = RecoverySourceCheckpointQuerySchema.parse(input)
    const exclusions = this.exclusionsFor(query.ignoreCommitted)
    const maxRows = query.maxRows ?? DEFAULT_MAX_ROWS, perFamily = query.maxRowsPerFamily ?? DEFAULT_MAX_ROWS_PER_FAMILY
    const issues = new Set<RecoverySourceCheckpoint['issues'][number]>()
    const tables = (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map(row => String(row.name))
    const known = expectedTables(), present = new Set(tables)
    const schema = this.productSchema()
    if (schema !== PRODUCT_SCHEMA_VERSION) issues.add('unsupported_schema')
    for (const table of tables) if (!known.has(table) && !table.startsWith('sqlite_')) issues.add('unknown_table')
    for (const table of known) if (!present.has(table) && !INDEX_TABLES.has(table)) issues.add('missing_table')
    const observedEventCursor = Number((this.db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM event_log').get() as Row).seq)
    const families: { name: string; rows: number; digest: string; truncated: boolean }[] = []
    let total = 0, truncated = false, readable = schema === PRODUCT_SCHEMA_VERSION
    const scan = this.db.transaction(() => {
      for (const name of FAMILIES) {
        if (!present.has(name)) {
          families.push({ name, rows: 0, digest: sha(''), truncated: false })
          continue
        }
        const rows = this.db.prepare(`SELECT * FROM ${name} ORDER BY rowid LIMIT ${perFamily + 1}`).all() as Row[]
        const kept: string[] = []
        for (const row of rows) {
          if (excluded(name, row, exclusions)) continue
          kept.push(rowText(name, row))
        }
        const bounded = kept.length > perFamily, keptBounded = bounded ? kept.slice(0, perFamily) : kept
        if (bounded) { truncated = true; issues.add('scan_bounded') }
        if (total + keptBounded.length > maxRows) { truncated = true; issues.add('scan_bounded') }
        const allowed = Math.max(0, maxRows - total)
        const use = keptBounded.slice(0, allowed)
        if (use.length < keptBounded.length) { truncated = true; issues.add('scan_bounded') }
        total += use.length
        use.sort()
        families.push({ name, rows: use.length, digest: sha(use.join('\n')), truncated: bounded || use.length < keptBounded.length })
      }
    })
    scan()
    if (truncated || issues.has('scan_bounded')) readable = false
    if (issues.has('unsupported_schema') || issues.has('unknown_table') || issues.has('missing_table')) readable = false
    const unsupported = issues.has('unsupported_schema') || issues.has('unknown_table') || issues.has('missing_table')
    const coverage: RecoverySourceCheckpoint['coverage'] = unsupported ? 'unsupported' : readable ? 'complete' : 'bounded'
    const ordered = [...families].sort((left, right) => left.name.localeCompare(right.name))
    const fingerprint = coverage === 'complete'
      ? sha(['recovery-source-checkpoint/1', `schema:${schema}`, ...ordered.map(family => `${family.name}:${family.rows}:${family.digest}`)].join('\n'))
      : null
    return RecoverySourceCheckpointSchema.parse({
      protocol: 'recovery-source-checkpoint/1', observedAt: new Date().toISOString(), productSchema: schema,
      observedEventCursor, coverage, sourceFingerprint: fingerprint, families: ordered,
      ignoredConfirmation: exclusions ? { activationId: exclusions.activationId, commandId: exclusions.commandId,
        receiptSeq: exclusions.receiptSeq } : null,
      volatileFieldsIgnored: ['coordinator_instances.heartbeat_at'],
      issues: [...issues], startupAvailable: false,
    })
  }
}
