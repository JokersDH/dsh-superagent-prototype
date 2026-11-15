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

export const EXPORT_PROTOCOL = 'usage-insights-export/1' as const
export const EXPORT_DEFAULT_MAX_ROWS = 200
export const EXPORT_DEFAULT_MAX_BYTES = 1_048_576

const count = z.number().int().min(0).max(1_000_000).safe()

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
  readonly code: 'export_too_large' | 'invalid_summary'
  constructor(code: ExportFault['code'], message: string) {
    super(message)
    this.name = 'ExportFault'
    this.code = code
  }
}

export interface ExportOptions {
  maxRows?: number
  maxBytes?: number
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

/**
 * Build the export document and its serialized text.
 *
 * Rows are added in their stable order until `maxRows` or `maxBytes` is reached; the truncation block
 * reports exactly which bound stopped it and how many rows were left out. If even the empty envelope
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
    rows: [] as ExportRow[],
    truncation: {
      byRows: false, byBytes: false, totalRows: all.length, includedRows: 0,
      maxRows, maxBytes, bytes: 0,
    },
    limitations: summary.limitations,
    authorization: 'none' as const,
  }
  // The byte budget describes the document that is actually written (pretty-printed), and the recorded
  // `bytes` is part of that document, so its length is resolved to a fixed point rather than guessed.
  const finalize = (rows: readonly ExportRow[], truncation: {
    byRows: boolean
    byBytes: boolean
    totalRows: number
    includedRows: number
    maxRows: number
    maxBytes: number
    bytes: number
  }): { text: string; size: number } => {
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
  const draft = (rows: readonly ExportRow[]) => finalize(rows, {
    byRows: false, byBytes: false, totalRows: all.length, includedRows: rows.length, maxRows, maxBytes, bytes: 0,
  }).size
  const sizeOf = (rows: readonly ExportRow[]): number => draft(rows)
  if (sizeOf([]) > maxBytes)
    throw new ExportFault('export_too_large', `The export envelope alone exceeds the ${maxBytes}-byte budget`)

  const rows: ExportRow[] = []
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
  const document: ExportDocument = ExportDocumentSchema.parse({
    ...envelope,
    rows,
    truncation: {
      byRows: truncatedRows, byBytes: truncatedBytes, totalRows: all.length, includedRows: rows.length,
      maxRows, maxBytes, bytes: final.size,
    },
  })
  return { document, text: final.text }
}

/** Deterministic identity of an export document, for pinning it like a bundle. */
export const exportDigest = (document: ExportDocument): string => canonicalDigest(document as never)
