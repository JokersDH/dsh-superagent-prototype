/**
 * Wave-04 A1: synchronous AssistantState persistence. Decisions keep their body in the existing
 * `user_decision_versions` ledger and add source/actor metadata in a companion table, so there is one
 * decision authority, not a second one. Proposals are append-only versions in their own table.
 * Legacy decisions without metadata remain in the ledger but are never returned as source-verified.
 */
import type Database from 'better-sqlite3'
import {
  PersistedDecisionSchema, PersistedProposalSchema,
} from '@personal-agent/contracts'
import type {
  AssistantStatePage, AssistantStatePort, AssistantStateQuery, PersistedDecision, PersistedProposal, UserDecision,
} from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'
import type { ProductDecisions } from './workflows.ts'
import { AssistantContextBindingStore } from './assistant-context.ts'

type Row = Record<string, unknown>
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const digest = (value: unknown): string => value === undefined ? 'undefined' : canonicalDigest(JSON.parse(JSON.stringify(value)))
const limitOf = (value: number | undefined, fallback: number, max: number): number =>
  Math.max(1, Math.min(max, Math.trunc(value ?? fallback)))
const parseCursor = (cursor: string | undefined): { at: string; id: string } | undefined => {
  if (!cursor) return undefined
  const separator = cursor.indexOf('\u0000')
  if (separator < 1) throw new WorkflowConflict('Invalid assistant-state cursor')
  return { at: cursor.slice(0, separator), id: cursor.slice(separator + 1) }
}
const cursorOf = (at: string, id: string): string => `${at}\u0000${id}`

export interface LegacyDecisionRecord {
  decision: UserDecision
  /** The old ledger row has no source/actor metadata; it is not valid assistant memory. */
  legacy: true
  missingSource: true
}

/** Source-verified decision record joined with the single UserDecision body ledger. */
export class AssistantState implements AssistantStatePort {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  private readonly ledger: ProductDecisions
  readonly decisions: AssistantStatePort['decisions']
  readonly proposals: AssistantStatePort['proposals']
  /** Wave-10 shared AssistantContextBindings audit; one append-only writer on this connection. */
  readonly contextBindings: AssistantContextBindingStore
  constructor(db: Database.Database, uow: UnitOfWork, ledger: ProductDecisions) {
    this.db = db
    this.uow = uow
    this.ledger = ledger
    this.contextBindings = new AssistantContextBindingStore(db, uow)
    this.decisions = {
      get: this.get.bind(this),
      list: this.list.bind(this),
      put: this.put.bind(this),
      history: this.history.bind(this),
    }
    this.proposals = {
      get: this.proposalGet.bind(this),
      list: this.proposalList.bind(this),
      put: this.proposalPut.bind(this),
      history: this.proposalHistory.bind(this),
    }
  }

  private metadata(id: string, version: number): Row | undefined {
    return this.db.prepare('SELECT * FROM assistant_decision_versions WHERE id = ? AND version = ?').get(id, version) as Row | undefined
  }
  private body(id: string, version: number): Row | undefined {
    return this.db.prepare('SELECT value FROM user_decision_versions WHERE id = ? AND version = ?').get(id, version) as Row | undefined
  }
  private record(row: Row): PersistedDecision | undefined {
    const body = this.body(String(row.id), Number(row.version))
    if (!body) return undefined
    return PersistedDecisionSchema.parse({
      decision: json<UserDecision>(body.value),
      sourceMessageId: String(row.source_message_id),
      sourceTextDigest: String(row.source_text_digest),
      conversationId: String(row.conversation_id),
      actorRef: String(row.actor_ref),
      recordedAt: String(row.recorded_at),
      ...(row.revoked_by === null ? {} : { revokedBy: String(row.revoked_by) }),
    })
  }
  private currentRecord(id: string): PersistedDecision | undefined {
    const row = this.db.prepare('SELECT * FROM assistant_decision_versions WHERE id = ? ORDER BY version DESC LIMIT 1').get(id) as Row | undefined
    return row ? this.record(row) : undefined
  }

  get(id: string): PersistedDecision | undefined {
    return this.currentRecord(id)
  }

  list(query: AssistantStateQuery): AssistantStatePage<PersistedDecision> {
    const projectId = query.projectId
    const limit = limitOf(query.limit, 50, 200)
    const cursor = parseCursor(query.cursor)
    const args: unknown[] = [projectId]
    let cursorClause = ''
    if (cursor) {
      cursorClause = 'AND (m.recorded_at < ? OR (m.recorded_at = ? AND m.id < ?))'
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`SELECT m.* FROM assistant_decision_versions m
      WHERE m.project_id = ? AND m.version = (
        SELECT MAX(x.version) FROM assistant_decision_versions x WHERE x.id = m.id)
      ${cursorClause}
      ORDER BY m.recorded_at DESC, m.id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const records = rows.slice(0, limit).flatMap(row => {
      const record = this.record(row)
      return record ? [record] : []
    })
    const last = records.at(-1)
    return {
      records,
      ...(rows.length > limit && last ? { nextCursor: cursorOf(last.recordedAt, last.decision.id) } : {}),
    }
  }

  history(id: string, limit = 50): readonly PersistedDecision[] {
    const rows = this.db.prepare(`SELECT * FROM assistant_decision_versions WHERE id = ?
      ORDER BY version DESC LIMIT ?`).all(id, limitOf(limit, 50, 200)) as Row[]
    return rows.flatMap(row => {
      const record = this.record(row)
      return record ? [record] : []
    })
  }

  put(record: PersistedDecision, expectedVersion: number): { record: PersistedDecision; replayed: boolean } {
    let valid: PersistedDecision
    try { valid = PersistedDecisionSchema.parse(record) } catch (error) {
      throw new WorkflowConflict(`PersistedDecision failed contract validation: ${String(error)}`)
    }
    const version = valid.decision.version
    if (expectedVersion < 0) throw new WorkflowConflict('expectedVersion must not be negative')
    if (expectedVersion === 0 && version !== 1) throw new WorkflowConflict('A new decision must be version 1')
    if (expectedVersion > 0 && version !== expectedVersion + 1) throw new WorkflowConflict('A decision update must advance exactly one version')
    const valueDigest = digest(valid)
    return this.uow.atomic(() => {
      const existing = this.metadata(valid.decision.id, version)
      if (existing) {
        if (String(existing.value_digest) !== valueDigest)
          throw new WorkflowConflict(`Decision ${valid.decision.id}@${version} already exists with a different body`)
        const current = this.record(existing)
        if (!current) throw new WorkflowConflict(`Decision ${valid.decision.id}@${version} has no body`)
        return { record: current, replayed: true }
      }
      if (version > 1) {
        const previous = this.currentRecord(valid.decision.id)
        if (!previous || previous.decision.version !== version - 1)
          throw new WorkflowConflict(`Decision ${valid.decision.id}@${version} requires its previous version`)
        const same = (a: unknown, b: unknown): boolean => digest(a) === digest(b)
        if (!same(previous.decision.content, valid.decision.content) ||
          !same(previous.decision.scope, valid.decision.scope) ||
          !same(previous.decision.authorityRef, valid.decision.authorityRef) ||
          !same(previous.decision.supersedes, valid.decision.supersedes) ||
          previous.sourceMessageId !== valid.sourceMessageId ||
          previous.sourceTextDigest !== valid.sourceTextDigest ||
          previous.conversationId !== valid.conversationId ||
          previous.actorRef !== valid.actorRef)
          throw new WorkflowConflict('A decision revision cannot change its body, scope, source or actor; use a new decision ID')
      } else if (this.body(valid.decision.id, version)) {
        throw new WorkflowConflict(`Decision ${valid.decision.id}@${version} already exists as a legacy row without source metadata`)
      }
      this.ledger.append(valid.decision, expectedVersion > 0 ? { expectedVersion } : {})
      this.db.prepare(`INSERT INTO assistant_decision_versions
        (id, version, project_id, source_message_id, source_text_digest, conversation_id, actor_ref,
         recorded_at, revoked_by, value_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        valid.decision.id, version, valid.decision.scope.projectId, valid.sourceMessageId, valid.sourceTextDigest,
        valid.conversationId, valid.actorRef, valid.recordedAt, valid.revokedBy ?? null, valueDigest,
      )
      return { record: valid, replayed: false }
    })
  }

  /** Old ledger rows stay auditable but are explicitly marked legacy; they are not valid memory. */
  legacyDecisions(query: AssistantStateQuery): { records: readonly LegacyDecisionRecord[]; nextCursor?: string } {
    const limit = limitOf(query.limit, 50, 200)
    const cursor = parseCursor(query.cursor)
    const args: unknown[] = [query.projectId]
    let cursorClause = ''
    if (cursor) {
      cursorClause = 'AND (d.created_at < ? OR (d.created_at = ? AND d.id < ?))'
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`SELECT d.id, d.version, d.value, d.created_at FROM user_decision_versions d
      LEFT JOIN assistant_decision_versions m ON m.id = d.id AND m.version = d.version
      WHERE d.project_id = ? AND m.id IS NULL AND d.version = (
        SELECT MAX(x.version) FROM user_decision_versions x WHERE x.id = d.id)
      ${cursorClause}
      ORDER BY d.created_at DESC, d.id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const records = rows.slice(0, limit).map(row => ({
      decision: json<UserDecision>(row.value), legacy: true as const, missingSource: true as const,
    }))
    const lastRow = rows[Math.min(limit, rows.length) - 1]
    return {
      records,
      ...(rows.length > limit && lastRow ? { nextCursor: cursorOf(String(lastRow.created_at), String(lastRow.id)) } : {}),
    }
  }

  // ---- proposals -------------------------------------------------------------------------------

  private proposal(row: Row): PersistedProposal {
    return PersistedProposalSchema.parse(json<PersistedProposal>(row.value))
  }
  private proposalRow(id: string, version: number): Row | undefined {
    return this.db.prepare('SELECT * FROM assistant_proposal_versions WHERE proposal_id = ? AND version = ?').get(id, version) as Row | undefined
  }
  private immutable(a: PersistedProposal, b: PersistedProposal): boolean {
    const same = (x: unknown, y: unknown): boolean => digest(x) === digest(y)
    return a.proposalId === b.proposalId && a.projectId === b.projectId &&
      a.conversationId === b.conversationId && a.sourceMessageId === b.sourceMessageId &&
      a.sourceTextDigest === b.sourceTextDigest && a.actorRef === b.actorRef &&
      a.grantId === b.grantId && same(a.grantScope, b.grantScope) && same(a.contract, b.contract) &&
      same(a.payload, b.payload) && a.payloadDigest === b.payloadDigest &&
      a.createdAt === b.createdAt && a.expiresAt === b.expiresAt
  }

  proposalGet(id: string): PersistedProposal | undefined {
    const row = this.db.prepare('SELECT * FROM assistant_proposal_versions WHERE proposal_id = ? ORDER BY version DESC LIMIT 1').get(id) as Row | undefined
    return row ? this.proposal(row) : undefined
  }
  proposalList(query: AssistantStateQuery): AssistantStatePage<PersistedProposal> {
    const limit = limitOf(query.limit, 50, 200)
    const cursor = parseCursor(query.cursor)
    const args: unknown[] = [query.projectId]
    let cursorClause = ''
    if (cursor) {
      cursorClause = 'AND (p.updated_at < ? OR (p.updated_at = ? AND p.proposal_id < ?))'
      args.push(cursor.at, cursor.at, cursor.id)
    }
    const rows = this.db.prepare(`SELECT p.* FROM assistant_proposal_versions p
      WHERE p.project_id = ? AND p.version = (
        SELECT MAX(x.version) FROM assistant_proposal_versions x WHERE x.proposal_id = p.proposal_id)
      ${cursorClause}
      ORDER BY p.updated_at DESC, p.proposal_id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const records = rows.slice(0, limit).map(row => this.proposal(row))
    const last = records.at(-1)
    return {
      records,
      ...(rows.length > limit && last ? { nextCursor: cursorOf(last.updatedAt, last.proposalId) } : {}),
    }
  }
  proposalHistory(id: string, limit = 50): readonly PersistedProposal[] {
    const rows = this.db.prepare('SELECT * FROM assistant_proposal_versions WHERE proposal_id = ? ORDER BY version DESC LIMIT ?')
      .all(id, limitOf(limit, 50, 200)) as Row[]
    return rows.map(row => this.proposal(row))
  }
  proposalPut(record: PersistedProposal, expectedVersion: number): { record: PersistedProposal; replayed: boolean } {
    let valid: PersistedProposal
    try { valid = PersistedProposalSchema.parse(record) } catch (error) {
      throw new WorkflowConflict(`PersistedProposal failed contract validation: ${String(error)}`)
    }
    if (expectedVersion < 0) throw new WorkflowConflict('expectedVersion must not be negative')
    if (expectedVersion === 0 && valid.version !== 1) throw new WorkflowConflict('A new proposal must be version 1')
    if (expectedVersion > 0 && valid.version !== expectedVersion + 1) throw new WorkflowConflict('A proposal update must advance exactly one version')
    if (digest(valid.payload) !== valid.payloadDigest) throw new WorkflowConflict('Proposal payloadDigest does not match its payload')
    const valueDigest = digest(valid)
    return this.uow.atomic(() => {
      const existing = this.proposalRow(valid.proposalId, valid.version)
      if (existing) {
        if (String(existing.digest) !== valueDigest) throw new WorkflowConflict(`Proposal ${valid.proposalId}@${valid.version} already exists with a different body`)
        return { record: this.proposal(existing), replayed: true }
      }
      if (valid.version > 1) {
        const previous = this.proposalGet(valid.proposalId)
        if (!previous || previous.version !== valid.version - 1)
          throw new WorkflowConflict(`Proposal ${valid.proposalId}@${valid.version} requires its previous version`)
        if (!this.immutable(previous, valid))
          throw new WorkflowConflict('A proposal revision cannot change its source, grant, contract, payload or identity')
      }
      this.db.prepare(`INSERT INTO assistant_proposal_versions
        (proposal_id, version, state, project_id, conversation_id, source_message_id, source_text_digest,
         actor_ref, grant_id, payload_digest, created_at, expires_at, updated_at, effect_command_id,
         superseded_by, value, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        valid.proposalId, valid.version, valid.state, valid.projectId, valid.conversationId, valid.sourceMessageId,
        valid.sourceTextDigest, valid.actorRef, valid.grantId, valid.payloadDigest, valid.createdAt, valid.expiresAt,
        valid.updatedAt, valid.effectCommandId ?? null, valid.supersededBy ?? null, JSON.stringify(valid), valueDigest,
      )
      return { record: valid, replayed: false }
    })
  }
}
