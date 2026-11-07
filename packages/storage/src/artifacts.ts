/**
 * Content-addressed artifact files (DATA-05). Bytes are written to a temporary file, fsynced,
 * renamed into place, and only then may the caller insert the database reference — so a reference
 * never points at a half-written file. Garbage collection removes only files with no database row
 * and older than a grace period; referenced files (active, or copied into a backup) are never
 * touched. A crash between rename and insert leaves a complete-file orphan that the next GC pass
 * removes after the grace period.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type Database from 'better-sqlite3'

export interface ArtifactRecord {
  id: string
  digest: string
  bytes: number
  path: string
  createdAt: string
}

export interface WrittenArtifact {
  id: string
  digest: string
  bytes: number
  /** Path relative to the artifact root, as stored in the database. */
  path: string
}

export interface GcResult {
  removed: string[]
  kept: string[]
}

export class ArtifactStore {
  private readonly db: Database.Database
  private readonly filesDir: string
  private readonly tmpDir: string
  constructor(db: Database.Database, rootDir: string) {
    this.db = db
    this.filesDir = join(rootDir, 'artifacts')
    this.tmpDir = join(this.filesDir, 'tmp')
    mkdirSync(this.tmpDir, { recursive: true, mode: 0o700 })
  }

  /** The content address of the artifact with this ID. */
  filePath(id: string): string { return join(this.filesDir, id) }

  /**
   * Writes `data` durably and returns its complete-file record; the caller inserts the database
   * reference in the same transaction as the state change that refers to it. Identical content
   * yields the same content-addressed id, so a repeated write reuses the file.
   */
  write(data: Uint8Array): WrittenArtifact {
    const digest = createHash('sha256').update(data).digest('hex')
    const id = digest
    const target = this.filePath(id)
    if (!existsSync(target)) {
      const temp = join(this.tmpDir, `${digest}.${process.pid}.${Date.now()}`)
      const fd = openSync(temp, 'wx', 0o600)
      try {
        writeSync(fd, data)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temp, target)
      // fsync the directory so the rename itself is durable before a reference can exist.
      const dirFd = openSync(this.filesDir, 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    }
    return { id, digest, bytes: data.byteLength, path: relative(this.filesDir, target) }
  }

  /** Records a written artifact; content-addressed duplicates keep the first row. */
  insert(record: WrittenArtifact, createdAt = new Date().toISOString()): void {
    this.db.prepare('INSERT OR IGNORE INTO artifacts (id, digest, bytes, path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(record.id, record.digest, record.bytes, record.path, createdAt)
  }

  get(id: string): (ArtifactRecord & { absolutePath: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      id: String(row.id),
      digest: String(row.digest),
      bytes: Number(row.bytes),
      path: String(row.path),
      createdAt: String(row.created_at),
      absolutePath: this.filePath(String(row.id)),
    }
  }

  /** Reads a referenced artifact back and verifies its digest. */
  read(id: string): { record: ArtifactRecord; data: Uint8Array } | undefined {
    const record = this.get(id)
    if (!record) return undefined
    const data = readFileSync(record.absolutePath)
    if (createHash('sha256').update(data).digest('hex') !== record.digest) {
      throw new Error(`Artifact ${id} no longer matches its recorded digest`)
    }
    return { record, data }
  }

  /**
   * Removes temporary files and unreferenced files older than `graceMs`; referenced files are
   * always kept. Without a reference there is nothing a replay could resolve to, so the file is
   * safe to drop once any in-flight writer's grace period has passed.
   */
  gc(graceMs: number, now: number = Date.now()): GcResult {
    const referenced = new Set<string>(
      (this.db.prepare('SELECT id FROM artifacts').all() as Record<string, unknown>[]).map(row => String(row.id)),
    )
    const removed: string[] = []
    const kept: string[] = []
    const consider = (absolute: string): void => {
      const id = relative(this.filesDir, absolute)
      if (id.startsWith('tmp/') || !referenced.has(id)) {
        const age = now - statSync(absolute).mtimeMs
        if (age >= graceMs) { unlinkSync(absolute); removed.push(id) } else kept.push(id)
      } else kept.push(id)
    }
    for (const entry of readdirSync(this.tmpDir)) consider(join(this.tmpDir, entry))
    for (const entry of readdirSync(this.filesDir)) {
      if (entry === 'tmp') continue
      const absolute = join(this.filesDir, entry)
      if (statSync(absolute).isFile()) consider(absolute)
    }
    if (removed.length) {
      const dirFd = openSync(this.filesDir, 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    }
    return { removed, kept }
  }
}

/** Ensures the artifact root exists for a state directory. */
export function ensureArtifactRoot(rootDir: string): string {
  const dir = join(rootDir, 'artifacts')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  mkdirSync(join(dir, 'tmp'), { recursive: true, mode: 0o700 })
  return dir
}

/** The artifact root path under a state directory (exported for tests and callers). */
export const artifactRoot = (stateDir: string): string => join(stateDir, 'artifacts')
/** The directory that holds the database file's parent, for callers that pass only a DB path. */
export const stateDirOf = (databasePath: string): string => dirname(databasePath)
