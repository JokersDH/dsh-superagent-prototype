import { PersistedDecisionSchema, PersistedProposalSchema } from '@personal-agent/contracts'
import type {
  AssistantStatePage,
  AssistantStatePort,
  AssistantStateQuery,
  Json,
  PersistedDecision,
  PersistedProposal,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { snapshot } from './snapshot.ts'

export type AssistantStateConflictCode = 'conflict' | 'stale_version' | 'invalid_record'

export class AssistantStateConflict extends Error {
  readonly code: AssistantStateConflictCode
  constructor(code: AssistantStateConflictCode, message: string) {
    super(message)
    this.name = 'AssistantStateConflict'
    this.code = code
  }
}

interface RecordMeta {
  readonly id: string
  readonly projectId: string
  readonly at: string
  readonly version: number
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const separator = decoded.indexOf('|')
    if (separator <= 0) throw new Error('missing separator')
    const at = decoded.slice(0, separator)
    const id = decoded.slice(separator + 1)
    if (!Number.isFinite(Date.parse(at)) || id.length === 0) throw new Error('invalid cursor')
    return { at, id }
  } catch {
    throw new AssistantStateConflict('invalid_record', 'Assistant state cursor is not valid')
  }
}

/** One append-only version chain with CAS updates and idempotent same-body replay. */
class VersionedRecords<T> {
  private readonly chains = new Map<string, T[]>()
  private readonly identity: (record: T) => RecordMeta
  private readonly parse: (record: unknown) => T

  constructor(identity: (record: T) => RecordMeta, parse: (record: unknown) => T) {
    this.identity = identity
    this.parse = parse
  }

  put(record: T, expectedVersion: number): { record: T; replayed: boolean } {
    const parsed = snapshot(this.parse(record))
    const meta = this.identity(parsed)
    const versions = this.chains.get(meta.id)
    if (!versions) {
      if (expectedVersion !== 0 || meta.version !== 1) {
        throw new AssistantStateConflict('stale_version', 'A new assistant record must start at version 1 from expectedVersion 0')
      }
      this.chains.set(meta.id, [parsed])
      return { record: snapshot(parsed), replayed: false }
    }
    const current = versions[versions.length - 1]!
    const currentMeta = this.identity(current)
    if (meta.version === currentMeta.version) {
      if (canonicalDigest(parsed as unknown as Json) === canonicalDigest(current as unknown as Json)) {
        return { record: snapshot(current), replayed: true }
      }
      throw new AssistantStateConflict('conflict', 'The same version cannot carry a different body')
    }
    if (expectedVersion !== currentMeta.version || meta.version !== expectedVersion + 1) {
      throw new AssistantStateConflict('stale_version', 'Assistant record version is not the expected successor')
    }
    versions.push(parsed)
    return { record: snapshot(parsed), replayed: false }
  }

  get(id: string): T | undefined {
    const versions = this.chains.get(id)
    return versions === undefined ? undefined : snapshot(versions[versions.length - 1]!)
  }

  history(id: string, limit = 50): readonly T[] {
    const versions = this.chains.get(id)
    if (!versions) return []
    const bounded = Math.min(Math.max(limit, 1), 200)
    return versions.slice(-bounded).reverse().map((record) => snapshot(record))
  }

  list(query: AssistantStateQuery): AssistantStatePage<T> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const records: { record: T; meta: RecordMeta }[] = []
    for (const versions of this.chains.values()) {
      const record = versions[versions.length - 1]!
      const meta = this.identity(record)
      if (meta.projectId !== query.projectId) continue
      records.push({ record, meta })
    }
    records.sort((left, right) => right.meta.at.localeCompare(left.meta.at) || left.meta.id.localeCompare(right.meta.id))
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const after = cursor
      ? records.filter(
          ({ meta }) => meta.at < cursor.at || (meta.at === cursor.at && meta.id > cursor.id),
        )
      : records
    const page = after.slice(0, limit)
    const last = page[page.length - 1]
    return {
      records: page.map((item) => snapshot(item.record)),
      ...(after.length > limit && last ? { nextCursor: encodeCursor(last.meta.at, last.meta.id) } : {}),
    }
  }
}

/**
 * In-memory reference implementation of the shared AssistantStatePort. It is a fixture/reference
 * adapter for C2/C4 until storage publishes the real sync port; it is not a second database.
 */
export class InMemoryAssistantState implements AssistantStatePort {
  private readonly decisionRecords = new VersionedRecords<PersistedDecision>(
    (record) => ({
      id: record.decision.id,
      projectId: record.decision.scope.projectId,
      at: record.recordedAt,
      version: record.decision.version,
    }),
    (record) => PersistedDecisionSchema.parse(record),
  )
  private readonly proposalRecords = new VersionedRecords<PersistedProposal>(
    (record) => ({ id: record.proposalId, projectId: record.projectId, at: record.updatedAt, version: record.version }),
    (record) => PersistedProposalSchema.parse(record),
  )

  readonly decisions = {
    get: (id: string) => this.decisionRecords.get(id),
    list: (query: AssistantStateQuery) => this.decisionRecords.list(query),
    put: (record: PersistedDecision, expectedVersion: number) => this.decisionRecords.put(record, expectedVersion),
    history: (id: string, limit?: number) => this.decisionRecords.history(id, limit),
  }
  readonly proposals = {
    get: (id: string) => this.proposalRecords.get(id),
    list: (query: AssistantStateQuery) => this.proposalRecords.list(query),
    put: (record: PersistedProposal, expectedVersion: number) => this.proposalRecords.put(record, expectedVersion),
    history: (id: string, limit?: number) => this.proposalRecords.history(id, limit),
  }
}
