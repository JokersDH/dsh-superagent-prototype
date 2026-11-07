/**
 * Runtime observations (batch 2 of agent-tasks/g1-agent-a-runtime-state.md): durable, append-only
 * evidence of the strict runtime facts the ingress accepted, plus a read/reduce interface for the
 * composition root.
 *
 * - Every fact leaves one attempt-level observation with its identity, contract, kind, disposition,
 *   original factId/payloadRef and the host-recorded payload digest. Physical payloads additionally
 *   leave one row per resource they report.
 * - `record` must run inside the ingress transaction, so the observation commits or rolls back with
 *   the fact receipt, the core mutation and the events/effects they enqueue.
 * - Nothing here releases a resource, moves the current pointer or grants authorization. Cancel
 *   acknowledgement, process exit and writer quiescence are independent facts: the reducer never
 *   derives one from another, and an absent PID or a timeout is not evidence of anything.
 */
import type Database from 'better-sqlite3'
import type { ContractRef, CriticalFact, Json, RuntimeFactPayload } from '@personal-agent/contracts'
import type { RuntimeBindings, BindingIdentity } from './ingress.ts'
import type { UnitOfWork } from './uow.ts'

type Row = Record<string, unknown>

/** A fact ID was recorded before with a different body, contract or disposition. */
export class ObservationConflict extends Error {}

export type ObservationDisposition = 'business' | 'physical_only'

export interface ObservationInput {
  /** The strict fact as accepted by the ingress (contracts `CriticalFact`). */
  fact: CriticalFact
  /** The parsed strict payload for that fact (contracts `RuntimeFactPayload`). */
  payload: RuntimeFactPayload
  /** Whether the ingress applied a business fact or stored a physical-only observation. */
  disposition: ObservationDisposition
  /** The host-recorded canonical SHA-256 of the immutable payload value. */
  payloadSha256: string
}

export interface RuntimeObservationRow {
  factId: string
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: ContractRef
  kind: string
  disposition: ObservationDisposition
  payloadRef: string
  payloadSha256: string
  /** Normalized, non-authoritative fields (for example `{ acknowledged: true }`); the payload file holds the authoritative value. */
  detail: unknown
  /** When the host committed the observation; ordering is commit order, not a native clock. */
  observedAt: string
}

export type WriterStatus = 'active' | 'quiescent' | 'indeterminate'

export interface ResourceObservationRow {
  factId: string
  attemptId: string
  resourceRef: string
  ownership: 'spawned_process' | 'shared_service_session'
  kind: 'runtime.exited' | 'writer.observed'
  exitCode?: number | null
  signal?: string | null
  status?: WriterStatus
  observedAt: string
}

export interface ResourceObservationSummary {
  resourceRef: string
  observations: number
  last: ResourceObservationRow
  /** A process exit was observed; it says nothing about other resources or group quiescence. */
  exit: { observed: boolean; exitCode?: number | null; signal?: string | null; factId?: string }
  /** The latest writer observation for this resource, kept separate from exits and cancels. */
  writer: { observed: boolean; status?: WriterStatus; factId?: string }
  /** `observed_quiescent` only when a writer observation explicitly reported `quiescent`; never inferred. */
  quiescence: 'observed_quiescent' | 'unknown'
}

export interface AttemptObservationSummary {
  attemptId: string
  observations: number
  last?: RuntimeObservationRow
  /** Native cancel acknowledgement is a dispatch fact; it is never group quiescence. */
  cancel: { observed: boolean; acknowledged: boolean }
  resources: readonly ResourceObservationSummary[]
}

const PHYSICAL_KINDS = new Set(['cancel.observed', 'writer.observed', 'runtime.exited'])

/** Normalized, non-authoritative detail fields; payload files remain the authoritative values. */
function detailFor(payload: RuntimeFactPayload): Json {
  switch (payload.kind) {
    case 'turn.ended': return { outcome: payload.value.outcome, candidateAvailable: payload.value.candidateAvailable }
    case 'cancel.observed': return { acknowledged: payload.value.acknowledged, delivery: payload.value.dispatch.delivery }
    case 'config.changed': return { detection: payload.value.detection, previousFingerprint: payload.value.previousFingerprint, observedFingerprint: payload.value.observedFingerprint }
    case 'usage.observed': return { completeness: payload.value.completeness }
    case 'runtime.error': return { code: payload.value.code }
    case 'candidate.observed': return { artifactCount: payload.value.artifactRefs.length }
    case 'question.opened': return { questionId: payload.value.id, version: payload.value.version }
    case 'answer.observed': return { answerId: payload.value.answerId, status: payload.value.status }
    case 'policy.prepared': return { requestedPolicyRevision: payload.value.requestedPolicyRevision, enforcement: payload.value.enforcement, verification: payload.value.verification }
    case 'dispatch.observed': return { delivery: payload.value.delivery, retry: payload.value.retry }
    case 'writer.observed': return { resources: payload.value.resources.length }
    case 'runtime.exited': return { resourceRef: payload.value.resourceRef, exitCode: payload.value.exitCode, signal: payload.value.signal }
  }
}

export class RuntimeObservations {
  private readonly db: Database.Database
  private readonly uow: UnitOfWork
  private readonly bindings: RuntimeBindings
  private readonly now: () => string
  constructor(db: Database.Database, uow: UnitOfWork, bindings: RuntimeBindings, now: () => string = () => new Date().toISOString()) {
    this.db = db
    this.uow = uow
    this.bindings = bindings
    this.now = now
  }

  /**
   * Records the observation of one accepted fact and its per-resource observations inside the
   * caller's ingress transaction. An exact repeat of a recorded factId is an idempotent no-op; a
   * different body or disposition for the same factId is a conflict.
   */
  record(input: ObservationInput): void {
    if (this.uow.nesting < 1) throw new Error('Runtime observations must be recorded inside the ingress transaction')
    const { fact, payload, disposition, payloadSha256 } = input
    if (!/^[0-9a-f]{64}$/.test(payloadSha256)) throw new Error('An observation requires the host-recorded canonical SHA-256 of its payload')
    if (fact.kind !== payload.kind) throw new Error(`Runtime fact ${fact.factId} kind ${fact.kind} and payload kind ${payload.kind} disagree`)
    const existing = this.get(fact.factId)
    if (existing) {
      if (existing.payloadSha256 !== payloadSha256 || existing.kind !== payload.kind || existing.attemptId !== fact.attemptId || existing.disposition !== disposition) {
        throw new ObservationConflict(`Fact ${fact.factId} was observed with a different body, attempt or disposition`)
      }
      return
    }
    const observedAt = this.now()
    this.db.prepare(`INSERT INTO runtime_observations
      (fact_id, ticket_id, assignment_id, attempt_id, fence_epoch, contract, kind, disposition, payload_ref, payload_sha256, detail, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      fact.factId, fact.ticketId, fact.assignmentId, fact.attemptId, fact.fenceEpoch, JSON.stringify(fact.contract),
      payload.kind, disposition, fact.payloadRef, payloadSha256, JSON.stringify(detailFor(payload)), observedAt,
    )
    for (const resource of this.resourceRows(fact, payload)) {
      this.db.prepare(`INSERT INTO resource_observations (fact_id, attempt_id, resource_ref, ownership, kind, status, exit_code, signal, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        fact.factId, fact.attemptId, resource.resourceRef, resource.ownership, resource.kind,
        resource.status ?? null, resource.exitCode ?? null, resource.signal ?? null, observedAt,
      )
    }
  }

  get(factId: string): RuntimeObservationRow | undefined {
    const row = this.db.prepare('SELECT * FROM runtime_observations WHERE fact_id = ?').get(factId) as Row | undefined
    return row ? this.attemptRow(row) : undefined
  }

  /** Observations of one attempt, oldest first. */
  forAttempt(attemptId: string, limit = 100): RuntimeObservationRow[] {
    return (this.db.prepare('SELECT * FROM runtime_observations WHERE attempt_id = ? ORDER BY rowid LIMIT ?').all(attemptId, limit) as Row[])
      .map(row => this.attemptRow(row))
  }

  /** Resource observations across attempts for one resource reference, oldest first (audit only). */
  forResource(resourceRef: string, limit = 100): ResourceObservationRow[] {
    return (this.db.prepare('SELECT * FROM resource_observations WHERE resource_ref = ? ORDER BY rowid LIMIT ?').all(resourceRef, limit) as Row[])
      .map(row => this.resourceRow(row))
  }

  /** The per-resource rows one fact reported (used to verify a trusted barrier receipt). */
  forFact(factId: string): ResourceObservationRow[] {
    return (this.db.prepare('SELECT * FROM resource_observations WHERE fact_id = ? ORDER BY rowid').all(factId) as Row[])
      .map(row => this.resourceRow(row))
  }

  /**
   * Read-only reduction for the composition root: separate cancel/exit/writer facts per attempt and
   * resource. It never releases a resource or claims group quiescence; only an explicit
   * writer.observed `quiescent` makes one resource's `quiescence` observed.
   */
  summarize(attemptId: string): AttemptObservationSummary {
    const rows = (this.db.prepare('SELECT * FROM runtime_observations WHERE attempt_id = ? ORDER BY rowid').all(attemptId) as Row[]).map(row => this.attemptRow(row))
    const cancelRow = [...rows].reverse().find(row => row.kind === 'cancel.observed')
    const cancelDetail = cancelRow ? cancelRow.detail as { acknowledged?: unknown } | null : undefined
    const resourceRows = (this.db.prepare('SELECT * FROM resource_observations WHERE attempt_id = ? ORDER BY rowid').all(attemptId) as Row[]).map(row => this.resourceRow(row))
    const byResource = new Map<string, ResourceObservationRow[]>()
    for (const row of resourceRows) {
      const list = byResource.get(row.resourceRef) ?? []
      list.push(row)
      byResource.set(row.resourceRef, list)
    }
    const resources = [...byResource].map(([resourceRef, observations]): ResourceObservationSummary => {
      const last = observations[observations.length - 1]!
      const exitRows = observations.filter(row => row.kind === 'runtime.exited')
      const writerRows = observations.filter(row => row.kind === 'writer.observed')
      const lastExit = exitRows[exitRows.length - 1]
      const lastWriter = writerRows[writerRows.length - 1]
      return {
        resourceRef,
        observations: observations.length,
        last,
        exit: lastExit
          ? { observed: true, exitCode: lastExit.exitCode ?? null, signal: lastExit.signal ?? null, factId: lastExit.factId }
          : { observed: false },
        writer: lastWriter?.status ? { observed: true, status: lastWriter.status, factId: lastWriter.factId } : { observed: false },
        quiescence: lastWriter?.status === 'quiescent' ? 'observed_quiescent' : 'unknown',
      }
    })
    const last = rows[rows.length - 1]
    return {
      attemptId,
      observations: rows.length,
      ...(last ? { last } : {}),
      cancel: {
        observed: !!cancelRow,
        acknowledged: cancelRow ? cancelDetail?.acknowledged === true : false,
      },
      resources,
    }
  }

  /** The per-resource rows a physical fact reports, with ownership read from the known binding. */
  private resourceRows(fact: CriticalFact, payload: RuntimeFactPayload): {
    resourceRef: string
    ownership: 'spawned_process' | 'shared_service_session'
    kind: 'runtime.exited' | 'writer.observed'
    status?: WriterStatus
    exitCode?: number | null
    signal?: string | null
  }[] {
    if (!PHYSICAL_KINDS.has(payload.kind)) return []
    if (payload.kind === 'cancel.observed') return []
    const binding = this.bindings.binding<BindingIdentity>(fact.attemptId)
    if (!binding) throw new ObservationConflict(`Physical observation for unknown attempt ${fact.attemptId}`)
    const ownership = new Map(binding.resources.map(resource => [resource.ref, resource.ownership]))
    if (payload.kind === 'runtime.exited') {
      const declared = ownership.get(payload.value.resourceRef)
      if (!declared) throw new ObservationConflict(`Attempt ${fact.attemptId} did not register resource ${payload.value.resourceRef}`)
      return [{ resourceRef: payload.value.resourceRef, ownership: declared, kind: 'runtime.exited', exitCode: payload.value.exitCode, signal: payload.value.signal }]
    }
    if (payload.kind !== 'writer.observed') return []
    return payload.value.resources.map(resource => {
      const declared = ownership.get(resource.resourceRef)
      if (!declared || declared !== resource.ownership) {
        throw new ObservationConflict(`Attempt ${fact.attemptId} did not register resource ${resource.resourceRef} with ownership ${resource.ownership}`)
      }
      return { resourceRef: resource.resourceRef, ownership: resource.ownership, kind: 'writer.observed' as const, status: resource.status }
    })
  }

  private attemptRow(row: Row): RuntimeObservationRow {
    return {
      factId: String(row.fact_id),
      ticketId: String(row.ticket_id),
      assignmentId: String(row.assignment_id),
      attemptId: String(row.attempt_id),
      fenceEpoch: Number(row.fence_epoch),
      contract: JSON.parse(String(row.contract)) as ContractRef,
      kind: String(row.kind),
      disposition: String(row.disposition) as ObservationDisposition,
      payloadRef: String(row.payload_ref),
      payloadSha256: String(row.payload_sha256),
      detail: JSON.parse(String(row.detail)) as unknown,
      observedAt: String(row.observed_at),
    }
  }

  private resourceRow(row: Row): ResourceObservationRow {
    const kind = String(row.kind) as ResourceObservationRow['kind']
    return {
      factId: String(row.fact_id),
      attemptId: String(row.attempt_id),
      resourceRef: String(row.resource_ref),
      ownership: String(row.ownership) as ResourceObservationRow['ownership'],
      kind,
      ...(kind === 'runtime.exited'
        ? { exitCode: row.exit_code === null ? null : Number(row.exit_code), signal: row.signal === null ? null : String(row.signal) }
        : {}),
      ...(row.status === null ? {} : { status: String(row.status) as WriterStatus }),
      observedAt: String(row.observed_at),
    }
  }
}
