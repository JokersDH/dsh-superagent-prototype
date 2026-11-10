import { PersistedDecisionSchema } from '@personal-agent/contracts'
import type { AssistantStatePort, PersistedDecision } from '@personal-agent/contracts'
import { DecisionConflict, DecisionError } from './errors.ts'
import { snapshot } from './snapshot.ts'
import type {
  AppendDecisionInput,
  DecisionPage,
  DecisionQuery,
  DecisionRecord,
  DecisionStatus,
  DecisionStorePort,
  RevokeDecisionInput,
  RevokeResult,
} from './types.ts'

const SCAN_PAGE = 200
const MAX_SCAN_PAGES = 5

function encodeCursor(recordedAt: string, id: string): string {
  return Buffer.from(`${recordedAt}|${id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { recordedAt: string; id: string } {
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

function mapConflict(error: unknown): never {
  // The shared port fixture/implementation reports typed conflicts; map them without a package cycle.
  const code = error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : undefined
  if (code === 'stale_version') throw new DecisionConflict('stale_version', (error as Error).message)
  if (code === 'conflict') throw new DecisionConflict('payload_mismatch', (error as Error).message)
  throw error
}

/**
 * Adapts the shared synchronous AssistantStatePort to the decision domain port. It opens no database
 * and performs no migration; the production port is storage-owned. The adapter bounds supersession
 * scans on the current project and returns immutable copies.
 */
export class AssistantDecisionStore implements DecisionStorePort {
  private readonly port: AssistantStatePort
  constructor(port: AssistantStatePort) {
    this.port = port
  }

  async append(input: AppendDecisionInput): Promise<{ record: DecisionRecord; idempotent: boolean }> {
    const existing = this.port.decisions.get(input.decision.id)
    const expectedVersion = existing === undefined ? 0 : existing.decision.version
    const record = PersistedDecisionSchema.parse({
      decision: input.decision,
      sourceMessageId: input.sourceMessageId,
      sourceTextDigest: input.sourceTextDigest,
      conversationId: input.sourceConversationId,
      actorRef: input.actorRef,
      recordedAt: input.recordedAt,
      ...(input.decision.revokedAt === undefined ? {} : { revokedBy: input.actorRef }),
    })
    try {
      const stored = this.port.decisions.put(record, expectedVersion)
      return {
        record: this.toRecord(stored.record, this.supersededIds(input.decision.scope.projectId)),
        idempotent: stored.replayed,
      }
    } catch (error) {
      return mapConflict(error)
    }
  }

  async get(decisionId: string): Promise<DecisionRecord | undefined> {
    const record = this.port.decisions.get(decisionId)
    if (!record) return undefined
    return this.toRecord(record, this.supersededIds(record.decision.scope.projectId))
  }

  async list(query: DecisionQuery): Promise<DecisionPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const records = this.scanProject(query.projectId)
    const superseded = new Set<string>()
    for (const record of records) {
      if (record.decision.supersedes && !record.decision.revokedAt) superseded.add(record.decision.supersedes)
    }
    const mapped = records
      .map((record) => this.toRecord(record, superseded))
      .filter((record) => query.status === undefined || query.status === 'all' || record.status === query.status)
      .sort(
        (left, right) =>
          right.recordedAt.localeCompare(left.recordedAt) || left.decision.id.localeCompare(right.decision.id),
      )
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
    const after = cursor
      ? mapped.filter(
          (record) =>
            record.recordedAt < cursor.recordedAt ||
            (record.recordedAt === cursor.recordedAt && record.decision.id > cursor.id),
        )
      : mapped
    const page = after.slice(0, limit)
    const last = page[page.length - 1]
    return {
      decisions: page,
      ...(after.length > limit && last
        ? { nextCursor: encodeCursor(last.recordedAt, last.decision.id) }
        : {}),
    }
  }

  async revoke(input: RevokeDecisionInput): Promise<RevokeResult> {
    const current = this.port.decisions.get(input.decisionId)
    if (!current) throw new DecisionError('not_found', 'Decision does not exist')
    if (input.expectedVersion !== current.decision.version) {
      throw new DecisionConflict('stale_version', 'Expected decision version is stale')
    }
    if (current.decision.revokedAt) {
      return {
        record: this.toRecord(current, this.supersededIds(current.decision.scope.projectId)),
        idempotent: true,
      }
    }
    const revoked = PersistedDecisionSchema.parse({
      ...current,
      decision: { ...current.decision, version: current.decision.version + 1, revokedAt: input.revokedAt },
      recordedAt: input.revokedAt,
      actorRef: input.actorRef,
      revokedBy: input.actorRef,
    })
    try {
      const stored = this.port.decisions.put(revoked, current.decision.version)
      return {
        record: this.toRecord(stored.record, this.supersededIds(current.decision.scope.projectId)),
        idempotent: stored.replayed,
      }
    } catch (error) {
      return mapConflict(error)
    }
  }

  private scanProject(projectId: string): readonly PersistedDecision[] {
    const records: PersistedDecision[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const result = this.port.decisions.list({
        projectId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: SCAN_PAGE,
      })
      records.push(...result.records)
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    return records
  }

  private supersededIds(projectId: string): ReadonlySet<string> {
    const superseded = new Set<string>()
    for (const record of this.scanProject(projectId)) {
      if (record.decision.supersedes && !record.decision.revokedAt) superseded.add(record.decision.supersedes)
    }
    return superseded
  }

  private toRecord(record: PersistedDecision, superseded: ReadonlySet<string>): DecisionRecord {
    let status: DecisionStatus = 'active'
    if (record.decision.revokedAt) status = 'revoked'
    else if (superseded.has(record.decision.id)) status = 'superseded'
    return snapshot({
      decision: record.decision,
      status,
      recordedAt: record.recordedAt,
      actorRef: record.actorRef,
      sourceMessageId: record.sourceMessageId,
      sourceConversationId: record.conversationId,
      sourceTextDigest: record.sourceTextDigest,
    })
  }
}
