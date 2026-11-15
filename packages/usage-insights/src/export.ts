/**
 * Bounded, sanitized export of an observation.
 *
 * The export carries the same numbers as the report and the display projection — it is not a second
 * analysis — and it is bounded in both rows and bytes. When a bound is hit the document says exactly
 * what was left out; a truncated export is never presented as complete.
 *
 * It contains no raw work evidence, no prompt, no path and no credential: only identifiers, aggregate
 * values, coverage and the input digest needed to trace the observation back to its source.
 */
import { z } from 'zod'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import {
  MetricRowSchema,
  UsageInsightsSummarySchema,
  type MetricRow,
  type UsageInsightsSummary,
} from './protocol.ts'
import { consumerScope, formatMetricValue, metricRowKey, metricUnitLabel } from './facing.ts'

export const EXPORT_PROTOCOL = 'usage-insights-export/2' as const
export const EXPORT_DEFAULT_MAX_ROWS = 200
export const EXPORT_DEFAULT_MAX_BYTES = 1_048_576

const count = z.number().int().min(0).max(1_000_000).safe()

/**
 * An export belongs to exactly one observation. The identity is the analysis summary id: the same id
 * means the same observation, and a re-read of the source produces a different id. A previous export
 * can be declared so the document says whether it continues that observation or replaces it; the
 * values are always recomputed, never copied from the earlier file.
 */
export const SNAPSHOT_PROTOCOL = 'usage-insights-snapshot/1' as const
export const SNAPSHOT_CONTINUITY = ['first_observation', 'same_snapshot', 'new_snapshot'] as const
export type SnapshotContinuity = (typeof SNAPSHOT_CONTINUITY)[number]

export const SnapshotBlockSchema = z.strictObject({
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  capturedAt: z.string().min(1).max(64),
  continuity: z.enum(SNAPSHOT_CONTINUITY),
  /** The export this document was compared with, when the caller declared one. */
  previous: z.strictObject({
    snapshotId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    capturedAt: z.string().min(1).max(64),
  }).nullable(),
  /** Present only for `new_snapshot`: the values are a fresh read, not the earlier displayed ones. */
  note: z.string().min(1).max(512).nullable(),
}).superRefine((value, ctx) => {
  if (value.continuity === 'first_observation' && value.previous !== null)
    ctx.addIssue({ code: 'custom', message: 'A first observation cannot declare a previous export' })
  if (value.continuity !== 'first_observation' && value.previous === null)
    ctx.addIssue({ code: 'custom', message: 'A continued or replaced observation must declare the previous export' })
  if ((value.continuity === 'new_snapshot') !== (value.note !== null))
    ctx.addIssue({ code: 'custom', message: 'Only a replaced observation carries a discontinuity note' })
  if (value.continuity === 'same_snapshot' && value.snapshotId === null)
    ctx.addIssue({ code: 'custom', message: 'An observation without an identity cannot continue another one' })
})
export type SnapshotBlock = z.infer<typeof SnapshotBlockSchema>

export interface PreviousSnapshot {
  readonly snapshotId: string | null
  readonly capturedAt: string
}

const NEW_SNAPSHOT_NOTE =
  'This export re-read the observation, so its snapshot differs from the previously exported one; the earlier displayed values are not reused or extended.'

export const snapshotBlock = (snapshotId: string | null, capturedAt: string, previous: PreviousSnapshot | null): SnapshotBlock => {
  if (previous === null) return { snapshotId, capturedAt, continuity: 'first_observation', previous: null, note: null }
  const same = snapshotId !== null && previous.snapshotId === snapshotId
  return {
    snapshotId,
    capturedAt,
    continuity: same ? 'same_snapshot' : 'new_snapshot',
    previous: { snapshotId: previous.snapshotId, capturedAt: previous.capturedAt },
    note: same ? null : NEW_SNAPSHOT_NOTE,
  }
}

/**
 * Read the snapshot identity out of an export document, so the CLI can declare what the next export
 * replaces. Documents written before the snapshot block existed carry the summary id instead; a
 * document without either identity yields a `null` id, which is reported as a replaced observation
 * rather than silently treated as continuous.
 */
export function previousSnapshotOf(value: unknown): PreviousSnapshot | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const snapshot = record.snapshot
  if (snapshot !== null && typeof snapshot === 'object') {
    const block = snapshot as Record<string, unknown>
    if (typeof block.capturedAt === 'string') {
      const id = block.snapshotId
      return { snapshotId: typeof id === 'string' ? id : null, capturedAt: block.capturedAt }
    }
  }
  const from = record.exportedFrom
  if (from !== null && typeof from === 'object') {
    const block = from as Record<string, unknown>
    const capturedAt = block.capturedAt
    if (typeof capturedAt === 'string') {
      const id = block.summaryId
      return { snapshotId: typeof id === 'string' ? id : null, capturedAt }
    }
  }
  return null
}

export const ExportRowSchema = z.strictObject({
  /** Stable identity: metric, layer and currency. The same row always has the same id. */
  rowId: z.string().min(1).max(200),
  metricId: z.string().min(1).max(120),
  layer: z.enum(['actual_native', 'controlled', 'protocol_fixture', 'schema', 'operator_note']).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  unit: z.string().min(1).max(16),
  value: z.number().finite().nullable(),
  formatted: z.string().min(1).max(128).nullable(),
  sampleCount: count,
  unknownCount: count,
  excludedCount: count,
  coverage: z.enum(['complete', 'partial', 'source_missing', 'not_collected', 'unsupported']),
  nullReason: z.string().min(1).max(64).nullable(),
})
export type ExportRow = z.infer<typeof ExportRowSchema>

export const ExportDocumentSchema = z.strictObject({
  protocol: z.literal(EXPORT_PROTOCOL),
  exportedFrom: z.strictObject({
    inputId: z.string().min(1).max(128),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    summaryId: z.string().regex(/^[a-f0-9]{64}$/),
    sourceKind: z.string().min(1).max(64),
    sourceDescriptor: z.string().min(1).max(256),
    capturedAt: z.string().min(1).max(64),
  }),
  snapshot: SnapshotBlockSchema,
  window: z.strictObject({ from: z.string().min(1).max(64), to: z.string().min(1).max(64) }),
  timezone: z.string().min(1).max(64),
  scope: z.strictObject({
    projectIds: z.array(z.string().min(1).max(128)).max(32).readonly(),
    aggregation: z.enum(['single_project', 'declared_multi_project', 'cross_project']),
    label: z.string().min(1).max(128),
  }),
  sourceCoverage: z.strictObject({
    outcomes: z.enum(['complete', 'partial', 'source_missing', 'not_collected', 'unsupported']),
    workEvidence: z.enum(['complete', 'partial', 'source_missing', 'not_collected', 'unsupported']),
    attention: z.enum(['complete', 'partial', 'source_missing', 'not_collected', 'unsupported']),
    overall: z.enum(['complete', 'partial', 'source_missing', 'not_collected', 'unsupported']),
  }),
  attention: z.strictObject({
    observedAt: z.string().max(64).nullable(),
    items: count,
    coverage: z.enum(['complete', 'partial', 'source_missing', 'not_collected', 'unsupported']),
    stale: z.boolean(),
  }),
  rows: z.array(ExportRowSchema).max(2_000).readonly(),
  truncation: z.strictObject({
    /** Which bound stopped the export, if any. */
    byRows: z.boolean(),
    byBytes: z.boolean(),
    totalRows: count,
    includedRows: count,
    maxRows: z.number().int().min(1),
    maxBytes: z.number().int().min(1),
    bytes: count,
  }),
  limitations: z.array(z.string().min(1).max(512)).max(32).readonly(),
  authorization: z.literal('none'),
})
export type ExportDocument = z.infer<typeof ExportDocumentSchema>

export class ExportFault extends Error {
  readonly code: 'export_too_large' | 'invalid_summary' | 'invalid_previous'
  constructor(code: ExportFault['code'], message: string) {
    super(message)
    this.name = 'ExportFault'
    this.code = code
  }
}

export interface ExportOptions {
  maxRows?: number
  maxBytes?: number
  /** The export this one is compared with; it never contributes a value, only the continuity note. */
  previous?: PreviousSnapshot | null
}

const toExportRow = (row: MetricRow): ExportRow => ({
  rowId: metricRowKey(row),
  metricId: row.metricId,
  layer: row.layer,
  currency: row.currency,
  unit: metricUnitLabel(row),
  value: row.value,
  formatted: formatMetricValue(row),
  sampleCount: row.sampleCount,
  unknownCount: row.unknownCount,
  excludedCount: row.excludedCount,
  coverage: row.coverage,
  nullReason: row.nullReason,
})

export interface TruncationBlock {
  byRows: boolean
  byBytes: boolean
  totalRows: number
  includedRows: number
  maxRows: number
  maxBytes: number
  bytes: number
}

/**
 * Serialize a document whose rows are added in their stable order until `maxRows` or `maxBytes` is
 * reached. The truncation block reports exactly which bound stopped it and how many rows were left
 * out. The recorded `bytes` is part of the document it describes, so the length is resolved to a
 * fixed point instead of being guessed, and the caller decides how an envelope that cannot fit at all
 * is refused.
 */
export function serializeBounded<Row>(
  envelope: Record<string, unknown>,
  all: readonly Row[],
  limits: { maxRows: number; maxBytes: number },
  onEnvelopeTooLarge: () => never,
): { text: string; rows: Row[]; truncation: TruncationBlock } {
  const { maxRows, maxBytes } = limits
  const finalize = (rows: readonly Row[], truncation: TruncationBlock): { text: string; size: number } => {
    let guess = truncation.bytes
    for (let attempt = 0; attempt < 4; attempt++) {
      const text = `${JSON.stringify({ ...envelope, rows, truncation: { ...truncation, bytes: guess } }, null, 2)}\n`
      const size = Buffer.byteLength(text)
      if (size === guess) return { text, size }
      guess = size
    }
    const text = `${JSON.stringify({ ...envelope, rows, truncation: { ...truncation, bytes: guess } }, null, 2)}\n`
    return { text, size: Buffer.byteLength(text) }
  }
  const sizeOf = (rows: readonly Row[]): number =>
    finalize(rows, { byRows: false, byBytes: false, totalRows: all.length, includedRows: rows.length, maxRows, maxBytes, bytes: 0 }).size
  if (sizeOf([]) > maxBytes) return onEnvelopeTooLarge()

  const rows: Row[] = []
  let truncatedRows = false
  let truncatedBytes = false
  for (const row of all) {
    if (rows.length >= maxRows) { truncatedRows = true; break }
    const candidate = [...rows, row]
    if (sizeOf(candidate) > maxBytes) { truncatedBytes = true; break }
    rows.push(row)
  }
  const final = finalize(rows, {
    byRows: truncatedRows, byBytes: truncatedBytes, totalRows: all.length, includedRows: rows.length,
    maxRows, maxBytes, bytes: 0,
  })
  return {
    text: final.text,
    rows,
    truncation: {
      byRows: truncatedRows, byBytes: truncatedBytes, totalRows: all.length, includedRows: rows.length,
      maxRows, maxBytes, bytes: final.size,
    },
  }
}

/**
 * Build the export document and its serialized text.
 *
 * The rows are the same numbers the report and the display projection show; the document records the
 * snapshot it belongs to, the bounds it obeyed and what was left out. If even the empty envelope
 * cannot fit `maxBytes`, the export refuses instead of emitting a misleading fragment.
 */
export function buildInsightExport(summary: UsageInsightsSummary, options: ExportOptions = {}): {
  document: ExportDocument
  text: string
} {
  const parsed = UsageInsightsSummarySchema.safeParse(summary)
  if (!parsed.success) throw new ExportFault('invalid_summary', 'The summary does not match the stable schema')
  const maxRows = Math.min(options.maxRows ?? EXPORT_DEFAULT_MAX_ROWS, 2_000)
  const maxBytes = options.maxBytes ?? EXPORT_DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new ExportFault('invalid_summary', 'maxRows must be a positive integer')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new ExportFault('invalid_summary', 'maxBytes must be a positive integer')

  const all = summary.metrics.map(toExportRow)
  const snapshot = snapshotBlock(summary.summaryId, summary.capturedAt, options.previous ?? null)
  const limitations = snapshot.note === null ? [...summary.limitations] : [snapshot.note, ...summary.limitations].slice(0, 32)
  const envelope = {
    protocol: EXPORT_PROTOCOL,
    exportedFrom: {
      inputId: summary.inputId,
      inputDigest: summary.inputDigest,
      summaryId: summary.summaryId,
      sourceKind: summary.sourceKind,
      sourceDescriptor: summary.sourceDescriptor,
      capturedAt: summary.capturedAt,
    },
    snapshot,
    window: summary.window,
    timezone: summary.timezone,
    scope: consumerScope(summary),
    sourceCoverage: summary.coverage,
    attention: {
      observedAt: summary.attention.observedAt,
      items: summary.attention.items,
      coverage: summary.attention.coverage,
      stale: summary.attention.stale,
    },
    limitations,
    authorization: 'none' as const,
  }
  const built = serializeBounded(envelope, all, { maxRows, maxBytes }, () => {
    throw new ExportFault('export_too_large', `The export envelope alone exceeds the ${maxBytes}-byte budget`)
  })
  const document: ExportDocument = ExportDocumentSchema.parse({
    ...envelope,
    rows: built.rows,
    truncation: built.truncation,
  })
  return { document, text: built.text }
}

/** Deterministic identity of an export document, for pinning it like a bundle. */
export const exportDigest = (document: ExportDocument): string => canonicalDigest(document as never)
