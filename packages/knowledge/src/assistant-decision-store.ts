import { PersistedDecisionSchema } from '@personal-agent/contracts'
import type { AssistantStatePort, PersistedDecision } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { Json } from '@personal-agent/contracts'
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

/** Documented default scan budget: 200 records per page, 200 pages (40,000 decisions per project). */
export const DEFAULT_DECISION_SCAN = Object.freeze({ pageSize: 200, maxPages: 200 })

export interface DecisionScanLimits {
  readonly pageSize?: number
  readonly maxPages?: number
}

interface ScanResult {
  readonly records: readonly PersistedDecision[]
}

/** Explicit refusal when a project scan cannot be completed inside its budget. */
function scanIncomplete(projectId: string, scanned: number, limits: { pageSize: number; maxPages: number }): never {
  throw new DecisionError('scan_incomplete', 'Decision project scan exceeded its bound; refuse to treat partial results as complete', {
    projectId,
    scanned,
    pageSize: limits.pageSize,
    maxPages: limits.maxPages,
  })
}

const OTHERWISE_EMPTY: ReadonlySet<string> = new Set<string>()

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

/** Replay identity ignores only `recordedAt`: a retry at a later time is the same decision. */
function sameReplayBody(left: PersistedDecision, right: PersistedDecision): boolean {
  return (
    canonicalDigest(left.decision as unknown as Json) === canonicalDigest(right.decision as unknown as Json) &&
    left.sourceMessageId === right.sourceMessageId &&
    left.conversationId === right.conversationId &&
    left.sourceTextDigest === right.sourceTextDigest &&
    left.actorRef === right.actorRef &&
    (left.revokedBy ?? null) === (right.revokedBy ?? null)
  )
}

export interface SyncDecisionAppend {
  readonly record: DecisionRecord
  readonly idempotent: boolean
}

/**
 * Adapts the shared synchronous AssistantStatePort to the decision domain port. It opens no database
 * and performs no migration; the production port is storage-owned. Creation, same-version replay,
 * old-version replay (never resurrecting a revoked/superseded decision) and legitimate successors are
 * mapped explicitly onto the port's CAS contract.
 */
export class AssistantDecisionStore implements DecisionStorePort {
  private readonly port: AssistantStatePort
  private readonly scanLimits: { readonly pageSize: number; readonly maxPages: number }
  constructor(port: AssistantStatePort, limits: DecisionScanLimits = {}) {
    this.port = port
    this.scanLimits = {
      pageSize: Math.min(Math.max(limits.pageSize ?? DEFAULT_DECISION_SCAN.pageSize, 1), 200),
      maxPages: Math.min(Math.max(limits.maxPages ?? DEFAULT_DECISION_SCAN.maxPages, 1), 10_000),
    }
  }

  async append(input: AppendDecisionInput): Promise<SyncDecisionAppend> {
    return this.appendSync(input)
  }

  appendSync(input: AppendDecisionInput): SyncDecisionAppend {
    const candidate = snapshot(PersistedDecisionSchema.parse({
      decision: input.decision,
      sourceMessageId: input.sourceMessageId,
      sourceTextDigest: input.sourceTextDigest,
      conversationId: input.sourceConversationId,
      actorRef: input.actorRef,
      recordedAt: input.recordedAt,
      ...(input.decision.revokedAt === undefined ? {} : { revokedBy: input.actorRef }),
    }))
    return this.putSync(candidate)
  }

  async get(decisionId: string): Promise<DecisionRecord | undefined> {
    return this.getSync(decisionId)
  }

  getSync(decisionId: string): DecisionRecord | undefined {
    const record = this.port.decisions.get(decisionId)
    if (!record) return undefined
    const superseded = this.isSuperseded(decisionId, record.recordedAt, record.decision.scope.projectId)
    return this.toRecord(record, superseded ? new Set([decisionId]) : OTHERWISE_EMPTY)
  }

  async list(query: DecisionQuery): Promise<DecisionPage> {
    return this.listSync(query)
  }

  listSync(query: DecisionQuery): DecisionPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const records = this.scanProject(query.projectId).records
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
    return this.revokeSync(input)
  }

  revokeSync(input: RevokeDecisionInput): RevokeResult {
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
    const revoked = snapshot(PersistedDecisionSchema.parse({
      ...current,
      decision: { ...current.decision, version: current.decision.version + 1, revokedAt: input.revokedAt },
      recordedAt: input.revokedAt,
      actorRef: input.actorRef,
      revokedBy: input.actorRef,
    }))
    const stored = this.put(revoked, current.decision.version)
    return {
      record: this.toRecord(stored.record, this.supersededIds(current.decision.scope.projectId)),
      idempotent: stored.replayed,
    }
  }

  private putSync(candidate: PersistedDecision): SyncDecisionAppend {
    const projectId = candidate.decision.scope.projectId
    const current = this.port.decisions.get(candidate.decision.id)
    if (!current) {
      if (candidate.decision.version !== 1) {
        throw new DecisionConflict('stale_version', 'A new decision must be version 1')
      }
      const stored = this.put(candidate, 0)
      return { record: this.toRecord(stored.record), idempotent: stored.replayed }
    }
    if (candidate.decision.version === current.decision.version) {
      if (!sameReplayBody(current, candidate)) {
        throw new DecisionConflict('payload_mismatch', 'A decision replay changed its body, source or actor')
      }
      // The current head may already be revoked or superseded; replay must not resurrect it.
      return { record: this.toRecord(current, current.decision.supersedes ? this.supersededIds(projectId) : undefined), idempotent: true }
    }
    if (candidate.decision.version < current.decision.version) {
      const historical = this.port.decisions
        .history(candidate.decision.id, 200)
        .find((record) => record.decision.version === candidate.decision.version)
      if (!historical || !sameReplayBody(historical, candidate)) {
        throw new DecisionConflict('stale_version', 'An older decision replay does not match its audit body')
      }
      return { record: this.toRecord(current, current.decision.supersedes ? this.supersededIds(projectId) : undefined), idempotent: true }
    }
    if (candidate.decision.version !== current.decision.version + 1) {
      throw new DecisionConflict('stale_version', 'Decision version is not the next revision')
    }
    const stored = this.put(candidate, current.decision.version)
    return { record: this.toRecord(stored.record, current.decision.supersedes ? this.supersededIds(projectId) : undefined), idempotent: stored.replayed }
  }

  private put(record: PersistedDecision, expectedVersion: number): { record: PersistedDecision; replayed: boolean } {
    try {
      return this.port.decisions.put(record, expectedVersion)
    } catch (error) {
      return mapConflict(error)
    }
  }

  /**
   * Complete project scan or an explicit `scan_incomplete` refusal. A truncated page walk is never
   * returned as if it were the whole project: supersession/effectiveness would silently be wrong.
   */
  private scanProject(projectId: string): ScanResult {
    const { pageSize, maxPages } = this.scanLimits
    const records: PersistedDecision[] = []
    let cursor: string | undefined
    for (let page = 0; page < maxPages; page += 1) {
      const result = this.port.decisions.list({
        projectId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: pageSize,
      })
      records.push(...result.records)
      if (!result.nextCursor) return { records }
      cursor = result.nextCursor
    }
    return scanIncomplete(projectId, records.length, { pageSize, maxPages })
  }

  private supersededIds(projectId: string): ReadonlySet<string> {
    const superseded = new Set<string>()
    for (const record of this.scanProject(projectId).records) {
      if (record.decision.supersedes && !record.decision.revokedAt) superseded.add(record.decision.supersedes)
    }
    return superseded
  }

  /**
   * Targeted supersession probe. A superseding record must be appended after its target, so the
   * DESC page walk can stop at records strictly older than the target. No superseder found after a
   * complete walk is a proof, not an assumption; an exceeded bound refuses.
   */
  private isSuperseded(decisionId: string, recordedAt: string, projectId: string): boolean {
    const { pageSize, maxPages } = this.scanLimits
    const cutoff = Date.parse(recordedAt)
    let cursor: string | undefined
    let scanned = 0
    for (let page = 0; page < maxPages; page += 1) {
      const result = this.port.decisions.list({
        projectId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: pageSize,
      })
      for (const record of result.records) {
        if (record.decision.id === decisionId) continue
        if (record.decision.supersedes === decisionId && !record.decision.revokedAt) return true
        if (Number.isFinite(cutoff) && Date.parse(record.recordedAt) < cutoff) return false
      }
      scanned += result.records.length
      if (!result.nextCursor) return false
      cursor = result.nextCursor
    }
    return scanIncomplete(projectId, scanned, { pageSize, maxPages })
  }

  private toRecord(record: PersistedDecision, superseded: ReadonlySet<string> = OTHERWISE_EMPTY): DecisionRecord {
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
