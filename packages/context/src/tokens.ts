import type { ContextSourceKind } from './types.ts'

const KIND_WEIGHT: Record<ContextSourceKind, number> = {
  work: 6,
  contract: 5,
  decision: 5,
  verification: 4,
  delivery: 3,
  artifact: 3,
  conversation_message: 3,
  project_metadata: 2,
  document: 2,
  source_file: 1,
}

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x3000 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  )
}

/**
 * Deterministic, conservative token estimate for budget enforcement. CJK characters count as one
 * token each; other characters count as a quarter token. It overestimates rather than undercounts.
 */
export function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) tokens += isCjk(char.codePointAt(0) ?? 0) ? 1 : 0.25
  return Math.ceil(tokens)
}

/** Query terms used only for deterministic ranking. No stemming or model call. */
export function queryTerms(query: string): readonly string[] {
  const terms = new Set<string>()
  for (const word of query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    if (word.length >= 2) terms.add(word)
  }
  for (const char of query) {
    if (isCjk(char.codePointAt(0) ?? 0)) terms.add(char)
  }
  return [...terms]
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1 && count < 20) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

export function relevanceScore(input: {
  readonly terms: readonly string[]
  readonly kind: ContextSourceKind
  readonly path: string
  readonly title?: string
  readonly content?: string
}): number {
  const header = `${input.path}\n${input.title ?? ''}`.toLowerCase()
  let score = KIND_WEIGHT[input.kind]
  for (const term of input.terms) {
    score += countOccurrences(header, term) * 3
    if (input.content !== undefined) score += Math.min(countOccurrences(input.content.toLowerCase(), term), 20)
  }
  return score
}
