/**
 * Trusted completion evidence (WP-04, batch 2 + admission fixes): an implementation of the core
 * `CompletionVerifier` port that resolves Verification, candidate-bound quiescence and human
 * acceptance from immutable records on the same database connection, synchronously and read-only.
 *
 * Quiescence is not derived from writer observations. It consumes the trusted host barrier receipt
 * (`confirmOwnedQuiescence` in the coordinator composition) and re-verifies, against the database:
 * the full registered resource manifest digest, the ended binding with the same attempt/contract
 * identity, the `runtime.barrier.confirmed` event, and the host-derived writer fact whose
 * per-resource rows must cover **every** registered resource with explicit `quiescent` status.
 * A caller-selected subset, a changed manifest, a newer epoch/contract or an ordinary observation
 * cannot produce or keep completion evidence.
 *
 * It never decides completion and never manufactures proof: `resolve` returns `undefined` for any
 * missing, stale or mismatched record.
 */
import type Database from 'better-sqlite3'
import { VerificationSchema } from '@personal-agent/contracts'
import type { CandidateRef, CompletionProposal, ContractRef, Verification } from '@personal-agent/contracts'
import type { CompletionEvidence, CompletionVerifier } from '@personal-agent/orchestrator-core'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'

type Row = Record<string, unknown>

export class EvidenceConflict extends Error {}
/** The record body failed strict validation or is inconsistent with the trusted barrier. */
export class InvalidEvidence extends Error {}
/** The requested quiescence is not proven by a trusted complete-inventory barrier receipt. */
export class QuiescenceUnavailable extends Error {}

/** The trusted host barrier receipt returned by `confirmOwnedQuiescence` (structural; no coordinator import). */
export interface BarrierReceipt {
  scope: 'registered_owned_resources_only'
  attemptId: string
  proofRef: string
  resourceManifestDigest: string
  confirmedEventSeq: number
  writerFactId?: string
}

export interface QuiescenceInput {
  /** Stable record ID, chosen by the trusted composition root. */
  id: string
  candidate: CandidateRef
  artifactDigest: string
  /** The runtime attempt whose resources the barrier covered. */
  attemptId: string
  /** The trusted barrier receipt; writer observations alone are not proof. */
  barrier: BarrierReceipt
}

export interface AcceptanceInput {
  id: string
  candidate: CandidateRef
  artifactDigest: string
  criterionIds: readonly string[]
  /** The authenticated actor who accepted; a separate source from machine results. */
  actorRef: string
}

interface StoredQuiescenceEvidence {
  manifestDigest: string
  proofRef: string
  confirmedEventSeq: number
  writerFactId?: string
  resources: { resourceRef: string; factId: string }[]
}

interface BindingView {
  attemptId: string
  ticketId: string
  assignmentId: string
  contract: ContractRef
  state: string
  fenceEpoch: number
  runnerIdentityRef: string
  source: string
  resources: readonly { ref: string; ownership: string }[]
}

const candidateOf = (row: Row): CandidateRef => ({
  ticketId: String(row.ticket_id),
  assignmentId: String(row.assignment_id),
  candidateGeneration: Number(row.candidate_generation),
  contract: JSON.parse(String(row.contract)) as ContractRef,
})

const sameCandidate = (a: CandidateRef, b: CandidateRef): boolean =>
  a.ticketId === b.ticketId && a.assignmentId === b.assignmentId && a.candidateGeneration === b.candidateGeneration
  && a.contract.workId === b.contract.workId && a.contract.revision === b.contract.revision && a.contract.digest === b.contract.digest

const sameContract = (a: ContractRef, b: ContractRef): boolean =>
  !!a && !!b && a.workId === b.workId && a.revision === b.revision && a.digest === b.digest

/** Canonical digest of a registered `(ref, ownership)` manifest, as the host barrier computes it. */
export function manifestDigest(resources: readonly { ref: string; ownership: string }[]): string {
  return canonicalDigest(
    resources.map(resource => ({ ref: resource.ref, ownership: resource.ownership })).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) as never,
  )
}

const verificationOf = (row: Row): Verification => ({
  ticketId: String(row.ticket_id),
  assignmentId: String(row.assignment_id),
  candidateGeneration: Number(row.candidate_generation),
  contract: JSON.parse(String(row.contract)) as ContractRef,
  id: String(row.id),
  artifactDigest: String(row.artifact_digest),
  criteriaDigest: String(row.criteria_digest),
  environmentRef: String(row.environment_ref),
  verifierIdentityRef: String(row.verifier_identity_ref),
  results: JSON.parse(String(row.results)) as Verification['results'],
})
const digestOf = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)) as never)
const row = (db: Database.Database, sql: string, ...args: unknown[]): Row | undefined =>
  db.prepare(sql).get(...args) as Row | undefined

export class CompletionEvidenceStore implements CompletionVerifier {
  private readonly db: Database.Database
  private readonly store: ProductStore
  constructor(store: ProductStore) {
    this.store = store
    this.db = store.db
  }

  /**
   * Records a Verification immutably; strict validation on intake; an identical replay is a no-op.
   * The write joins the caller's UnitOfWork, so a receipt/event/effect and this record commit together.
   */
  recordVerification(verification: Verification): void {
    let valid: Verification
    try { valid = VerificationSchema.parse(verification) } catch (error) {
      throw new InvalidEvidence(`Verification ${String(verification?.id)} failed strict contract validation: ${String(error)}`)
    }
    this.store.uow.atomic(() => {
      const existing = row(this.db, 'SELECT * FROM completion_verifications WHERE id = ?', valid.id)
      if (existing) {
        if (digestOf(verificationOf(existing)) !== digestOf(valid)) throw new EvidenceConflict(`Verification ${valid.id} already exists with a different body`)
        return
      }
      this.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        valid.id, valid.ticketId, valid.assignmentId, valid.candidateGeneration, JSON.stringify(valid.contract),
        valid.artifactDigest, valid.criteriaDigest, valid.environmentRef, valid.verifierIdentityRef,
        JSON.stringify(valid.results), new Date().toISOString(),
      )
    })
  }

  /**
   * Records candidate-bound quiescence only from a trusted complete-inventory barrier receipt that
   * is re-verified against the ended binding, the exact registered manifest, the barrier event and
   * the host-derived writer fact covering every registered resource.
   */
  recordQuiescence(input: QuiescenceInput): void {
    if (!/^[a-f0-9]{64}$/.test(input.artifactDigest)) throw new QuiescenceUnavailable('Quiescence must bind a frozen artifact digest')
    const barrier = input.barrier
    if (!barrier || barrier.scope !== 'registered_owned_resources_only') throw new QuiescenceUnavailable('Quiescence requires a trusted owned-resources barrier receipt')
    if (barrier.attemptId !== input.attemptId) throw new QuiescenceUnavailable('The barrier receipt names another attempt')
    const binding = this.store.bindings.binding<BindingView>(barrier.attemptId)
    if (!binding) throw new QuiescenceUnavailable(`Unknown runtime attempt ${barrier.attemptId}`)
    if (binding.ticketId !== input.candidate.ticketId || binding.assignmentId !== input.candidate.assignmentId || !sameContract(binding.contract, input.candidate.contract)) {
      throw new QuiescenceUnavailable('The barrier receipt does not belong to the candidate assignment/contract')
    }
    if (binding.state !== 'ended') throw new QuiescenceUnavailable('The barrier receipt requires the attempt binding to be ended')
    const current = this.store.bindings.current<BindingView>(input.candidate.ticketId)
    if (!current || current.attemptId !== barrier.attemptId) throw new QuiescenceUnavailable('The barrier attempt is not the current registration for this ticket')
    if (manifestDigest(binding.resources) !== barrier.resourceManifestDigest) throw new QuiescenceUnavailable('The barrier manifest no longer matches the registered resources')
    const event = this.eventAt(barrier.confirmedEventSeq)
    if (!event || !this.barrierEventValid(event, barrier.attemptId, barrier, binding, input.candidate.contract)) {
      throw new QuiescenceUnavailable('The barrier event does not match the receipt, producer, command result or contract')
    }
    const resources: { resourceRef: string; factId: string }[] = []
    if (!binding.resources.length && barrier.writerFactId) throw new QuiescenceUnavailable('An empty registered manifest cannot cite a writer fact')
    if (binding.resources.length) {
      if (!barrier.writerFactId) throw new QuiescenceUnavailable('A non-empty resource manifest needs the host-derived writer fact')
      const fact = this.store.facts.get(barrier.writerFactId)
      const observation = this.store.observations.get(barrier.writerFactId)
      if (!fact || !observation || observation.kind !== 'writer.observed' || observation.attemptId !== barrier.attemptId) {
        throw new QuiescenceUnavailable('The host-derived writer fact is missing for this attempt')
      }
      const rows = this.store.observations.forFact(barrier.writerFactId)
      for (const resource of binding.resources) {
        const proving = rows.find(item => item.resourceRef === resource.ref && item.ownership === resource.ownership && item.kind === 'writer.observed' && item.status === 'quiescent')
        if (!proving) throw new QuiescenceUnavailable(`Registered resource ${resource.ref} is not proven quiescent by the barrier fact`)
        resources.push({ resourceRef: resource.ref, factId: proving.factId })
      }
    }
    const evidence: StoredQuiescenceEvidence = {
      manifestDigest: barrier.resourceManifestDigest, proofRef: barrier.proofRef, confirmedEventSeq: barrier.confirmedEventSeq,
      ...(barrier.writerFactId ? { writerFactId: barrier.writerFactId } : {}), resources,
    }
    const existing = this.quiescenceById(input.id)
    this.store.uow.atomic(() => {
      if (existing) {
        if (digestOf(existing) !== digestOf({ candidate: input.candidate, artifactDigest: input.artifactDigest, attemptId: barrier.attemptId, evidence })) {
          throw new EvidenceConflict(`Quiescence ${input.id} already exists with a different body`)
        }
        return
      }
      this.db.prepare(`INSERT INTO completion_quiescence
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, attempt_id, resource_refs, evidence, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.id, input.candidate.ticketId, input.candidate.assignmentId, input.candidate.candidateGeneration,
        JSON.stringify(input.candidate.contract), input.artifactDigest, barrier.attemptId,
        JSON.stringify(binding.resources.map(resource => resource.ref)), JSON.stringify(evidence), new Date().toISOString(),
      )
    })
  }

  /** Records a trusted user's acceptance of the candidate's required human criteria. */
  recordAcceptance(input: AcceptanceInput): void {
    if (!input.criterionIds.length || new Set(input.criterionIds).size !== input.criterionIds.length) throw new InvalidEvidence('Acceptance needs unique criterion IDs')
    if (!input.actorRef.trim()) throw new InvalidEvidence('Acceptance needs an authenticated actor')
    if (!/^[a-f0-9]{64}$/.test(input.artifactDigest)) throw new InvalidEvidence('Acceptance must bind a frozen artifact digest')
    const body = { candidate: input.candidate, artifactDigest: input.artifactDigest, criterionIds: [...input.criterionIds], actorRef: input.actorRef }
    this.store.uow.atomic(() => {
      const existing = this.acceptanceById(input.id)
      if (existing) {
        if (digestOf(existing) !== digestOf(body)) throw new EvidenceConflict(`Acceptance ${input.id} already exists with a different body`)
        return
      }
      this.db.prepare(`INSERT INTO completion_acceptances
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criterion_ids, actor_ref, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.id, input.candidate.ticketId, input.candidate.assignmentId, input.candidate.candidateGeneration,
        JSON.stringify(input.candidate.contract), input.artifactDigest, JSON.stringify(input.criterionIds),
        input.actorRef, new Date().toISOString(),
      )
    })
  }

  /**
   * Read-only resolution for the core gate, on the same connection. Every returned record must match
   * the proposal's complete candidate identity (ticket/assignment/generation/contract) and artifact;
   * the quiescence barrier is re-verified against the current binding manifest and event so a late
   * resource/epoch/contract change invalidates it.
   *
   * The core gate calls this inside its own completion transaction; a caller checking evidence
   * outside the gate must wrap the call in `store.uow.atomic(() => ...)` so records and the current
   * binding/event rows come from one snapshot. Record methods above join the caller's transaction.
   */
  resolve(proposal: CompletionProposal): CompletionEvidence | undefined {
    const verification = row(this.db, 'SELECT * FROM completion_verifications WHERE id = ?', proposal.verificationId)
    if (!verification) return undefined
    if (!sameCandidate(candidateOf(verification), proposal) || String(verification.artifact_digest) !== proposal.artifactDigest) return undefined
    const quiescence = row(this.db, `SELECT * FROM completion_quiescence WHERE ticket_id = ? AND assignment_id = ? AND candidate_generation = ?
      AND artifact_digest = ? ORDER BY rowid DESC LIMIT 1`,
    proposal.ticketId, proposal.assignmentId, proposal.candidateGeneration, proposal.artifactDigest)
    if (!quiescence) return undefined
    const candidate = candidateOf(quiescence)
    const stored = JSON.parse(String(quiescence.evidence)) as StoredQuiescenceEvidence
    if (!this.barrierStillValid(candidate, String(quiescence.attempt_id), stored)) return undefined
    const evidence: CompletionEvidence = {
      verification: verificationOf(verification),
      quiescence: { id: String(quiescence.id), candidate, artifactDigest: String(quiescence.artifact_digest) },
    }
    if (proposal.humanAcceptanceRef) {
      const acceptance = row(this.db, 'SELECT * FROM completion_acceptances WHERE id = ?', proposal.humanAcceptanceRef)
      if (!acceptance) return undefined
      if (!sameCandidate(candidateOf(acceptance), proposal) || String(acceptance.artifact_digest) !== proposal.artifactDigest) return undefined
      evidence.humanAcceptance = {
        id: String(acceptance.id),
        candidate: candidateOf(acceptance),
        artifactDigest: String(acceptance.artifact_digest),
        criterionIds: JSON.parse(String(acceptance.criterion_ids)) as string[],
      }
    }
    return evidence
  }

  /** Re-checks the barrier against the current pointer, binding manifest, event/producer/command result and fact. */
  private barrierStillValid(candidate: CandidateRef, attemptId: string, evidence: StoredQuiescenceEvidence): boolean {
    const binding = this.store.bindings.binding<BindingView>(attemptId)
    if (!binding) return false
    if (binding.ticketId !== candidate.ticketId || binding.assignmentId !== candidate.assignmentId || !sameContract(binding.contract, candidate.contract)) return false
    if (binding.state !== 'ended') return false
    const current = this.store.bindings.current<BindingView>(candidate.ticketId)
    if (!current || current.attemptId !== attemptId) return false
    if (manifestDigest(binding.resources) !== evidence.manifestDigest) return false
    const event = this.eventAt(evidence.confirmedEventSeq)
    if (!event || !this.barrierEventValid(event, attemptId, {
      scope: 'registered_owned_resources_only', proofRef: evidence.proofRef, resourceManifestDigest: evidence.manifestDigest,
      ...(evidence.writerFactId ? { writerFactId: evidence.writerFactId } : {}),
    }, binding, candidate.contract)) return false
    if (!binding.resources.length && evidence.writerFactId) return false
    if (binding.resources.length) {
      if (!evidence.writerFactId) return false
      const rows = this.store.observations.forFact(evidence.writerFactId)
      if (binding.resources.some(resource => !rows.some(item => item.resourceRef === resource.ref && item.ownership === resource.ownership && item.status === 'quiescent'))) return false
    }
    return true
  }

  /**
   * The event must be a host barrier for this attempt: right topic/entity, the same receipt/manifest/scope/
   * contract, the binding's producer identity, the full attempt identity, the matching writer fact, and a
   * committed barrier command result for the same receipt.
   */
  private barrierEventValid(
    event: { seq: number; topic: string; entityRef: string; payload: Record<string, unknown> },
    attemptId: string,
    receipt: { scope: string; proofRef: string; resourceManifestDigest: string; writerFactId?: string },
    binding: BindingView,
    contract: ContractRef,
  ): boolean {
    if (event.topic !== 'runtime.barrier.confirmed' || event.entityRef !== attemptId) return false
    const payload = event.payload
    if (payload.proofRef !== receipt.proofRef || payload.resourceManifestDigest !== receipt.resourceManifestDigest || payload.scope !== receipt.scope) return false
    if (!sameContract(payload.contract as ContractRef, contract)) return false
    if (payload.runnerIdentityRef !== binding.runnerIdentityRef || payload.source !== binding.source) return false
    const attempt = payload.attempt as Record<string, unknown> | undefined
    if (!attempt || attempt.attemptId !== attemptId || attempt.ticketId !== binding.ticketId || attempt.assignmentId !== binding.assignmentId
      || attempt.fenceEpoch !== binding.fenceEpoch || !sameContract(attempt.contract as ContractRef, binding.contract)) return false
    const writerFactId = payload.writerFactId
    if (!(writerFactId === null || typeof writerFactId === 'string')) return false
    if (receipt.writerFactId ? writerFactId !== receipt.writerFactId : writerFactId !== null) return false
    const commandId = payload.barrierCommandId
    if (typeof commandId !== 'string' || !commandId) return false
    const command = this.store.commands.get(commandId)
    if (!command || command.status !== 'recorded') return false
    const result = command.result as Partial<BarrierReceipt> | undefined
    if (!result || result.scope !== receipt.scope || result.attemptId !== attemptId || result.proofRef !== receipt.proofRef
      || result.resourceManifestDigest !== receipt.resourceManifestDigest) return false
    if (result.confirmedEventSeq !== undefined && result.confirmedEventSeq !== event.seq) return false
    if ((result.writerFactId ?? null) !== writerFactId) return false
    return true
  }

  private eventAt(seq: number): { seq: number; topic: string; entityRef: string; payload: Record<string, unknown> } | undefined {
    if (!Number.isSafeInteger(seq) || seq < 1) return undefined
    const event = this.store.events.after(seq - 1, 1)[0]
    if (!event || event.seq !== seq) return undefined
    return { seq: event.seq, topic: event.topic, entityRef: event.entityRef, payload: (event.payload ?? {}) as Record<string, unknown> }
  }

  private quiescenceById(id: string): { candidate: CandidateRef; artifactDigest: string; attemptId: string; evidence: StoredQuiescenceEvidence } | undefined {
    const rowValue = row(this.db, 'SELECT * FROM completion_quiescence WHERE id = ?', id)
    if (!rowValue) return undefined
    return { candidate: candidateOf(rowValue), artifactDigest: String(rowValue.artifact_digest), attemptId: String(rowValue.attempt_id), evidence: JSON.parse(String(rowValue.evidence)) as StoredQuiescenceEvidence }
  }

  private acceptanceById(id: string): { candidate: CandidateRef; artifactDigest: string; criterionIds: string[]; actorRef: string } | undefined {
    const rowValue = row(this.db, 'SELECT * FROM completion_acceptances WHERE id = ?', id)
    if (!rowValue) return undefined
    return { candidate: candidateOf(rowValue), artifactDigest: String(rowValue.artifact_digest), criterionIds: JSON.parse(String(rowValue.criterion_ids)) as string[], actorRef: String(rowValue.actor_ref) }
  }
}
