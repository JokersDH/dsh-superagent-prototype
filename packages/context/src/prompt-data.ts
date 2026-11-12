import { sha256Text } from './digest.ts'
import { estimateTokens } from './tokens.ts'
import type { ContextComposition } from './composer.ts'
import type { ContextSlice } from './types.ts'

export interface PromptDataBudget {
  readonly maxItems?: number
  readonly maxBytes?: number
  readonly maxTokens?: number
}

export interface PromptDataHardCeilings {
  readonly maxItems: number
  readonly maxBytes: number
  readonly maxTokens: number
}

export const PROMPT_DATA_CEILINGS: PromptDataHardCeilings = Object.freeze({
  maxItems: 64,
  maxBytes: 256 * 1024,
  maxTokens: 64_000,
})

export interface PromptDataSourceReference {
  readonly sourceId: string
  readonly kind: string
  readonly path: string
  /** Digest of exactly the text included for this source. */
  readonly visiblePreviewDigest: string
  readonly truncated: boolean
}

export interface PromptDataOmission {
  readonly sourceId?: string
  readonly path?: string
  readonly reason: 'budget_items' | 'budget_bytes' | 'budget_tokens'
}

export interface PromptDataProjection {
  readonly protocol: 'context-prompt-data/1'
  /** Plain reference data. It carries no role, tool, permission or command field. */
  readonly text: string
  readonly references: readonly PromptDataSourceReference[]
  readonly omitted: readonly PromptDataOmission[]
  readonly totals: { readonly items: number; readonly bytes: number; readonly tokens: number }
  readonly budget: Required<PromptDataBudget>
  readonly truncated: boolean
  readonly untrusted: true
}

const DEFAULT_BUDGET: Required<PromptDataBudget> = { maxItems: 12, maxBytes: 32 * 1024, maxTokens: 8000 }

/** One trailing newline terminates every block; bytes and tokens both reserve it up front. */
const SEPARATOR = '\n'
const SEPARATOR_BYTES = 1
const SEPARATOR_TOKENS = 1

function resolveBudget(budget: PromptDataBudget = {}): Required<PromptDataBudget> {
  const positive = (value: number | undefined, fallback: number, ceiling: number): number => {
    if (value === undefined) return Math.min(fallback, ceiling)
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
      throw new TypeError('Prompt data budget must be a positive integer')
    }
    return Math.min(value, ceiling)
  }
  return {
    maxItems: positive(budget.maxItems, DEFAULT_BUDGET.maxItems, PROMPT_DATA_CEILINGS.maxItems),
    maxBytes: positive(budget.maxBytes, DEFAULT_BUDGET.maxBytes, PROMPT_DATA_CEILINGS.maxBytes),
    maxTokens: positive(budget.maxTokens, DEFAULT_BUDGET.maxTokens, PROMPT_DATA_CEILINGS.maxTokens),
  }
}

function header(slice: ContextSlice): string {
  return `--- untrusted reference: ${slice.kind} ${slice.path} [${slice.sourceId}] truncated=${slice.truncated ? 'yes' : 'no'} ---\n`
}

function truncateForTokens(text: string, maxTokens: number): { content: string; truncated: boolean } {
  if (maxTokens <= 0) return { content: '', truncated: text.length > 0 }
  let end = 0
  let tokens = 0
  for (const char of text) {
    const cost = (char.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.25
    if (tokens + cost > maxTokens) break
    tokens += cost
    end += char.length
  }
  return { content: text.slice(0, end), truncated: end < text.length }
}

/**
 * Fits one source body into the bytes/tokens left for content. `maxBytes`/`maxTokens` are already net
 * of the header and the block separator, and both are hard caps for what this returns.
 */
function fitContent(text: string, maxBytes: number, maxTokens: number): { content: string; truncated: boolean } {
  if (maxBytes <= 0 || maxTokens <= 0) return { content: '', truncated: text.length > 0 }
  let content = text
  let truncated = false
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    content = Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '')
    truncated = true
  }
  const tokenFit = truncateForTokens(content, maxTokens)
  if (tokenFit.truncated) truncated = true
  return { content: tokenFit.content, truncated }
}

/**
 * Projects a composition into bounded plain reference data for the existing AssistantModelPort.
 *
 * - Every block is labelled untrusted reference data; there is no system role, tool call, permission
 *   or command field, and instruction-like text inside a source stays data.
 * - Item count, UTF-8 bytes and a CJK-aware token estimate are hard caps; a partial item is marked
 *   truncated and its included text digest is reported.
 * - Nothing here sends a model request, signs a grant or auto-attaches to a conversation.
 */
export function projectPromptData(
  composition: ContextComposition,
  budget: PromptDataBudget = {},
): PromptDataProjection {
  const resolved = resolveBudget(budget)
  const references: PromptDataSourceReference[] = []
  const omitted: PromptDataOmission[] = []
  const parts: string[] = []
  let bytes = 0
  let tokens = 0
  let truncated = false

  for (const slice of composition.slices) {
    if (references.length >= resolved.maxItems) {
      omitted.push({ sourceId: slice.sourceId, path: slice.path, reason: 'budget_items' })
      truncated = true
      continue
    }
    const head = header(slice)
    const headBytes = Buffer.byteLength(head, 'utf8')
    const headTokens = estimateTokens(head)
    // The separator that terminates this block belongs to the same budget as its header and body.
    const remainingBytes = resolved.maxBytes - bytes - headBytes - SEPARATOR_BYTES
    const remainingTokens = resolved.maxTokens - tokens - headTokens - SEPARATOR_TOKENS
    if (remainingBytes <= 0) {
      omitted.push({ sourceId: slice.sourceId, path: slice.path, reason: 'budget_bytes' })
      truncated = true
      continue
    }
    if (remainingTokens <= 0) {
      omitted.push({ sourceId: slice.sourceId, path: slice.path, reason: 'budget_tokens' })
      truncated = true
      continue
    }
    // Fit the body into both caps; a body that no longer fits at all is omitted, never half-added.
    const fit = fitContent(slice.content, remainingBytes, remainingTokens)
    if (fit.content.length === 0) {
      omitted.push({ sourceId: slice.sourceId, path: slice.path, reason: 'budget_tokens' })
      truncated = true
      continue
    }
    const block = `${head}${fit.content}${SEPARATOR}`
    const blockBytes = Buffer.byteLength(block, 'utf8')
    const blockTokens = estimateTokens(block)
    // Defensive: the conservative estimate of the serialized block is the reported amount.
    if (blockBytes > resolved.maxBytes - bytes) {
      omitted.push({ sourceId: slice.sourceId, path: slice.path, reason: 'budget_bytes' })
      truncated = true
      continue
    }
    if (blockTokens > resolved.maxTokens - tokens) {
      omitted.push({ sourceId: slice.sourceId, path: slice.path, reason: 'budget_tokens' })
      truncated = true
      continue
    }
    parts.push(block)
    bytes += blockBytes
    tokens += blockTokens
    const sourceTruncated = fit.truncated || slice.content !== fit.content || slice.truncated
    if (sourceTruncated) truncated = true
    references.push({
      sourceId: slice.sourceId,
      kind: slice.kind,
      path: slice.path,
      visiblePreviewDigest: sha256Text(fit.content),
      truncated: sourceTruncated,
    })
  }

  return {
    protocol: 'context-prompt-data/1',
    text: parts.join(''),
    references,
    omitted,
    totals: { items: references.length, bytes, tokens },
    budget: resolved,
    truncated: truncated || references.some((reference) => reference.truncated),
    untrusted: true,
  }
}
