/**
 * Wave-07 A2: recovery intent facts. Main owns the activation protocol and user authorization; the
 * storage owner records one immutable, idempotent plan-intent fact plus its command receipt and event
 * inside the caller's UnitOfWork. A row here is never execution authority: it cannot grant a new
 * Work, release an old writer, delete a restore marker or consume the historical queues.
 */
import type Database from 'better-sqlite3'
import { RecoveryPlanSchema } from '@personal-agent/contracts'
import type { RecoveryPlan } from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { canonicalDigest } from './ingress.ts'
import { WorkflowConflict } from './workflow-errors.ts'

type Row = Record<string, unknown>
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const digest = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))
const limitOf = (value: number | undefined, fallback: number, max: number): number =>
  Math.max(1, Math.min(max, Math.trunc(value ?? fallback)))

export interface RecoveryIntentInput {
  /** Caller command identity; the same command + body replays, a changed body conflicts. */
  commandId: string
  /** Authenticated local actor; main validates this before calling the port. */
  actor: { userId: string; authorityRef: string }
  /** The plan main prepared from the read-only inspection. */
  plan: RecoveryPlan
  /** Fingerprint the plan was prepared against; drift rejects the intent. */
  expectedInspectionFingerprint: string
  /** Current source fingerprint at commit time (normally the same inspection fingerprint). */
  sourceFingerprint: string
  /** Explicit user confirmation time; must be inside the plan's validity window. */
  confirmedAt?: string
}

export interface RecoveryIntentRecord {
  protocol: 'recovery-intent/1'
  commandId: string
  planId: string
  planDigest: string
  inspectionFingerprint: string
  sourceFingerprint: string
  userId: string
  actorRef: string
  plan: RecoveryPlan
  createdAt: string
  expiresAt: string
  /** The fact is recorded; execution authorization is still main's decision. */
  authorization: 'not_granted'
  activationAvailable: false
}

export interface RecoveryIntentPage {
  records: readonly RecoveryIntentRecord[]
  nextCursor?: string
  /** True only when fewer rows than requested remain; a capped page is not proof of absence. */
  hasMore: boolean
}

const parseCursor = (cursor: string | undefined): { at: string; id: string } | undefined => {
  if (!cursor) return undefined
  const separator = cursor.indexOf('\u0000')
  if (separator < 1) throw new WorkflowConflict('Invalid recovery-intent cursor')
  return { at: cursor.slice(0, separator), id: cursor.slice(separator + 1) }
}

/**
 * Append-only intent facts. All methods are synchronous and join the caller's existing UnitOfWork;
 * no file, socket or business dispatch happens inside the transaction.
 */
export class RecoveryIntents {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) {
    this.db = db
    this.uow = uow
  }

  private mapRow(row: Row): RecoveryIntentRecord {
    let envelope: {
      protocol?: unknown; plan?: unknown; userId?: unknown; actorRef?: unknown
      inspectionFingerprint?: unknown; sourceFingerprint?: unknown; confirmedAt?: unknown
    }
    try { envelope = json(row.payload) } catch {
      throw new WorkflowConflict(`Recovery intent ${String(row.command_id)} has an unreadable payload`)
    }
    if (envelope.protocol !== 'recovery-intent/1') throw new WorkflowConflict('Recovery intent payload has an unsupported protocol')
    let plan: RecoveryPlan
    try { plan = RecoveryPlanSchema.parse(envelope.plan) } catch (error) {
      throw new WorkflowConflict(`Recovery intent ${String(row.command_id)} does not contain a valid plan: ${String(error)}`)
    }
    const confirmedAt = typeof envelope.confirmedAt === 'string' ? envelope.confirmedAt : ''
    if (
      !confirmedAt ||
      typeof envelope.userId !== 'string' || typeof envelope.actorRef !== 'string' ||
      typeof envelope.inspectionFingerprint !== 'string' || typeof envelope.sourceFingerprint !== 'string'
    ) throw new WorkflowConflict(`Recovery intent ${String(row.command_id)} is missing its envelope identity`)
    const planDigest = digest(plan)
    // The indexed columns and the immutable payload must agree; a hand-edited row is not a fact.
    if (
      String(row.plan_id) !== plan.planId || String(row.plan_digest) !== planDigest ||
      String(row.user_id) !== envelope.userId || String(row.actor_ref) !== envelope.actorRef ||
      String(row.inspection_fingerprint) !== envelope.inspectionFingerprint ||
      String(row.source_fingerprint) !== envelope.sourceFingerprint ||
      String(row.created_at) !== confirmedAt || String(row.expires_at) !== plan.expiresAt
    ) throw new WorkflowConflict(`Recovery intent ${String(row.command_id)} row is inconsistent with its payload`)
    return {
      protocol: 'recovery-intent/1',
      commandId: String(row.command_id),
      planId: plan.planId,
      planDigest,
      inspectionFingerprint: envelope.inspectionFingerprint,
      sourceFingerprint: envelope.sourceFingerprint,
      userId: envelope.userId,
      actorRef: envelope.actorRef,
      plan,
      createdAt: confirmedAt,
      expiresAt: plan.expiresAt,
      authorization: 'not_granted',
      activationAvailable: false,
    }
  }

  /**
   * Records one intent. Exact same command/body replays the original fact; a changed body, another
   * plan under the same plan identity, a drifted inspection fingerprint or an expired plan conflicts.
   */
  record(input: RecoveryIntentInput): { record: RecoveryIntentRecord; replayed: boolean } {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.commandId)) throw new WorkflowConflict('commandId must be a stable identity')
    let plan: RecoveryPlan
    try { plan = RecoveryPlanSchema.parse(input.plan) } catch (error) { throw new WorkflowConflict(`Recovery plan failed contract validation: ${String(error)}`) }
    if (plan.authorization !== 'not_granted' || plan.commitAvailable !== false)
      throw new WorkflowConflict('A recovery plan recorded before main authorization must remain not_granted')
    if (plan.inspectionFingerprint !== input.expectedInspectionFingerprint)
      throw new WorkflowConflict('The plan was prepared against another inspection fingerprint')
    if (input.sourceFingerprint !== input.expectedInspectionFingerprint)
      throw new WorkflowConflict('The source state drifted after the plan was prepared; inspect and plan again')
    const confirmedAt = input.confirmedAt ?? new Date().toISOString()
    if (Date.parse(plan.expiresAt) <= Date.parse(confirmedAt))
      throw new WorkflowConflict('The recovery plan expired before it was recorded')
    if (!input.actor || input.actor.userId.length === 0 || input.actor.authorityRef.length === 0)
      throw new WorkflowConflict('A recovery intent requires the authenticated local actor')
    const planDigest = digest(plan)
    const payload = { protocol: 'recovery-intent/1', plan, userId: input.actor.userId, actorRef: input.actor.authorityRef,
      inspectionFingerprint: input.expectedInspectionFingerprint, sourceFingerprint: input.sourceFingerprint, confirmedAt }
    const valueDigest = digest(payload)
    return this.uow.atomic(() => {
      const existing = this.db.prepare('SELECT * FROM recovery_intents WHERE command_id = ?').get(input.commandId) as Row | undefined
      if (existing) {
        if (String(existing.digest) !== valueDigest)
          throw new WorkflowConflict(`Recovery command ${input.commandId} already recorded another intent`)
        return { record: this.mapRow(existing), replayed: true }
      }
      const samePlan = this.db.prepare('SELECT * FROM recovery_intents WHERE plan_id = ?').get(plan.planId) as Row | undefined
      if (samePlan) {
        // A second command for the exact same plan/actor/source is a replay of the one stable intent,
        // not a new authorization; a changed plan body conflicts.
        if (String(samePlan.digest) !== valueDigest)
          throw new WorkflowConflict(`Recovery plan ${plan.planId} already has a different intent`)
        return { record: this.mapRow(samePlan), replayed: true }
      }
      this.db.prepare(`INSERT INTO recovery_intents
        (command_id, plan_id, plan_digest, inspection_fingerprint, source_fingerprint, user_id, actor_ref,
         payload, digest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.commandId, plan.planId, planDigest, input.expectedInspectionFingerprint, input.sourceFingerprint,
        input.actor.userId, input.actor.authorityRef, JSON.stringify(payload), valueDigest, confirmedAt, plan.expiresAt,
      )
      return { record: this.getByPlan(plan.planId)!, replayed: false }
    })
  }

  getByPlan(planId: string): RecoveryIntentRecord | undefined {
    const row = this.db.prepare('SELECT * FROM recovery_intents WHERE plan_id = ?').get(planId) as Row | undefined
    return row ? this.mapRow(row) : undefined
  }

  getByCommand(commandId: string): RecoveryIntentRecord | undefined {
    const row = this.db.prepare('SELECT * FROM recovery_intents WHERE command_id = ?').get(commandId) as Row | undefined
    return row ? this.mapRow(row) : undefined
  }

  /** Bounded history for one exact source fingerprint; newest first with a stable cursor. */
  list(input: { sourceFingerprint?: string; limit?: number; cursor?: string } = {}): RecoveryIntentPage {
    const limit = limitOf(input.limit, 50, 200)
    const cursor = parseCursor(input.cursor)
    const args: unknown[] = []
    const where: string[] = []
    if (input.sourceFingerprint) { where.push('source_fingerprint = ?'); args.push(input.sourceFingerprint) }
    if (cursor) { where.push('(created_at < ? OR (created_at = ? AND plan_id < ?))'); args.push(cursor.at, cursor.at, cursor.id) }
    const rows = this.db.prepare(`SELECT * FROM recovery_intents${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, plan_id DESC LIMIT ?`).all(...args, limit + 1) as Row[]
    const records = rows.slice(0, limit).map(row => this.mapRow(row))
    const hasMore = rows.length > limit
    const last = records.at(-1)
    return {
      records,
      ...(hasMore && last ? { nextCursor: `${last.createdAt}\u0000${last.planId}` } : {}),
      hasMore,
    }
  }
}
