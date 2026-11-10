import type { ContextBundle, ContextValidation } from './types.ts'

export interface ContextPreviewFile {
  readonly path: string
  readonly kind: string
  readonly bytes: number
  readonly tokens: number
  readonly truncated: boolean
  readonly relevance: number
}

/** Compact, UI-consumable summary of a bundle before a conversation upload is confirmed. */
export interface ContextPreview {
  readonly projectId: string
  readonly purpose: string
  readonly grantId: string
  readonly status: ContextBundle['status']
  readonly validity: ContextValidation['validity'] | 'unknown'
  readonly baseline: ContextBundle['baseline']
  readonly sourceKinds: readonly string[]
  readonly allowedPaths: readonly string[]
  readonly selectedFiles: readonly string[]
  readonly files: readonly ContextPreviewFile[]
  readonly totals: { readonly files: number; readonly bytes: number; readonly tokens: number }
  readonly omitted: readonly { readonly path?: string; readonly reason: string; readonly detail?: string }[]
  readonly injectionFlags: readonly { readonly path: string; readonly patterns: readonly string[] }[]
  readonly nextCursor?: string
}

/**
 * Builds the bounded preview main shows before confirming a conversation upload. It never reads
 * more content, never widens budgets and never turns file content into authority.
 */
export function buildContextPreview(
  bundle: ContextBundle,
  validation?: ContextValidation,
): ContextPreview {
  const files = bundle.slices.map((slice) => ({
    path: slice.path,
    kind: slice.kind,
    bytes: slice.bytes,
    tokens: slice.tokens,
    truncated: slice.truncated,
    relevance: slice.relevance,
  }))
  return {
    projectId: bundle.projectId,
    purpose: bundle.purpose,
    grantId: bundle.grantId,
    status: bundle.status,
    validity: validation?.validity ?? 'unknown',
    baseline: bundle.baseline,
    sourceKinds: bundle.authorization.sourceKinds,
    allowedPaths: bundle.authorization.allowedPaths,
    selectedFiles: bundle.slices
      .filter((slice) => slice.kind === 'document' || slice.kind === 'source_file')
      .map((slice) => slice.path),
    files,
    totals: { files: files.length, bytes: bundle.used.bytes, tokens: bundle.used.tokens },
    omitted: bundle.omitted.map((item) => ({
      ...(item.path === undefined ? {} : { path: item.path }),
      reason: item.reason,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    })),
    injectionFlags: bundle.injectionFlags.map((flag) => ({ path: flag.path, patterns: flag.patterns })),
    ...(bundle.nextCursor === undefined ? {} : { nextCursor: bundle.nextCursor }),
  }
}
