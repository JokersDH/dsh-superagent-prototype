/**
 * Capture a complete, consistent view of one private state directory into a staging area:
 *
 * - the database through the storage snapshot port (`backupDatabase` uses SQLite's online backup
 *   API, so WAL content is included and a concurrent writer is handled by the engine), then
 *   `verifyDatabase` for integrity/foreign-key/schema facts;
 * - every artifact referenced by that consistent snapshot, copied and re-hashed;
 * - the non-secret project binding file (paths and check settings only);
 * - an explicit exclusion list for credentials, runtime records, machine-bound environment
 *   authority, derived worktrees, caches and unclassified files.
 *
 * Nothing outside the state directory is read, and no business command is sent.
 */
import { createHash } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { once } from 'node:events'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import Database from 'better-sqlite3'
import { artifactRoot, backupDatabase, verifyDatabase, type VerifyResult } from '@personal-agent/storage'
import { PortabilityError } from './errors.ts'
import type { DatabaseFacts, ExcludedEntry, PathBinding, WriterClaimFacts } from './manifest.ts'

export interface StagingFile {
  /** Path inside the bundle archive, already validated. */
  readonly path: string
  /** Absolute staged file path. */
  readonly source: string
  readonly bytes: number
  readonly sha256: string
}

export interface SnapshotResult {
  readonly database: StagingFile
  readonly artifacts: readonly (StagingFile & { readonly id: string; readonly digest: string })[]
  readonly config: readonly StagingFile[]
  readonly databaseFacts: DatabaseFacts
  readonly pathMap: readonly PathBinding[]
  readonly excluded: readonly ExcludedEntry[]
  readonly sourceStateName: string
  readonly unreferencedArtifacts: number
  readonly sqliteVersion: string
}

export interface SnapshotOptions {
  readonly stateDir: string
  readonly stagingDir: string
  readonly now?: Date
}

const EXCLUDED_NAMES: ReadonlyMap<string, string> = new Map([
  ['workbench.json', 'launcher-runtime-record'],
  ['instance.json', 'launcher-runtime-record'],
  ['launcher.json', 'launcher-runtime-record'],
  ['scratch-project.json', 'development-fixture-reference'],
  ['native-sessions', 'native-session-material'],
  ['environments', 'machine-bound-environment-authority'],
  ['workspaces', 'derived-worktrees'],
  ['logs', 'runtime-log'],
  ['cache', 'cache'],
  ['node_modules', 'dependencies'],
])

const CREDENTIAL = /\.key$/

const hashedCopy = async (source: string, destination: string): Promise<{ bytes: number; sha256: string }> => {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const hash = createHash('sha256')
  const output = createWriteStream(destination, { mode: 0o600 })
  for await (const chunk of createReadStream(source)) {
    hash.update(chunk)
    if (!output.write(chunk)) await once(output, 'drain')
  }
  output.end()
  await once(output, 'close')
  const fd = openSync(destination, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const stat = lstatSync(destination)
  return { bytes: stat.size, sha256: hash.digest('hex') }
}

const assertPrivateState = (stateDir: string): string => {
  if (!isAbsolute(stateDir))
    throw new PortabilityError('invalid_root', 'State directory must be absolute', { stateDir })
  let stat
  try {
    stat = lstatSync(stateDir)
  } catch {
    throw new PortabilityError('database_unavailable', 'State directory does not exist', { stateDir })
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new PortabilityError('unsafe_root', 'State directory must be a real directory', { stateDir })
  if (process.getuid && stat.uid !== process.getuid())
    throw new PortabilityError('unsafe_root', 'State directory is not owned by the current user', { stateDir })
  if ((stat.mode & 0o077) !== 0)
    throw new PortabilityError('unsafe_root', 'State directory is visible to other users', { stateDir, mode: (stat.mode & 0o777).toString(8) })
  return realpathSync(stateDir)
}

interface LiveFacts {
  readonly writerClaim: WriterClaimFacts | null
  readonly eventSeq: number | null
  readonly productSchema: number | null
  readonly sqlite: string
}

function liveFacts(db: Database.Database): LiveFacts {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name),
  )
  let writerClaim: WriterClaimFacts | null = null
  if (tables.has('writer_claim')) {
    const claim = db.prepare('SELECT nonce, pid, started_at FROM writer_claim WHERE id = 1').get() as
      | { nonce: string; pid: number; started_at: string }
      | undefined
    if (claim) {
      let heartbeatAt: string | null = null
      if (tables.has('coordinator_instances')) {
        const row = db.prepare('SELECT heartbeat_at FROM coordinator_instances WHERE nonce = ?').get(claim.nonce) as
          | { heartbeat_at: string }
          | undefined
        heartbeatAt = row?.heartbeat_at ?? null
      }
      writerClaim = { pid: Number(claim.pid), startedAt: String(claim.started_at), heartbeatAt }
    }
  }
  let eventSeq: number | null = null
  if (tables.has('event_log')) {
    const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log').get() as { seq: number }
    eventSeq = Number(row.seq)
  }
  let productSchema: number | null = null
  if (tables.has('schema_meta')) {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value: string } | undefined
    if (row) {
      try { productSchema = Number(JSON.parse(String(row.value))) } catch { productSchema = null }
    }
  }
  const sqlite = String((db.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version)
  return { writerClaim, eventSeq, productSchema, sqlite }
}

const safeArtifactPath = (artifactRootDir: string, recorded: string, id: string): string => {
  const segments = recorded.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\')))
    throw new PortabilityError('artifact_missing', 'Artifact record has an unsafe path', { id })
  const absolute = join(artifactRootDir, recorded)
  const rel = relative(artifactRootDir, absolute)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new PortabilityError('artifact_missing', 'Artifact record points outside the artifact root', { id })
  return absolute
}

interface ProjectBindingFile {
  readonly projects: readonly PathBinding[]
}

function readProjectBindings(path: string): ProjectBindingFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new PortabilityError('config_invalid', 'Project binding file is not valid JSON', { file: basename(path) })
  }
  const projects: PathBinding[] = []
  const record = parsed as { projects?: unknown }
  if (Array.isArray(record?.projects)) {
    for (const project of record.projects) {
      const candidate = project as { path?: unknown; environment?: { storeDir?: unknown } }
      if (typeof candidate?.path === 'string' && candidate.path.length > 0 && candidate.path.length <= 4096)
        projects.push({ role: 'project', original: candidate.path, note: 'rebind on restore; revalidate environment' })
      const storeDir = candidate?.environment?.storeDir
      if (typeof storeDir === 'string' && storeDir.length > 0 && storeDir.length <= 4096)
        projects.push({ role: 'project-environment', original: storeDir, note: 're-probe on restore' })
    }
  }
  return { projects }
}

/** Capture the state directory into `stagingDir`; every staged file is sized and hashed. */
export async function snapshotState(options: SnapshotOptions): Promise<SnapshotResult> {
  const stateDir = assertPrivateState(options.stateDir)
  const stagingRoot = options.stagingDir
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
  const databasePath = join(stateDir, 'state.sqlite')
  if (!existsSync(databasePath))
    throw new PortabilityError('database_unavailable', 'No product database exists in this state directory', {
      state: basename(stateDir),
    })
  const stagedDatabase = join(stagingRoot, 'state.sqlite')
  mkdirSync(dirname(stagedDatabase), { recursive: true, mode: 0o700 })

  let live: Database.Database
  try {
    live = new Database(databasePath, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new PortabilityError('database_unavailable', 'Cannot open the product database read-only', {
      cause: String((error as { message?: string }).message ?? error),
    })
  }
  let facts: LiveFacts
  let verified: VerifyResult
  try {
    facts = liveFacts(live)
    const backup = await backupDatabase(live, stagedDatabase)
    verified = verifyDatabase(stagedDatabase)
    if (verified.integrity !== 'ok' || verified.foreignKeyViolations !== 0)
      throw new PortabilityError('database_verify_failed', 'Consistent snapshot failed integrity or foreign-key checks', {
        integrity: backup.integrity,
        foreignKeyViolations: backup.foreignKeyViolations,
      })
  } finally {
    live.close()
  }
  const databaseCopy = await hashedCopy(stagedDatabase, join(stagingRoot, 'hashed-state.sqlite'))
  if (databaseCopy.bytes !== lstatSync(stagedDatabase).size)
    throw new PortabilityError('database_verify_failed', 'Staged database copy does not match its snapshot')

  const artifactsRootDir = artifactRoot(stateDir)
  const snapshotDb = new Database(stagedDatabase, { readonly: true, fileMustExist: true })
  let artifactRows: { id: string; digest: string; bytes: number; path: string }[]
  try {
    artifactRows = snapshotDb.prepare('SELECT id, digest, bytes, path FROM artifacts ORDER BY id').all() as {
      id: string
      digest: string
      bytes: number
      path: string
    }[]
  } finally {
    snapshotDb.close()
  }

  const artifacts: (StagingFile & { id: string; digest: string })[] = []
  const stagedArtifactIds = new Set<string>()
  for (const row of artifactRows) {
    const source = safeArtifactPath(artifactsRootDir, row.path, row.id)
    if (!existsSync(source))
      throw new PortabilityError('artifact_missing', 'A database-referenced artifact file is missing', { id: row.id })
    const destination = join(stagingRoot, 'artifacts', row.id)
    const copy = await hashedCopy(source, destination)
    if (copy.bytes !== Number(row.bytes) || copy.sha256 !== row.digest)
      throw new PortabilityError('artifact_digest_mismatch', 'A database-referenced artifact does not match its recorded digest', {
        id: row.id,
        expectedBytes: Number(row.bytes),
        observedBytes: copy.bytes,
      })
    if (row.id !== row.digest)
      throw new PortabilityError('artifact_digest_mismatch', 'Artifact id is not its content digest', { id: row.id })
    artifacts.push({ id: row.id, digest: row.digest, path: `artifacts/${row.id}`, source: destination, bytes: copy.bytes, sha256: copy.sha256 })
    stagedArtifactIds.add(row.id)
  }

  const config: StagingFile[] = []
  const pathMap: PathBinding[] = []
  const configPath = join(stateDir, 'native-projects.json')
  if (existsSync(configPath)) {
    const stat = lstatSync(configPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
      throw new PortabilityError('config_invalid', 'Project binding file is unsafe or too large')
    const bindings = readProjectBindings(configPath)
    pathMap.push(...bindings.projects)
    const destination = join(stagingRoot, 'config', 'native-projects.json')
    const copy = await hashedCopy(configPath, destination)
    config.push({ path: 'config/native-projects.json', source: destination, bytes: copy.bytes, sha256: copy.sha256 })
  }

  const excluded: ExcludedEntry[] = []
  let unreferencedArtifacts = 0
  for (const name of readdirSync(stateDir).sort()) {
    if (name === 'state.sqlite' || name === 'state.sqlite-wal' || name === 'state.sqlite-shm') {
      excluded.push({ path: name, reason: 'captured-as-consistent-snapshot' })
      continue
    }
    if (name === 'artifacts') continue
    if (name === 'native-projects.json') continue
    if (CREDENTIAL.test(name)) {
      excluded.push({ path: name, reason: 'credential' })
      continue
    }
    const known = EXCLUDED_NAMES.get(name)
    if (known) {
      excluded.push({ path: name, reason: known })
      continue
    }
    excluded.push({ path: name, reason: 'unclassified-state-file' })
  }
  if (existsSync(artifactsRootDir)) {
    for (const entry of readdirSync(artifactsRootDir)) {
      if (entry === 'tmp' || !stagedArtifactIds.has(entry)) unreferencedArtifacts += 1
    }
    if (unreferencedArtifacts > 0)
      excluded.push({ path: 'artifacts', reason: `unreferenced-or-temporary-files:${unreferencedArtifacts}` })
  }

  const databaseFacts: DatabaseFacts = {
    integrity: verified.integrity,
    foreignKeyViolations: verified.foreignKeyViolations,
    productSchema: verified.productSchema,
    snapshotBytes: databaseCopy.bytes,
    eventSeq: facts.eventSeq,
    writerClaim: facts.writerClaim,
  }
  return {
    database: { path: 'state/state.sqlite', source: join(stagingRoot, 'hashed-state.sqlite'), bytes: databaseCopy.bytes, sha256: databaseCopy.sha256 },
    artifacts,
    config,
    databaseFacts,
    pathMap,
    excluded,
    sourceStateName: basename(stateDir),
    unreferencedArtifacts,
    sqliteVersion: facts.sqlite,
  }
}
