import type { ContextDecisionSource, ReadIndexWorkView, WorkspaceReadIndex } from './read-index-port.ts'
import type { ComposedConversationMessage, ComposedConversationProvider } from './composer.ts'
import { sha256Text } from './digest.ts'
import { estimateTokens, queryTerms, relevanceScore } from './tokens.ts'
import type { ContextSourceKind } from './types.ts'

/**
 * Deterministic single-project relevance retrieval.
 *
 * Authorization comes first: a candidate from another project, a source family the caller was not
 * granted, a question-anchor display, a non-reusable role/provenance pair or a superseded decision is
 * excluded before any score exists. Only then are the remaining candidates ranked by the same
 * deterministic estimator the composer uses, and bounded by item/byte budgets. There is no embedding,
 * vector store, online learning or model call: the same inputs always produce the same ordered output.
 */

export interface RelevanceCandidate {
  readonly sourceId: string
  readonly kind: ContextSourceKind
  readonly path: string
  readonly title?: string
  /** Source text used only for term matching; it is never returned by the selector. */
  readonly content: string
  readonly projectId: string
  readonly workId?: string
  /** Conversation role/provenance when the candidate is a message. */
  readonly role?: string
  readonly provenance?: string
  /** Set when the record is a question/authentication answer display of any provenance. */
  readonly anchorQuestionId?: string
  /** True when an effective decision list already knows this decision was replaced. */
  readonly superseded?: boolean
}

export type RelevanceOmissionReason =
  | 'foreign_project'
  | 'denied_kind'
  | 'question_anchor'
  | 'other_work'
  | 'untrusted_role'
  | 'superseded'
  | 'no_match'
  | 'budget_items'
  | 'budget_bytes'

export interface RelevanceItem {
  readonly sourceId: string
  readonly kind: ContextSourceKind
  readonly path: string
  readonly title?: string
  readonly score: number
  readonly matchedTerms: readonly string[]
  readonly contentBytes: number
  readonly contentTokens: number
  readonly contentDigest: string
}

export interface RelevanceOmission {
  readonly sourceId: string
  readonly path: string
  readonly reason: RelevanceOmissionReason
}

export interface RelevanceBudget {
  readonly maxItems: number
  readonly maxBytes: number
}

export const RELEVANCE_CEILINGS: RelevanceBudget = Object.freeze({ maxItems: 64, maxBytes: 256 * 1024 })
export const RELEVANCE_DEFAULTS: RelevanceBudget = Object.freeze({ maxItems: 16, maxBytes: 32 * 1024 })

export interface RelevanceSelection {
  readonly protocol: 'context-relevance/1'
  readonly projectId: string
  readonly query: string
  readonly terms: readonly string[]
  readonly items: readonly RelevanceItem[]
  readonly omitted: readonly RelevanceOmission[]
  readonly totals: { readonly considered: number; readonly eligible: number; readonly selected: number; readonly bytes: number }
  readonly budget: RelevanceBudget
  /** False when the budget, not the data, ended the selection. */
  readonly complete: boolean
  readonly untrusted: true
  readonly deterministic: true
}

export interface RelevanceSelectionOptions {
  readonly projectId: string
  readonly query?: string
  readonly allowedKinds?: readonly ContextSourceKind[]
  readonly workId?: string
  readonly maxItems?: number
  readonly maxBytes?: number
}

function resolvePositive(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  if (value === undefined) return Math.min(fallback, ceiling)
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`Relevance ${name} must be a positive integer`)
  }
  return Math.min(value, ceiling)
}

function isReusableRole(role: string | undefined, provenance: string | undefined): boolean {
  if (role === undefined || provenance === undefined) return true
  return (
    (role === 'user' && provenance === 'trusted_user') ||
    (role === 'assistant' && provenance === 'reasoner_reply')
  )
}

function matchedTerms(candidate: RelevanceCandidate, terms: readonly string[]): readonly string[] {
  if (terms.length === 0) return []
  const header = `${candidate.path}\n${candidate.title ?? ''}`.toLowerCase()
  const body = candidate.content.toLowerCase()
  return terms.filter((term) => header.includes(term) || body.includes(term))
}

/**
 * Ranks already-authorized candidates. The caller still owns whatever produces candidates; this
 * function refuses foreign or out-of-family data itself rather than trusting the caller.
 */
export function selectRelevantSources(
  candidates: readonly RelevanceCandidate[],
  options: RelevanceSelectionOptions,
): RelevanceSelection {
  const budget: RelevanceBudget = {
    maxItems: resolvePositive(options.maxItems, RELEVANCE_DEFAULTS.maxItems, RELEVANCE_CEILINGS.maxItems, 'maxItems'),
    maxBytes: resolvePositive(options.maxBytes, RELEVANCE_DEFAULTS.maxBytes, RELEVANCE_CEILINGS.maxBytes, 'maxBytes'),
  }
  const terms = queryTerms(options.query ?? '')
  const allowedKinds = options.allowedKinds === undefined ? undefined : new Set(options.allowedKinds)
  const omitted: RelevanceOmission[] = []
  const eligible: { candidate: RelevanceCandidate; score: number; matched: readonly string[]; bytes: number; tokens: number }[] = []

  for (const candidate of candidates) {
    if (candidate.projectId !== options.projectId) {
      omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'foreign_project' })
      continue
    }
    if (allowedKinds !== undefined && !allowedKinds.has(candidate.kind)) {
      omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'denied_kind' })
      continue
    }
    if (candidate.anchorQuestionId !== undefined) {
      omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'question_anchor' })
      continue
    }
    if (candidate.kind === 'conversation_message') {
      if (candidate.workId !== undefined && candidate.workId !== options.workId) {
        omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'other_work' })
        continue
      }
      if (!isReusableRole(candidate.role, candidate.provenance)) {
        omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'untrusted_role' })
        continue
      }
    }
    if (candidate.superseded === true) {
      omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'superseded' })
      continue
    }
    const matched = matchedTerms(candidate, terms)
    if (terms.length > 0 && matched.length === 0) {
      omitted.push({ sourceId: candidate.sourceId, path: candidate.path, reason: 'no_match' })
      continue
    }
    // A selected work gets only a small deterministic bonus, never an authorization.
    const workBonus = options.workId !== undefined && candidate.workId === options.workId ? 2 : 0
    eligible.push({
      candidate,
      score:
        relevanceScore({
          terms,
          kind: candidate.kind,
          path: candidate.path,
          ...(candidate.title === undefined ? {} : { title: candidate.title }),
          content: candidate.content,
        }) + workBonus,
      matched,
      bytes: Buffer.byteLength(candidate.content, 'utf8'),
      tokens: estimateTokens(candidate.content),
    })
  }

  eligible.sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.sourceId.localeCompare(right.candidate.sourceId) ||
      left.candidate.path.localeCompare(right.candidate.path),
  )

  const items: RelevanceItem[] = []
  let bytes = 0
  for (const entry of eligible) {
    if (items.length >= budget.maxItems) {
      omitted.push({ sourceId: entry.candidate.sourceId, path: entry.candidate.path, reason: 'budget_items' })
      continue
    }
    if (bytes + entry.bytes > budget.maxBytes) {
      omitted.push({ sourceId: entry.candidate.sourceId, path: entry.candidate.path, reason: 'budget_bytes' })
      continue
    }
    bytes += entry.bytes
    items.push({
      sourceId: entry.candidate.sourceId,
      kind: entry.candidate.kind,
      path: entry.candidate.path,
      ...(entry.candidate.title === undefined ? {} : { title: entry.candidate.title }),
      score: entry.score,
      matchedTerms: entry.matched,
      contentBytes: entry.bytes,
      contentTokens: entry.tokens,
      contentDigest: sha256Text(entry.candidate.content),
    })
  }

  return {
    protocol: 'context-relevance/1',
    projectId: options.projectId,
    query: options.query ?? '',
    terms,
    items,
    omitted,
    totals: { considered: candidates.length, eligible: eligible.length, selected: items.length, bytes },
    budget,
    complete: !omitted.some((entry) => entry.reason.startsWith('budget_')),
    untrusted: true,
    deterministic: true,
  }
}

/** Maps the scoped conversation provider into candidates; the adapter already filtered the read. */
export async function createConversationRelevanceCandidates(
  provider: ComposedConversationProvider,
  selection: { readonly projectId: string; readonly conversationId: string },
  options: { readonly limit?: number } = {},
): Promise<readonly RelevanceCandidate[]> {
  const messages: readonly ComposedConversationMessage[] = await provider.recent({
    projectId: selection.projectId,
    conversationId: selection.conversationId,
    limit: Math.min(Math.max(options.limit ?? 200, 1), 1000),
  })
  return messages.map((message) => ({
    sourceId: message.messageId,
    kind: 'conversation_message',
    path: `conversation/${selection.conversationId}/${message.messageId}.json`,
    title: `Conversation message ${message.sequence}`,
    content: message.text,
    projectId: selection.projectId,
    role: message.role,
    provenance: message.provenance,
  }))
}

/** Maps effective decisions; a known replacement id stays out even if it still appears in a page. */
export function createDecisionRelevanceCandidates(
  decisions: readonly ContextDecisionSource[],
  options: { readonly supersededIds?: readonly string[] } = {},
): readonly RelevanceCandidate[] {
  const superseded = new Set(options.supersededIds ?? [])
  return decisions.map((decision) => ({
    sourceId: decision.decisionId,
    kind: 'decision',
    path: `decisions/${decision.decisionId}.json`,
    title: 'Explicit user decision',
    content: decision.content,
    projectId: decision.scope.projectId,
    superseded: superseded.has(decision.decisionId),
  }))
}

/**
 * Projects A's persisted project/work read index into work and current-contract candidates. Stale or
 * missing contracts produce no candidate at all, so a long work list cannot smuggle an old contract
 * into the selection through a high textual score.
 */
export function createReadIndexWorkCandidates(
  index: WorkspaceReadIndex,
  projectId: string,
  options: { readonly limit?: number } = {},
): readonly RelevanceCandidate[] {
  const limit = Math.min(Math.max(options.limit ?? 64, 1), 512)
  const listed = index.listWorks({ projectIds: [projectId], limit })
  const candidates: RelevanceCandidate[] = []
  for (const work of listed.works) {
    const entry: ReadIndexWorkView | undefined = index.work(work.id, [projectId])
    if (!entry || entry.project.id !== projectId) continue
    candidates.push({
      sourceId: `work-${work.id}`,
      kind: 'work',
      path: `work/${work.id}.json`,
      title: work.title,
      content: JSON.stringify({
        workId: work.id,
        title: work.title,
        createdAt: work.createdAt,
        authorityState: entry.authorityState,
        contractState: entry.contractState,
        verificationIds: entry.verificationIds,
        acceptanceIds: entry.acceptanceIds,
        accepted: entry.deliverables.filter((item) => item.accepted).length,
        deliverables: entry.deliverables.length,
      }),
      projectId,
      workId: work.id,
    })
    if (entry.contract && entry.contractState === 'current' && entry.authorityState === 'current') {
      candidates.push({
        sourceId: `contract-${work.id}`,
        kind: 'contract',
        path: `work/${work.id}/contract.json`,
        title: `${work.title} contract`,
        content: JSON.stringify({
          goal: entry.contract.goal,
          scope: entry.contract.scope,
          criteria: entry.contract.criteria,
          revision: entry.contract.revision,
        }),
        projectId,
        workId: work.id,
      })
    }
  }
  return candidates
}
