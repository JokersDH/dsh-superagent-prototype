/**
 * Wave-09 A1: read-only recovery target inventory. A target database (plus any WAL) is copied to a
 * private temporary directory and opened readonly there, so the target directory itself is never
 * created, migrated, locked or written. Unknown tables / newer schemas are unsupported, never an
 * empty valid target. `startupAvailable` is always false: this is not a start permission or proof
 * that any historical writer stopped.
 */
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, lstatSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS, PRODUCT_SCHEMA_VERSION } from './migrations.ts'
import type { RecoveryTargetInventory as Inventory, RecoveryTargetInventoryReader } from '@personal-agent/contracts'

type Issue = Inventory['issues'][number]

/** Tables that only hold schema/host bookkeeping; their rows do not imply business residue. */
const METADATA_TABLES = new Set([
  'schema_meta', 'coordinator_instances', 'writer_claim', 'artifacts', 'ingress_payloads',
  'event_log', 'command_receipts', 'fact_receipts',
])
/** FTS5 shadow tables are derived index storage; their internal config rows are not business data. */
const INDEX_TABLE = /^conversation_search(?:_|$)/
const MIN_SUPPORTED_SCHEMA = 1
const MAX_TABLES = 256

/** Table names this build's migration registry creates; used to validate the classification itself. */
export function migratedTableNames(): string[] {
  const names = new Set<string>()
  for (const migration of MIGRATIONS)
    for (const statement of migration.statements) {
      const match = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(statement)
      if (match?.[1]) names.add(match[1])
    }
  return [...names].sort()
}

export const TARGET_TABLE_CATEGORIES: Readonly<Record<string, 'metadata' | 'business'>> = Object.freeze({
  ...Object.fromEntries([...METADATA_TABLES].map(name => [name, 'metadata' as const])),
  conversations: 'business', conversation_members: 'business', conversation_messages: 'business',
  works: 'business', contract_revisions: 'business', ticket_links: 'business',
  user_questions: 'business', dispatch_controls: 'business',
  trigger: 'business', disposition: 'business', thread: 'business', ticket: 'business', decision: 'business',
  trigger_thread: 'business', effect: 'business', dispatch_receipts: 'business', channel_receipts: 'business',
  answers: 'business', answer_deliveries: 'business',
  runtime_bindings: 'business', runtime_current: 'business', runtime_authority: 'business',
  runtime_observations: 'business', resource_observations: 'business',
  completion_verifications: 'business', completion_quiescence: 'business', completion_acceptances: 'business',
  project_settings_versions: 'business', project_settings_current: 'business',
  user_decision_versions: 'business', assistant_decision_versions: 'business', assistant_proposal_versions: 'business',
  route_advice: 'business', review_evidence: 'business', execution_outcome: 'business',
  recovery_intents: 'business', recovery_activations: 'business',
})

const categoryOf = (name: string): 'metadata' | 'business' | 'unknown' =>
  TARGET_TABLE_CATEGORIES[name] ?? (INDEX_TABLE.test(name) ? 'metadata' : 'unknown')

interface FileDigest { digest: string | null; stable: boolean; exists: boolean; regular: boolean }

/** Reads one file once; size/mtime/inode must be unchanged before and after. */
function stableFileDigest(path: string): FileDigest {
  let before
  try { before = lstatSync(path) } catch { return { digest: null, stable: true, exists: false, regular: true } }
  if (!before.isFile() || before.isSymbolicLink())
    return { digest: null, stable: false, exists: true, regular: false }
  try {
    const fd = openSync(path, 'r')
    try {
      const chunks: Buffer[] = []
      const buffer = Buffer.alloc(64 * 1024)
      let read = 0
      for (;;) {
        const count = readSync(fd, buffer, 0, buffer.length, null)
        if (count <= 0) break
        chunks.push(Buffer.from(buffer.subarray(0, count)))
        read += count
      }
      const after = statSync(path)
      const stable = before.size === after.size && before.mtimeMs === after.mtimeMs &&
        before.ino === after.ino && read === before.size
      return stable
        ? { digest: createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), stable: true, exists: true, regular: true }
        : { digest: null, stable: false, exists: true, regular: true }
    } finally { closeSync(fd) }
  } catch { return { digest: null, stable: false, exists: true, regular: true } }
}

/**
 * Digest covers `state.sqlite` plus `state.sqlite-wal` only when both were read without concurrent
 * change. `-shm` is shared memory, not durable material, and is excluded. This is a byte digest of
 * the observed snapshot, not proof that the directory or credentials are complete.
 */
function materialDigest(stateRoot: string): { digest: string | null; issues: Issue[] } {
  const database = stableFileDigest(join(stateRoot, 'state.sqlite'))
  const wal = stableFileDigest(join(stateRoot, 'state.sqlite-wal'))
  const issues: Issue[] = []
  if (!database.regular || !wal.regular) issues.push('unsafe_link')
  else if (!database.stable || !wal.stable) issues.push('busy_or_changed')
  if (!database.exists) return { digest: null, issues }
  const hash = createHash('sha256')
  hash.update(`db:${database.exists ? 'present' : 'absent'}:`).update(database.digest ?? '')
  hash.update(`\nwal:${wal.exists ? 'present' : 'absent'}:`).update(wal.digest ?? '')
  return { digest: hash.digest('hex'), issues }
}

interface Snapshot { directory: string | undefined; issues: Issue[]; exists: boolean; changed: boolean }

/** Copies the DB/WAL to a private temp dir; the target directory is only read. */
function copySnapshot(stateRoot: string): Snapshot {
  const databasePath = join(stateRoot, 'state.sqlite')
  let before
  try { before = lstatSync(databasePath) } catch { return { directory: undefined, issues: [], exists: false, changed: false } }
  if (!before.isFile() || before.isSymbolicLink())
    return { directory: undefined, issues: ['unsafe_link'], exists: true, changed: false }
  const walPath = `${databasePath}-wal`
  let wal: ReturnType<typeof lstatSync> | undefined
  try { wal = lstatSync(walPath) } catch { wal = undefined }
  if (wal && (!wal.isFile() || wal.isSymbolicLink()))
    return { directory: undefined, issues: ['unsafe_link'], exists: true, changed: false }
  const directory = mkdtempSync(join(tmpdir(), 'pa-target-inventory-'))
  try {
    copyFileSync(databasePath, join(directory, 'state.sqlite'))
    if (wal) copyFileSync(walPath, join(directory, 'state.sqlite-wal'))
    const after = lstatSync(databasePath)
    const walAfter = wal ? lstatSync(walPath) : undefined
    const changed = before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino ||
      (wal !== undefined) !== (walAfter !== undefined) ||
      (wal && walAfter && (wal.size !== walAfter.size || wal.mtimeMs !== walAfter.mtimeMs || wal.ino !== walAfter.ino))
    return { directory, issues: changed ? ['busy_or_changed'] : [], exists: true, changed: Boolean(changed) }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    return { directory: undefined, issues: ['busy_or_changed'], exists: true, changed: true, ...{ error: String(error) } }
  }
}

export class RecoveryTargetInventoryReaderImpl implements RecoveryTargetInventoryReader {
  inspect(stateRoot: string): Inventory {
    const observedAt = new Date().toISOString()
    const issues = new Set<Issue>()
    const tables: { name: string; category: 'metadata' | 'business' | 'unknown'; rows: number }[] = []
    let productSchema: number | null = null
    let integrity: Inventory['integrity'] = 'unknown'
    let completeness: Inventory['completeness'] = 'unsupported'

    const finish = (digest: string | null): Inventory => ({
      protocol: 'recovery-target-inventory/1', stateRoot, observedAt, productSchema, databaseDigest: digest,
      integrity, completeness, tables, issues: [...issues], startupAvailable: false,
    })

    let root
    try { root = lstatSync(stateRoot) } catch { issues.add('missing_database'); return finish(null) }
    if (!root.isDirectory() || root.isSymbolicLink()) {
      issues.add('unsafe_link')
      return finish(null)
    }
    if ((root.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && root.uid !== process.getuid()))
      issues.add('not_private')

    const material = materialDigest(stateRoot)
    for (const issue of material.issues) issues.add(issue)
    const snapshot = copySnapshot(stateRoot)
    for (const issue of snapshot.issues) issues.add(issue)
    if (!snapshot.exists) {
      issues.add('missing_database')
      return finish(material.digest)
    }
    if (!snapshot.directory) {
      completeness = issues.has('busy_or_changed') ? 'bounded' : 'unsupported'
      return finish(material.digest)
    }

    let db: Database.Database | undefined
    try {
      db = new Database(join(snapshot.directory, 'state.sqlite'), { readonly: true, fileMustExist: true })
      const integrityRow = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
      integrity = integrityRow?.integrity_check === 'ok' ? 'ok' : 'failed'
      if (integrity === 'failed') issues.add('integrity_failed')
      const schemaRow = db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value?: string } | undefined
      if (schemaRow?.value !== undefined) {
        try { productSchema = Number(JSON.parse(String(schemaRow.value))) } catch { productSchema = null }
      }
      const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
        .map(row => row.name)
      const bounded = names.length > MAX_TABLES
      for (const name of names.slice(0, MAX_TABLES)) {
        const category = categoryOf(name)
        if (category === 'unknown') issues.add('unknown_table')
        const rows = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get() as { n: number }).n)
        tables.push({ name, category, rows })
      }
      if (productSchema === null || !Number.isSafeInteger(productSchema) ||
        productSchema < MIN_SUPPORTED_SCHEMA || productSchema > PRODUCT_SCHEMA_VERSION) issues.add('unsupported_schema')
      if (issues.has('unsupported_schema') || issues.has('unknown_table') || issues.has('integrity_failed'))
        completeness = 'unsupported'
      else if (bounded || issues.has('busy_or_changed')) completeness = 'bounded'
      else completeness = 'complete'
      if (tables.some(table => table.category === 'business' && table.rows > 0)) issues.add('business_rows_present')
    } catch (error) {
      const text = `${(error as NodeJS.ErrnoException).code ?? ''} ${String(error)}`
      if (/SQLITE_NOTADB|SQLITE_CORRUPT|malformed/i.test(text)) {
        integrity = 'failed'
        issues.add('integrity_failed')
      } else if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(text)) issues.add('busy_or_changed')
      else issues.add('unsupported_schema')
      completeness = issues.has('busy_or_changed') ? 'bounded' : 'unsupported'
    } finally {
      db?.close()
      rmSync(snapshot.directory, { recursive: true, force: true })
    }
    return finish(material.digest)
  }
}

/** Store-independent readonly reader for main/D consumers; it never opens the target writable. */
export const recoveryTargetInventory = new RecoveryTargetInventoryReaderImpl()
export const createRecoveryTargetInventoryReader = (): RecoveryTargetInventoryReader => new RecoveryTargetInventoryReaderImpl()
