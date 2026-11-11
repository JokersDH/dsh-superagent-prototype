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
    readonly untrustedProvenance: number
    readonly permissionDisplay: number
    readonly systemRole: number
    readonly otherWork: number
  }
}

export interface ScopedConversationProvider extends ComposedConversationProvider {
  /** Coverage of the most recent `recent()` call. */
  coverage(): ConversationAdapterCoverage
}

const PERMISSION_DISPLAY_PROVENANCE = 'question_answer_display'
const TRUSTED_USER = 'trusted_user'

/**
 * Filters to the selected project/conversation and trusted user messages, excludes permission /
 * authentication answer displays, system messages and (when a work is selected) messages anchored to
 * a different work. Paging is bounded and coverage is reported so a truncated scan is never presented
 * as a complete conversation.
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
    excluded: { otherConversation: 0, foreignProject: 0, unprovenProject: 0, untrustedProvenance: 0, permissionDisplay: 0, systemRole: 0, otherWork: 0 },
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
      const excluded = { otherConversation: 0, foreignProject: 0, unprovenProject: 0, untrustedProvenance: 0, permissionDisplay: 0, systemRole: 0, otherWork: 0 }
      const accepted: (ComposedConversationMessage & { sequence: number })[] = []
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
          if (message.provenance === PERMISSION_DISPLAY_PROVENANCE) {
            excluded.permissionDisplay += 1
            continue
          }
          if (message.provenance !== TRUSTED_USER) {
            excluded.untrustedProvenance += 1
            continue
          }
          if (message.role === 'system') {
            excluded.systemRole += 1
            continue
          }
          const anchoredWork = message.anchor?.workId
          if (selection.workId !== undefined && anchoredWork !== undefined && anchoredWork !== selection.workId) {
            excluded.otherWork += 1
            continue
          }
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
        before = sorted[sorted.length - 1]!.sequence
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
  readonly requested: number
  readonly returned: number
  readonly missing: number
  readonly complete: boolean
}

export interface ScopedArtifactProvider extends ComposedArtifactProvider {
  coverage(): ArtifactAdapterCoverage
}

/**
 * Only the caller-verified published artifact ids are looked up, metadata only. Duplicate ids are
 * collapsed and the list is bounded; a missing metadata row is counted, never replaced by a guess.
 */
export function createPublishedArtifactProvider(
  lookup: ScopedArtifactLookup,
  selection: PublishedArtifactSelection,
  options: { readonly maxIds?: number } = {},
): ScopedArtifactProvider {
  const maxIds = Math.min(Math.max(options.maxIds ?? 64, 1), 256)
  let coverage: ArtifactAdapterCoverage = { requested: 0, returned: 0, missing: 0, complete: true }
  return {
    coverage: () => coverage,
    async recent({ limit }) {
      const requestedIds = [...new Set(selection.publishedArtifactIds)]
      const missing: string[] = []
      const artifacts: ComposedArtifactView[] = []
      const wanted = Math.min(requestedIds.length, maxIds, Math.max(limit, 1))
      for (const id of requestedIds) {
        if (artifacts.length >= wanted) break
        const metadata = lookup.get(id)
        if (!metadata) {
          missing.push(id)
          continue
        }
        artifacts.push({ artifactId: metadata.id, digest: metadata.digest, bytes: metadata.bytes, createdAt: metadata.createdAt })
      }
      coverage = {
        requested: requestedIds.length,
        returned: artifacts.length,
        missing: missing.length,
        complete: requestedIds.length <= wanted && missing.length === 0,
      }
      return artifacts
    },
  }
}

/** Error helper kept local so the adapters do not need to import the error class at runtime. */
export type ScopedAdapterError = ContextError
