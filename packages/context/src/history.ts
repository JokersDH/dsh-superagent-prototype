import type {
  AssistantContextBinding,
  AssistantContextHistory,
  AssistantContextHistoryPage,
  AssistantContextHistoryQuery,
  AssistantReplyResult,
  AssistantReplyResults,
  ContractRef,
  Scope,
} from '@personal-agent/contracts'
import { AssistantContextHistoryQuerySchema } from '@personal-agent/contracts'

/**
 * Read-only projection of A's persisted context history and completed reply results.
 *
 * History is data for the reviewer, never a grant: nothing here re-sends a request, re-signs a
 * confirmation, reuses a historical expiry or claims that a historical source is still current.
 * Current product rules still require the user's explicit new authorization for any new send.
 */

export interface HistoryEntrySource {
  readonly sourceId: string
  readonly kind: string
  readonly sourceDigest: string
  readonly previewDigest: string
  readonly truncated: boolean
}

export type HistoryEntryState =
  | 'expired'
  | 'current_window'
  | 'contract_changed'
  | 'scope_changed'
  | 'other_work'
  | 'other_conversation'

export interface HistoryCompletedReply {
  readonly replyMessageId: string
  readonly requestDigest: string
  readonly artifactRef: string
  readonly artifactDigest: string
  readonly textDigest: string
  readonly model: string
  readonly recordedAt: string
}

export interface HistoryEntry {
  readonly messageId: string
  readonly requestId: string
  readonly commandId: string
  readonly projectId: string
  readonly conversationId: string
  readonly confirmedAt: string
  readonly expiresAt: string
  /** Derived from the recorded expiry only; it is a data status, not an authorization. */
  readonly state: HistoryEntryState
  readonly selections: readonly string[]
  readonly contract?: ContractRef
  readonly sources: readonly HistoryEntrySource[]
  readonly bundleDigest: string
  readonly sourceCount: number
  readonly truncatedSources: number
  /** The completed reply attached to the original request, if A recorded one. */
  readonly completedReply?: HistoryCompletedReply
  /** True when only the before-send receipt exists; a request record is not a completed reply. */
  readonly replyUnknown: boolean
  /** Always true: viewing history never authorizes a new send. */
  readonly requiresExplicitReauthorization: true
  readonly trust: 'untrusted_data'
}

export interface HistoryOmission {
  readonly messageId?: string
  readonly projectId?: string
  readonly conversationId?: string
  readonly reason: 'foreign_project' | 'other_conversation' | 'other_work' | 'inconsistent_binding' | 'duplicate'
}

export interface HistoryView {
  readonly protocol: 'assistant-context-history-view/1'
  readonly query: AssistantContextHistoryQuery
  readonly entries: readonly HistoryEntry[]
  readonly omitted: readonly HistoryOmission[]
  readonly pages: number
  readonly hasMore: boolean
  readonly nextCursor?: string
  /** False when the page budget or a non-advancing cursor stopped the walk. */
  readonly complete: boolean
  readonly totals: {
    readonly pages: number
    readonly entries: number
    readonly completedReplies: number
    readonly unknownReplies: number
    /** Completed results that named another source/project/conversation and were not attached. */
    readonly mismatchedReplies: number
  }
  readonly authorization: 'none'
  readonly untrusted: true
  readonly notes: readonly string[]
}

export interface HistoryViewOptions {
  readonly now: () => Date
  readonly maxPages?: number
  /** Current selection used only to describe drift; it never re-reads or re-authorizes anything. */
  readonly workId?: string
  readonly contract?: ContractRef
  readonly scope?: Scope
  readonly replyResults?: Pick<AssistantReplyResults, 'forRequest'>
  /**
   * Main's own reply lookup for a source message (for example through its assistant request key).
   * C never guesses main's key format; when omitted only `replyResults.forRequest(binding.requestId)`
   * is tried, which is exact but often a different identity from the inference request.
   */
  readonly replyFor?: (messageId: string) => AssistantReplyResult | undefined
}

function toEntry(
  binding: AssistantContextBinding,
  options: HistoryViewOptions,
  requestReply: ((requestId: string) => AssistantReplyResult | undefined) | undefined,
): { entry: HistoryEntry; mismatchedReply: boolean } {
  const now = options.now().getTime()
  const expires = Date.parse(binding.expiresAt)
  let state: HistoryEntryState = expires <= now ? 'expired' : 'current_window'
  if (options.workId !== undefined && binding.contract?.workId !== options.workId) state = 'other_work'
  else if (options.contract !== undefined) {
    const current = options.contract
    const historical = binding.contract
    if (
      historical === undefined ||
      historical.workId !== current.workId ||
      historical.revision !== current.revision ||
      historical.digest !== current.digest
    ) {
      state = 'contract_changed'
    }
  }
  if (options.scope !== undefined && JSON.stringify(binding.scope) !== JSON.stringify(options.scope)) {
    state = 'scope_changed'
  }

  const reply = options.replyFor?.(binding.messageId) ?? requestReply?.(binding.requestId)
  // A completed result only attaches when it names exactly this source/project/conversation.
  const matches =
    reply !== undefined &&
    reply.sourceMessageId === binding.messageId &&
    reply.projectId === binding.projectId &&
    reply.conversationId === binding.conversationId
  const mismatchedReply = reply !== undefined && !matches
  const completedReply: HistoryCompletedReply | undefined =
    reply === undefined || !matches
      ? undefined
      : {
          replyMessageId: reply.replyMessageId,
          requestDigest: reply.requestDigest,
          artifactRef: reply.artifactRef,
          artifactDigest: reply.artifactDigest,
          textDigest: reply.textDigest,
          model: reply.model,
          recordedAt: reply.recordedAt,
        }

  const entry: HistoryEntry = {
    messageId: binding.messageId,
    requestId: binding.requestId,
    commandId: binding.commandId,
    projectId: binding.projectId,
    conversationId: binding.conversationId,
    confirmedAt: binding.confirmedAt,
    expiresAt: binding.expiresAt,
    state,
    selections: binding.selections,
    ...(binding.contract === undefined ? {} : { contract: binding.contract }),
    sources: binding.sources.map((source) => ({
      sourceId: source.sourceId,
      kind: source.kind,
      sourceDigest: source.sourceDigest,
      previewDigest: source.previewDigest,
      truncated: source.truncated,
    })),
    bundleDigest: binding.bundleDigest,
    sourceCount: binding.sources.length,
    truncatedSources: binding.sources.filter((source) => source.truncated).length,
    ...(completedReply === undefined ? {} : { completedReply }),
    replyUnknown: completedReply === undefined,
    requiresExplicitReauthorization: true,
    trust: 'untrusted_data',
  }
  return { entry, mismatchedReply }
}

/**
 * Walks A's keyset history port within a page budget and projects each binding against the current
 * selection. The cursor is opaque data: it is passed back unchanged, never interpreted here.
 */
export function collectContextHistory(
  history: Pick<AssistantContextHistory, 'page'>,
  queryInput: unknown,
  options: HistoryViewOptions,
): HistoryView {
  const query = AssistantContextHistoryQuerySchema.parse(queryInput)
  const maxPages = Math.min(Math.max(options.maxPages ?? 4, 1), 20)
  const entries: HistoryEntry[] = []
  const omitted: HistoryOmission[] = []
  const seen = new Set<string>()
  let mismatchedReplies = 0
  let pages = 0
  let hasMore = false
  let nextCursor: string | undefined
  let complete = false
  let previousCursor: string | undefined

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page: AssistantContextHistoryPage = history.page({ ...query, ...(nextCursor === undefined ? {} : { cursor: nextCursor }) })
    pages += 1
    for (const binding of page.records) {
      if (!query.projectIds.includes(binding.projectId)) {
        omitted.push({ messageId: binding.messageId, projectId: binding.projectId, conversationId: binding.conversationId, reason: 'foreign_project' })
        continue
      }
      if (query.conversationId !== undefined && binding.conversationId !== query.conversationId) {
        omitted.push({
          messageId: binding.messageId,
          projectId: binding.projectId,
          conversationId: binding.conversationId,
          reason: 'other_conversation',
        })
        continue
      }
      if (query.workId !== undefined && binding.contract?.workId !== query.workId) {
        // The page must agree with its own work filter; a row whose body names another work (or no
        // work at all) is not silently counted as this work's history.
        omitted.push({
          messageId: binding.messageId,
          projectId: binding.projectId,
          conversationId: binding.conversationId,
          reason: 'other_work',
        })
        continue
      }
      if (binding.scope.projectId !== binding.projectId) {
        omitted.push({
          messageId: binding.messageId,
          projectId: binding.projectId,
          conversationId: binding.conversationId,
          reason: 'inconsistent_binding',
        })
        continue
      }
      if (seen.has(binding.messageId)) {
        omitted.push({ messageId: binding.messageId, projectId: binding.projectId, conversationId: binding.conversationId, reason: 'duplicate' })
        continue
      }
      seen.add(binding.messageId)
      const projected = toEntry(binding, options, options.replyResults?.forRequest.bind(options.replyResults))
      if (projected.mismatchedReply) mismatchedReplies += 1
      entries.push(projected.entry)
    }
    hasMore = page.hasMore
    nextCursor = page.nextCursor
    if (!hasMore) {
      complete = true
      break
    }
    if (nextCursor === undefined || nextCursor === previousCursor) {
      // A cursor that never advances would infinite-loop or duplicate pages; stop and say so.
      complete = false
      break
    }
    previousCursor = nextCursor
  }

  const completedReplies = entries.filter((entry) => entry.completedReply !== undefined).length
  const notes = [
    'History bindings and completed replies are recorded data, not a grant, session or replay permission.',
    'A binding past its expiry remains viewable as history; any new send needs the current user confirmation.',
    'Source digests show what was frozen at that time; current source equality is unverified until re-read.',
    'A completed reply attaches only when its source/project/conversation match; a mismatched result is counted, never shown.',
  ]
  return {
    protocol: 'assistant-context-history-view/1',
    query,
    entries,
    omitted,
    pages,
    hasMore,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    complete,
    totals: {
      pages,
      entries: entries.length,
      completedReplies,
      unknownReplies: entries.length - completedReplies,
      mismatchedReplies,
    },
    authorization: 'none',
    untrusted: true,
    notes,
  }
}
