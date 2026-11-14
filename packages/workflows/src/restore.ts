/**
 * Verified restore of one workflow snapshot into a NEW private state directory.
 *
 * A workflow snapshot is `snapshot.json` + `product.sqlite` + `artifacts/<id>`. Restore re-hashes
 * every byte against the manifest, re-reads the evidence summary from the restored database with
 * the manifest's own evidence recipe, and only then writes `restore-report.json`. The report binds
 * the original snapshot digest, database digest, evidence digest and logical source to the new root,
 * so a consumer can prove that the rows it reads belong to that restore rather than to a copy with
 * a hand-written marker. It never copies credentials, never starts a daemon and never resends a
 * business request.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { PRODUCT_SCHEMA_VERSION, readWorkflowContent, readWorkflowEvidence, verifyDatabase, type ContentCollection, type WorkflowContentSummary, type WorkflowEvidenceSummary } from '@personal-agent/storage'
import type { SnapshotManifest } from './snapshot.ts'

export class RestoreError extends Error {}

export interface RestoreSnapshotOptions {
  /** Absolute directory produced by `WorkflowSnapshots.create`. */
  readonly snapshotDirectory: string
  /** New state directory; must not exist or must be empty. */
  readonly targetStateDir: string
  /** The state root the snapshot was produced from; recorded as a root mapping, never rewritten. */
  readonly sourceStateRoot?: string
  /** Optional independent expectations. A mismatch refuses before any target byte is written. */
  readonly expected?: RestoreExpectation
  readonly now?: Date
}

export interface RestoreSnapshotReport {
  readonly protocol: 'personal-restore/1'
  readonly createdAt: string
  readonly snapshot: {
    readonly format: 'workflow-snapshot/1' | 'workflow-snapshot/2'
    readonly digest: string
    readonly createdAt: string
    readonly databaseSha256: string
    readonly databaseBytes: number
    readonly artifacts: number
  }
  readonly targetPath: string
  readonly database: { readonly integrity: 'ok' | string; readonly foreignKeyViolations: number; readonly productSchema: number | null; readonly eventSeq: number | null; readonly sha256: string }
  readonly evidence: { readonly status: 'verified' | 'unknown'; readonly digest: string | null; readonly protocol: string | null; readonly families: number }
  /** Logical row content, independent of integrity/schema and of SQLite file rewriting. */
  readonly content: {
    readonly protocol: string; readonly digest: string | null; readonly productSchema: number | null; readonly complete: boolean
    readonly collections: readonly ContentCollection[]; readonly omittedTables: readonly string[]; readonly reason: string | null
    readonly rows: number; readonly bytes: number
  }
  readonly artifacts: readonly { readonly id: string; readonly digest: string; readonly bytes: number }[]
  readonly logicalSource: { readonly digest: string | null; readonly coverage: 'complete' | 'unknown' }
  readonly rootMapping: { readonly from: string | null; readonly to: string }
  readonly pathMappings: { readonly applied: readonly string[]; readonly pendingRebind: readonly string[] }
  readonly requiresRevalidation: readonly string[]
  readonly limitations: readonly string[]
}

export interface ArtifactExpectation { readonly id: string; readonly digest: string; readonly bytes: number }

export interface RestoreExpectation {
  readonly protocol?: 'workflow-snapshot/1' | 'workflow-snapshot/2'
  readonly snapshotDigest?: string
  readonly databaseSha256?: string
  readonly evidenceDigest?: string
  /** Content proof computed independently from the source database before snapshotting. */
  readonly contentDigest?: string
  /** Exact independent artifact inventory (id/digest/bytes); an empty list is only valid for an empty original subject. */
  readonly artifacts?: readonly ArtifactExpectation[]
}

export interface RestoreSnapshotResult {
  readonly status: 'ok' | 'blocked'
  readonly targetStateDir: string
  readonly reportPath: string
  readonly report: RestoreSnapshotReport | null
  readonly message?: string
}

export const RESTORE_LIMITS = { manifestBytes: 8 * 1024 * 1024, databaseBytes: 512 * 1024 * 1024, artifactBytes: 512 * 1024 * 1024,
  totalArtifactBytes: 2 * 1024 * 1024 * 1024, maxArtifacts: 4096 } as const
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const normalizeArtifacts = (input: readonly ArtifactExpectation[] | undefined, label: string): ArtifactExpectation[] => {
  if (!Array.isArray(input)) throw new RestoreError(`${label} artifact inventory is not an array`)
  if (input.length > RESTORE_LIMITS.maxArtifacts) throw new RestoreError(`${label} artifact count exceeds the limit`)
  const seen = new Set<string>(), result: ArtifactExpectation[] = []
  let total = 0
  for (const artifact of input) {
    if (!artifact || typeof artifact.id !== 'string' || artifact.id === 'tmp' || !ARTIFACT_ID.test(artifact.id) ||
      typeof artifact.digest !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.digest) ||
      !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > RESTORE_LIMITS.artifactBytes)
      throw new RestoreError(`${label} artifact entry is invalid`)
    if (seen.has(artifact.id)) throw new RestoreError(`${label} artifact inventory contains a duplicate id`)
    seen.add(artifact.id); total += artifact.bytes
    if (total > RESTORE_LIMITS.totalArtifactBytes) throw new RestoreError(`${label} artifact bytes exceed the cumulative limit`)
    result.push({ id: artifact.id, digest: artifact.digest, bytes: artifact.bytes })
  }
  return result
}

const sameArtifacts = (left: readonly ArtifactExpectation[], right: readonly ArtifactExpectation[]): boolean => {
  if (left.length !== right.length) return false
  const map = new Map(right.map(value => [value.id, value]))
  return left.every(value => { const other = map.get(value.id); return !!other && other.digest === value.digest && other.bytes === value.bytes })
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const REVALIDATION = [
  'Native execution environment and policy evidence were not migrated; re-probe before dispatching.',
  'Native authentication lives in the account home and is not part of a workflow snapshot; re-authenticate locally.',
  'The old writer pid/nonce and runtime records are historical and never become authority on restore.',
  'Project bindings are not carried by a workflow snapshot; rebind them to a local path before dispatch.',
] as const

const LIMITATIONS = [
  'A restored state is data, not an execution, recovery-start or human-acceptance grant.',
  'Logical source equality does not prove that the original physical writer has stopped.',
  'Old held queues and unknown resources are preserved; restore never consumes or clears them.',
] as const

const readManifest = (directory: string): { manifest: SnapshotManifest; digest: string } => {
  const path = join(directory, 'snapshot.json')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RESTORE_LIMITS.manifestBytes) throw new RestoreError('snapshot manifest is missing, unsafe or too large')
  const bytes = readFileSync(path)
  const manifest = JSON.parse(bytes.toString('utf8')) as SnapshotManifest
  if (manifest === null || typeof manifest !== 'object') throw new RestoreError('snapshot manifest is not an object')
  if (manifest.protocol !== 'workflow-snapshot/1' && manifest.protocol !== 'workflow-snapshot/2') throw new RestoreError('unsupported snapshot protocol')
  if (manifest.complete !== true) throw new RestoreError('snapshot is not complete; restore refuses an incomplete snapshot')
  if (!Array.isArray(manifest.artifacts) || manifest.database?.path !== 'product.sqlite') throw new RestoreError('snapshot manifest has no database/artifact inventory')
  if (!Number.isSafeInteger(manifest.database.bytes) || manifest.database.bytes < 0 || manifest.database.bytes > RESTORE_LIMITS.databaseBytes)
    throw new RestoreError('snapshot database size is invalid or over the configured bound')
  return { manifest, digest: sha256(bytes) }
}

const writePrivate = (path: string, bytes: Uint8Array): void => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const fd = openSync(path, 'wx', 0o600)
  try {
    for (let offset = 0; offset < bytes.byteLength;) offset += writeSync(fd, bytes, offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

const copyVerified = (source: string, destination: string, expected: { sha256: string; bytes: number }): void => {
  const stat = lstatSync(source)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new RestoreError(`snapshot entry is not a regular file: ${source}`)
  if (stat.size !== expected.bytes || stat.size > RESTORE_LIMITS.artifactBytes) throw new RestoreError(`snapshot entry size mismatch: ${source}`)
  const bytes = readFileSync(source)
  if (sha256(bytes) !== expected.sha256) throw new RestoreError(`snapshot entry digest mismatch: ${source}`)
  writePrivate(destination, bytes)
}

const eventSeq = (path: string): number | null => {
  try {
    // Read-only; a missing table is unknown, not zero.
    const database = new Database(path, { readonly: true })
    try { const row = database.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log').get() as { seq: number }; return Number.isSafeInteger(row.seq) ? row.seq : null } finally { database.close() }
  } catch { return null }
}

export async function restoreWorkflowSnapshot(options: RestoreSnapshotOptions): Promise<RestoreSnapshotResult> {
  const snapshotDirectory = resolve(options.snapshotDirectory), target = resolve(options.targetStateDir)
  const reportPath = join(target, 'restore-report.json')
  const blocked = (message: string): RestoreSnapshotResult => ({ status: 'blocked', targetStateDir: target, reportPath, report: null, message })
  if (!snapshotDirectory.startsWith('/') || !target.startsWith('/')) return blocked('snapshot and target paths must be absolute')
  if (snapshotDirectory === target) return blocked('snapshot and target must be different directories')
  try {
    const { manifest, digest } = readManifest(snapshotDirectory)
    const expected = options.expected ?? {}
    if (expected.protocol !== undefined && expected.protocol !== manifest.protocol) return blocked(`snapshot protocol ${manifest.protocol} is not the expected ${expected.protocol}`)
    if (expected.snapshotDigest !== undefined && expected.snapshotDigest !== digest) return blocked('snapshot manifest digest does not match the independent expectation')
    if (expected.databaseSha256 !== undefined && expected.databaseSha256 !== manifest.database.sha256) return blocked('snapshot database digest does not match the independent expectation')
    if (expected.evidenceDigest !== undefined && expected.evidenceDigest !== manifest.evidence?.digest) return blocked('snapshot evidence digest does not match the independent expectation')
    if (expected.artifacts !== undefined) {
      const required = normalizeArtifacts(expected.artifacts, 'expected')
      const actual = manifest.artifacts.map(artifact => ({ id: artifact.id, digest: artifact.digest, bytes: artifact.bytes }))
      if (!sameArtifacts(required, actual)) return blocked('snapshot artifact inventory does not match the independent expected inventory')
    }
    if (manifest.incompatibleSchema) return blocked(`snapshot schema ${String(manifest.database.productSchema)} is newer than this build (${PRODUCT_SCHEMA_VERSION})`)
    if (manifest.database.integrity !== 'ok' || manifest.database.foreignKeyViolations !== 0) return blocked('snapshot database was not verified when produced')

    if (existsSync(target)) {
      const entries = readdirSync(target)
      if (entries.length > 0) return blocked('restore target directory must be new or empty')
    } else mkdirSync(target, { recursive: true, mode: 0o700 })
    const targetStat = lstatSync(target)
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) return blocked('restore target must be a real directory')
    const staging = `${target}.restore-${process.pid}-${Date.now()}`
    mkdirSync(staging, { mode: 0o700 })
    try {
      copyVerified(join(snapshotDirectory, 'product.sqlite'), join(staging, 'state.sqlite'), manifest.database)
      for (const artifact of manifest.artifacts) {
        if (!artifact || typeof artifact.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(artifact.id) ||
          artifact.snapshotPath !== `artifacts/${artifact.id}` || artifact.status !== 'copied')
          throw new RestoreError(`snapshot artifact ${String(artifact?.id)} is not a verified copied entry`)
        copyVerified(join(snapshotDirectory, artifact.snapshotPath), join(staging, 'artifacts', artifact.id), { sha256: artifact.digest, bytes: artifact.bytes })
      }
      const restoredDatabase = join(staging, 'state.sqlite')
      const verified = verifyDatabase(restoredDatabase)
      if (verified.integrity !== 'ok' || verified.foreignKeyViolations !== 0) throw new RestoreError('restored database failed integrity/foreign-key verification')
      if (verified.productSchema !== manifest.database.productSchema) throw new RestoreError('restored database schema differs from the snapshot manifest')
      const formatVersion = manifest.protocol === 'workflow-snapshot/2' ? 2 : 1
      const evidence: WorkflowEvidenceSummary = readWorkflowEvidence(restoredDatabase, formatVersion)
      const exactFamilies = evidence.families.length === manifest.evidence.families.length &&
        evidence.families.every((family, index) => family.name === manifest.evidence.families[index]?.name &&
          family.count === manifest.evidence.families[index]?.count && family.digest === manifest.evidence.families[index]?.digest &&
          family.truncated === manifest.evidence.families[index]?.truncated)
      if (evidence.protocol !== manifest.evidence.protocol || evidence.digest !== manifest.evidence.digest || !evidence.complete || !exactFamilies)
        throw new RestoreError('restored evidence summary does not match the snapshot recipe/digest')
      const content: WorkflowContentSummary = readWorkflowContent(restoredDatabase)
      if (expected.contentDigest !== undefined && (content.digest === null || content.digest !== expected.contentDigest))
        throw new RestoreError('restored logical content does not match the independent source content expectation')
      const databaseBytes = readFileSync(restoredDatabase)

      const report: RestoreSnapshotReport = {
        protocol: 'personal-restore/1',
        createdAt: (options.now ?? new Date()).toISOString(),
        snapshot: { format: manifest.protocol, digest, createdAt: manifest.createdAt, databaseSha256: manifest.database.sha256,
          databaseBytes: manifest.database.bytes, artifacts: manifest.artifacts.length },
        targetPath: target,
        database: { integrity: verified.integrity, foreignKeyViolations: verified.foreignKeyViolations,
          productSchema: verified.productSchema, eventSeq: eventSeq(restoredDatabase), sha256: sha256(databaseBytes) },
        evidence: { status: 'verified', digest: evidence.digest, protocol: evidence.protocol, families: evidence.families.length },
        content: { protocol: content.protocol, digest: content.digest, productSchema: content.productSchema, complete: content.complete,
          collections: content.collections, omittedTables: content.omittedTables, reason: content.reason, rows: content.rows, bytes: content.bytes },
        artifacts: normalizeArtifacts(manifest.artifacts, 'snapshot'),
        logicalSource: { digest: evidence.digest, coverage: 'complete' },
        rootMapping: { from: options.sourceStateRoot ? resolve(options.sourceStateRoot) : null, to: target },
        pathMappings: { applied: [], pendingRebind: ['project bindings are not carried by a workflow snapshot'] },
        requiresRevalidation: REVALIDATION,
        limitations: LIMITATIONS,
      }
      writePrivate(join(staging, 'restore-report.json'), Buffer.from(`${JSON.stringify(report, null, 2)}\n`))
      const directory = openSync(staging, 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
      renameSync(staging, target)
      return { status: 'ok', targetStateDir: target, reportPath, report }
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      return blocked(error instanceof Error ? error.message : String(error))
    }
  } catch (error) {
    return blocked(error instanceof Error ? error.message : String(error))
  }
}

/** Read-only re-verification of an existing restored root against its report and content, not just SQLite health. */
export interface VerifyRestoredExpectation extends RestoreExpectation {
  readonly contentDigest?: string
  readonly sourceStateRoot?: string
}

export interface RestoreVerification {
  readonly status: 'ok' | 'blocked'
  /** `independent` requires at least one caller-supplied snapshot/database/evidence/content expectation. */
  readonly basis: 'independent' | 'report_only' | null
  readonly artifactCoverage: 'independent' | 'report_only' | null
  readonly report: RestoreSnapshotReport | null
  readonly content: WorkflowContentSummary | null
  readonly message?: string
}

export function verifyRestoredSnapshot(targetStateDir: string, expected: VerifyRestoredExpectation = {}): RestoreVerification {
  try {
    const target = resolve(targetStateDir)
    const report = JSON.parse(readFileSync(join(target, 'restore-report.json'), 'utf8')) as RestoreSnapshotReport
    if (report.protocol !== 'personal-restore/1') throw new RestoreError('restore report protocol is invalid')
    if (realpathSync(report.targetPath) !== realpathSync(target)) throw new RestoreError('restore report belongs to another state root')
    if (report.rootMapping?.to && realpathSync(report.rootMapping.to) !== realpathSync(target)) throw new RestoreError('restore root mapping does not point at this target')
    if (expected.sourceStateRoot && (report.rootMapping?.from === null || report.rootMapping?.from === undefined ||
      resolve(report.rootMapping.from) !== resolve(expected.sourceStateRoot))) throw new RestoreError('restore source root mapping differs from the independent expectation')
    if (expected.protocol && report.snapshot.format !== expected.protocol) throw new RestoreError('restore snapshot format differs from the independent expectation')
    if (expected.snapshotDigest && report.snapshot.digest !== expected.snapshotDigest) throw new RestoreError('restore snapshot digest differs from the independent expectation')
    if (expected.databaseSha256 && report.database.sha256 !== expected.databaseSha256) throw new RestoreError('restore database digest differs from the independent expectation')
    if (expected.evidenceDigest && report.evidence.digest !== expected.evidenceDigest) throw new RestoreError('restore evidence digest differs from the independent expectation')
    if (expected.contentDigest && report.content.digest !== expected.contentDigest) throw new RestoreError('restore content digest differs from the independent expectation')
    const database = join(target, 'state.sqlite')
    const verified = verifyDatabase(database)
    if (verified.integrity !== 'ok' || verified.foreignKeyViolations !== 0) throw new RestoreError('restored database failed re-verification')
    if (verified.productSchema !== report.database.productSchema) throw new RestoreError('restored database schema changed after restore')
    const contentVersion = report.content?.protocol === 'workflow-content/1' ? 1 : report.content?.protocol === 'workflow-content/2' ? 2 : null
    if (contentVersion === null) throw new RestoreError('restore report has an unsupported content proof protocol')
    const content = readWorkflowContent(database, { version: contentVersion })
    if (!content.complete || content.digest === null) throw new RestoreError(`restored content proof is incomplete: ${content.reason ?? 'unknown'}`)
    if (content.productSchema !== report.content.productSchema) throw new RestoreError('restored content schema differs from the report')
    if (report.content.digest === null || content.digest !== report.content.digest) throw new RestoreError('restored row content differs from the restore report')
    const reportArtifacts = normalizeArtifacts(report.artifacts, 'report')
    if (!Number.isSafeInteger(report.snapshot.artifacts) || report.snapshot.artifacts !== reportArtifacts.length)
      throw new RestoreError('restore report artifact count does not match its inventory')
    const artifactCoverage: 'independent' | 'report_only' = expected.artifacts === undefined ? 'report_only' : 'independent'
    const required = expected.artifacts === undefined ? reportArtifacts : normalizeArtifacts(expected.artifacts, 'expected')
    if (artifactCoverage === 'independent' && !sameArtifacts(required, reportArtifacts))
      throw new RestoreError('restore report artifact inventory differs from the independent expected inventory')
    const artifactDirectory = join(target, 'artifacts')
    let entries: string[] = []
    if (existsSync(artifactDirectory)) {
      const directory = lstatSync(artifactDirectory)
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new RestoreError('restore artifact directory is not a real directory')
      entries = readdirSync(artifactDirectory).sort().filter(name => {
        if (name !== 'tmp') return true
        const scratch = lstatSync(join(artifactDirectory, name))
        if (!scratch.isDirectory() || scratch.isSymbolicLink()) throw new RestoreError('restore artifact scratch path is not a directory')
        return false
      })
    }
    const expectedIds = new Set(required.map(artifact => artifact.id))
    if (entries.some(name => !expectedIds.has(name))) throw new RestoreError(`restore target contains a foreign artifact file: ${entries.filter(name => !expectedIds.has(name)).slice(0, 5).join(', ')}`)
    if (required.length !== entries.length) throw new RestoreError('restore target is missing a required artifact file')
    let artifactBytes = 0
    for (const artifact of required) {
      const path = join(artifactDirectory, artifact.id)
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new RestoreError(`restored artifact ${artifact.id} is not a regular file`)
      if (stat.size !== artifact.bytes) throw new RestoreError(`restored artifact ${artifact.id} size differs from the expected inventory`)
      artifactBytes += artifact.bytes
      if (artifactBytes > RESTORE_LIMITS.totalArtifactBytes) throw new RestoreError('restored artifact bytes exceed the cumulative limit')
      const bytes = readFileSync(path)
      if (sha256(bytes) !== artifact.digest) throw new RestoreError(`restored artifact ${artifact.id} differs from the snapshot`)
    }
    const independentContent = Boolean(expected.snapshotDigest || expected.databaseSha256 || expected.evidenceDigest || expected.contentDigest)
    const basis = artifactCoverage === 'independent' && independentContent ? 'independent' : 'report_only'
    return { status: 'ok', basis, artifactCoverage, report, content }
  } catch (error) {
    return { status: 'blocked', basis: null, artifactCoverage: null, report: null, content: null, message: error instanceof Error ? error.message : String(error) }
  }
}
