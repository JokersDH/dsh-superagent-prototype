/**
 * Display-only export of the document the coordinator actually serves.
 *
 * `GET /v1/insights` returns `usage-observation/1`, whose values are already formatted strings. A
 * consumer that only has that document cannot know the underlying number: `12.3` may be 12.25 or
 * 12.349, and parsing it back would fabricate numeric provenance. This export therefore has **no
 * numeric field at all** — it copies the served strings verbatim, keeps the served row identity,
 * layer, unit and sample count, and states that numeric values are unavailable.
 *
 * The numeric export (`usage-insights-export/2`) is the artifact for a caller that holds the analysis
 * summary. The two are distinguishable on purpose: a display export can never be mistaken for a
 * numeric one, and no document claims the other's authority.
 */
import { z } from 'zod'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { UsageObservationSchema, type UsageObservation } from '@personal-agent/contracts'
import {
  EXPORT_DEFAULT_MAX_BYTES,
  EXPORT_DEFAULT_MAX_ROWS,
  SnapshotBlockSchema,
  serializeBounded,
  snapshotBlock,
  type PreviousSnapshot,
  type SnapshotBlock,
  type TruncationBlock,
} from './export.ts'

export const DISPLAY_EXPORT_PROTOCOL = 'usage-insights-display-export/1' as const

const count = z.number().int().min(0).max(1_000_000).safe()

export const DisplayExportRowSchema = z.strictObject({
  /** The served metric id verbatim. It is the row identity the page itself uses. */
  rowId: z.string().min(1).max(160),
  label: z.string().min(1).max(128),
  layer: z.enum(['observed', 'controlled', 'native', 'operator', 'unknown']),
  unit: z.string().max(16),
  /** The served string. There is no numeric sibling, so nothing can be reverse-parsed into one. */
  formatted: z.string().min(1).max(128).nullable(),
  sampleCount: count.nullable(),
  detail: z.string().min(1).max(512),
})
export type DisplayExportRow = z.infer<typeof DisplayExportRowSchema>

export const DisplayExportDocumentSchema = z.strictObject({
  protocol: z.literal(DISPLAY_EXPORT_PROTOCOL),
  exportedFrom: z.strictObject({
    observationProtocol: z.literal('usage-observation/1'),
    observedAt: z.string().min(1).max(64),
    days: z.union([z.literal(7), z.literal(30)]),
    timezone: z.string().min(1).max(64),
    /** Where the served document came from. It is a description, never a permission. */
    reader: z.string().min(1).max(256),
  }),
  snapshot: SnapshotBlockSchema,
  window: z.strictObject({ from: z.string().min(1).max(64), to: z.string().min(1).max(64) }),
  scope: z.strictObject({
    projectIds: z.array(z.string().min(1).max(128)).max(32).readonly(),
    aggregation: z.enum(['single_project', 'declared_multi_project', 'cross_project']),
    label: z.string().min(1).max(128),
  }),
  header: z.strictObject({
    status: z.enum(['ready', 'insufficient_data', 'unavailable']),
    windowLabel: z.string().min(1).max(200),
    coverage: z.string().min(1).max(256),
    coverageState: z.enum(['complete', 'partial', 'unknown']),
    sampleCount: count.nullable(),
    unknownCount: count.nullable(),
  }),
  rows: z.array(DisplayExportRowSchema).max(2_000).readonly(),
  truncation: z.strictObject({
    byRows: z.boolean(),
    byBytes: z.boolean(),
    totalRows: count,
    includedRows: count,
    maxRows: z.number().int().min(1),
    maxBytes: z.number().int().min(1),
    bytes: count,
  }),
  sourceIdentity: z.strictObject({
    kind: z.literal('display_dto'),
    numericValues: z.literal(false),
    note: z.string().min(1).max(512),
  }),
  crossCheck: z.strictObject({
    numericValuesAvailable: z.literal(false),
    reason: z.string().min(1).max(512),
  }),
  limitations: z.array(z.string().min(1).max(512)).max(32).readonly(),
  authorization: z.literal('none'),
})
export type DisplayExportDocument = z.infer<typeof DisplayExportDocumentSchema>

export class DisplayExportFault extends Error {
  readonly code: 'display_export_too_large' | 'invalid_display_dto'
  constructor(code: DisplayExportFault['code'], message: string) {
    super(message)
    this.name = 'DisplayExportFault'
    this.code = code
  }
}

export interface DisplayExportOptions {
  maxRows?: number
  maxBytes?: number
  /** The export this one is compared with; it contributes no value, only the continuity note. */
  previous?: PreviousSnapshot | null
}

const DISPLAY_NOTE =
  'The served document carries formatted strings only. This export preserves them verbatim and deliberately has no numeric field, so no number is reverse-parsed or presented as an analysis result.'

const toDisplayRow = (metric: UsageObservation['metrics'][number]): DisplayExportRow => ({
  rowId: metric.id,
  label: metric.label,
  layer: metric.layer,
  unit: metric.unit,
  formatted: metric.value,
  sampleCount: metric.sampleCount,
  detail: metric.detail,
})

/**
 * Build the display-only export from the document the coordinator serves.
 *
 * The input is validated against `usage-observation/1`; an invalid document is refused instead of
 * being coerced. An unavailable observation (no rows, no summary id) exports a document with an empty
 * row list and a `null` snapshot identity, never a fabricated empty observation.
 */
export function buildDisplayExport(raw: unknown, options: DisplayExportOptions = {}): {
  document: DisplayExportDocument
  text: string
} {
  const parsed = UsageObservationSchema.safeParse(raw)
  if (!parsed.success) throw new DisplayExportFault('invalid_display_dto', 'The document is not a usage-observation/1 payload')
  const dto = parsed.data
  const maxRows = Math.min(options.maxRows ?? EXPORT_DEFAULT_MAX_ROWS, 2_000)
  const maxBytes = options.maxBytes ?? EXPORT_DEFAULT_MAX_BYTES
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new DisplayExportFault('invalid_display_dto', 'maxRows must be a positive integer')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new DisplayExportFault('invalid_display_dto', 'maxBytes must be a positive integer')

  const snapshot = snapshotBlock(dto.summaryId, dto.observedAt, options.previous ?? null)
  const limitations = [
    ...(snapshot.note === null ? [] : [snapshot.note]),
    DISPLAY_NOTE,
    'The served document does not include the current attention snapshot; pending item counts are unavailable here.',
    ...dto.limitations,
  ].slice(0, 32)
  const envelope = {
    protocol: DISPLAY_EXPORT_PROTOCOL,
    exportedFrom: {
      observationProtocol: 'usage-observation/1' as const,
      observedAt: dto.observedAt,
      days: dto.days,
      timezone: dto.timezone,
      reader: 'the coordinator document served by GET /v1/insights',
    },
    snapshot,
    window: dto.window,
    scope: {
      projectIds: dto.scope.projectIds,
      aggregation: dto.scope.aggregation,
      label: dto.scope.label,
    },
    header: {
      status: dto.status,
      windowLabel: dto.windowLabel,
      coverage: dto.coverage,
      coverageState: dto.coverageState,
      sampleCount: dto.sampleCount,
      unknownCount: dto.unknownCount,
    },
    sourceIdentity: {
      kind: 'display_dto' as const,
      numericValues: false as const,
      note: DISPLAY_NOTE,
    },
    crossCheck: {
      numericValuesAvailable: false as const,
      reason: 'Only the served strings are available; a numeric cross-check needs the authorization-scoped analysis summary.',
    },
    limitations,
    authorization: 'none' as const,
  }
  const built = serializeBounded(envelope, dto.metrics.map(toDisplayRow), { maxRows, maxBytes }, () => {
    throw new DisplayExportFault('display_export_too_large', `The export envelope alone exceeds the ${maxBytes}-byte budget`)
  })
  const document: DisplayExportDocument = DisplayExportDocumentSchema.parse({
    ...envelope,
    rows: built.rows,
    truncation: built.truncation,
  })
  return { document, text: built.text }
}

/** Deterministic identity of a display export, for pinning it like a bundle. */
export const displayExportDigest = (document: DisplayExportDocument): string => canonicalDigest(document as never)

export type { SnapshotBlock, TruncationBlock }
