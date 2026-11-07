/**
 * Trusted completion evidence (WP-04, batch 2): an implementation of the core `CompletionVerifier`
 * port that resolves Verification, candidate-bound quiescence and human acceptance from immutable
 * records on the same database connection, synchronously and read-only.
 *
 * It never decides completion and never manufactures proof:
 * - `recordQuiescence` re-derives the requirement from the runtime observation store at record
 *   time: every named resource of the attempt must have an explicit writer.observed `quiescent`
 *   fact. An exit, a cancel ACK, a timeout or a missing PID cannot produce a quiescence record.
 * - `resolve` only looks up records that match the proposal's candidate and artifact exactly;
 *   anything stale or missing yields `undefined`, and the core gate refuses.
 */
import type Database from 'better-sqlite3'
import type { CandidateRef, CompletionProposal, ContractRef, Verification } from '@personal-agent/contracts'
import type { CompletionEvidence, CompletionVerifier } from '@personal-agent/orchestrator-core'
import type { ProductStore } from '@personal-agent/storage'
import { canonicalDigest } from '@personal-agent/storage'

type Row = Record<string, unknown>

export class EvidenceConflict extends Error {}
/** The requested quiescence is not proven by the runtime observations (or the attempt is unknown). */
export class QuiescenceUnavailable extends Error {}

export interface QuiescenceInput {
  /** Stable record ID, chosen by the trusted composition root. */
  id: string
  candidate: CandidateRef
  artifactDigest: string
  /** The runtime attempt whose resources the observations describe. */
  attemptId: string
  /** The resources that must each be observed quiescent. */
  resourceRefs: readonly string[]
}

export interface AcceptanceInput {
  id: string
  candidate: CandidateRef
  artifactDigest: string
  criterionIds: readonly string[]
  /** The authenticated actor who accepted; a separate source from machine results. */
  actorRef: string
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
  private readonly observations: ProductStore['observations']
  private readonly bindings: ProductStore['bindings']
  constructor(store: ProductStore) {
    this.db = store.db
    this.observations = store.observations
    this.bindings = store.bindings
  }

  /** Records a Verification immutably; an identical replay is a no-op, a different body conflicts. */
  recordVerification(verification: Verification): void {
    const existing = row(this.db, 'SELECT * FROM completion_verifications WHERE id = ?', verification.id)
    if (existing) {
      if (digestOf(verificationOf(existing)) !== digestOf(verification)) {
        throw new EvidenceConflict(`Verification ${verification.id} already exists with a different body`)
      }
      return
    }
    this.db.prepare(`INSERT INTO completion_verifications
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
       environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      verification.id, verification.ticketId, verification.assignmentId, verification.candidateGeneration,
      JSON.stringify(verification.contract), verification.artifactDigest, verification.criteriaDigest,
      verification.environmentRef, verification.verifierIdentityRef, JSON.stringify(verification.results),
      new Date().toISOString(),
    )
  }

  /**
   * Records candidate-bound quiescence only when the runtime observation store shows an explicit
   * `observed_quiescent` writer fact for every named resource of the attempt. The evidence (the
   * observation fact IDs) is stored with the record.
   */
  recordQuiescence(input: QuiescenceInput): void {
    if (!input.resourceRefs.length) throw new QuiescenceUnavailable('Quiescence needs at least one observed resource')
    if (!/^[a-f0-9]{64}$/.test(input.artifactDigest)) throw new QuiescenceUnavailable('Quiescence must bind a frozen artifact digest')
    const binding = this.bindings.binding(input.attemptId)
    if (!binding) throw new QuiescenceUnavailable(`Unknown runtime attempt ${input.attemptId}`)
    if (binding.ticketId !== input.candidate.ticketId || binding.assignmentId !== input.candidate.assignmentId) {
      throw new QuiescenceUnavailable(`Attempt ${input.attemptId} does not belong to the candidate assignment`)
    }
    const summary = this.observations.summarize(input.attemptId)
    const evidence: { resourceRef: string; factId: string }[] = []
    for (const resourceRef of input.resourceRefs) {
      const resource = summary.resources.find(item => item.resourceRef === resourceRef)
      if (!resource || resource.quiescence !== 'observed_quiescent') {
        throw new QuiescenceUnavailable(`Resource ${resourceRef} of attempt ${input.attemptId} has no explicit observed quiescence`)
      }
      evidence.push({ resourceRef, factId: resource.last.factId })
    }
    const existing = row(this.db, 'SELECT evidence FROM completion_quiescence WHERE id = ?', input.id)
    if (existing) {
      if (canonicalDigest(JSON.parse(String(existing.evidence)) as never) !== canonicalDigest(evidence as never)) {
        throw new EvidenceConflict(`Quiescence ${input.id} already exists with different evidence`)
      }
      return
    }
    this.db.prepare(`INSERT INTO completion_quiescence
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, attempt_id, resource_refs, evidence, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.candidate.ticketId, input.candidate.assignmentId, input.candidate.candidateGeneration,
      JSON.stringify(input.candidate.contract), input.artifactDigest, input.attemptId,
      JSON.stringify(input.resourceRefs), JSON.stringify(evidence), new Date().toISOString(),
    )
  }

  /** Records a trusted user's acceptance of the candidate's required human criteria. */
  recordAcceptance(input: AcceptanceInput): void {
    if (!input.criterionIds.length || new Set(input.criterionIds).size !== input.criterionIds.length) throw new EvidenceConflict('Acceptance needs unique criterion IDs')
    if (!input.actorRef.trim()) throw new EvidenceConflict('Acceptance needs an authenticated actor')
    if (!/^[a-f0-9]{64}$/.test(input.artifactDigest)) throw new EvidenceConflict('Acceptance must bind a frozen artifact digest')
    const existing = row(this.db, 'SELECT criterion_ids FROM completion_acceptances WHERE id = ?', input.id)
    if (existing) {
      if (canonicalDigest(JSON.parse(String(existing.criterion_ids)) as never) !== canonicalDigest([...input.criterionIds] as never)) {
        throw new EvidenceConflict(`Acceptance ${input.id} already exists with different criteria`)
      }
      return
    }
    this.db.prepare(`INSERT INTO completion_acceptances
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criterion_ids, actor_ref, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, input.candidate.ticketId, input.candidate.assignmentId, input.candidate.candidateGeneration,
      JSON.stringify(input.candidate.contract), input.artifactDigest, JSON.stringify(input.criterionIds),
      input.actorRef, new Date().toISOString(),
    )
  }

  /**
   * Read-only resolution for the core gate, on the same connection: the verification and quiescence
   * must match the proposal's candidate and artifact exactly; a requested acceptance must match too.
   * Any missing, stale or mismatched record yields `undefined`, never a synthesized success.
   */
  resolve(proposal: CompletionProposal): CompletionEvidence | undefined {
    const verification = row(this.db, 'SELECT * FROM completion_verifications WHERE id = ?', proposal.verificationId)
    if (!verification) return undefined
    if (!sameCandidate(candidateOf(verification), proposal) || String(verification.artifact_digest) !== proposal.artifactDigest) return undefined
    const quiescence = row(this.db, `SELECT * FROM completion_quiescence WHERE ticket_id = ? AND assignment_id = ? AND candidate_generation = ?
      AND artifact_digest = ? ORDER BY rowid DESC LIMIT 1`,
    proposal.ticketId, proposal.assignmentId, proposal.candidateGeneration, proposal.artifactDigest)
    if (!quiescence) return undefined
    const evidence: CompletionEvidence = {
      verification: verificationOf(verification),
      quiescence: {
        id: String(quiescence.id),
        candidate: candidateOf(quiescence),
        artifactDigest: String(quiescence.artifact_digest),
      },
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
}
