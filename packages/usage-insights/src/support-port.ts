/**
 * Stable Node port for the support path.
 *
 * main owns HTTP/App/transport; this module is what main composes: one function that turns the
 * document a user holds into a support report, one that turns an install manifest into identity
 * (with missing fields left unknown), one that builds the shareable file, and the three label strings
 * the existing trial workspace already renders. Nothing here is a route, a credential reader or a
 * browser import: the report is computed in Node and only bounded strings cross into the UI.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { UsageObservationDownloadSchema, UsageObservationSchema, UsageSupportDownloadSchema } from '@personal-agent/contracts'
import { DisplayExportDocumentSchema } from './display-export.ts'
import { buildSupportReport, describeDisplayDocument, SUPPORT_SUMMARY_PROTOCOL, type SupportReport } from './support.ts'

export const SUPPORT_FILE_PROTOCOL = 'usage-insights-support-file/1' as const
export const SUPPORT_DTO_PROTOCOL = 'usage-insights-support/1' as const
export const SUPPORT_FILE_MAX_BYTES = 65_536

export interface SupportDigestCheck {
  /** The digest the document declares, when it declares one. */
  readonly declared: string | null
  /** The digest recomputed from the bytes actually parsed. */
  readonly actual: string
  /** `true` only when a declared digest is present and equal to the recomputed one. */
  readonly verified: boolean
  /** Not every document carries a digest; `unverified` is not a pass. */
  readonly state: 'verified' | 'mismatch' | 'absent'
}

export interface SupportConservation {
  /** The rows the file carries are exactly the rows the embedded observation carries. */
  readonly rowsMatch: boolean
  readonly scopeMatches: boolean
  readonly windowMatches: boolean
  readonly headerMatches: boolean
  /** Reasons a comparison could not be made; empty when every check ran. */
  readonly notCompared: readonly string[]
}

/**
 * What was actually proven about the document. `contract-digest` means the product's own contract and
 * the payload digest both hold; `digest-only` means the bytes match their declared hash but the
 * envelope does not satisfy the product contract; `shape-only` means no digest was available at all.
 */
export type SupportVerification = 'contract-digest' | 'digest-only' | 'shape-only'

export interface SupportDocumentRead {
  readonly report: SupportReport
  /**
   * Unknown fields are not dropped-and-forgotten: a document that carries them fails its contract and
   * is refused, so a report can never be read as "we inspected and cleared every field".
   */
  readonly verification: SupportVerification
  /** `observation` (served DTO), `export` (downloaded display document) or `download` (envelope). */
  readonly documentKind: 'observation' | 'export' | 'download' | 'support'
  readonly digest: SupportDigestCheck
  readonly conservation: SupportConservation
  /**
   * Whether the envelope passed the product's own contract. A file from an older build (or one that
   * was re-serialized) still yields a digest verdict and a conservation verdict, but is reported as
   * not contract-valid so nobody mistakes it for a product-produced artifact.
   */
  readonly contractValid: boolean
}

export class SupportPortFault extends Error {
  readonly code: 'invalid_document' | 'digest_mismatch' | 'too_large'
  constructor(code: SupportPortFault['code'], message: string) {
    super(message)
    this.name = 'SupportPortFault'
    this.code = code
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Attach a caller-supplied origin to a report that was written without one (a file main produced, or
 * a legacy summary). The report's own evidence is kept; only the identity and the capability verdict
 * change, and the verdict is derived from the origin rather than copied.
 */
const withOrigin = (report: SupportReport, origin: unknown): SupportReport => {
  if (origin === null || origin === undefined) return report
  const parsed = SupportOriginSchema.safeParse(origin)
  if (!parsed.success) return report
  const block = parsed.data as unknown as SupportReport['origin']
  if (block === null) return report
  const exportCapability = block.capabilities === null ? 'unverified' as const
    : block.capabilities.displayDownload ? 'present' as const : 'absent' as const
  return { ...report, origin: block, exportCapability }
}

interface LooseEnvelope {
  readonly observation: unknown
  readonly text: string
  readonly sha256: string
}

/** The minimum an envelope must carry for a digest and conservation verdict to mean anything. */
const looseEnvelope = (input: unknown): LooseEnvelope | null => {
  if (input === null || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  if (record.protocol !== 'usage-observation-download/1') return null
  if (typeof record.text !== 'string' || typeof record.sha256 !== 'string') return null
  if (!UsageObservationSchema.safeParse(record.observation).success) return null
  if (!/^[a-f0-9]{64}$/.test(record.sha256)) return null
  return { observation: record.observation, text: record.text, sha256: record.sha256 }
}

const envelopeRead = (envelope: LooseEnvelope, contractValid: boolean, options: { origin?: unknown }): SupportDocumentRead => {
  const actual = sha256(envelope.text)
  const digest: SupportDigestCheck = envelope.sha256 === actual
    ? { declared: envelope.sha256, actual, verified: true, state: 'verified' }
    : { declared: envelope.sha256, actual, verified: false, state: 'mismatch' }
  let document: unknown
  try {
    document = JSON.parse(envelope.text)
  } catch {
    throw new SupportPortFault('invalid_document', 'The envelope text is not JSON')
  }
  const report = buildSupportReport({ observation: envelope.observation, origin: options.origin })
  return {
    report,
    verification: digest.state !== 'verified' || !contractValid ? 'digest-only' : 'contract-digest',
    documentKind: 'download',
    digest,
    conservation: conservationOf(envelope.observation, document),
    contractValid,
  }
}

const conservationOf = (observation: unknown, document: unknown): SupportConservation => {
  const dto = UsageObservationSchema.safeParse(observation)
  const exported = DisplayExportDocumentSchema.safeParse(document)
  if (!dto.success || !exported.success)
    return { rowsMatch: false, scopeMatches: false, windowMatches: false, headerMatches: false,
      notCompared: ['the envelope does not carry both an observation and a display document'] }
  const a = dto.data, b = exported.data
  const header = { status: a.status, windowLabel: a.windowLabel, coverage: a.coverage, coverageState: a.coverageState,
    sampleCount: a.sampleCount, unknownCount: a.unknownCount }
  return {
    rowsMatch: a.metrics.length === b.rows.length &&
      b.rows.every((row, index) => row.rowId === a.metrics[index]!.id && row.formatted === a.metrics[index]!.value &&
        row.layer === a.metrics[index]!.layer && row.unit === a.metrics[index]!.unit &&
        row.sampleCount === a.metrics[index]!.sampleCount),
    scopeMatches: JSON.stringify(a.scope) === JSON.stringify(b.scope),
    windowMatches: JSON.stringify(a.window) === JSON.stringify(b.window),
    headerMatches: JSON.stringify(header) === JSON.stringify(b.header),
    notCompared: [],
  }
}

/**
 * Read one document a user or an operator holds.
 *
 * A downloaded envelope is checked for its **digest** (the shape check is not a cryptographic check)
 * and for field conservation between the bytes and the observation it claims to belong to. A bare
 * display document or a served observation has no declared digest, so the digest state is `absent`
 * and the conservation block says what could not be compared.
 */
export function readSupportDocument(input: unknown, options: { origin?: unknown } = {}): SupportDocumentRead {
  // A support file main produced: the envelope names a digest of the text, and the text carries the
  // report. The product contract checks the two agree by shape; the digest check is ours.
  const support = UsageSupportDownloadSchema.safeParse(input)
  if (support.success) {
    const actual = sha256(support.data.text)
    const digest: SupportDigestCheck = support.data.sha256 === actual
      ? { declared: support.data.sha256, actual, verified: true, state: 'verified' }
      : { declared: support.data.sha256, actual, verified: false, state: 'mismatch' }
    const file = readSupportFile(JSON.parse(support.data.text))
    return {
      report: withOrigin(file.report, options.origin),
      verification: digest.state === 'verified' && file.schema === 'current' ? 'contract-digest' : 'digest-only',
      documentKind: 'support',
      digest,
      conservation: { rowsMatch: false, scopeMatches: false, windowMatches: false, headerMatches: false,
        notCompared: ['a support file carries one report, so there is no second document to compare'] },
      contractValid: file.schema === 'current',
    }
  }
  // A bare summary written by an older build: no envelope, no digest. It is re-projected and marked
  // shape-only so a colleague can still read it, with nothing presented as verified.
  if (input !== null && typeof input === 'object' && (input as Record<string, unknown>).protocol === SUPPORT_SUMMARY_PROTOCOL) {
    const file = readSupportFile({ protocol: SUPPORT_DTO_PROTOCOL, report: input })
    return {
      report: withOrigin(file.report, options.origin),
      verification: 'shape-only',
      documentKind: 'support',
      digest: { declared: null, actual: sha256(JSON.stringify(input)), verified: false, state: 'absent' },
      conservation: { rowsMatch: false, scopeMatches: false, windowMatches: false, headerMatches: false,
        notCompared: ['a bare summary carries one report and no envelope, so there is nothing to verify against'] },
      contractValid: file.schema === 'current',
    }
  }
  const strict = UsageObservationDownloadSchema.safeParse(input)
  if (strict.success) return envelopeRead(strict.data, true, options)

  // A file that does not satisfy the product contract can still be diagnosed: the digest verdict and
  // the conservation verdict are exactly what tells a colleague that it was edited or came from a
  // different build. It is never reported as contract-valid.
  const loose = looseEnvelope(input)
  if (loose !== null) return envelopeRead(loose, false, options)

  const observation = UsageObservationSchema.safeParse(input)
  const exported = DisplayExportDocumentSchema.safeParse(input)
  if (!observation.success && !exported.success)
    throw new SupportPortFault('invalid_document', 'The document is not an observation, a display export or a download envelope')
  const report = buildSupportReport({ observation: input, origin: options.origin })
  return {
    // A bare document is not an envelope, but it did pass the strict schema that defines it: the
    // contract holds, only a payload digest is missing.
    contractValid: true,
    verification: 'shape-only',
    report,
    documentKind: observation.success ? 'observation' : 'export',
    // A bare document carries no payload digest to verify; calling that "verified" would be a lie.
    digest: { declared: null, actual: sha256(JSON.stringify(input)), verified: false, state: 'absent' },
    conservation: { rowsMatch: false, scopeMatches: false, windowMatches: false, headerMatches: false,
      notCompared: ['no envelope: there is no second document to compare against'] },
  }
}

const SupportRowSchema = z.object({
  rowId: z.string().min(1).max(200), layer: z.enum(['observed', 'controlled', 'native', 'operator', 'unknown']),
  unit: z.string().max(16), hasValue: z.boolean(), sampleCount: z.number().int().min(0).max(1_000_000).nullable(),
}).passthrough()
const SupportOriginSchema = z.object({
  kind: z.enum(['package', 'runtime', 'unknown']),
  identitySource: z.enum(['install-manifest', 'incomplete-manifest', 'archive-only']).nullable(),
  buildId: z.string().max(128).nullable(), sourceCommit: z.string().max(128).nullable(),
  archiveSha256: z.string().max(64).nullable(),
  capabilities: z.object({ pageObservation: z.boolean(), numericExport: z.boolean(), displayDownload: z.boolean() }).nullable(),
  browserTrigger: z.enum(['present', 'absent', 'unverifiable']).nullable(),
  missing: z.array(z.string().max(64)).max(8),
}).passthrough()
/** Shape of the support report a colleague receives; the reader below validates it. */
export const SupportReportSchema = z.object({
  protocol: z.literal(SUPPORT_SUMMARY_PROTOCOL),
  observationProtocol: z.literal('usage-observation/1'),
  documentKind: z.enum(['observation', 'display_export']),
  status: z.enum(['ready', 'insufficient_data', 'unavailable']),
  summaryId: z.string().max(64).nullable(),
  days: z.union([z.literal(7), z.literal(30)]),
  timezone: z.string().min(1).max(64),
  coverageState: z.enum(['complete', 'partial', 'unknown']),
  counts: z.object({ rows: z.number().int().min(0).max(2000), withValue: z.number().int().min(0).max(2000),
    unknown: z.number().int().min(0).max(2000), sampleCount: z.number().int().min(0).max(1_000_000).nullable() }),
  rows: z.array(SupportRowSchema).max(2000),
  origin: SupportOriginSchema.nullable(),
  evidence: z.object({ coverageState: z.enum(['complete', 'partial', 'unknown']),
    rowsWithValue: z.number().int().min(0), rowsWithoutValue: z.number().int().min(0),
    sampleCount: z.number().int().min(0).nullable(), partial: z.boolean(),
    absentFacts: z.array(z.string().max(256)).max(16) }),
  exportCapability: z.enum(['present', 'absent', 'unverified']),
  numericValues: z.literal(false),
  authorization: z.literal('none'),
}).passthrough()

export interface SupportFile {
  readonly protocol: typeof SUPPORT_FILE_PROTOCOL
  readonly fileName: string
  readonly mediaType: 'application/json'
  readonly text: string
  readonly bytes: number
  readonly sha256: string
}

/**
 * The file a user can hand to a colleague. It is the support report itself, bounded, with a name that
 * identifies the observation and the build — the same envelope shape main already downloads, so main
 * can reuse one download path for both files.
 */
export function buildSupportFile(report: SupportReport, options: { maxBytes?: number } = {}): SupportFile {
  const maxBytes = options.maxBytes ?? SUPPORT_FILE_MAX_BYTES
  // The summary keeps its own protocol identity inside the envelope; the envelope names the
  // shareable artifact, so neither identity is overwritten.
  const envelope = { protocol: SUPPORT_DTO_PROTOCOL, report }
  const text = `${JSON.stringify(envelope, null, 2)}\n`
  const bytes = Buffer.byteLength(text)
  if (bytes > maxBytes) throw new SupportPortFault('too_large', `The support file is ${bytes} bytes, above the ${maxBytes}-byte budget`)
  const build = report.origin?.buildId ?? 'unknown-build'
  const snapshot = report.summaryId === null ? 'no-snapshot' : report.summaryId.slice(0, 12)
  return {
    protocol: SUPPORT_FILE_PROTOCOL,
    fileName: `support-${report.days}d-${snapshot}-${build}.json`,
    mediaType: 'application/json',
    text,
    bytes,
    sha256: sha256(text),
  }
}

/** The three strings the trial workspace already renders; `undefined` means "not supplied". */
export function supportLabels(report: SupportReport): {
  readonly packageLabel?: string
  readonly sourceLabel?: string
  readonly note?: string
} {
  const origin = report.origin
  if (origin === null) return { note: '未附带安装包身份；观察本身不可据此判断版本。' }
  const build = origin.buildId ?? '未声明构建'
  const archive = origin.archiveSha256 === null ? '未声明摘要' : `tar ${origin.archiveSha256.slice(0, 12)}…`
  const packageLabel = `${build} / ${archive}`
  const sourceLabel = origin.sourceCommit === null ? '来源未声明' : `source ${origin.sourceCommit.slice(0, 12)}`
  const parts: string[] = []
  if (origin.identitySource === 'incomplete-manifest') parts.push('安装清单字段不全，缺失项保持未知')
  if (origin.missing.length) parts.push(`缺能力：${origin.missing.join(', ')}`)
  if (report.evidence.absentFacts.length) parts.push(report.evidence.absentFacts[0]!)
  return { packageLabel, sourceLabel, ...(parts.length ? { note: parts.join('；') } : {}) }
}

export interface SupportFileRead {
  readonly report: SupportReport
  /** `current` satisfies the published shape; `legacy` was re-projected from an older one. */
  readonly schema: 'current' | 'legacy'
  /** Fields an older file did not carry; they are null/unknown, never guessed. */
  readonly missingFields: readonly string[]
}

/**
 * Read a support file a colleague received.
 *
 * A file from an older build (before `origin` and `evidence` existed) is not refused and not trusted:
 * its known fields are re-projected, the missing ones stay unknown/`unverified`, and the caller is told
 * the schema is `legacy`.
 */
export function readSupportFile(input: unknown): SupportFileRead {
  if (input === null || typeof input !== 'object')
    throw new SupportPortFault('invalid_document', 'The support file is not an object')
  const envelope = input as Record<string, unknown>
  if (envelope.protocol !== SUPPORT_DTO_PROTOCOL)
    throw new SupportPortFault('invalid_document', 'The file is not a usage-insights-support/1 payload')
  const parsed = SupportReportSchema.safeParse(envelope.report)
  if (parsed.success) return { report: parsed.data as unknown as SupportReport, schema: 'current', missingFields: [] }
  const legacy = legacyReport(envelope.report)
  if (legacy === null) throw new SupportPortFault('invalid_document', 'The support report does not match its published shape')
  return { report: legacy.report, schema: 'legacy', missingFields: legacy.missingFields }
}

/**
 * Re-project a wave-32-era report: keep the fields that were recorded, derive `evidence` from them,
 * and leave `origin`/`exportCapability` explicitly unknown instead of inventing them.
 */
const legacyReport = (raw: unknown): { report: SupportReport; missingFields: string[] } | null => {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record.protocol !== SUPPORT_SUMMARY_PROTOCOL) return null
  const rows = Array.isArray(record.rows) ? record.rows as Record<string, unknown>[] : null
  const counts = record.counts !== null && typeof record.counts === 'object' ? record.counts as Record<string, unknown> : null
  const window = record.window !== null && typeof record.window === 'object' ? record.window as Record<string, unknown> : null
  const scope = record.scope !== null && typeof record.scope === 'object' ? record.scope as Record<string, unknown> : null
  const coverageState = record.coverageState === 'complete' || record.coverageState === 'partial' || record.coverageState === 'unknown'
    ? record.coverageState : null
  const status = record.status === 'ready' || record.status === 'insufficient_data' || record.status === 'unavailable'
    ? record.status : null
  const days = record.days === 7 || record.days === 30 ? record.days : null
  if (rows === null || counts === null || window === null || scope === null || coverageState === null || status === null ||
    days === null || typeof window.from !== 'string' || typeof window.to !== 'string' ||
    typeof record.observedAt !== 'string' || typeof record.timezone !== 'string' || !Array.isArray(scope.projectIds))
    return null
  const layers = ['observed', 'controlled', 'native', 'operator', 'unknown'] as const
  type Layer = (typeof layers)[number]
  const supportRows = rows.map(row => ({
    rowId: String(row.rowId ?? ''),
    layer: (layers as readonly unknown[]).includes(row.layer) ? row.layer as Layer : 'unknown' as Layer,
    unit: String(row.unit ?? ''), hasValue: row.hasValue === true,
    sampleCount: typeof row.sampleCount === 'number' ? row.sampleCount : null,
  }))
  const withValue = supportRows.filter(row => row.hasValue).length
  const absentFacts: string[] = []
  if (supportRows.length - withValue > 0) absentFacts.push(`${supportRows.length - withValue} row(s) have no observed value`)
  if (coverageState === 'partial') absentFacts.push('the observation is partial')
  if (coverageState === 'unknown') absentFacts.push('coverage is unknown')
  if (status === 'unavailable') absentFacts.push('the observation is unavailable')
  const sampleCount = typeof counts.sampleCount === 'number' ? counts.sampleCount : null
  if (sampleCount === null) absentFacts.push('the header sample count is not established')
  const report: SupportReport = {
    protocol: SUPPORT_SUMMARY_PROTOCOL,
    observationProtocol: 'usage-observation/1',
    documentKind: 'observation',
    status,
    summaryId: typeof record.summaryId === 'string' ? record.summaryId : null,
    observedAt: record.observedAt,
    days,
    timezone: record.timezone,
    window: { from: window.from, to: window.to },
    scope: { projectIds: scope.projectIds.map(String), aggregation: String(scope.aggregation ?? 'declared_multi_project'),
      label: String(scope.label ?? '') },
    coverage: String(record.coverage ?? ''),
    coverageState,
    counts: { rows: supportRows.length, withValue, unknown: supportRows.length - withValue, sampleCount },
    rows: supportRows,
    limitations: Array.isArray(record.limitations) ? record.limitations.map(String).slice(0, 32) : [],
    numericValues: false,
    note: String(record.note ?? 'Legacy support report: metadata only.'),
    authorization: 'none',
    origin: null,
    evidence: { coverageState, rowsWithValue: withValue, rowsWithoutValue: supportRows.length - withValue, sampleCount,
      partial: coverageState !== 'complete' || status !== 'ready', absentFacts },
    exportCapability: 'unverified',
  }
  const missingFields: string[] = []
  for (const field of ['origin', 'evidence', 'exportCapability', 'documentKind'] as const)
    if (!(field in record)) missingFields.push(field)
  return { report, missingFields }
}

/**
 * A framework-free handler main can mount. It returns a status and a JSON body; it never throws a
 * stack trace to the client and never echoes the document's values back.
 */
export function createSupportHandler(dependencies: { resolveOrigin?: () => unknown } = {}) {
  return (input: unknown): { status: 200 | 422; body: unknown } => {
    try {
      const read = readSupportDocument(input, dependencies.resolveOrigin === undefined
        ? {} : { origin: dependencies.resolveOrigin() })
      return {
        status: 200,
        body: { protocol: SUPPORT_DTO_PROTOCOL, report: read.report, digest: read.digest, conservation: read.conservation },
      }
    } catch (error) {
      const code = error instanceof SupportPortFault ? error.code : 'invalid_document'
      return { status: 422, body: { error: { code, message: 'The support summary could not be produced.' } } }
    }
  }
}

/**
 * Identity from an install manifest.
 *
 * Only declared fields are used. A manifest that declares neither build nor source yields `null`
 * (nothing is known); one that declares only some of them is `incomplete-manifest` with the rest
 * left null. A path, a branch name or a bundle keyword is never converted into a commit hash.
 */
export function originFromManifest(
  manifest: unknown,
  capabilities?: { pageObservation: boolean; numericExport: boolean; displayDownload: boolean } | null,
  options: { browserTrigger?: SupportOriginTrigger, missing?: readonly string[]; archiveSha256?: string | null } = {},
): import('./support.ts').SupportOrigin | null {
  if (manifest === null || typeof manifest !== 'object') return null
  const record = manifest as Record<string, unknown>
  const source = record.source !== null && typeof record.source === 'object' ? record.source as Record<string, unknown> : null
  const buildId = typeof record.buildId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(record.buildId) ? record.buildId : null
  const commit = source !== null && typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit) ? source.commit : null
  const archiveSha256 = typeof options.archiveSha256 === 'string' && /^[a-f0-9]{64}$/.test(options.archiveSha256)
    ? options.archiveSha256 : null
  if (buildId === null && commit === null) return null
  return {
    kind: 'package',
    identitySource: buildId !== null && commit !== null ? 'install-manifest' : 'incomplete-manifest',
    buildId,
    sourceCommit: commit,
    archiveSha256,
    capabilities: capabilities ?? null,
    browserTrigger: options.browserTrigger ?? null,
    missing: options.missing ? [...options.missing] : [],
  }
}

export type SupportOriginTrigger = 'present' | 'absent' | 'unverifiable'
