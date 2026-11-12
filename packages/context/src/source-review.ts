import { sha256Text } from './digest.ts'
import type { ContextComposition, ComposedSourceManifestSelection } from './composer.ts'
import type { ContextOmission, ContextOmissionReason, ContextSlice, ContextSourceKind } from './types.ts'

/**
 * Human-readable source review projection.
 *
 * Main needs to show a reviewer where a frozen context bundle actually came from: a recognizable
 * title, the source category, a stable citation and a short excerpt. Every field here is derived from
 * the validated composition (trusted port descriptors and actual slice records); nothing is taken
 * from model text, and no host path, actor, tool, permission or command field is produced. The
 * content itself stays untrusted data.
 */

export type SourceReviewCategory = 'decision' | 'conversation' | 'project_fact' | 'contract' | 'artifact' | 'file'

export interface SourceReviewItem {
  readonly sourceId: string
  readonly kind: ContextSourceKind
  readonly category: SourceReviewCategory
  /** Trusted descriptor title when present, else a sanitized basename of the project-relative path. */
  readonly title: string
  /** Stable, model-independent citation such as `decision:decisions/one.json@aaaaaaa`. */
  readonly citation: string
  /** Bounded visible excerpt of exactly what the bundle carries for this source. */
  readonly excerpt: string
  readonly status: 'visible' | 'truncated' | 'excerpt_budget'
  /** True when the source itself, or this excerpt, is only part of the source. */
  readonly truncated: boolean
  readonly excerptBytes: number
  /** Digest of the whole visible slice content (identical to the manifest preview digest). */
  readonly visiblePreviewDigest: string
  /** Digest of exactly the excerpt shown to the reviewer. */
  readonly excerptDigest: string
  readonly wholeSourceDigest: string
  readonly digestScope: ContextSlice['baseline']['digestScope']
  readonly baselineCommit?: string
  readonly trust: 'untrusted_data'
}

export interface SourceReviewOmission {
  readonly sourceId?: string
  readonly path?: string
  readonly reason: ContextOmissionReason
  readonly detail?: string
}

export interface SourceReviewBudget {
  readonly maxItems: number
  readonly maxBytes: number
  readonly maxExcerptBytes: number
}

export interface SourceReviewCeilings {
  readonly maxItems: number
  readonly maxBytes: number
  readonly maxExcerptBytes: number
}

export const SOURCE_REVIEW_CEILINGS: SourceReviewCeilings = Object.freeze({
  maxItems: 64,
  maxBytes: 64 * 1024,
  maxExcerptBytes: 4 * 1024,
})

export const SOURCE_REVIEW_DEFAULTS: SourceReviewBudget = Object.freeze({
  maxItems: 32,
  maxBytes: 16 * 1024,
  maxExcerptBytes: 1024,
})

/** Bounded counters for sources the review budget stopped; no per-item entry is emitted for them. */
export interface SourceReviewSuppressed {
  readonly items: number
  readonly bytes: number
}

export interface SourceReviewProjection {
  readonly protocol: 'context-source-review/1'
  readonly selection: ComposedSourceManifestSelection
  /** Never longer than `budget.maxItems`. */
  readonly items: readonly SourceReviewItem[]
  readonly omitted: readonly SourceReviewOmission[]
  readonly suppressed: SourceReviewSuppressed
  readonly totals: {
    readonly items: number
    readonly visibleBytes: number
    readonly omitted: number
    readonly suppressed: number
  }
  readonly budget: SourceReviewBudget
  readonly truncated: boolean
  /** Always true: excerpts are data for a reviewer, never instructions or authority. */
  readonly untrusted: true
  readonly notes: readonly string[]
}

const CATEGORY: Record<ContextSourceKind, SourceReviewCategory> = {
  decision: 'decision',
  conversation_message: 'conversation',
  project_metadata: 'project_fact',
  verification: 'project_fact',
  delivery: 'project_fact',
  contract: 'contract',
  work: 'contract',
  artifact: 'artifact',
  document: 'file',
  source_file: 'file',
}

function resolvePositive(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  if (value === undefined) return Math.min(fallback, ceiling)
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`Source review ${name} must be a positive integer`)
  }
  return Math.min(value, ceiling)
}

function sanitizeLabel(value: string, maxLength = 120): string {
  // Strip control characters, collapse whitespace and bound the length; keep the label readable.
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Project-relative only; anything absolute, parent-escaping or backslash-separated is not citable. */
function safePath(path: string): string | undefined {
  if (path.length === 0 || path.length > 1024) return undefined
  if (path.startsWith('/') || path.startsWith('\\')) return undefined
  if (/^[A-Za-z]:[\\/]/.test(path)) return undefined
  if (path.includes('\\')) return undefined
  if (path.includes('\u0000')) return undefined
  if (path.split('/').some((segment) => segment === '..')) return undefined
  return path
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function takeUtf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '')
}

function citationOf(kind: ContextSourceKind, path: string | undefined, sourceId: string, commit: string | undefined): string {
  const reference = path ?? `redacted/${sourceId}`
  const short = commit === undefined ? '' : `@${commit.slice(0, 8)}`
  return `${kind}:${reference}${short}`
}

function omissionOf(item: ContextOmission): SourceReviewOmission {
  // The same path rule as review items: an absolute/host/parent-escaping path is never echoed back.
  const path = item.path === undefined ? undefined : safePath(item.path)
  return {
    ...(item.sourceId === undefined ? {} : { sourceId: item.sourceId }),
    ...(path === undefined ? {} : { path }),
    reason: item.reason,
    ...(item.detail === undefined ? {} : { detail: sanitizeLabel(item.detail, 200) }),
  }
}

/**
 * Projects a frozen composition into bounded review data. This function is pure: it does not sign a
 * grant, persist a confirmation, re-read a source or claim that any excerpt is current.
 */
export function projectSourceReview(
  composition: ContextComposition,
  budget: { readonly maxItems?: number; readonly maxBytes?: number; readonly maxExcerptBytes?: number } = {},
): SourceReviewProjection {
  const resolved: SourceReviewBudget = {
    maxItems: resolvePositive(budget.maxItems, SOURCE_REVIEW_DEFAULTS.maxItems, SOURCE_REVIEW_CEILINGS.maxItems, 'maxItems'),
    maxBytes: resolvePositive(budget.maxBytes, SOURCE_REVIEW_DEFAULTS.maxBytes, SOURCE_REVIEW_CEILINGS.maxBytes, 'maxBytes'),
    maxExcerptBytes: resolvePositive(
      budget.maxExcerptBytes,
      SOURCE_REVIEW_DEFAULTS.maxExcerptBytes,
      SOURCE_REVIEW_CEILINGS.maxExcerptBytes,
      'maxExcerptBytes',
    ),
  }
  const items: SourceReviewItem[] = []
  const notes: string[] = []
  const suppressed = { items: 0, bytes: 0 }
  let visibleBytes = 0
  let truncated = false
  let redactedPaths = 0
  let redactedOmissions = 0

  for (const slice of composition.slices) {
    const category = CATEGORY[slice.kind]
    const path = safePath(slice.path)
    if (path === undefined) redactedPaths += 1
    const label = sanitizeLabel(slice.title ?? '')
    const title = label.length > 0 ? label : sanitizeLabel(path === undefined ? '(redacted source)' : basename(path))
    const citation = citationOf(slice.kind, path, slice.sourceId, slice.baseline.commit)

    if (items.length >= resolved.maxItems) {
      // Past the item cap only a bounded count remains; no title/citation/excerpt is emitted.
      suppressed.items += 1
      truncated = true
      continue
    }

    const allowance = Math.min(resolved.maxExcerptBytes, resolved.maxBytes - visibleBytes)
    if (allowance <= 0 && slice.content.length > 0) {
      suppressed.bytes += 1
      truncated = true
      continue
    }
    const excerpt = takeUtf8Prefix(slice.content, allowance)
    const excerptBytes = Buffer.byteLength(excerpt, 'utf8')
    visibleBytes += excerptBytes
    const excerptCut = excerpt !== slice.content
    const sourceTruncated = slice.truncated || excerptCut
    if (sourceTruncated) truncated = true
    items.push({
      sourceId: slice.sourceId,
      kind: slice.kind,
      category,
      title,
      citation,
      excerpt,
      status: excerptCut ? 'excerpt_budget' : slice.truncated ? 'truncated' : 'visible',
      truncated: sourceTruncated,
      excerptBytes,
      visiblePreviewDigest: sha256Text(slice.content),
      excerptDigest: sha256Text(excerpt),
      wholeSourceDigest: slice.baseline.contentDigest,
      digestScope: slice.baseline.digestScope,
      ...(slice.baseline.commit === undefined ? {} : { baselineCommit: slice.baseline.commit }),
      trust: 'untrusted_data',
    })
  }

  const omitted = composition.omitted.map((item) => {
    if (item.path !== undefined && safePath(item.path) === undefined) redactedOmissions += 1
    return omissionOf(item)
  })
  if (redactedPaths > 0) notes.push(`${redactedPaths} source path(s) were not project-relative and are cited by source id only.`)
  if (redactedOmissions > 0) notes.push(`${redactedOmissions} omitted path(s) were not project-relative and are reported by reason/source id only.`)
  if (suppressed.items > 0) notes.push(`${suppressed.items} source(s) exceeded the review item budget and are counted, not listed.`)
  if (suppressed.bytes > 0) notes.push(`${suppressed.bytes} source(s) had no remaining review byte budget and are counted, not listed.`)
  if (composition.omitted.some((item) => item.reason === 'missing' || item.reason === 'stale' || item.reason === 'contract_stale')) {
    notes.push('Some selected sources are missing or stale; their recorded reason is listed under omitted.')
  }
  notes.push('Excerpts are untrusted data from a frozen bundle; they carry no actor, tool, permission or command authority.')

  return {
    protocol: 'context-source-review/1',
    selection: {
      projectId: composition.projectId,
      ...(composition.conversationId === undefined ? {} : { conversationId: composition.conversationId }),
      ...(composition.workId === undefined ? {} : { workId: composition.workId }),
      ...(composition.contract === undefined ? {} : { contract: composition.contract }),
    },
    items,
    omitted,
    suppressed,
    totals: {
      items: items.length,
      visibleBytes,
      omitted: omitted.length,
      suppressed: suppressed.items + suppressed.bytes,
    },
    budget: resolved,
    truncated,
    untrusted: true,
    notes,
  }
}
