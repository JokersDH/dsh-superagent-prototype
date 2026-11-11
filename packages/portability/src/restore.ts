/**
 * Restore a verified bundle into a NEW private state directory.
 *
 * Order is deliberate: the whole bundle is verified first, bytes are extracted into a private
 * staging directory beside the target with per-entry re-hashing, path bindings are only rewritten
 * for explicit `--map-path` pairs, a restore report records what needs revalidation, and only then
 * is the staging directory atomically renamed into place. The target is never an existing state,
 * the daemon is never started, and no begin/deliver/answer is replayed.
 */
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { PRODUCT_SCHEMA_VERSION, verifyDatabase } from '@personal-agent/storage'
import { verifyEvidenceSummary, type EvidenceSummary } from './evidence.ts'
import { PortabilityError } from './errors.ts'
import { DATABASE_ENTRY, MANIFEST_ENTRY } from './manifest.ts'
import { readTarGz } from './archive.ts'
import { verifyBundle } from './bundle.ts'

export interface RestorePathMapping {
  readonly from: string
  readonly to: string
}

export interface RestoreOptions {
  readonly bundlePath: string
  /** New state directory; must not exist or be an empty directory. */
  readonly targetStateDir: string
  /** Absolute private temporary root for bundle verification. */
  readonly stagingRoot?: string
  readonly mapPaths?: readonly RestorePathMapping[]
  readonly now?: Date
}

export interface RestoreReport {
  readonly protocol: 'personal-restore/1'
  readonly createdAt: string
  readonly bundle: {
    readonly archiveSha256: string
    readonly manifestDigest: string
    readonly manifestCreatedAt: string
    readonly producer: { product: string; version: string; platform: string; arch: string; node: string; sqlite: string }
    readonly sourceStateName: string
    readonly fileName: string
  }
  readonly targetPath: string
  readonly entries: { readonly count: number; readonly bytes: number }
  readonly database: {
    readonly integrity: 'ok' | string
    readonly foreignKeyViolations: number
    readonly productSchema: number | null
    readonly eventSeq: number | null
  }
  readonly pathMappings: {
    readonly applied: readonly (RestorePathMapping & { readonly field: string })[]
    readonly pendingRebind: readonly string[]
    readonly unmatchedMappings: readonly string[]
  }
  /** Evidence coverage that was actually re-read from the restored database. */
  readonly evidence: {
    readonly status: 'verified' | 'verified_with_migration' | 'not_recorded'
    readonly digest: string | null
    readonly counts: EvidenceSummary['counts'] | null
    readonly routingEvidence: EvidenceSummary['routingEvidence'] | null
    readonly reason: string | null
    /** Bundle evidence format 1 predates routing evidence; the routing payload is absent by design. */
    readonly legacyFormat: boolean
    /** The restored database was migrated forward (append-only) from the bundle schema. */
    readonly migratedSchema: boolean
    readonly schema: { readonly bundle: number | null; readonly restored: number | null }
  }
  readonly requiresRevalidation: readonly string[]
  readonly excluded: readonly { path: string; reason: string }[]
  readonly limitations: readonly string[]
}

export interface RestoreResult {
  readonly report: RestoreReport
  readonly reportPath: string
  readonly targetStateDir: string
}

const REVALIDATION = [
  'Native execution environment and policy evidence were not migrated; re-probe before dispatching.',
  'Native authentication lives in the account home and is not part of the bundle; re-authenticate locally.',
  'The old writer pid/nonce and runtime records are historical and never become authority on restore.',
  'Project bindings not explicitly remapped stay pending and must be rebound to a local path.',
] as const

const safeMapping = (mapping: RestorePathMapping): RestorePathMapping => {
  if (!isAbsolute(mapping.from) || !isAbsolute(mapping.to))
    throw new PortabilityError('invalid_root', 'Path mappings must use absolute paths', { mapping })
  if (mapping.from === mapping.to)
    throw new PortabilityError('invalid_root', 'Path mapping has identical source and destination', { mapping })
  return { from: resolve(mapping.from), to: resolve(mapping.to) }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error instanceof PortabilityError) throw error
    throw new PortabilityError('config_invalid', 'Restored project binding file is not valid JSON')
  }
}

function writePrivateFile(path: string, bytes: Buffer, options: { readonly overwrite?: boolean } = {}): void {
  const fd = openSync(path, options.overwrite === true ? 'w' : 'wx', 0o600)
  try {
    for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function applyBindings(
  staging: string,
  mappings: readonly RestorePathMapping[],
): RestoreReport['pathMappings'] {
  const configPath = join(staging, 'native-projects.json')
  const unmatchedMappings = mappings.map((mapping) => `${mapping.from} -> ${mapping.to}`)
  if (!existsSync(configPath)) {
    return { applied: [], pendingRebind: [], unmatchedMappings }
  }
  const parsed = readJson(configPath) as { projects?: unknown[] }
  const applied: (RestorePathMapping & { field: string })[] = []
  const pending = new Set<string>()
  const lookup = new Map(mappings.map((mapping) => [mapping.from, mapping.to]))
  const rewrite = (value: string, field: string): string => {
    const mapped = lookup.get(value)
    if (mapped === undefined) {
      pending.add(value)
      return value
    }
    applied.push({ from: value, to: mapped, field })
    const candidate = unmatchedMappings.indexOf(`${value} -> ${mapped}`)
    if (candidate >= 0) unmatchedMappings.splice(candidate, 1)
    return mapped
  }
  if (Array.isArray(parsed?.projects)) {
    for (const item of parsed.projects) {
      const project = item as { path?: unknown; environment?: { storeDir?: unknown } }
      if (typeof project?.path === 'string') project.path = rewrite(project.path, 'project.path')
      const storeDir = project?.environment?.storeDir
      if (typeof storeDir === 'string') project.environment!.storeDir = rewrite(storeDir, 'project.environment.storeDir')
    }
  }
  const bytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`)
  writePrivateFile(configPath, bytes, { overwrite: true })
  return { applied, pendingRebind: [...pending], unmatchedMappings }
}

/** Restore a verified bundle into a fresh private state directory. Never starts the daemon. */
export async function restoreBundle(options: RestoreOptions): Promise<RestoreResult> {
  const bundlePath = resolve(options.bundlePath)
  const target = resolve(options.targetStateDir)
  if (!isAbsolute(options.targetStateDir))
    throw new PortabilityError('target_invalid', 'Restore target must be absolute', { target: options.targetStateDir })
  const parent = dirname(target)
  let parentStat
  try {
    parentStat = lstatSync(parent)
  } catch {
    throw new PortabilityError('target_invalid', 'Restore target parent directory does not exist', { parent })
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
    throw new PortabilityError('target_invalid', 'Restore target parent must be a real directory', { parent })
  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new PortabilityError('target_invalid', 'Restore target must be a real directory', { target })
    if (readdirSync(target).length > 0)
      throw new PortabilityError('target_not_empty', 'Restore target is not empty; an active state is never overwritten', { target })
  }
  const mappings = (options.mapPaths ?? []).map(safeMapping)

  // 1. Verify the complete bundle before touching the target.
  const verified = await verifyBundle(bundlePath, options.stagingRoot ? { stagingRoot: options.stagingRoot } : {})
  const manifest = verified.manifest
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  const kindOf = new Map(manifest.entries.map((entry) => [entry.path, entry.kind]) as [string, string][])

  // 2. Extract into a private staging directory beside the target for an atomic rename.
  const staging = mkdtempSync(join(parent, '.pa-restore-'))
  chmodSync(staging, 0o700)
  let active: { path: string; destination: string; hash: ReturnType<typeof createHash>; fd: number; written: number } | null = null
  const seen = new Set<string>()
  try {
    await readTarGz(bundlePath, {
      start(entry) {
        if (entry.path === MANIFEST_ENTRY) {
          active = { path: entry.path, destination: '', hash: createHash('sha256'), fd: -1, written: 0 }
          return
        }
        const recorded = expected.get(entry.path)
        if (!recorded)
          throw new PortabilityError('archive_invalid', 'The bundle contains an entry absent from its manifest', { path: entry.path })
        const kind = kindOf.get(entry.path)
        let destination
        if (entry.path === DATABASE_ENTRY) destination = join(staging, 'state.sqlite')
        else if (kind === 'artifact') {
          const id = entry.path.slice('artifacts/'.length)
          if (!/^[A-Za-z0-9._-]+$/.test(id))
            throw new PortabilityError('archive_unsafe_path', 'Artifact entry name is not a plain id', { path: entry.path })
          mkdirSync(join(staging, 'artifacts'), { recursive: true, mode: 0o700 })
          destination = join(staging, 'artifacts', id)
        } else if (entry.path === 'config/native-projects.json') destination = join(staging, 'native-projects.json')
        else throw new PortabilityError('manifest_invalid', 'Unexpected config entry in bundle', { path: entry.path })
        const fd = openSync(destination, 'wx', 0o600)
        active = { path: entry.path, destination, hash: createHash('sha256'), fd, written: 0 }
      },
      chunk(chunk) {
        if (active === null) throw new PortabilityError('archive_invalid', 'Archive data outside an entry')
        active.hash.update(chunk)
        if (active.fd >= 0) writeSync(active.fd, chunk)
        active.written += chunk.byteLength
      },
      end() {
        if (active === null) throw new PortabilityError('archive_invalid', 'Archive entry ended without a start')
        const current = active
        active = null
        if (current.fd >= 0) {
          fsyncSync(current.fd)
          closeSync(current.fd)
        }
        if (current.path === MANIFEST_ENTRY) {
          const manifestEntry = expected.get(MANIFEST_ENTRY)
          if (manifestEntry && current.written > 0) seen.add(MANIFEST_ENTRY)
          return
        }
        const recorded = expected.get(current.path)
        if (!recorded) throw new PortabilityError('archive_invalid', 'Unexpected archive entry', { path: current.path })
        const digest = current.hash.digest('hex')
        if (current.written !== recorded.bytes || digest !== recorded.sha256)
          throw new PortabilityError('bundle_digest_mismatch', 'Extracted entry does not match the manifest digest', { path: current.path })
        seen.add(current.path)
        if (current.path === DATABASE_ENTRY) chmodSync(current.destination, 0o600)
      },
    })
    const required = new Set(manifest.entries.map((entry) => entry.path))
    for (const path of required) {
      if (!seen.has(path)) throw new PortabilityError('archive_invalid', 'A manifest entry was not extracted', { path })
    }

    // 3. Re-verify the extracted database before it can become a state directory.
    const database = verifyDatabase(join(staging, 'state.sqlite'))
    if (database.integrity !== 'ok' || database.foreignKeyViolations !== 0)
      throw new PortabilityError('database_verify_failed', 'Restored database failed integrity or foreign-key checks', {
        integrity: database.integrity,
        foreignKeyViolations: database.foreignKeyViolations,
      })
    // Never activate a state from a newer schema: this build cannot prove it can read the data, and
    // an implicit down-migration/deletion is forbidden.
    if (database.productSchema !== null && database.productSchema > PRODUCT_SCHEMA_VERSION)
      throw new PortabilityError('schema_unsupported', 'Bundle database schema is newer than this build supports', {
        productSchema: database.productSchema,
        supported: PRODUCT_SCHEMA_VERSION,
      })
    let eventSeq: number | null = null
    const db = new Database(join(staging, 'state.sqlite'), { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM event_log').get() as { seq: number }
      eventSeq = Number(row.seq)
    } catch {
      eventSeq = null
    } finally {
      db.close()
    }

    // 3b. A readable database is not enough: every recorded evidence class must match the bundle.
    let evidenceReport: RestoreReport['evidence']
    if (manifest.evidence === undefined) {
      evidenceReport = {
        status: 'not_recorded',
        digest: null,
        counts: null,
        routingEvidence: null,
        reason: 'This bundle was produced before evidence coverage was recorded; evidence completeness is unknown.',
        legacyFormat: false,
        migratedSchema: false,
        schema: { bundle: manifest.database.productSchema ?? null, restored: database.productSchema },
      }
    } else {
      const expected = {
        protocol: 'personal-evidence' as const,
        formatVersion: manifest.evidence.formatVersion,
        digest: manifest.evidence.digest,
        productSchema: manifest.evidence.productSchema,
        projects: [], works: [], decisions: [], assistantDecisions: [], assistantProposals: [], artifacts: [], acceptedEvents: [],
        routingEvidence: manifest.evidence.routingEvidence,
        counts: manifest.evidence.counts,
        limitations: manifest.evidence.limitations,
      } as unknown as EvidenceSummary
      const verifiedEvidence = verifyEvidenceSummary(join(staging, 'state.sqlite'), expected)
      if (!verifiedEvidence.ok)
        throw new PortabilityError('evidence_mismatch', 'Restored database evidence does not match the bundle manifest', {
          mismatches: verifiedEvidence.mismatches,
          expectedDigest: manifest.evidence.digest,
          actualDigest: verifiedEvidence.actual.digest,
        })
      const routing = verifiedEvidence.actual.routingEvidence
      if (routing.status === 'included' && routing.missingArtifactRefs.length > 0)
        throw new PortabilityError('evidence_mismatch', 'Review evidence references artifacts that are absent from the restored state', {
          missingArtifactRefs: routing.missingArtifactRefs,
        })
      evidenceReport = {
        status: verifiedEvidence.migratedSchema ? 'verified_with_migration' : 'verified',
        digest: verifiedEvidence.actual.digest,
        counts: verifiedEvidence.actual.counts,
        routingEvidence: routing,
        reason: routing.status === 'unavailable' ? routing.reason : null,
        legacyFormat: verifiedEvidence.legacyFormat,
        migratedSchema: verifiedEvidence.migratedSchema,
        schema: { bundle: manifest.evidence.productSchema, restored: verifiedEvidence.actual.productSchema },
      }
    }

    // 4. Explicit path remapping only; everything else stays pending.
    const pathMappings = applyBindings(staging, mappings)
    const report: RestoreReport = {
      protocol: 'personal-restore/1',
      createdAt: (options.now ?? new Date()).toISOString(),
      bundle: {
        archiveSha256: verified.archiveSha256,
        manifestDigest: verified.manifestDigest,
        manifestCreatedAt: manifest.createdAt,
        producer: {
          product: manifest.producer.product,
          version: manifest.producer.version,
          platform: manifest.producer.platform,
          arch: manifest.producer.arch,
          node: manifest.producer.node,
          sqlite: manifest.producer.sqlite,
        },
        sourceStateName: manifest.source.stateName,
        fileName: bundlePath.split('/').pop() ?? bundlePath,
      },
      targetPath: target,
      entries: { count: manifest.counts.entries, bytes: manifest.entries.reduce((total, entry) => total + entry.bytes, 0) },
      database: {
        integrity: database.integrity,
        foreignKeyViolations: database.foreignKeyViolations,
        productSchema: database.productSchema,
        eventSeq,
      },
      pathMappings,
      evidence: evidenceReport,
      requiresRevalidation: [...REVALIDATION],
      excluded: manifest.selection.excluded,
      limitations: [
        ...manifest.limitations,
        'Restore does not start the daemon, consume the durable queue, or resend begin/deliver/answer.',
        'The restored instance has new local credentials; old runtime records and writer identity are not authority.',
        ...(evidenceReport.status === 'not_recorded'
          ? ['Legacy bundle has no evidence coverage; evidence completeness was not verified.']
          : []),
        ...(evidenceReport.migratedSchema
          ? [`Restored database was migrated append-only from schema ${String(evidenceReport.schema.bundle)} to ${String(evidenceReport.schema.restored)}; no user record was deleted or rewritten, but schema-level behavior is new for this state.`]
          : []),
        ...(evidenceReport.legacyFormat
          ? ['This bundle predates routing evidence (format 1); route advice/review/outcome records are absent by construction, not verified as zero.']
          : []),
        ...(evidenceReport.routingEvidence?.status === 'unavailable'
          ? ['Routing evidence tables are absent from the restored database; those evidence classes are not covered.']
          : []),
      ],
    }
    const reportPath = join(staging, 'restore-report.json')
    writePrivateFile(reportPath, Buffer.from(`${JSON.stringify(report, null, 2)}\n`))

    // 5. Atomically move into place; the target was verified missing or empty above.
    if (existsSync(target)) rmdirSync(target)
    renameSync(staging, target)
    return { report, reportPath: join(target, 'restore-report.json'), targetStateDir: target }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (error instanceof PortabilityError) throw error
    throw new PortabilityError('restore_failed', 'Restore failed before activation', {
      cause: String((error as { message?: string }).message ?? error),
    })
  }
}

/** Read the restore report of an activated state directory, if any. */
export function readRestoreReport(stateDir: string): RestoreReport | null {
  const path = join(stateDir, 'restore-report.json')
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new PortabilityError('unsafe_root', 'Restore report file is unsafe', { path })
  return JSON.parse(readFileSync(path, 'utf8')) as RestoreReport
}

export { writePrivateFile }
