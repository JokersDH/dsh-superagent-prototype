/**
 * Versioned backup bundle manifest (`pa-backup/1`). A bundle is a deterministic tar.gz whose first
 * entry is this manifest; every other entry is listed with size and SHA-256 so a restore can fail
 * closed on any missing, extra, truncated, or modified member. This is a distribution-local format,
 * not a product wire DTO: it carries no public contract and no credentials.
 */
import { createHash } from 'node:crypto'
import { PortabilityError } from './errors.ts'

export const BUNDLE_FORMAT = 'pa-backup' as const
export const BUNDLE_FORMAT_VERSION = 1
export const MANIFEST_ENTRY = 'manifest.json'
export const DATABASE_ENTRY = 'state/state.sqlite'

export const BUNDLE_LIMITS = {
  /** Maximum number of non-manifest archive members. */
  maxEntries: 100_000,
  /** Maximum bytes for one decompressed member (artifact or database snapshot). */
  maxEntryBytes: 4 * 1024 * 1024 * 1024,
  /** Maximum decompressed bytes per bundle. */
  maxTotalBytes: 16 * 1024 * 1024 * 1024,
  /** Maximum manifest bytes (read before full validation). */
  maxManifestBytes: 4 * 1024 * 1024,
  /** ustar name field limit; longer paths are refused instead of using PAX/GNU extensions. */
  maxPathLength: 100,
  /** Maximum path segment count. */
  maxPathDepth: 8,
  /** Maximum compressed bundle bytes accepted by the reader. */
  maxArchiveBytes: 16 * 1024 * 1024 * 1024,
} as const

export type BundleEntryKind = 'database' | 'artifact' | 'config'

export interface BundleEntry {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly kind: BundleEntryKind
}

export interface ExcludedEntry {
  readonly path: string
  readonly reason: string
}

export interface PathBinding {
  readonly role: 'project' | 'workspace' | 'project-environment'
  readonly original: string
  readonly note?: string
}

export interface WriterClaimFacts {
  readonly pid: number
  readonly startedAt: string
  readonly heartbeatAt: string | null
}

export interface DatabaseFacts {
  readonly integrity: 'ok' | string
  readonly foreignKeyViolations: number
  readonly productSchema: number | null
  readonly snapshotBytes: number
  readonly eventSeq: number | null
  readonly writerClaim: WriterClaimFacts | null
}

export interface EvidenceReference {
  readonly protocol: 'personal-evidence'
  readonly formatVersion: 1
  readonly digest: string
  readonly productSchema: number | null
  readonly counts: {
    readonly projects: number
    readonly works: number
    readonly decisions: number
    readonly assistantDecisions: number
    readonly assistantProposals: number
    readonly artifacts: number
    readonly acceptedEvents: number
  }
  readonly routingEvidence: {
    readonly status: 'unavailable' | 'included'
    readonly reason: string
    readonly requiredPorts: readonly string[]
  }
  readonly limitations: readonly string[]
}

export interface BackupManifest {
  readonly format: typeof BUNDLE_FORMAT
  readonly formatVersion: typeof BUNDLE_FORMAT_VERSION
  readonly createdAt: string
  readonly producer: {
    readonly product: 'dsh-superagent'
    readonly version: string
    readonly node: string
    readonly sqlite: string
    readonly platform: string
    readonly arch: string
    readonly tool: string
  }
  readonly source: {
    /** Base name only; never a private absolute path. */
    readonly stateName: string
    readonly instanceRunning: boolean
    readonly access: string | null
  }
  readonly selection: {
    readonly database: boolean
    readonly artifacts: boolean
    readonly config: readonly string[]
    readonly excluded: readonly ExcludedEntry[]
    readonly includeProjectContent: false
  }
  readonly pathMap: readonly PathBinding[]
  readonly entries: readonly BundleEntry[]
  readonly artifactRefs: readonly {
    readonly id: string
    readonly digest: string
    readonly bytes: number
    readonly entry: string
  }[]
  readonly database: DatabaseFacts
  readonly counts: { readonly entries: number; readonly artifacts: number; readonly excluded: number }
  /** Optional for legacy wave-04 bundles; new bundles always record it. */
  readonly evidence?: EvidenceReference
  readonly limitations: readonly string[]
}

/** Deterministic JSON: object keys sorted, arrays preserved, undefined rejected. */
export function canonicalJson(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string')
      return input
    if (Array.isArray(input)) return input.map(walk)
    if (typeof input === 'object') {
      const record = input as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(record).sort()) {
        const next = record[key]
        if (next === undefined) throw new PortabilityError('manifest_invalid', 'Canonical JSON rejects undefined values', { key })
        sorted[key] = walk(next)
      }
      return sorted
    }
    throw new PortabilityError('manifest_invalid', 'Canonical JSON rejects non-JSON values', { type: typeof input })
  }
  return JSON.stringify(walk(value))
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function manifestDigest(manifest: BackupManifest): string {
  return sha256Hex(canonicalJson(manifest))
}

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A bundle member path must be a short, relative, forward-slash path made of plain segments.
 * Absolute paths, `..`, empty segments, backslashes, NUL, and over-deep/over-long paths are refused
 * so an archive can never write outside its staging directory.
 */
export function assertSafeEntryPath(
  path: unknown,
  limits: { readonly maxPathLength: number; readonly maxPathDepth: number } = BUNDLE_LIMITS,
): string {
  if (typeof path !== 'string' || path.length === 0)
    throw new PortabilityError('archive_unsafe_path', 'Bundle entry path must be a non-empty string', { path })
  if (path.length > limits.maxPathLength)
    throw new PortabilityError('archive_unsafe_path', 'Bundle entry path is too long', { path: path.slice(0, 120) })
  if (path.includes('\\') || path.includes('\0'))
    throw new PortabilityError('archive_unsafe_path', 'Bundle entry path contains an unsupported character', { path })
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path))
    throw new PortabilityError('archive_unsafe_path', 'Bundle entry path must be relative', { path })
  const segments = path.split('/')
  if (segments.length > limits.maxPathDepth)
    throw new PortabilityError('archive_unsafe_path', 'Bundle entry path is too deep', { path })
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment))
      throw new PortabilityError('archive_unsafe_path', 'Bundle entry path contains an unsafe segment', { path, segment })
  }
  return path
}

const fail = (message: string, detail: Readonly<Record<string, unknown>> = {}): never => {
  throw new PortabilityError('manifest_invalid', message, detail)
}

const str = (value: unknown, field: string, max = 4096): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return fail(`Manifest field ${field} is invalid`)
  return value
}

const optionalStr = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : str(value, field)

const nonNegativeInt = (value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    return fail(`Manifest field ${field} must be a non-negative safe integer`)
  return value
}

const bool = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') return fail(`Manifest field ${field} must be a boolean`)
  return value
}

/** Fail-closed structural validation. Semantic cross-checks (entry digests) happen on verify. */
export function validateManifest(input: unknown): BackupManifest {
  const value = isRecord(input) ? input : fail('Manifest must be an object')
  if (value.format !== BUNDLE_FORMAT) fail('Manifest format is not pa-backup')
  if (value.formatVersion !== BUNDLE_FORMAT_VERSION)
    throw new PortabilityError('manifest_version_unsupported', 'Bundle format version is not supported by this build', {
      formatVersion: value.formatVersion,
      supported: BUNDLE_FORMAT_VERSION,
    })
  const createdAt = str(value.createdAt, 'createdAt', 64)
  if (Number.isNaN(Date.parse(createdAt))) fail('Manifest createdAt is not an ISO timestamp')

  const producer = isRecord(value.producer) ? value.producer : fail('Manifest producer is missing')
  if (producer.product !== 'dsh-superagent') fail('Manifest producer product is unrecognized')
  const source = isRecord(value.source) ? value.source : fail('Manifest source is missing')
  const stateName = str(source.stateName, 'source.stateName', 128)
  if (stateName.includes('/') || stateName.includes('\\') || stateName === '.' || stateName === '..')
    fail('Manifest source.stateName must be a base name, not a path')
  const selection = isRecord(value.selection) ? value.selection : fail('Manifest selection is missing')
  const config = Array.isArray(selection.config) ? selection.config : fail('Manifest selection.config must be an array')
  if (config.length > 1000) fail('Manifest selection.config must be an array')
  const configPaths = config.map((entry) => assertSafeEntryPath(entry))
  const excluded = Array.isArray(selection.excluded) ? selection.excluded : fail('Manifest selection.excluded must be an array')
  if (excluded.length > 100_000) fail('Manifest selection.excluded must be an array')
  const excludedEntries: ExcludedEntry[] = excluded.map((entry) => {
    if (!isRecord(entry)) fail('Manifest excluded entry is not an object')
    return { path: str(entry.path, 'selection.excluded[].path', 4096), reason: str(entry.reason, 'selection.excluded[].reason', 256) }
  })
  if (selection.includeProjectContent !== false)
    fail('Manifest includeProjectContent must be false; project content is never implicit')

  const pathMap = Array.isArray(value.pathMap) ? value.pathMap : fail('Manifest pathMap is missing')
  const mapped: PathBinding[] = pathMap.map((entry) => {
    if (!isRecord(entry)) fail('Manifest pathMap entry is not an object')
    if (!['project', 'workspace', 'project-environment'].includes(String(entry.role)))
      fail('Manifest pathMap role is unrecognized')
    const note = optionalStr(entry.note, 'pathMap[].note')
    return {
      role: entry.role as PathBinding['role'],
      original: str(entry.original, 'pathMap[].original'),
      ...(note === undefined ? {} : { note }),
    }
  })

  const entries = Array.isArray(value.entries) ? value.entries : fail('Manifest entries are missing')
  const seen = new Set<string>()
  const parsedEntries: BundleEntry[] = entries.map((entry) => {
    if (!isRecord(entry)) fail('Manifest entry is not an object')
    const path = assertSafeEntryPath(entry.path)
    if (path === MANIFEST_ENTRY) fail('Manifest entries must not include the manifest itself')
    if (seen.has(path)) throw new PortabilityError('archive_duplicate_entry', 'Manifest lists a duplicate entry', { path })
    seen.add(path)
    const sha = str(entry.sha256, 'entries[].sha256', 64)
    if (!SHA256.test(sha)) fail('Manifest entry sha256 is invalid')
    if (!['database', 'artifact', 'config'].includes(String(entry.kind)))
      fail('Manifest entry kind is unrecognized')
    return {
      path,
      bytes: nonNegativeInt(entry.bytes, 'entries[].bytes', BUNDLE_LIMITS.maxEntryBytes),
      sha256: sha,
      kind: entry.kind as BundleEntryKind,
    }
  })

  const refs = Array.isArray(value.artifactRefs) ? value.artifactRefs : fail('Manifest artifactRefs are missing')
  const artifactRefs = refs.map((entry) => {
    if (!isRecord(entry)) fail('Manifest artifactRef is not an object')
    const id = str(entry.id, 'artifactRefs[].id', 128)
    const digest = str(entry.digest, 'artifactRefs[].digest', 64)
    if (!SHA256.test(digest)) fail('Manifest artifactRef digest is invalid')
    if (!SHA256.test(id)) fail('Manifest artifactRef id is not a content address')
    const path = assertSafeEntryPath(entry.entry)
    if (!seen.has(path)) fail('Manifest artifactRef names an entry that does not exist')
    return { id, digest, bytes: nonNegativeInt(entry.bytes, 'artifactRefs[].bytes'), entry: path }
  })

  const database = isRecord(value.database) ? value.database : fail('Manifest database facts are missing')
  const eventSeq = database.eventSeq === null || database.eventSeq === undefined
    ? null
    : nonNegativeInt(database.eventSeq, 'database.eventSeq')
  let writerClaim: WriterClaimFacts | null = null
  if (database.writerClaim !== null && database.writerClaim !== undefined) {
    const claim = isRecord(database.writerClaim) ? database.writerClaim : fail('Manifest database.writerClaim is invalid')
    const heartbeat = claim.heartbeatAt
    writerClaim = {
      pid: nonNegativeInt(claim.pid, 'database.writerClaim.pid'),
      startedAt: str(claim.startedAt, 'database.writerClaim.startedAt', 64),
      heartbeatAt: heartbeat === null ? null : str(heartbeat, 'database.writerClaim.heartbeatAt', 64),
    }
  }
  const databaseFacts: DatabaseFacts = {
    integrity: str(database.integrity, 'database.integrity', 4096),
    foreignKeyViolations: nonNegativeInt(database.foreignKeyViolations, 'database.foreignKeyViolations'),
    productSchema: database.productSchema === null ? null : nonNegativeInt(database.productSchema, 'database.productSchema'),
    snapshotBytes: nonNegativeInt(database.snapshotBytes, 'database.snapshotBytes', BUNDLE_LIMITS.maxEntryBytes),
    eventSeq,
    writerClaim,
  }

  const counts = isRecord(value.counts) ? value.counts : fail('Manifest counts are missing')
  if (nonNegativeInt(counts.entries, 'counts.entries') !== parsedEntries.length)
    fail('Manifest counts.entries does not match entries')
  if (nonNegativeInt(counts.artifacts, 'counts.artifacts') !== artifactRefs.length)
    fail('Manifest counts.artifacts does not match artifactRefs')
  if (nonNegativeInt(counts.excluded, 'counts.excluded') !== excludedEntries.length)
    fail('Manifest counts.excluded does not match excluded')

  const limitations = Array.isArray(value.limitations) ? value.limitations : fail('Manifest limitations are missing')
  if (limitations.length > 1000) fail('Manifest limitations is too long')
  const limitationTexts = limitations.map((entry) => str(entry, 'limitations[]', 2048))

  // Optional for legacy bundles. New bundles must carry a well-formed evidence reference.
  let evidence: EvidenceReference | undefined
  if (value.evidence !== undefined) {
    const raw = isRecord(value.evidence) ? value.evidence : fail('Manifest evidence is invalid')
    if (raw.protocol !== 'personal-evidence') fail('Manifest evidence protocol is unrecognized')
    if (raw.formatVersion !== 1) fail('Manifest evidence format version is unsupported')
    const digest = str(raw.digest, 'evidence.digest', 64)
    if (!SHA256.test(digest)) fail('Manifest evidence digest is invalid')
    const evidenceCounts = isRecord(raw.counts) ? raw.counts : fail('Manifest evidence.counts is missing')
    const routing = isRecord(raw.routingEvidence) ? raw.routingEvidence : fail('Manifest evidence.routingEvidence is missing')
    if (!['unavailable', 'included'].includes(String(routing.status))) fail('Manifest evidence.routingEvidence.status is invalid')
    const requiredPorts = Array.isArray(routing.requiredPorts) ? routing.requiredPorts : fail('Manifest evidence.routingEvidence.requiredPorts is missing')
    const evidenceLimitations = Array.isArray(raw.limitations) ? raw.limitations : fail('Manifest evidence.limitations is missing')
    evidence = {
      protocol: 'personal-evidence',
      formatVersion: 1,
      digest,
      productSchema: raw.productSchema === null || raw.productSchema === undefined ? null : nonNegativeInt(raw.productSchema, 'evidence.productSchema'),
      counts: {
        projects: nonNegativeInt(evidenceCounts.projects, 'evidence.counts.projects'),
        works: nonNegativeInt(evidenceCounts.works, 'evidence.counts.works'),
        decisions: nonNegativeInt(evidenceCounts.decisions, 'evidence.counts.decisions'),
        assistantDecisions: nonNegativeInt(evidenceCounts.assistantDecisions, 'evidence.counts.assistantDecisions'),
        assistantProposals: nonNegativeInt(evidenceCounts.assistantProposals, 'evidence.counts.assistantProposals'),
        artifacts: nonNegativeInt(evidenceCounts.artifacts, 'evidence.counts.artifacts'),
        acceptedEvents: nonNegativeInt(evidenceCounts.acceptedEvents, 'evidence.counts.acceptedEvents'),
      },
      routingEvidence: {
        status: routing.status as 'unavailable' | 'included',
        reason: str(routing.reason, 'evidence.routingEvidence.reason', 2048),
        requiredPorts: requiredPorts.map((entry) => str(entry, 'evidence.routingEvidence.requiredPorts[]', 512)),
      },
      limitations: evidenceLimitations.map((entry) => str(entry, 'evidence.limitations[]', 1024)),
    }
  }

  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    createdAt,
    producer: {
      product: 'dsh-superagent',
      version: str(producer.version, 'producer.version', 64),
      node: str(producer.node, 'producer.node', 64),
      sqlite: str(producer.sqlite, 'producer.sqlite', 64),
      platform: str(producer.platform, 'producer.platform', 64),
      arch: str(producer.arch, 'producer.arch', 64),
      tool: str(producer.tool, 'producer.tool', 128),
    },
    source: {
      stateName,
      instanceRunning: bool(source.instanceRunning, 'source.instanceRunning'),
      access: source.access === null ? null : str(source.access, 'source.access', 64),
    },
    selection: {
      database: bool(selection.database, 'selection.database'),
      artifacts: bool(selection.artifacts, 'selection.artifacts'),
      config: configPaths,
      excluded: excludedEntries,
      includeProjectContent: false,
    },
    pathMap: mapped,
    entries: parsedEntries,
    artifactRefs,
    database: databaseFacts,
    counts: { entries: parsedEntries.length, artifacts: artifactRefs.length, excluded: excludedEntries.length },
    ...(evidence === undefined ? {} : { evidence }),
    limitations: limitationTexts,
  }
}
