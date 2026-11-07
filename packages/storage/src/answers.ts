/**
 * Answer persistence (DATA-07's storage half, in coordination with the WP-05 QuestionBroker).
 * An answer is recorded once per answer ID with a payload digest, and every native target gets
 * exactly one delivery row — the primary key (answer_id, target_binding_id) makes a second
 * delivery path for the same target impossible. Recovery reads the per-target rows back instead
 * of inferring success from the answer text, and an expired target stays expired.
 */
import type Database from 'better-sqlite3'
import type { AnswerDelivery } from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'

/** Destination statuses owned by the contracts: never synthesize `native_applied` from a local write. */
export type DeliveryStatus = AnswerDelivery['status']

export class AnswerConflict extends Error {}

type Row = Record<string, unknown>

export interface RecordedAnswer { alreadyRecorded: boolean }

export class Answers {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  constructor(db: Database.Database, uow: UnitOfWork) { this.db = db; this.uow = uow }

  /**
   * Records an answer for a question version in one transaction with its per-target delivery
   * rows written by the caller; a replay with the same digest deduplicates, a different digest
   * for the same answer ID is refused.
   */
  record(answerId: string, input: { questionId: string; expectedVersion: number; digest: string; answer: unknown }): RecordedAnswer {
    return this.uow.atomic(() => {
      const row = this.db.prepare('SELECT answer_digest FROM answers WHERE answer_id = ?').get(answerId) as Row | undefined
      if (row) {
        if (String(row.answer_digest) !== input.digest) throw new AnswerConflict(`Answer ${answerId} was recorded with a different payload digest`)
        return { alreadyRecorded: true }
      }
      this.db.prepare('INSERT INTO answers (answer_id, question_id, expected_version, answer_digest, answer, recorded_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(answerId, input.questionId, input.expectedVersion, input.digest, JSON.stringify(input.answer), new Date().toISOString())
      return { alreadyRecorded: false }
    })
  }

  get(answerId: string): { questionId: string; expectedVersion: number; digest: string; answer: unknown; recordedAt: string } | undefined {
    const row = this.db.prepare('SELECT * FROM answers WHERE answer_id = ?').get(answerId) as Row | undefined
    if (!row) return undefined
    return {
      questionId: String(row.question_id),
      expectedVersion: Number(row.expected_version),
      digest: String(row.answer_digest),
      answer: JSON.parse(String(row.answer)),
      recordedAt: String(row.recorded_at),
    }
  }

  /** Upserts the single delivery row of one target; status only moves forward through the contracts' states. */
  upsertDelivery(answerId: string, targetBindingId: string, status: DeliveryStatus, evidence?: string): void {
    this.db.prepare(`INSERT INTO answer_deliveries (answer_id, target_binding_id, status, evidence, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(answer_id, target_binding_id) DO UPDATE SET status = excluded.status, evidence = excluded.evidence, updated_at = excluded.updated_at`)
      .run(answerId, targetBindingId, status, evidence ?? null, new Date().toISOString())
  }

  deliveries(answerId: string): AnswerDelivery[] {
    return (this.db.prepare('SELECT * FROM answer_deliveries WHERE answer_id = ? ORDER BY target_binding_id').all(answerId) as Row[]).map(row => {
      const evidence = row.evidence === null ? [] : [String(row.evidence)]
      return {
        answerId: String(row.answer_id),
        targetBindingId: String(row.target_binding_id),
        status: String(row.status) as DeliveryStatus,
        evidenceRefs: evidence,
      }
    })
  }
}
