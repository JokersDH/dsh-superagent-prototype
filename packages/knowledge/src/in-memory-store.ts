import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { UserDecisionSchema } from '@personal-agent/contracts'
import type { Json, UserDecision } from '@personal-agent/contracts'
import { DecisionConflict, DecisionError } from './errors.ts'
import { snapshot } from './snapshot.ts'
import type {
  AppendDecisionInput,
  DecisionPage,
  DecisionQuery,
  DecisionRecord,
  DecisionStorePort,
  DecisionStatus,
  RevokeDecisionInput,
  RevokeResult,
} from './types.ts'

interface DecisionEntry {
  readonly decision: UserDecision
  readonly recordedAt: string
  readonly actorRef: string
  readonly sourceMessageId: string
  readonly sourceConversationId: string
  readonly sourceTextDigest: string
}

const digestOf = (decision: UserDecision): string => canonicalDigest(decision as unknown as Json)

function encodeCursor(entry: DecisionEntry): string {
  return Buffer.from(`${entry.recordedAt}|${entry.decision.id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { readonly recordedAt: string; readonly id: string } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const separator = decoded.indexOf('|')
    if (separator <= 0) throw new Error('missing separator')
    const recordedAt = decoded.slice(0, separator)
    const id = decoded.slice(separator + 1)
    if (!Number.isFinite(Date.parse(recordedAt)) || id.length === 0) throw new Error('invalid cursor')
    return { recordedAt, id }
  } catch {
    throw new DecisionError('invalid_cursor', 'Decision cursor is not valid')
  }
}

/**
 * In-memory fixture/reference implementation of the storage-owned port. It keeps every revision,
 * enforces append-only identity and CAS revocation, and never creates a second database.
 */
export class InMemoryDecisionStore implements DecisionStorePort {
  private readonly history = new Map<string, DecisionEntry[]>()

  async append(input: AppendDecisionInput): Promise<{ record: DecisionRecord; idempotent: boolean }> {
    const decision = snapshot(UserDecisionSchema.parse(input.decision))
    const versions = this.history.get(decision.id)
    if (!versions) {
      if (decision.version !== 1) throw new DecisionConflict('invalid_version', 'A new decision must start at version 1')
      if (decision.revokedAt) throw new DecisionConflict('revoked', 'A new decision cannot start revoked')
      const entry: DecisionEntry = {
        decision,
        recordedAt: input.recordedAt,
        actorRef: input.actorRef,
        sourceMessageId: input.sourceMessageId,
        sourceConversationId: input.sourceConversationId,
        sourceTextDigest: input.sourceTextDigest,
      }
      this.history.set(decision.id, [entry])
      return { record: this.toRecord(entry), idempotent: false }
    }
    const current = versions[versions.length - 1]!
    if (decision.version === current.decision.version) {
      if (digestOf(decision) === digestOf(current.decision)) {
        return { record: this.toRecord(current), idempotent: true }
      }
      throw new DecisionConflict('payload_mismatch', 'The same version cannot carry a different payload')
    }
    if (decision.version !== current.decision.version + 1) {
      throw new DecisionConflict('stale_version', 'Decision version is not the next revision')
    }
    if (current.decision.revokedAt) throw new DecisionConflict('revoked', 'A revoked decision cannot gain revisions')
    if (
      decision.content !== current.decision.content ||
      canonicalDigest(decision.scope as unknown as Json) !== canonicalDigest(current.decision.scope as unknown as Json) ||
      decision.authorityRef !== current.decision.authorityRef ||
      (decision.supersedes ?? null) !== (current.decision.supersedes ?? null) ||
      input.sourceMessageId !== current.sourceMessageId ||
      input.sourceConversationId !== current.sourceConversationId ||
      input.sourceTextDigest !== current.sourceTextDigest
    ) {
      throw new DecisionConflict('immutable', 'Decision content, scope and source are immutable; record a new decision id')
    }
    const entry: DecisionEntry = {
      decision,
      recordedAt: input.recordedAt,
      actorRef: input.actorRef,
      sourceMessageId: current.sourceMessageId,
      sourceConversationId: current.sourceConversationId,
      sourceTextDigest: current.sourceTextDigest,
    }
    versions.push(entry)
    return { record: this.toRecord(entry), idempotent: false }
  }

  async get(decisionId: string): Promise<DecisionRecord | undefined> {
    const versions = this.history.get(decisionId)
    if (!versions) return undefined
    return this.toRecord(versions[versions.length - 1]!)
  }

  async list(query: DecisionQuery): Promise<DecisionPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const superseded = this.supersededIds()
    const records: { entry: DecisionEntry; record: DecisionRecord }[] = []
    for (const versions of this.history.values()) {
      const entry = versions[versions.length - 1]!
      if (entry.decision.scope.projectId !== query.projectId) continue
      const record = this.toRecord(entry, superseded)
      if (query.status && query.status !== 'all' && record.status !== query.status) continue
      records.push({ entry, record })
    }
    records.sort(
      (left, right) =>
        right.entry.recordedAt.localeCompare(left.entry.recordedAt) ||
        left.entry.decision.id.localeCompare(right.entry.decision.id),
    )
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const afterCursor = cursor
      ? records.filter(
          ({ entry }) =>
            entry.recordedAt < cursor.recordedAt ||
            (entry.recordedAt === cursor.recordedAt && entry.decision.id > cursor.id),
        )
      : records
    const page = afterCursor.slice(0, limit)
    const last = page[page.length - 1]
    return {
      decisions: page.map((item) => item.record),
      ...(afterCursor.length > limit && last ? { nextCursor: encodeCursor(last.entry) } : {}),
    }
  }

  async revoke(input: RevokeDecisionInput): Promise<RevokeResult> {
    if (!Number.isFinite(Date.parse(input.revokedAt))) {
      throw new DecisionError('invalid_content', 'Revocation time is not a valid timestamp')
    }
    const versions = this.history.get(input.decisionId)
    if (!versions) throw new DecisionError('not_found', 'Decision does not exist')
    const current = versions[versions.length - 1]!
    if (input.expectedVersion !== current.decision.version) {
      throw new DecisionConflict('stale_version', 'Expected decision version is stale')
    }
    if (current.decision.revokedAt) return { record: this.toRecord(current), idempotent: true }
    const revoked: DecisionEntry = {
      decision: snapshot({ ...current.decision, version: current.decision.version + 1, revokedAt: input.revokedAt }),
      recordedAt: input.revokedAt,
      actorRef: input.actorRef,
      sourceMessageId: current.sourceMessageId,
      sourceConversationId: current.sourceConversationId,
      sourceTextDigest: current.sourceTextDigest,
    }
    versions.push(revoked)
    return { record: this.toRecord(revoked), idempotent: false }
  }

  private supersededIds(): ReadonlySet<string> {
    const superseded = new Set<string>()
    for (const versions of this.history.values()) {
      const current = versions[versions.length - 1]!
      if (current.decision.supersedes && !current.decision.revokedAt) superseded.add(current.decision.supersedes)
    }
    return superseded
  }

  private toRecord(entry: DecisionEntry, superseded: ReadonlySet<string> = this.supersededIds()): DecisionRecord {
    let status: DecisionStatus = 'active'
    if (entry.decision.revokedAt) status = 'revoked'
    else if (superseded.has(entry.decision.id)) status = 'superseded'
    return snapshot({
      decision: entry.decision,
      status,
      recordedAt: entry.recordedAt,
      actorRef: entry.actorRef,
      sourceMessageId: entry.sourceMessageId,
      sourceConversationId: entry.sourceConversationId,
      sourceTextDigest: entry.sourceTextDigest,
    })
  }
}
