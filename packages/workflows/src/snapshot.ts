/**
 * Consistent workflow snapshot: a SQLite online backup is the authoritative database copy, and the
 * artifact registry is read from that backup (not the live connection), then every referenced file is
 * copied and digest-verified. A missing/corrupt file produces a blocked result; the snapshot is
 * never presented as complete. Restoration is a caller decision in a new state directory.
 */
import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync, writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  backupDatabase, EVIDENCE_FAMILY_SET_VERSION, PRODUCT_SCHEMA_VERSION, inspectSchemaInventory, readArtifactRegistry, readRoutingArtifactRefs, readWorkflowEvidence, verifyDatabase,
  type ArtifactRegistryRow, type ProductStore, type WorkflowEvidenceSummary,
} from '@personal-agent/storage'

export class SnapshotError extends Error {}

export interface SnapshotArtifact extends ArtifactRegistryRow {
  /** Snapshot-relative path, e.g. `artifacts/<id>`. */
  snapshotPath: string
  status: 'copied' | 'missing' | 'corrupt'
}

export interface SnapshotManifest {
  protocol: 'workflow-snapshot/1' | 'workflow-snapshot/2'
  createdAt: string
  database: { path: 'product.sqlite'; bytes: number; sha256: string; productSchema: number; integrity: string; foreignKeyViolations: number }
  artifacts: readonly SnapshotArtifact[]
  /** Artifact IDs referenced by review evidence; they must be present in the backup registry. */
  referencedArtifacts: readonly string[]
  missingReferences: readonly string[]
  /** A database newer than this build's migration registry cannot be restored by this build. */
  incompatibleSchema: boolean
  /** Bounded identities+digests for durable decisions/settings/contracts/verification/outcomes/reviews. */
  evidence: WorkflowEvidenceSummary
  /** Required schema objects observed when this snapshot was created. */
  schemaInventory?: { missingTables: readonly string[]; missingIndexes: readonly string[]; unknownTables: readonly string[] }
  complete: boolean
  missing: readonly string[]
  corrupt: readonly string[]
}

export interface SnapshotResult {
  status: 'ok' | 'blocked'
  destination: string
  manifestPath: string
  manifest: SnapshotManifest
  message?: string
}

export interface SnapshotVerification {
  status: 'ok' | 'blocked'
  manifestPath: string
  database: { integrity: string; foreignKeyViolations: number; productSchema: number | null; sha256: string }
  artifacts: readonly { id: string; status: 'ok' | 'missing' | 'corrupt' }[]
  message?: string
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

function writeDurable(path: string, data: Uint8Array): void {
  const fd = openSync(path, 'wx', 0o600)
  try {
    let offset = 0
    while (offset < data.byteLength) offset += writeSync(fd, data, offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

function copyDurable(source: string, destination: string, expected: { digest: string; bytes: number }): 'ok' | 'missing' | 'corrupt' {
  if (!existsSync(source)) return 'missing'
  let data: Buffer
  try {
    data = readFileSync(source)
  } catch {
    // A permission/IO failure is not proof that the file is intact; keep the snapshot blocked.
    return 'corrupt'
  }
  if (data.byteLength !== expected.bytes || sha256(data) !== expected.digest) return 'corrupt'
  try {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    const temporary = `${destination}.${process.pid}.tmp`
    writeDurable(temporary, data)
    renameSync(temporary, destination)
    return 'ok'
  } catch (error) {
    throw new SnapshotError(`Could not write snapshot artifact ${expected.digest}: ${String(error)}`)
  }
}

/** Owns snapshot creation/verification; the caller supplies a new destination directory. */
export class WorkflowSnapshots {
  private readonly store: ProductStore
  constructor(store: ProductStore) { this.store = store }

  async create(input: { destination: string; createdAt?: string }): Promise<SnapshotResult> {
    if (!input.destination.startsWith('/')) throw new SnapshotError('Snapshot destination must be absolute')
    try {
      mkdirSync(input.destination, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SnapshotError('Snapshot destination must not already exist')
      throw error
    }
    const databasePath = join(input.destination, 'product.sqlite')
    const backup = await backupDatabase(this.store.db, databasePath)
    const artifactRows = readArtifactRegistry(databasePath)
    const registryIds = new Set(artifactRows.map(row => row.id))
    const referencedArtifacts = readRoutingArtifactRefs(databasePath)
    const missingReferences = referencedArtifacts.filter(id => !registryIds.has(id))
    const evidence = readWorkflowEvidence(databasePath)
    const legacyEvidence = readWorkflowEvidence(databasePath, 1)
    const artifacts: SnapshotArtifact[] = []
    const missing: string[] = []
    const corrupt: string[] = []
    for (const row of artifactRows) {
      const source = this.store.artifacts.get(row.id)?.absolutePath
      const relative = `artifacts/${row.id}`
      const destination = join(input.destination, relative)
      const copied = source ? copyDurable(source, destination, row) : 'missing'
      if (copied !== 'ok') {
        (copied === 'missing' ? missing : corrupt).push(row.id)
      }
      artifacts.push({ ...row, snapshotPath: relative, status: copied === 'ok' ? 'copied' : copied })
    }
    const databaseBytes = readFileSync(databasePath)
    const database = {
      path: 'product.sqlite' as const,
      bytes: databaseBytes.byteLength,
      sha256: sha256(databaseBytes),
      productSchema: backup.productSchema,
      integrity: backup.integrity,
      foreignKeyViolations: backup.foreignKeyViolations,
    }
    const incompatibleSchema = database.productSchema > PRODUCT_SCHEMA_VERSION
    const schemaInventory = inspectSchemaInventory(databasePath, database.productSchema)
    const schemaOk = !schemaInventory.futureSchema && schemaInventory.missingTables.length === 0 &&
      schemaInventory.missingIndexes.length === 0 && schemaInventory.unknownTables.length === 0
    const complete = missing.length === 0 && corrupt.length === 0 && missingReferences.length === 0 &&
      !incompatibleSchema && schemaOk && database.integrity === 'ok' && database.foreignKeyViolations === 0
    const manifest: SnapshotManifest = {
      protocol: 'workflow-snapshot/2',
      createdAt: input.createdAt ?? new Date().toISOString(),
      database,
      artifacts,
      referencedArtifacts,
      missingReferences,
      incompatibleSchema,
      evidence,
      schemaInventory: { missingTables: schemaInventory.missingTables, missingIndexes: schemaInventory.missingIndexes,
        unknownTables: schemaInventory.unknownTables },
      complete,
      missing,
      corrupt,
    }
    const manifestPath = join(input.destination, 'snapshot.json')
    writeDurable(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
    const directory = openSync(input.destination, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
    return {
      status: complete ? 'ok' : 'blocked',
      destination: input.destination,
      manifestPath,
      manifest,
      ...(complete ? {} : {
        message: `Snapshot is incomplete: ${missing.length} missing, ${corrupt.length} corrupt, ${missingReferences.length} missing referenced artifact(s); database integrity ${database.integrity}${incompatibleSchema ? `; schema ${database.productSchema} is newer than this build's ${PRODUCT_SCHEMA_VERSION}` : ''}.`,
      }),
    }
  }

  /** Read-only verification of an existing snapshot; never mutates or restores it. */
  verify(destination: string): SnapshotVerification {
    const manifestPath = join(destination, 'snapshot.json')
    let manifest: SnapshotManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as SnapshotManifest
      if (!['workflow-snapshot/1', 'workflow-snapshot/2'].includes(manifest.protocol) || !Array.isArray(manifest.artifacts))
        throw new Error('unsupported manifest')
    } catch (error) {
      return {
        status: 'blocked', manifestPath,
        database: { integrity: 'unavailable', foreignKeyViolations: 0, productSchema: null, sha256: '' },
        artifacts: [], message: `Snapshot manifest is missing or invalid: ${String(error)}`,
      }
    }
    const databasePath = join(destination, manifest.database.path)
    if (!existsSync(databasePath)) {
      return {
        status: 'blocked', manifestPath,
        database: { integrity: 'missing', foreignKeyViolations: 0, productSchema: null, sha256: '' },
        artifacts: manifest.artifacts.map(item => ({ id: item.id, status: 'missing' as const })),
        message: 'Snapshot database is missing.',
      }
    }
    const bytes = readFileSync(databasePath)
    const databaseSha = sha256(bytes)
    const verified = verifyDatabase(databasePath)
    const evidence = readWorkflowEvidence(databasePath)
    const legacyEvidence = readWorkflowEvidence(databasePath, 1)
    const artifacts = manifest.artifacts.map(item => {
      const file = join(destination, item.snapshotPath)
      if (!existsSync(file)) return { id: item.id, status: 'missing' as const }
      const data = readFileSync(file)
      return { id: item.id, status: data.byteLength === item.bytes && sha256(data) === item.digest ? 'ok' as const : 'corrupt' as const }
    })
    const incompatibleSchema = verified.productSchema === null || verified.productSchema > PRODUCT_SCHEMA_VERSION ||
      manifest.database.productSchema > PRODUCT_SCHEMA_VERSION
    // Family-set v2 is a complete, versioned list: creation and verification require the exact
    // current family set and the overall digest. A v1 manifest has no familySetVersion and keeps its
    // historical capability by checking only the families it actually recorded.
    const manifestFamilies = manifest.evidence?.families
    const familySetVersion = manifest.evidence?.familySetVersion
    const futureFamilySet = typeof familySetVersion === 'number' && familySetVersion > EVIDENCE_FAMILY_SET_VERSION
    const exactFamilies = Array.isArray(manifestFamilies) &&
      manifestFamilies.length === evidence.families.length &&
      new Set(manifestFamilies.map(family => family.name)).size === manifestFamilies.length &&
      evidence.families.every(current => {
        const recorded = manifestFamilies.find(family => family.name === current.name)
        return !!recorded && recorded.count === current.count && recorded.digest === current.digest &&
          recorded.truncated === current.truncated
      })
    const legacyFamilies = Array.isArray(manifestFamilies) &&
      manifestFamilies.length === legacyEvidence.families.length &&
      new Set(manifestFamilies.map(family => family.name)).size === manifestFamilies.length &&
      legacyEvidence.families.every(recorded => {
        const manifestFamily = manifestFamilies.find(family => family.name === recorded.name)
        return !!manifestFamily && manifestFamily.count === recorded.count && manifestFamily.digest === recorded.digest &&
          manifestFamily.truncated === recorded.truncated
      })
    const evidenceMatches = futureFamilySet ? false
      : manifest.protocol === 'workflow-snapshot/2'
        ? familySetVersion === EVIDENCE_FAMILY_SET_VERSION && manifest.evidence?.protocol === 'workflow-evidence/2' &&
          manifest.evidence.digest === evidence.digest && exactFamilies
        : manifest.protocol === 'workflow-snapshot/1'
          ? familySetVersion === undefined && manifest.evidence?.protocol === 'workflow-evidence/1' &&
            manifest.evidence.digest === legacyEvidence.digest && legacyFamilies
          : false
    const schemaInventory = inspectSchemaInventory(databasePath, verified.productSchema)
    const schemaOk = schemaInventory.productSchema !== null && schemaInventory.productSchema >= 1 &&
      !schemaInventory.futureSchema && schemaInventory.missingTables.length === 0 &&
      schemaInventory.missingIndexes.length === 0 && schemaInventory.unknownTables.length === 0
    const ok = manifest.complete && !manifest.incompatibleSchema && !incompatibleSchema && schemaOk &&
      evidenceMatches &&
      databaseSha === manifest.database.sha256 &&
      verified.integrity === 'ok' && verified.foreignKeyViolations === 0 &&
      verified.productSchema === manifest.database.productSchema &&
      manifest.database.integrity === 'ok' && manifest.database.foreignKeyViolations === 0 &&
      artifacts.every(item => item.status === 'ok')
    return {
      status: ok ? 'ok' : 'blocked',
      manifestPath,
      database: { integrity: verified.integrity, foreignKeyViolations: verified.foreignKeyViolations, productSchema: verified.productSchema, sha256: databaseSha },
      artifacts,
      ...(ok ? {} : {
        message: incompatibleSchema
          ? `Snapshot schema ${String(verified.productSchema)} is not restorable by this build (${PRODUCT_SCHEMA_VERSION}).`
          : !schemaOk
            ? `Snapshot schema is missing required objects: ${JSON.stringify(schemaInventory)}`
            : 'Snapshot bytes, database integrity, family version or referenced artifacts do not match the manifest.',
      }),
    }
  }
}

/** Convenience for callers that only need the manifest bytes (no second writer). */
export function readSnapshotManifest(destination: string): SnapshotManifest {
  const path = join(destination, 'snapshot.json')
  if (!existsSync(path)) throw new SnapshotError('Snapshot manifest is missing')
  return JSON.parse(readFileSync(path, 'utf8')) as SnapshotManifest
}

/** Exposed for callers that need the exact bytes/stat before a restore; no state is changed. */
export function snapshotFileBytes(path: string): { bytes: number; mtimeMs: number } {
  const stat = statSync(path)
  return { bytes: stat.size, mtimeMs: stat.mtimeMs }
}
