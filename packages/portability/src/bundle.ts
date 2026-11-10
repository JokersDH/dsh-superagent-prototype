/**
 * Create and verify a complete `pa-backup/1` bundle.
 *
 * Creation takes the consistent database snapshot through the storage port, stages and re-hashes
 * every referenced artifact and the non-secret project binding file, writes the manifest first, and
 * archives all staged bytes. Verification is independent of creation: it re-reads the archive,
 * validates structure/limits/paths, re-hashes every entry, compares the manifest exactly, and runs
 * SQLite integrity/foreign-key/schema checks on the archived database.
 */
import { createHash } from 'node:crypto'
import { closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyDatabase, type VerifyResult } from '@personal-agent/storage'
import { PortabilityError } from './errors.ts'
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_LIMITS,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  canonicalJson,
  manifestDigest,
  validateManifest,
  type BackupManifest,
  type BundleEntry,
} from './manifest.ts'
import { createHashingSink, readTarGz, writeTarGz, type ArchiveSource, type HashedEntry } from './archive.ts'
import { snapshotState } from './snapshot.ts'

export interface CreateBundleOptions {
  /** Absolute private state directory to back up (the coordinator `--state` directory). */
  readonly stateDir: string
  /** Absolute output bundle path; the parent must exist. */
  readonly outputPath: string
  /** Absolute private staging root (e.g. the product cache root). */
  readonly stagingRoot: string
  readonly productVersion?: string
  readonly toolVersion?: string
  readonly instance?: { readonly running: boolean; readonly access: string | null }
  readonly now?: Date
  /** Self-verify after writing (default true). */
  readonly verify?: boolean
}

export interface BundleResult {
  readonly bundlePath: string
  readonly archiveSha256: string
  readonly bytes: number
  readonly manifest: BackupManifest
}

export interface VerifyBundleResult {
  readonly manifest: BackupManifest
  readonly manifestDigest: string
  readonly archiveSha256: string
  readonly bytes: number
  readonly entries: readonly HashedEntry[]
  readonly database: VerifyResult
}

const LIMITATIONS = [
  'Account homes, model/API keys, native authentication, native session material and environment authority receipts are not included.',
  'Project and worktree content is not included; only non-secret project bindings are carried and must be explicitly rebound/revalidated.',
  'Runtime records, sockets, PIDs, caches and node_modules are not included.',
  'Restoring into a new directory does not replay begin/deliver/answer and does not start the daemon.',
] as const

const hashFile = (path: string): string => {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

const privateTempDir = (stagingRoot: string): string => {
  const directory = mkdtempSync(join(stagingRoot, 'pa-backup-'))
  return directory
}

export async function createBundle(options: CreateBundleOptions): Promise<BundleResult> {
  const staging = privateTempDir(options.stagingRoot)
  try {
    const snapshot = await snapshotState({ stateDir: options.stateDir, stagingDir: join(staging, 'files') })
    const entries: BundleEntry[] = [
      { path: snapshot.database.path, bytes: snapshot.database.bytes, sha256: snapshot.database.sha256, kind: 'database' as const },
      ...snapshot.artifacts.map((artifact) => ({
        path: artifact.path,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        kind: 'artifact' as const,
      })),
      ...snapshot.config.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256, kind: 'config' as const })),
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

    const now = options.now ?? new Date()
    const manifest: BackupManifest = validateManifest({
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      createdAt: now.toISOString(),
      producer: {
        product: 'dsh-superagent',
        version: options.productVersion ?? process.env.PA_PRODUCT_VERSION ?? '0.1.0',
        node: process.versions.node,
        sqlite: snapshot.sqliteVersion,
        platform: process.platform,
        arch: process.arch,
        tool: options.toolVersion ?? 'pa-backup/1',
      },
      source: {
        stateName: snapshot.sourceStateName,
        instanceRunning: options.instance?.running ?? false,
        access: options.instance?.access ?? null,
      },
      selection: {
        database: true,
        artifacts: true,
        config: snapshot.config.map((file) => file.path),
        excluded: snapshot.excluded,
        includeProjectContent: false,
      },
      pathMap: snapshot.pathMap,
      entries,
      artifactRefs: snapshot.artifacts.map((artifact) => ({
        id: artifact.id,
        digest: artifact.digest,
        bytes: artifact.bytes,
        entry: artifact.path,
      })),
      database: snapshot.databaseFacts,
      counts: { entries: entries.length, artifacts: snapshot.artifacts.length, excluded: snapshot.excluded.length },
      evidence: {
        protocol: snapshot.evidence.protocol,
        formatVersion: snapshot.evidence.formatVersion,
        digest: snapshot.evidence.digest,
        productSchema: snapshot.evidence.productSchema,
        counts: snapshot.evidence.counts,
        routingEvidence: snapshot.evidence.routingEvidence,
        limitations: snapshot.evidence.limitations,
      },
      limitations: [
        ...LIMITATIONS,
        ...(snapshot.databaseFacts.writerClaim
          ? ['A writer claim was recorded in the snapshot; its old pid/nonce is historical and never becomes authority on restore.']
          : []),
      ],
    })

    const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`)
    if (manifestBytes.byteLength > BUNDLE_LIMITS.maxManifestBytes)
      throw new PortabilityError('archive_limit_exceeded', 'Bundle manifest exceeds the size budget', {
        bytes: manifestBytes.byteLength,
      })
    const staged = new Map<string, string>([
      [snapshot.database.path, snapshot.database.source],
      ...snapshot.artifacts.map((artifact) => [artifact.path, artifact.source] as const),
      ...snapshot.config.map((file) => [file.path, file.source] as const),
    ])
    const archiveEntries: ArchiveSource[] = [
      { path: MANIFEST_ENTRY, source: manifestBytes },
      ...entries.map((entry) => ({ path: entry.path, source: staged.get(entry.path) as string })),
    ]
    await writeTarGz(options.outputPath, archiveEntries)
    const bytes = statSync(options.outputPath).size
    if (bytes > BUNDLE_LIMITS.maxArchiveBytes)
      throw new PortabilityError('archive_limit_exceeded', 'Bundle archive exceeds the size budget', { bytes })
    const archiveSha256 = hashFile(options.outputPath)
    if (options.verify !== false) {
      const verified = await verifyBundle(options.outputPath, { stagingRoot: options.stagingRoot })
      if (verified.manifestDigest !== manifestDigest(manifest))
        throw new PortabilityError('manifest_invalid', 'Self-verification read a different manifest')
    }
    return { bundlePath: options.outputPath, archiveSha256, bytes, manifest }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export interface VerifyBundleOptions {
  /** Private temporary root for the extracted database check; defaults to the OS temp dir. */
  readonly stagingRoot?: string
}

export async function verifyBundle(bundlePath: string, options: VerifyBundleOptions = {}): Promise<VerifyBundleResult> {
  let stat
  try {
    stat = lstatSync(bundlePath)
  } catch {
    throw new PortabilityError('archive_invalid', 'Bundle file does not exist', { path: bundlePath })
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new PortabilityError('archive_invalid', 'Bundle must be a regular file', { path: bundlePath })
  if (stat.size > BUNDLE_LIMITS.maxArchiveBytes)
    throw new PortabilityError('archive_limit_exceeded', 'Bundle file exceeds the size budget', { bytes: stat.size })

  const staging = mkdtempSync(join(options.stagingRoot ?? tmpdir(), 'pa-verify-'))
  const databasePath = join(staging, 'state.sqlite')
  let databaseFd: number | null = null
  const manifestChunks: Buffer[] = []
  let manifestBytes = 0
  try {
    const { sink, entries } = createHashingSink((path, chunk) => {
      if (path === MANIFEST_ENTRY) {
        manifestBytes += chunk.byteLength
        if (manifestBytes > BUNDLE_LIMITS.maxManifestBytes)
          throw new PortabilityError('archive_limit_exceeded', 'Bundle manifest exceeds the size budget')
        manifestChunks.push(Buffer.from(chunk))
      } else if (path === DATABASE_ENTRY) {
        if (databaseFd === null) databaseFd = openSync(databasePath, 'wx', 0o600)
        const buffer = Buffer.from(chunk)
        for (let offset = 0; offset < buffer.length;) offset += writeSync(databaseFd, buffer, offset)
      }
    })
    await readTarGz(bundlePath, sink)
    if (entries.length === 0 || entries[0]?.path !== MANIFEST_ENTRY)
      throw new PortabilityError('archive_invalid', 'The bundle manifest must be the first archive entry')
    if (manifestBytes === 0) throw new PortabilityError('archive_invalid', 'The bundle manifest is empty')
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(manifestChunks).toString('utf8'))
    } catch {
      throw new PortabilityError('manifest_invalid', 'The bundle manifest is not valid JSON')
    }
    const manifest = validateManifest(parsed)

    const archived = new Map(entries.filter((entry) => entry.path !== MANIFEST_ENTRY).map((entry) => [entry.path, entry]))
    if (archived.size !== entries.length - 1)
      throw new PortabilityError('archive_duplicate_entry', 'The bundle has duplicate member paths')
    const listed = new Map(manifest.entries.map((entry) => [entry.path, entry]))
    for (const entry of manifest.entries) {
      const member = archived.get(entry.path)
      if (!member)
        throw new PortabilityError('archive_invalid', 'A manifest-listed entry is missing from the archive', { path: entry.path })
      if (member.size !== entry.bytes || member.sha256 !== entry.sha256)
        throw new PortabilityError('bundle_digest_mismatch', 'An archive member does not match the manifest digest', {
          path: entry.path,
        })
    }
    for (const path of archived.keys()) {
      if (!listed.has(path))
        throw new PortabilityError('manifest_invalid', 'The archive contains an entry absent from the manifest', { path })
    }
    for (const ref of manifest.artifactRefs) {
      const entry = listed.get(ref.entry)
      if (!entry || entry.sha256 !== ref.digest || entry.bytes !== ref.bytes)
        throw new PortabilityError('bundle_digest_mismatch', 'Artifact reference does not match its archive entry', {
          id: ref.id,
        })
    }

    if (databaseFd === null || !manifest.selection.database)
      throw new PortabilityError('database_unavailable', 'The bundle does not contain a database snapshot')
    closeSync(databaseFd)
    databaseFd = null
    let database: VerifyResult
    try {
      database = verifyDatabase(databasePath)
    } catch (error) {
      throw new PortabilityError('database_verify_failed', 'The archived database cannot be verified', {
        cause: String((error as { message?: string }).message ?? error),
      })
    }
    if (database.integrity !== 'ok' || database.foreignKeyViolations !== 0)
      throw new PortabilityError('database_verify_failed', 'The archived database failed integrity or foreign-key checks', {
        integrity: database.integrity,
        foreignKeyViolations: database.foreignKeyViolations,
      })
    if (manifest.database.integrity !== database.integrity ||
        manifest.database.foreignKeyViolations !== database.foreignKeyViolations ||
        manifest.database.productSchema !== database.productSchema)
      throw new PortabilityError('bundle_digest_mismatch', 'Manifest database facts do not match the archived database')
    return {
      manifest,
      manifestDigest: manifestDigest(manifest),
      archiveSha256: hashFile(bundlePath),
      bytes: stat.size,
      entries,
      database,
    }
  } finally {
    if (databaseFd !== null) {
      try { closeSync(databaseFd) } catch { /* already closed */ }
    }
    rmSync(staging, { recursive: true, force: true })
  }
}
