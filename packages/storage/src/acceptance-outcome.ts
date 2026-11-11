/**
 * A2 wave-06: deterministic acceptance-event projection. The main application's accepted event is
 * evidence, not a new acceptance command. This module rebuilds an ExecutionOutcome only when every
 * candidate/attempt/profile/verification/acceptance source exists; otherwise it returns an explicit
 * gap and writes nothing. It never emits a second accepted event or invents timing/usage.
 */
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  CandidateRefSchema, EvidenceLayerSchema, ExecutionOutcomeSchema, ReviewTimingSchema,
} from '@personal-agent/contracts'
import type { CandidateRef, ExecutionOutcome, ExecutionProfileRef } from '@personal-agent/contracts'
import { UnitOfWork } from './uow.ts'
import { WorkflowConflict } from './workflow-errors.ts'
import { RoutingEvidence } from './routing-evidence.ts'

type Row = Record<string, unknown>
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
type EvidenceLayer = ExecutionOutcome['layer']

export interface AcceptanceProjectionInput {
  /** Sequence of the existing application.candidate.accepted event. */
  eventSeq: number
  projectId: string
  /** Trusted main producer supplies the exact profile identity; it is not inferred from a brand. */
  profileRef: ExecutionProfileRef
  /** Trusted producer's declared evidence layer; no model/native text can promote it. */
  layer: EvidenceLayer
}

export type AcceptanceProjectionResult =
  | { status: 'recorded' | 'replayed'; outcome: ExecutionOutcome }
  | { status: 'incomplete'; eventSeq: number; reasons: readonly string[] }
  | { status: 'conflict'; eventSeq: number; reasons: readonly string[] }

const unique = (values: readonly string[]): string[] => [...new Set(values)].slice(0, 128)

export class AcceptanceOutcomeProjection {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  private readonly routing: RoutingEvidence
  constructor(db: Database.Database, uow: UnitOfWork, routing: RoutingEvidence) {
    this.db = db
    this.uow = uow
    this.routing = routing
  }

  /**
   * Projects one accepted event. The event and all source reads are synchronous; the write joins the
   * caller's UnitOfWork. Re-running the same event returns the existing deterministic outcome.
   */
  consume(input: AcceptanceProjectionInput): AcceptanceProjectionResult {
    if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq <= 0) throw new WorkflowConflict('eventSeq must be positive')
    if (!input.profileRef || typeof input.profileRef.profileId !== 'string') throw new WorkflowConflict('A trusted profileRef is required')
    EvidenceLayerSchema.parse(input.layer)
    const event = this.db.prepare('SELECT seq, topic, entity_ref, payload, at FROM event_log WHERE seq = ?').get(input.eventSeq) as Row | undefined
    if (!event) return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['event_missing'] }
    if (String(event.topic) !== 'application.candidate.accepted') return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['event_topic_mismatch'] }
    const payload = json<{ candidate?: unknown; actorRef?: unknown; reviewTiming?: unknown }>(event.payload)
    let candidate: CandidateRef
    try { candidate = CandidateRefSchema.parse(payload.candidate) } catch { return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['candidate_missing'] } }
    const work = this.db.prepare('SELECT project_id FROM works WHERE id = ?').get(candidate.contract.workId) as Row | undefined
    if (!work || String(work.project_id) !== input.projectId)
      return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['work_project_mismatch'] }
    let timing
    if (payload.reviewTiming !== undefined) {
      try { timing = ReviewTimingSchema.parse(payload.reviewTiming) } catch { return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['review_timing_invalid'] } }
    }
    const bindingRows = this.db.prepare(`SELECT value FROM runtime_bindings WHERE ticket_id = ?`).all(candidate.ticketId) as Row[]
    const bindings = bindingRows.map(row => json<Record<string, unknown>>(row.value)).filter(binding =>
      binding.assignmentId === candidate.assignmentId && binding.ticketId === candidate.ticketId &&
      binding.state === 'ended' && binding.contract && json<Record<string, unknown>>(JSON.stringify(binding.contract)).digest === candidate.contract.digest &&
      (binding.contract as { workId?: string }).workId === candidate.contract.workId &&
      (binding.contract as { revision?: number }).revision === candidate.contract.revision)
    if (bindings.length !== 1) return { status: 'incomplete', eventSeq: input.eventSeq, reasons: [bindings.length ? 'attempt_ambiguous' : 'attempt_missing'] }
    const binding = bindings[0]!
    const attemptId = String(binding.attemptId ?? '')
    const fenceEpoch = Number(binding.fenceEpoch ?? 0)
    if (!attemptId || !Number.isSafeInteger(fenceEpoch) || fenceEpoch < 1)
      return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['attempt_identity_invalid'] }
    const verification = this.db.prepare(`SELECT id, artifact_digest FROM completion_verifications
      WHERE ticket_id = ? AND assignment_id = ? AND candidate_generation = ? ORDER BY created_at DESC LIMIT 1`)
      .get(candidate.ticketId, candidate.assignmentId, candidate.candidateGeneration) as Row | undefined
    if (!verification) return { status: 'incomplete', eventSeq: input.eventSeq, reasons: ['verification_missing'] }
    const acceptance = this.db.prepare(`SELECT id, artifact_digest FROM completion_acceptances
      WHERE ticket_id = ? AND assignment_id = ? AND candidate_generation = ? AND artifact_digest = ?
      ORDER BY accepted_at DESC LIMIT 1`).get(candidate.ticketId, candidate.assignmentId, candidate.candidateGeneration, String(verification.artifact_digest)) as Row | undefined
    // Machine-only contracts may have no separate completion_acceptances row; the accepted event
    // itself is the authoritative acceptance reference in that case.
    const acceptedEventRef = `accepted-event-${input.eventSeq}`
    const acceptanceRef = acceptance ? String(acceptance.id) : acceptedEventRef
    const outcomeId = `accepted-outcome-${hash(JSON.stringify(candidate)).slice(0, 40)}`
    const evidenceRefs = unique([
      String(verification.id), acceptanceRef, acceptedEventRef,
      ...(timing ? timing.evidenceRefs : []),
    ])
    const outcome: ExecutionOutcome = ExecutionOutcomeSchema.parse({
      protocol: 'execution-outcome/1', id: outcomeId, projectId: input.projectId,
      attempt: { ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, attemptId, fenceEpoch, contract: candidate.contract },
      profileRef: input.profileRef, candidate,
      verificationRef: String(verification.id), artifactDigest: String(verification.artifact_digest),
      acceptance: 'accepted', acceptanceRef, evidenceRefs, layer: input.layer,
      usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: String(event.at),
      ...(timing ? { reviewTiming: timing } : {}),
    })
    return this.uow.atomic(() => {
      const result = this.routing.outcomes.put(outcome)
      return { status: result.replayed ? 'replayed' : 'recorded', outcome: result.record }
    })
  }
}
