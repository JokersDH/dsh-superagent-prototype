import type { ComposedArtifactProvider, ComposedArtifactView, ComposedConversationMessage, ComposedConversationProvider } from './composer.ts'
import type { ContextError } from './errors.ts'

/**
 * Scoped, bounded adapters over already-authorized main-side readers.
 *
 * These close the two recipe hazards from wave-09: a conversation adapter that silently mixed other
 * projects / permission displays into the composition, and an artifact adapter that enumerated a
 * global registry instead of only the artifacts published for the selected work.
 */

export interface ScopedConversationMessageView {
  readonly id: string
  readonly conversationId: string
  readonly projectId?: string | undefined
  readonly sequence: number
  readonly role: 'user' | 'assistant' | 'system'
  readonly provenance: string
  readonly text: string
  readonly createdAt: string
  readonly anchor?: { readonly workId?: string | undefined; readonly questionId?: string | undefined; readonly messageId?: string | undefined } | undefined
}

export interface ScopedConversationPage {
  readonly messages: readonly ScopedConversationMessageView[]
  readonly hasMore: boolean
}

/** The existing persisted message page reader, structurally (see A's ProductMessages.page). */
export interface ScopedConversationReader {
  page(conversationId: string, options: { before?: number; limit?: number }): ScopedConversationPage
}

export interface ConversationSelection {
  readonly projectId: string
  readonly conversationId: string
  /** Optional selected work; when present, messages anchored to another work are excluded. */
  readonly workId?: string
}

export interface ConversationAdapterCoverage {
  readonly scanned: number
  readonly returned: number
  /** False when the bounded page walk stopped before exhausting the conversation. */
  readonly complete: boolean
  readonly excluded: {
    readonly otherConversation: number
    readonly foreignProject: number
    readonly unprovenProject: number
    /** Question/authentication answer anchors are never reusable discussion context. */
    readonly questionAnchor: number
    /** Work-anchored supplements, including every one when no work is selected. */
    readonly otherWork: number
    readonly permissionDisplay: number
    readonly systemRole: number
    readonly untrustedProvenance: number
  }
}

export interface ScopedConversationProvider extends ComposedConversationProvider {
  /** Coverage of the most recent `recent()` call. */
  coverage(): ConversationAdapterCoverage
}

const PERMISSION_DISPLAY_PROVENANCE = 'question_answer_display'
const TRUSTED_USER = 'trusted_user'
const REASONER_REPLY = 'reasoner_reply'

/**
 * The exact reusable-discussion role/provenance pairs of the current main provider: a trusted user
 * message and a legitimate completed reasoner reply. Nothing else may stand in for either.
 */
function isReusableDiscussionMessage(role: string, provenance: string): boolean {
  return (
    (role === 'user' && provenance === TRUSTED_USER) ||
    (role === 'assistant' && provenance === REASONER_REPLY)
  )
}

/**
 * Filters to the selected project/conversation, excludes question/authentication anchors (whatever
 * role or provenance claims them), messages anchored to a work other than the selected one — and all
 * work-anchored messages when no work is selected — plus permission displays, system messages and
 * any role/provenance pair that is not a trusted user message or a completed reasoner reply. Paging
 * is bounded and coverage is reported so a truncated scan is never presented as a complete
 * conversation.
 */
export function createScopedConversationProvider(
  reader: ScopedConversationReader,
  selection: ConversationSelection,
  options: { readonly pageSize?: number; readonly maxPages?: number } = {},
): ScopedConversationProvider {
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200)
  const maxPages = Math.min(Math.max(options.maxPages ?? 8, 1), 100)
  let coverage: ConversationAdapterCoverage = {
    scanned: 0,
    returned: 0,
    complete: false,
    excluded: {
      otherConversation: 0,
      foreignProject: 0,
      unprovenProject: 0,
      questionAnchor: 0,
      otherWork: 0,
      permissionDisplay: 0,
      systemRole: 0,
      untrustedProvenance: 0,
    },
  }
  return {
    coverage: () => coverage,
    async recent({ projectId, conversationId, limit }) {
      if (projectId !== selection.projectId) {
        coverage = { ...coverage, scanned: 0, returned: 0, complete: true }
        return []
      }
      if (conversationId !== selection.conversationId) {
        coverage = { ...coverage, scanned: 0, returned: 0, complete: true }
        return []
      }
      const wanted = Math.min(Math.max(limit, 1), pageSize * maxPages)
      const excluded = {
        otherConversation: 0,
        foreignProject: 0,
        unprovenProject: 0,
        questionAnchor: 0,
        otherWork: 0,
        permissionDisplay: 0,
        systemRole: 0,
        untrustedProvenance: 0,
      }
      const accepted: (ComposedConversationMessage & { sequence: number })[] = []
      const acceptedIds = new Set<string>()
      let scanned = 0
      let before: number | undefined
      let complete = false
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const page = reader.page(selection.conversationId, { limit: pageSize, ...(before === undefined ? {} : { before }) })
        const sorted = [...page.messages].sort((left, right) => right.sequence - left.sequence)
        for (const message of sorted) {
          scanned += 1
          if (message.conversationId !== selection.conversationId) {
            excluded.otherConversation += 1
            continue
          }
          if (message.projectId === undefined) {
            excluded.unprovenProject += 1
            continue
          }
          if (message.projectId !== selection.projectId) {
            excluded.foreignProject += 1
            continue
          }
          // Any question/anchor answer display is excluded before role/provenance can claim trust.
          if (message.anchor?.questionId !== undefined) {
            excluded.questionAnchor += 1
            continue
          }
          // A work-anchored supplement is only reusable for that exact selected work; with no work
          // selected every work-anchored supplement stays out of the general discussion.
          const anchoredWork = message.anchor?.workId
          if (anchoredWork !== undefined && anchoredWork !== selection.workId) {
            excluded.otherWork += 1
            continue
          }
          if (!isReusableDiscussionMessage(message.role, message.provenance)) {
            if (message.provenance === PERMISSION_DISPLAY_PROVENANCE) excluded.permissionDisplay += 1
            else if (message.role === 'system') excluded.systemRole += 1
            else excluded.untrustedProvenance += 1
            continue
          }
          // A repeated page must not appear twice in the composition; the cursor guard below
          // separately stops the walk and reports the scan as incomplete.
          if (acceptedIds.has(message.id)) continue
          acceptedIds.add(message.id)
          accepted.push({
            messageId: message.id,
            conversationId: message.conversationId,
            sequence: message.sequence,
            role: message.role,
            provenance: message.provenance,
            text: message.text,
            createdAt: message.createdAt,
          })
          if (accepted.length >= wanted) break
        }
        if (accepted.length >= wanted) {
          complete = false
          break
        }
        if (!page.hasMore || sorted.length === 0) {
          complete = true
          break
        }
        const next = sorted[sorted.length - 1]!.sequence
        // A cursor that does not strictly move backwards would re-read the same page forever or
        // silently rescan; report the scan as incomplete instead of claiming full coverage.
        if (before !== undefined && next >= before) {
          complete = false
          break
        }
        before = next
      }
      coverage = { scanned, returned: accepted.length, complete, excluded }
      return accepted
    },
  }
}

export interface ScopedArtifactMetadata {
  readonly id: string
  readonly digest: string
  readonly bytes: number
  readonly createdAt: string
}

/** Metadata-only lookup; the adapter never enumerates a registry, lists files or reads bytes. */
export interface ScopedArtifactLookup {
  get(id: string): ScopedArtifactMetadata | undefined
}

export interface PublishedArtifactSelection {
  /** Verified published artifact ids for the selected work/message; never a global registry page. */
  readonly publishedArtifactIds: readonly string[]
}

export interface ArtifactAdapterCoverage {
  /** Deduplicated published ids this selection names. */
  readonly requested: number
  /** Metadata lookups actually attempted; bounded by `maxIds`, never by the result count. */
  readonly lookedUp: number
  readonly returned: number
  /** Looked-up ids whose metadata was absent or belonged to a different id. */
  readonly missing: number
  /** Looked-up ids whose metadata exceeded `maxArtifactBytes`. */
  readonly oversized: number
  /** False when lookups/returns stopped early or any requested id could not be returned. */
  readonly complete: boolean
}

export interface ScopedArtifactProvider extends ComposedArtifactProvider {
  coverage(): ArtifactAdapterCoverage
}

function positiveInteger(value: number | undefined, fallback: number, ceiling: number, name: string): number {
  if (value === undefined) return Math.min(fallback, ceiling)
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`Published artifact adapter ${name} must be a positive integer`)
  }
  return Math.min(value, ceiling)
}

/**
 * Only the caller-verified published artifact ids are looked up, metadata only. Duplicate ids are
 * collapsed; `maxIds` bounds attempted lookups (so a run of missing metadata cannot walk the whole
 * list) while the returned count is bounded separately by the request limit. A missing or
 * mistyped metadata row and an oversized artifact are counted, never replaced by a guess.
 */
export function createPublishedArtifactProvider(
  lookup: ScopedArtifactLookup,
  selection: PublishedArtifactSelection,
  options: { readonly maxIds?: number; readonly maxArtifactBytes?: number } = {},
): ScopedArtifactProvider {
  const maxIds = positiveInteger(options.maxIds, 64, 256, 'maxIds')
  const maxArtifactBytes =
    options.maxArtifactBytes === undefined ? undefined : positiveInteger(options.maxArtifactBytes, 1, Number.MAX_SAFE_INTEGER, 'maxArtifactBytes')
  let coverage: ArtifactAdapterCoverage = { requested: 0, lookedUp: 0, returned: 0, missing: 0, oversized: 0, complete: true }
  return {
    coverage: () => coverage,
    async recent({ limit }) {
      const requestedIds = [...new Set(selection.publishedArtifactIds)]
      const maxResults = Math.max(limit, 1)
      const artifacts: ComposedArtifactView[] = []
      let lookedUp = 0
      let missing = 0
      let oversized = 0
      for (const id of requestedIds) {
        if (lookedUp >= maxIds || artifacts.length >= maxResults) break
        lookedUp += 1
        const metadata = lookup.get(id)
        // A lookup that returns another identity is not evidence for the requested artifact.
        if (!metadata || metadata.id !== id) {
          missing += 1
          continue
        }
        if (maxArtifactBytes !== undefined && metadata.bytes > maxArtifactBytes) {
          oversized += 1
          continue
        }
        artifacts.push({ artifactId: metadata.id, digest: metadata.digest, bytes: metadata.bytes, createdAt: metadata.createdAt })
      }
      coverage = {
        requested: requestedIds.length,
        lookedUp,
        returned: artifacts.length,
        missing,
        oversized,
        complete: lookedUp === requestedIds.length && missing === 0 && oversized === 0,
      }
      return artifacts
    },
  }
}

/** Error helper kept local so the adapters do not need to import the error class at runtime. */
export type ScopedAdapterError = ContextError
