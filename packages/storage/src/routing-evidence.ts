/**
 * Wave-05 A1 routing evidence: immutable RouteAdvice, ReviewEvidence and ExecutionOutcome records
 * over the shared product UnitOfWork. The port is a fact store only; eligibility, review validity,
 * acceptance and currentness remain with C/main/E. No arbitrary HTTP write entry is created here.
 */
import type Database from 'better-sqlite3'
import {
  ExecutionOutcomeSchema, ReviewEvidenceSchema, RouteAdviceSchema,
} from '@personal-agent/contracts'
import type {
  ExecutionOutcome, ExecutionProfileRef, ReviewEvidence, ReviewSubject, RouteAdvice,
  RoutingEvidencePage, RoutingEvidencePort, RoutingEvidenceQuery,
} from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'

type Row = Record<string, unknown>
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))
const limitOf = (value: number | undefined, fallback: number, max: number): number =>
  Math.max(1, Math.min(max, Math.trunc(value ?? fallback)))
const parseCursor = (cursor: string | undefined): { at: string; id: string } | undefined => {
  if (!cursor) return undefined
  const separator = cursor.indexOf('\u0000')
  if (separator < 1) throw new WorkflowConflict('Invalid routing-evidence cursor')
  return { at: cursor.slice(0, separator), id: cursor.slice(separator + 1) }
}
const cursorOf = (at: string, id: string): string => `${at}\u0000${id}`
const projectOf = (value: string): string => {
  if (!value || value.length > 256) throw new WorkflowConflict('projectId is required')
  return value
}
const page = <T>(rows: Row[], limit: number, parse: (row: Row) => T, at: string): RoutingEvidencePage<T> => {
  const records = rows.slice(0, limit).map(parse)
  const last = records.at(-1)
  const lastRow = rows[Math.min(limit, rows.length) - 1]
  return {
    records,
    ...(rows.length > limit && last && lastRow ? { nextCursor: cursorOf(atOf(lastRow, at), String(lastRow.id)) } : {}),
  }
}
const atOf = (row: Row, column: string): string => String(row[column])

export interface RoutingEvidenceSources {
  attempt: {
    attemptId: string
    ticketId: string
    assignmentId: string
    fenceEpoch: number
    contract: unknown
    state: string
    source?: string
    runnerIdentityRef?: string
  }
  verifications: readonly {
    id: string; ticketId: string; assignmentId: string; candidateGeneration: number; artifactDigest: string;
    criteriaDigest: string; environmentRef: string; verifierIdentityRef: string; createdAt: string
  }[]
  acceptances: readonly {
    id: string; ticketId: string; assignmentId: string; candidateGeneration: number; artifactDigest: string;
    criterionIds: readonly string[]; actorRef: string; acceptedAt: string
  }[]
  observations: readonly { factId: string; kind: string; disposition: string; observedAt: string; detail: unknown }[]
  usage: { completeness: 'observed' | 'partial' | 'unknown'; observedAt?: string }
}

/** Read-only source projection; it never creates an outcome or claims an artifact belongs to a work. */
export class RoutingEvidence implements RoutingEvidencePort {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) {
    this.db = db
    this.uow = uow
  }

  private insert(table: string, columns: readonly string[], values: readonly unknown[]): void {
    this.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values)
  }

  advice = {
    put: (record: RouteAdvice): { record: RouteAdvice; replayed: boolean } => {
      let valid: RouteAdvice
      try { valid = RouteAdviceSchema.parse(record) } catch (error) { throw new WorkflowConflict(`RouteAdvice failed contract validation: ${String(error)}`) }
      const valueDigest = digest(valid)
      return this.uow.atomic(() => {
        const existing = this.db.prepare('SELECT * FROM route_advice WHERE id = ?').get(valid.id) as Row | undefined
        if (existing) {
          if (String(existing.digest) !== valueDigest) throw new WorkflowConflict(`RouteAdvice ${valid.id} already exists with a different body`)
          return { record: json<RouteAdvice>(existing.value), replayed: true }
        }
        this.insert('route_advice', ['id', 'project_id', 'created_at', 'expires_at', 'source_ref', 'value', 'digest'],
          [valid.id, valid.projectId, valid.createdAt, valid.expiresAt, valid.sourceRef, JSON.stringify(valid), valueDigest])
        return { record: valid, replayed: false }
      })
    },
    get: (id: string): RouteAdvice | undefined => {
      const row = this.db.prepare('SELECT value FROM route_advice WHERE id = ?').get(id) as Row | undefined
      return row ? json<RouteAdvice>(row.value) : undefined
    },
    list: (query: RoutingEvidenceQuery): RoutingEvidencePage<RouteAdvice> => this.listAdvice(query),
  }

  reviews = {
    put: (record: ReviewEvidence): { record: ReviewEvidence; replayed: boolean } => {
      let valid: ReviewEvidence
      try { valid = ReviewEvidenceSchema.parse(record) } catch (error) { throw new WorkflowConflict(`ReviewEvidence failed contract validation: ${String(error)}`) }
      const valueDigest = digest(valid)
      const subjectDigest = digest(valid.subject)
      return this.uow.atomic(() => {
        const existing = this.db.prepare('SELECT * FROM review_evidence WHERE id = ?').get(valid.id) as Row | undefined
        if (existing) {
          if (String(existing.digest) !== valueDigest) throw new WorkflowConflict(`ReviewEvidence ${valid.id} already exists with a different body`)
          return { record: json<ReviewEvidence>(existing.value), replayed: true }
        }
        this.insert('review_evidence', ['id', 'project_id', 'subject_digest', 'subject_value', 'layer', 'disposition', 'observed_at', 'report_artifact_ref', 'value', 'digest'],
          [valid.id, valid.projectId, subjectDigest, JSON.stringify(valid.subject), valid.layer, valid.disposition, valid.observedAt,
            valid.reportArtifactRef, JSON.stringify(valid), valueDigest])
        return { record: valid, replayed: false }
      })
    },
    get: (id: string): ReviewEvidence | undefined => {
      const row = this.db.prepare('SELECT value FROM review_evidence WHERE id = ?').get(id) as Row | undefined
      return row ? json<ReviewEvidence>(row.value) : undefined
    },
    list: (query: RoutingEvidenceQuery & { subject?: ReviewSubject }): RoutingEvidencePage<ReviewEvidence> => this.listReviews(query),
  }

  outcomes = {
    put: (record: ExecutionOutcome): { record: ExecutionOutcome; replayed: boolean } => {
      let valid: ExecutionOutcome
      try { valid = ExecutionOutcomeSchema.parse(record) } catch (error) { throw new WorkflowConflict(`ExecutionOutcome failed contract validation: ${String(error)}`) }
      const valueDigest = digest(valid)
      return this.uow.atomic(() => {
        const existing = this.db.prepare('SELECT * FROM execution_outcome WHERE id = ?').get(valid.id) as Row | undefined
        if (existing) {
          if (String(existing.digest) !== valueDigest) throw new WorkflowConflict(`ExecutionOutcome ${valid.id} already exists with a different body`)
          return { record: json<ExecutionOutcome>(existing.value), replayed: true }
        }
        this.insert('execution_outcome', ['id', 'project_id', 'profile_key', 'attempt_key', 'layer', 'acceptance', 'observed_at', 'value', 'digest'],
          [valid.id, valid.projectId, digest(valid.profileRef), digest(valid.attempt), valid.layer, valid.acceptance,
            valid.observedAt, JSON.stringify(valid), valueDigest])
        return { record: valid, replayed: false }
      })
    },
    get: (id: string): ExecutionOutcome | undefined => {
      const row = this.db.prepare('SELECT value FROM execution_outcome WHERE id = ?').get(id) as Row | undefined
      return row ? json<ExecutionOutcome>(row.value) : undefined
    },
    list: (query: RoutingEvidenceQuery & { profile?: ExecutionProfileRef }): RoutingEvidencePage<ExecutionOutcome> => this.listOutcomes(query),
  }

  private listAdvice(query: RoutingEvidenceQuery): RoutingEvidencePage<RouteAdvice> {
    const project = projectOf(query.projectId)
    const limit = limitOf(query.limit, 50, 200)
    const cursor = parseCursor(query.cursor)
    const args: unknown[] = [project]
    let clause = ''
    if (cursor) { clause = 'AND (created_at < ? OR (created_at = ? AND id < ?))'; args.push(cursor.at, cursor.at, cursor.id) }
    const rows = this.db.prepare(`SELECT * FROM route_advice WHERE project_id = ? ${clause}
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    return page(rows, limit, row => json<RouteAdvice>(row.value), 'created_at')
  }
  private listReviews(query: RoutingEvidenceQuery & { subject?: ReviewSubject }): RoutingEvidencePage<ReviewEvidence> {
    const project = projectOf(query.projectId)
    const limit = limitOf(query.limit, 50, 200)
    const cursor = parseCursor(query.cursor)
    const args: unknown[] = [project]
    const where = ['project_id = ?']
    if (query.subject) { where.push('subject_digest = ?'); args.push(digest(query.subject)) }
    if (cursor) { where.push('(observed_at < ? OR (observed_at = ? AND id < ?))'); args.push(cursor.at, cursor.at, cursor.id) }
    const rows = this.db.prepare(`SELECT * FROM review_evidence WHERE ${where.join(' AND ')}
      ORDER BY observed_at DESC, id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    return page(rows, limit, row => json<ReviewEvidence>(row.value), 'observed_at')
  }
  private listOutcomes(query: RoutingEvidenceQuery & { profile?: ExecutionProfileRef }): RoutingEvidencePage<ExecutionOutcome> {
    const project = projectOf(query.projectId)
    const limit = limitOf(query.limit, 50, 200)
    const cursor = parseCursor(query.cursor)
    const args: unknown[] = [project]
    const where = ['project_id = ?']
    if (query.profile) { where.push('profile_key = ?'); args.push(digest(query.profile)) }
    if (cursor) { where.push('(observed_at < ? OR (observed_at = ? AND id < ?))'); args.push(cursor.at, cursor.at, cursor.id) }
    const rows = this.db.prepare(`SELECT * FROM execution_outcome WHERE ${where.join(' AND ')}
      ORDER BY observed_at DESC, id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    return page(rows, limit, row => json<ExecutionOutcome>(row.value), 'observed_at')
  }

  /**
   * Source projection for main's trusted outcome producer. It returns only existing storage facts;
   * an absent usage fact stays `unknown` and an artifact digest never proves artifact presence.
   */
  sources(attemptId: string, projectId: string): RoutingEvidenceSources | undefined {
    const project = projectOf(projectId)
    const bindingRow = this.db.prepare('SELECT value FROM runtime_bindings WHERE attempt_id = ?').get(attemptId) as Row | undefined
    if (!bindingRow) return undefined
    const binding = json<Record<string, unknown>>(bindingRow.value)
    const contract = binding.contract as { workId?: string } | undefined
    const work = contract?.workId ? this.db.prepare('SELECT project_id FROM works WHERE id = ?').get(contract.workId) as Row | undefined : undefined
    if (!work || String(work.project_id) !== project) return undefined
    const ticketId = String(binding.ticketId ?? '')
    const assignmentId = String(binding.assignmentId ?? '')
    const verifications = (this.db.prepare(`SELECT id, ticket_id, assignment_id, candidate_generation, artifact_digest,
      criteria_digest, environment_ref, verifier_identity_ref, created_at FROM completion_verifications
      WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 50`).all(ticketId) as Row[]).map(row => ({
      id: String(row.id), ticketId: String(row.ticket_id), assignmentId: String(row.assignment_id),
      candidateGeneration: Number(row.candidate_generation), artifactDigest: String(row.artifact_digest),
      criteriaDigest: String(row.criteria_digest), environmentRef: String(row.environment_ref),
      verifierIdentityRef: String(row.verifier_identity_ref), createdAt: String(row.created_at),
    }))
    const acceptances = (this.db.prepare(`SELECT id, ticket_id, assignment_id, candidate_generation, artifact_digest,
      criterion_ids, actor_ref, accepted_at FROM completion_acceptances WHERE ticket_id = ?
      ORDER BY accepted_at DESC LIMIT 50`).all(ticketId) as Row[]).map(row => ({
      id: String(row.id), ticketId: String(row.ticket_id), assignmentId: String(row.assignment_id),
      candidateGeneration: Number(row.candidate_generation), artifactDigest: String(row.artifact_digest),
      criterionIds: json<string[]>(row.criterion_ids), actorRef: String(row.actor_ref), acceptedAt: String(row.accepted_at),
    }))
    const observations = (this.db.prepare(`SELECT fact_id, kind, disposition, observed_at, detail
      FROM runtime_observations WHERE attempt_id = ? ORDER BY observed_at DESC LIMIT 200`).all(attemptId) as Row[]).map(row => ({
      factId: String(row.fact_id), kind: String(row.kind), disposition: String(row.disposition),
      observedAt: String(row.observed_at), detail: json<unknown>(row.detail),
    }))
    const usageRow = observations.find(item => item.kind === 'usage.observed')
    const usageDetail = usageRow?.detail as { completeness?: string } | undefined
    const completeness = usageDetail?.completeness === 'observed' || usageDetail?.completeness === 'partial'
      ? usageDetail.completeness : 'unknown'
    return {
      attempt: {
        attemptId, ticketId, assignmentId,
        fenceEpoch: Number(binding.fenceEpoch ?? binding.fence_epoch ?? 0),
        contract: binding.contract,
        state: String(binding.state), ...(typeof binding.source === 'string' ? { source: binding.source } : {}),
        ...(typeof binding.runnerIdentityRef === 'string' ? { runnerIdentityRef: binding.runnerIdentityRef } : {}),
      },
      verifications, acceptances, observations,
      usage: { completeness, ...(usageRow ? { observedAt: usageRow.observedAt } : {}) },
    }
  }
}
