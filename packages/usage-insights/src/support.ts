/**
 * Sanitized support summary of a served observation.
 *
 * A colleague asking for help needs the scope, window, coverage, counts and identity of what they
 * saw — not the values, not free text and not a path. This module reads the served
 * `usage-observation/1` document and returns metadata only: no formatted value, no label, no detail
 * string. It deliberately cannot be used to turn a display document into numbers.
 */
import { UsageObservationSchema, type UsageObservation } from '@personal-agent/contracts'
import { DisplayExportDocumentSchema, type DisplayExportDocument } from './display-export.ts'

export const SUPPORT_SUMMARY_PROTOCOL = 'usage-insights-support-summary/1' as const

export interface SupportRow {
  readonly rowId: string
  readonly layer: 'observed' | 'controlled' | 'native' | 'operator' | 'unknown'
  readonly unit: string
  readonly hasValue: boolean
  readonly sampleCount: number | null
}

export interface SupportSummary {
  readonly protocol: typeof SUPPORT_SUMMARY_PROTOCOL
  readonly observationProtocol: 'usage-observation/1'
  /** Which document the caller holds: the served observation or the file they downloaded. */
  readonly documentKind: 'observation' | 'display_export'
  readonly status: UsageObservation['status']
  readonly summaryId: string | null
  readonly observedAt: string
  readonly days: 7 | 30
  readonly timezone: string
  readonly window: { readonly from: string; readonly to: string }
  readonly scope: { readonly projectIds: readonly string[]; readonly aggregation: string; readonly label: string }
  readonly coverage: string
  readonly coverageState: 'complete' | 'partial' | 'unknown'
  readonly counts: { readonly rows: number; readonly withValue: number; readonly unknown: number; readonly sampleCount: number | null }
  readonly rows: readonly SupportRow[]
  readonly limitations: readonly string[]
  readonly numericValues: false
  readonly note: string
  readonly authorization: 'none'
}

export class SupportFault extends Error {
  readonly code: 'invalid_display_dto'
  constructor(message: string) {
    super(message)
    this.name = 'SupportFault'
    this.code = 'invalid_display_dto'
  }
}

/**
 * Describe a served document for a support ticket. Only identifiers, units, layer names, counts,
 * coverage and the served limitations are copied; values and free text are not.
 */
export function describeDisplayDocument(raw: unknown): SupportSummary {
  const dto = UsageObservationSchema.safeParse(raw)
  if (dto.success) return summaryOfObservation(dto.data)
  const exported = DisplayExportDocumentSchema.safeParse(raw)
  if (exported.success) return summaryOfExport(exported.data)
  throw new SupportFault('The document is neither a usage-observation/1 payload nor a display export')
}

const summaryOfExport = (document: DisplayExportDocument): SupportSummary => {
  const rows: SupportRow[] = document.rows.map(row => ({
    rowId: row.rowId,
    layer: row.layer,
    unit: row.unit,
    hasValue: row.formatted !== null,
    sampleCount: row.sampleCount,
  }))
  return {
    protocol: SUPPORT_SUMMARY_PROTOCOL,
    observationProtocol: 'usage-observation/1',
    documentKind: 'display_export',
    status: document.header.status,
    summaryId: document.snapshot.snapshotId,
    observedAt: document.snapshot.capturedAt,
    days: document.exportedFrom.days,
    timezone: document.exportedFrom.timezone,
    window: { from: document.window.from, to: document.window.to },
    scope: { projectIds: document.scope.projectIds, aggregation: document.scope.aggregation, label: document.scope.label },
    coverage: document.header.coverage,
    coverageState: document.header.coverageState,
    counts: {
      rows: rows.length,
      withValue: rows.filter(row => row.hasValue).length,
      unknown: rows.filter(row => !row.hasValue).length,
      sampleCount: document.header.sampleCount,
    },
    rows,
    limitations: document.limitations,
    numericValues: false,
    note: 'Downloaded display document: formatted strings only. This summary carries metadata only; it is not a numeric analysis result.',
    authorization: 'none',
  }
}

const summaryOfObservation = (dto: UsageObservation): SupportSummary => {
  const rows: SupportRow[] = dto.metrics.map(metric => ({
    rowId: metric.id,
    layer: metric.layer,
    unit: metric.unit,
    hasValue: metric.value !== null,
    sampleCount: metric.sampleCount,
  }))
  return {
    protocol: SUPPORT_SUMMARY_PROTOCOL,
    observationProtocol: 'usage-observation/1',
    documentKind: 'observation',
    status: dto.status,
    summaryId: dto.summaryId,
    observedAt: dto.observedAt,
    days: dto.days,
    timezone: dto.timezone,
    window: { from: dto.window.from, to: dto.window.to },
    scope: { projectIds: dto.scope.projectIds, aggregation: dto.scope.aggregation, label: dto.scope.label },
    coverage: dto.coverage,
    coverageState: dto.coverageState,
    counts: {
      rows: rows.length,
      withValue: rows.filter(row => row.hasValue).length,
      unknown: rows.filter(row => !row.hasValue).length,
      sampleCount: dto.sampleCount,
    },
    rows,
    limitations: dto.limitations,
    numericValues: false,
    note: 'Display document: the served values are formatted strings. This summary carries metadata only; it is not a numeric analysis result.',
    authorization: 'none',
  }
}

/** Markdown rendering of a support summary, safe to paste into a ticket. */
export function renderSupportSummary(summary: SupportSummary): string {
  const lines: string[] = []
  lines.push(`# Observation support summary`)
  lines.push('')
  lines.push(`| Field | Value |`)
  lines.push(`| --- | --- |`)
  lines.push(`| Status | ${summary.status} |`)
  lines.push(`| Observation | ${summary.observedAt} (${summary.days} days, ${summary.timezone}) |`)
  lines.push(`| Window | ${summary.window.from} → ${summary.window.to} |`)
  lines.push(`| Scope | ${summary.scope.projectIds.join(', ') || '—'} (${summary.scope.aggregation}) |`)
  lines.push(`| Coverage | ${summary.coverageState} |`)
  lines.push(`| Summary id | ${summary.summaryId ?? 'none'} |`)
  lines.push(`| Rows | ${summary.counts.rows} (${summary.counts.withValue} with a value, ${summary.counts.unknown} unknown) |`)
  lines.push('')
  lines.push(`| Row id | Layer | Unit | Value present | Samples |`)
  lines.push(`| --- | --- | --- | --- | --- |`)
  for (const row of summary.rows)
    lines.push(`| ${row.rowId} | ${row.layer} | ${row.unit || '—'} | ${row.hasValue ? 'yes' : 'no'} | ${row.sampleCount ?? '—'} |`)
  lines.push('')
  for (const limitation of summary.limitations) lines.push(`- ${limitation}`)
  lines.push('')
  lines.push(summary.note)
  return `${lines.join('\n')}\n`
}

/** Where the observation came from, when the caller also inspected the running package. */
export interface SupportOrigin {
  readonly kind: 'package' | 'runtime' | 'unknown'
  /**
   * Where build and source came from. `install-manifest` means the package declared both fields;
   * `incomplete-manifest` means it declared some but not all (the missing ones stay null instead of
   * being guessed); `archive-only` means only the archive digest is known.
   */
  readonly identitySource: 'install-manifest' | 'incomplete-manifest' | 'archive-only' | null
  readonly buildId: string | null
  readonly sourceCommit: string | null
  readonly archiveSha256: string | null
  readonly capabilities: {
    readonly pageObservation: boolean
    readonly numericExport: boolean
    readonly displayDownload: boolean
  } | null
  readonly browserTrigger: 'present' | 'absent' | 'unverifiable' | null
  /** Capabilities the package does not contain; the first thing a support reader needs. */
  readonly missing: readonly string[]
}

/** What was observed versus what was merely available, so "incomplete" is visible. */
export interface SupportEvidence {
  readonly coverageState: 'complete' | 'partial' | 'unknown'
  readonly rowsWithValue: number
  readonly rowsWithoutValue: number
  readonly sampleCount: number | null
  /** True when the document itself says it is bounded, stale or partial. */
  readonly partial: boolean
  /** Absences a reader must not read as zero. */
  readonly absentFacts: readonly string[]
}

export interface SupportReport extends SupportSummary {
  readonly origin: SupportOrigin | null
  readonly evidence: SupportEvidence
  /** True only when a package was inspected **and** the export capability is present. */
  readonly exportCapability: 'present' | 'absent' | 'unverified'
}

const CAPABILITY_NAMES = ['pageObservation', 'numericExport', 'displayDownload'] as const

/**
 * Combine an observation's metadata with an inspected package, so one report answers the three
 * questions a trial report usually needs: what did I see, which version produced it, and which
 * capability is missing. The package report is plain data (no import of the tool), and anything that
 * does not look like one degrades to `origin: null` rather than a guess.
 */
export function buildSupportReport(input: { observation: unknown; origin?: unknown }): SupportReport {
  const summary = describeDisplayDocument(input.observation)
  const origin = supportOriginOf(input.origin)
  const absentFacts: string[] = []
  if (summary.counts.unknown > 0) absentFacts.push(`${summary.counts.unknown} row(s) have no observed value`)
  if (summary.coverageState === 'partial') absentFacts.push('the observation is partial')
  if (summary.coverageState === 'unknown') absentFacts.push('coverage is unknown')
  if (summary.status === 'unavailable') absentFacts.push('the observation is unavailable')
  if (summary.counts.sampleCount === null) absentFacts.push('the header sample count is not established')
  const evidence: SupportEvidence = {
    coverageState: summary.coverageState,
    rowsWithValue: summary.counts.withValue,
    rowsWithoutValue: summary.counts.unknown,
    sampleCount: summary.counts.sampleCount,
    partial: summary.coverageState !== 'complete' || summary.status !== 'ready',
    absentFacts,
  }
  const exportCapability: SupportReport['exportCapability'] = origin === null || origin.capabilities === null
    ? 'unverified'
    : origin.capabilities.displayDownload ? 'present' : 'absent'
  return { ...summary, origin, evidence, exportCapability }
}

const supportOriginOf = (raw: unknown): SupportOrigin | null => {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const capabilities = record.capabilities
  const browserTrigger = record.browserTrigger
  const missing = Array.isArray(record.missing) ? record.missing.filter(name => typeof name === 'string') : []
  // A capability block is trusted only when all three flags are booleans; anything else stays
  // unverified instead of being read as "absent".
  const flags = capabilities !== null && typeof capabilities === 'object' ? capabilities as Record<string, unknown> : null
  const capabilityBlock = flags !== null && CAPABILITY_NAMES.every(name => typeof flags[name] === 'boolean')
    ? {
        pageObservation: flags.pageObservation === true,
        numericExport: flags.numericExport === true,
        displayDownload: flags.displayDownload === true,
      }
    : null
  const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null)
  const identitySource = record.identitySource === 'install-manifest' || record.identitySource === 'incomplete-manifest' ||
    record.identitySource === 'archive-only' ? record.identitySource : null
  return {
    kind: record.kind === 'package' || record.kind === 'runtime' ? record.kind : 'unknown',
    identitySource,
    buildId: text(record.buildId),
    sourceCommit: text(record.sourceCommit),
    archiveSha256: typeof record.archiveSha256 === 'string' && /^[a-f0-9]{64}$/.test(record.archiveSha256) ? record.archiveSha256 : null,
    capabilities: capabilityBlock,
    browserTrigger: browserTrigger === 'present' || browserTrigger === 'absent' || browserTrigger === 'unverifiable' ? browserTrigger : null,
    missing: missing.filter(name => (CAPABILITY_NAMES as readonly string[]).includes(name)),
  }
}

/** Markdown rendering of a support report, including the version and the missing capability. */
export function renderSupportReport(report: SupportReport): string {
  const lines = renderSupportSummary(report).split('\n')
  const version = report.origin === null
    ? ['- Build: not inspected (no package supplied)', '- Export capability: unverified']
    : [
        `- Build: ${report.origin.buildId ?? 'unknown'} · source ${report.origin.sourceCommit ?? 'unknown'}`,
        `- Package: ${report.origin.archiveSha256 ?? 'unknown digest'}`,
        `- Export capability: ${report.exportCapability}${report.origin.missing.length ? ` · missing ${report.origin.missing.join(', ')}` : ''}`,
        `- Browser trigger: ${report.origin.browserTrigger ?? 'unverified'}`,
      ]
  const marker = lines.findIndex(line => line.startsWith('##') || line.startsWith('| Row id'));
  const insertAt = marker === -1 ? lines.length : marker
  lines.splice(insertAt, 0, ...version, '')
  if (report.evidence.absentFacts.length) {
    lines.push('Missing or incomplete (not zero):')
    for (const fact of report.evidence.absentFacts) lines.push(`- ${fact}`)
    lines.push('')
  }
  return lines.join('\n')
}
