import type {
  ExecutionOutcome,
  ExecutionProfileRef,
  Json,
  ReviewEvidence,
  ReviewSubject,
  RouteAdvice,
  RoutingEvidencePage,
  RoutingEvidencePort,
  RoutingEvidenceQuery,
} from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { snapshot } from './snapshot.ts'

export class RoutingEvidenceConflict extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutingEvidenceConflict'
  }
}

interface Stored<T> {
  readonly record: T
  readonly at: string
  readonly digest: string
}

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { at: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
  const separator = decoded.indexOf('|')
  if (separator <= 0) throw new RoutingEvidenceConflict('Routing evidence cursor is not valid')
  const at = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)
  if (!Number.isFinite(Date.parse(at)) || id.length === 0) throw new RoutingEvidenceConflict('Routing evidence cursor is not valid')
  return { at, id }
}

function pageOf<T>(
  stored: readonly Stored<T>[],
  id: (record: T) => string,
  query: RoutingEvidenceQuery,
  filter: (record: T) => boolean = () => true,
): RoutingEvidencePage<T> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
  const rows = stored
    .filter((item) => filter(item.record))
    .sort((left, right) => right.at.localeCompare(left.at) || id(left.record).localeCompare(id(right.record)))
  const after = cursor
    ? rows.filter((item) => item.at < cursor.at || (item.at === cursor.at && id(item.record) > cursor.id))
    : rows
  const page = after.slice(0, limit)
  const last = page[page.length - 1]
  return {
    records: page.map((item) => snapshot(item.record)),
    ...(after.length > limit && last ? { nextCursor: encodeCursor(last.at, id(last.record)) } : {}),
  }
}

function sameSubject(left: ReviewSubject, right: ReviewSubject): boolean {
  return canonicalDigest(left as unknown as Json) === canonicalDigest(right as unknown as Json)
}

function sameProfile(left: ExecutionProfileRef, right: ExecutionProfileRef): boolean {
  return (
    left.profileId === right.profileId &&
    left.revision === right.revision &&
    left.identityDigest === right.identityDigest
  )
}

/**
 * Reference in-memory RoutingEvidencePort fixture. It mirrors A's append-only same-body replay
 * contract for C-side consumers until storage publishes the real synchronous port. It is not a
 * second database and never grants execution authority.
 */
export class InMemoryRoutingEvidence implements RoutingEvidencePort {
  private readonly adviceRecords = new Map<string, Stored<RouteAdvice>>()
  private readonly reviewRecords = new Map<string, Stored<ReviewEvidence>>()
  private readonly outcomeRecords = new Map<string, Stored<ExecutionOutcome>>()

  readonly advice = {
    put: (record: RouteAdvice) => this.put(this.adviceRecords, record.id, record, record.createdAt),
    get: (id: string) => this.get(this.adviceRecords, id),
    list: (query: RoutingEvidenceQuery) =>
      pageOf([...this.adviceRecords.values()], (record) => record.id, query, (record) => record.projectId === query.projectId),
  }

  readonly reviews = {
    put: (record: ReviewEvidence) => this.put(this.reviewRecords, record.id, record, record.observedAt),
    get: (id: string) => this.get(this.reviewRecords, id),
    list: (query: RoutingEvidenceQuery & { subject?: ReviewSubject }) =>
      pageOf(
        [...this.reviewRecords.values()],
        (record) => record.id,
        query,
        (record) =>
          record.projectId === query.projectId && (query.subject === undefined || sameSubject(record.subject, query.subject)),
      ),
  }

  readonly outcomes = {
    put: (record: ExecutionOutcome) => this.put(this.outcomeRecords, record.id, record, record.observedAt),
    get: (id: string) => this.get(this.outcomeRecords, id),
    list: (query: RoutingEvidenceQuery & { profile?: ExecutionProfileRef }) =>
      pageOf(
        [...this.outcomeRecords.values()],
        (record) => record.id,
        query,
        (record) =>
          record.projectId === query.projectId && (query.profile === undefined || sameProfile(record.profileRef, query.profile)),
      ),
  }

  private put<T>(store: Map<string, Stored<T>>, id: string, record: T, at: string): { record: T; replayed: boolean } {
    const digest = canonicalDigest(record as unknown as Json)
    const existing = store.get(id)
    if (existing) {
      if (existing.digest !== digest) throw new RoutingEvidenceConflict(`Routing evidence ${id} already exists with a different body`)
      return { record: snapshot(existing.record), replayed: true }
    }
    store.set(id, { record: snapshot(record), at, digest })
    return { record: snapshot(record), replayed: false }
  }

  private get<T>(store: Map<string, Stored<T>>, id: string): T | undefined {
    const existing = store.get(id)
    return existing === undefined ? undefined : snapshot(existing.record)
  }
}
