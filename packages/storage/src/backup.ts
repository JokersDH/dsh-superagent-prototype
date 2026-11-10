/**
 * Consistent backup and restore (OPS-03): the SQLite online backup API takes a snapshot that
 * includes WAL content, and the restored copy is verified with integrity and foreign-key checks
 * before use. Restoring never resends business automatically — opening a restored database does
 * not start the effect queue; recovery is a deliberate reconcile-mode startup.
 */
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

export interface ArtifactRegistryRow {
  id: string
  digest: string
  bytes: number
  path: string
  createdAt: string
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
