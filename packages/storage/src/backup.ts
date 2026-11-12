/**
 * Consistent backup and restore (OPS-03): the SQLite online backup API takes a snapshot that
 * includes WAL content, and the restored copy is verified with integrity and foreign-key checks
 * before use. Restoring never resends business automatically — opening a restored database does
 * not start the effect queue; recovery is a deliberate reconcile-mode startup.
 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export interface BackupResult {
  destination: string
  bytes: number
  integrity: 'ok' | string
  foreignKeyViolations: number
  productSchema: number
}

export interface VerifyResult {
  integrity: 'ok' | string
  foreignKeyViolations: number
  productSchema: number | null
}

export interface WorkflowEvidenceFamily {
  name: string
  count: number
  /** SHA-256 over the ordered `identity:digest` rows; a bounded reference summary, not full content. */
  digest: string
  truncated: boolean
}

export interface WorkflowEvidenceSummary {
  protocol: 'workflow-evidence/1'
  families: readonly WorkflowEvidenceFamily[]
  digest: string
  complete: boolean
}

interface EvidenceFamilySpec {
  name: string
  /** FROM expression, possibly a join. */
  table: string
  /** Table used only for the existence probe. */
  existsTable?: string
  /** SQL expression for the stable identity used in the summary. */
  identity: string
  /** SQL expressions for the record body/nullable fields; hashed per row in Node. */
  body: readonly string[]
  /** Optional WHERE fragment, for legacy rows not shadowed by companion metadata. */
  where?: string
  order: string
}

const EVIDENCE_FAMILIES: readonly EvidenceFamilySpec[] = [
  { name: 'decisions',
    table: 'assistant_decision_versions m JOIN user_decision_versions d ON d.id = m.id AND d.version = m.version',
    existsTable: 'assistant_decision_versions',
    identity: "m.id || ':' || m.version",
    body: ['m.id', 'm.version', 'm.value_digest', 'm.source_message_id', 'm.source_text_digest', 'm.conversation_id', 'm.actor_ref', 'm.recorded_at', 'm.revoked_by', 'd.value'],
    order: 'm.id, m.version' },
  { name: 'legacy_decisions', table: 'user_decision_versions', identity: "id || ':' || version",
    body: ['value'], order: 'id, version',
    where: 'NOT EXISTS (SELECT 1 FROM assistant_decision_versions m WHERE m.id = user_decision_versions.id AND m.version = user_decision_versions.version)' },
  { name: 'proposals', table: 'assistant_proposal_versions', identity: "proposal_id || ':' || version",
    body: ['proposal_id', 'version', 'state', 'payload_digest', 'effect_command_id', 'superseded_by', 'value', 'digest'],
    order: 'proposal_id, version' },
  { name: 'project_settings', table: 'project_settings_versions', identity: "project_id || ':' || revision",
    body: ['project_id', 'revision', 'value', 'digest'], order: 'project_id, revision' },
  { name: 'contracts', table: 'contract_revisions', identity: "work_id || ':' || revision || ':' || digest",
    body: ['work_id', 'revision', 'digest', 'value'], order: 'work_id, revision, digest' },
  { name: 'verifications', table: 'completion_verifications', identity: 'id',
    body: ['id', 'ticket_id', 'assignment_id', 'candidate_generation', 'artifact_digest', 'criteria_digest', 'environment_ref', 'verifier_identity_ref', 'results', 'created_at'],
    order: 'id' },
  { name: 'acceptances', table: 'completion_acceptances', identity: 'id',
    body: ['id', 'ticket_id', 'assignment_id', 'candidate_generation', 'artifact_digest', 'criterion_ids', 'actor_ref', 'accepted_at'],
    order: 'id' },
  { name: 'outcomes', table: 'execution_outcome', identity: 'id', body: ['id', 'value', 'digest'], order: 'id' },
  { name: 'reviews', table: 'review_evidence', identity: 'id', body: ['id', 'value', 'digest'], order: 'id' },
  { name: 'recovery_intents', table: 'recovery_intents', identity: 'command_id',
    body: ['command_id', 'plan_id', 'plan_digest', 'inspection_fingerprint', 'source_fingerprint', 'user_id', 'actor_ref', 'payload', 'digest', 'created_at', 'expires_at'],
    order: 'created_at, plan_id' },
  { name: 'assistant_context_bindings', table: 'assistant_context_bindings', identity: 'message_id',
    body: ['message_id', 'command_id', 'request_id', 'project_id', 'conversation_id', 'user_text_digest',
      'principal_user_id', 'principal_authority_ref', 'bundle_ref', 'bundle_digest', 'confirmed_at', 'expires_at',
      'value', 'digest'],
    order: 'confirmed_at, message_id' },
  { name: 'recovery_activations', table: 'recovery_activations', identity: 'activation_id',
    body: ['activation_id', 'command_id', 'plan_id', 'plan_digest', 'source_json', 'target_json', 'principal_user_id',
      'principal_authority_ref', 'machine_digest', 'resource_policy_digest', 'created_at', 'expires_at', 'value', 'digest'],
    order: 'created_at, activation_id' },
]
const EVIDENCE_LIMIT = 2000

/**
 * Bounded reference summary of durable workflow evidence in a database snapshot. Each family lists
 * its identity set plus a digest over the actual record bodies, so a row change is visible even if
 * the database file bytes and manifest hash were re-recorded. It is not a second event authority
 * and does not return record bodies to callers.
 */
export function readWorkflowEvidence(databasePath: string): WorkflowEvidenceSummary {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const families: WorkflowEvidenceFamily[] = []
    for (const family of EVIDENCE_FAMILIES) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(family.existsTable ?? family.table)
      if (!exists) {
        families.push({ name: family.name, count: 0, digest: createHash('sha256').update('').digest('hex'), truncated: false })
        continue
      }
      const columns = [...family.body]
      const aliases = columns.map((expression, index) => `${expression} AS b${index}`)
      const rows = db.prepare(`SELECT ${family.identity} AS identity, ${aliases.join(', ')}
        FROM ${family.table}${family.where ? ` WHERE ${family.where}` : ''}
        ORDER BY ${family.order} LIMIT ${EVIDENCE_LIMIT + 1}`).all() as Record<string, unknown>[]
      const lines = rows.map(row => {
        const parts = columns.map((_, index) => {
          const value = row[`b${index}`]
          return value === null || value === undefined ? '\u0000' : String(value)
        })
        return `${String(row.identity)}\u0000${createHash('sha256').update(parts.join('\u0000')).digest('hex')}`
      })
      const truncated = lines.length > EVIDENCE_LIMIT
      const bounded = lines.slice(0, EVIDENCE_LIMIT)
      families.push({ name: family.name, count: bounded.length,
        digest: createHash('sha256').update(bounded.join('\n')).digest('hex'), truncated })
    }
    const digest = createHash('sha256')
      .update(families.map(family => `${family.name}:${family.count}:${family.digest}`).join('\n'))
      .digest('hex')
    return { protocol: 'workflow-evidence/1', families, digest, complete: families.every(family => !family.truncated) }
  } finally { db.close() }
}

export interface ArtifactRegistryRow {
  id: string
  digest: string
  bytes: number
  path: string
  createdAt: string
}

/** Report artifact references from routing evidence in a snapshot (for completeness checks). */
export function readRoutingArtifactRefs(databasePath: string): string[] {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const hasReview = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'review_evidence'").get()
    const hasBindings = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assistant_context_bindings'").get()
    if (!hasReview && !hasBindings) return []
    const refs = new Set<string>()
    if (hasReview) for (const row of db.prepare('SELECT DISTINCT report_artifact_ref FROM review_evidence').all() as Record<string, unknown>[])
      refs.add(String(row.report_artifact_ref))
    // A selected-context bundle must remain present for the audit row to be meaningful after restore.
    if (hasBindings) for (const row of db.prepare('SELECT DISTINCT bundle_ref FROM assistant_context_bindings').all() as Record<string, unknown>[])
      refs.add(String(row.bundle_ref))
    return [...refs].sort()
  } finally { db.close() }
}

/** Reads the artifact registry from a database snapshot without opening the live store. */
export function readArtifactRegistry(databasePath: string): ArtifactRegistryRow[] {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'").get()
    if (!exists) return []
    return (db.prepare('SELECT id, digest, bytes, path, created_at FROM artifacts ORDER BY created_at, id').all() as Record<string, unknown>[])
      .map(row => ({
        id: String(row.id), digest: String(row.digest), bytes: Number(row.bytes),
        path: String(row.path), createdAt: String(row.created_at),
      }))
  } finally { db.close() }
}

/** Runs integrity, foreign-key, and schema checks on a database file without starting any store. */
export function verifyDatabase(path: string): VerifyResult {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const integrity = String((db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check)
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length
    let productSchema: number | null = null
    try {
      const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as Record<string, unknown> | undefined
      if (row) productSchema = Number(JSON.parse(String(row.value)))
    } catch { /* a database without schema_meta is verified structurally only */ }
    return { integrity: integrity === 'ok' ? 'ok' : integrity, foreignKeyViolations, productSchema }
  } finally {
    db.close()
  }
}

/**
 * Takes a consistent snapshot of the live database (WAL included) to `destination`, then verifies
 * the restored copy. The destination must be a new path; the caller chooses a new state directory
 * for a restore rather than overwriting the live one.
 */
export async function backupDatabase(source: Database.Database, destination: string): Promise<BackupResult> {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  await source.backup(destination)
  const verified = verifyDatabase(destination)
  const bytes = (await import('node:fs')).statSync(destination).size
  return {
    destination,
    bytes,
    integrity: verified.integrity,
    foreignKeyViolations: verified.foreignKeyViolations,
    productSchema: verified.productSchema ?? 0,
  }
}
