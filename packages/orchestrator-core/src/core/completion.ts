import type { AssignmentRef, CandidateRef, CompletionProposal } from '@personal-agent/contracts'
import { UserError } from './errors.ts'
import { latestAssignment, liveTicket } from './model.ts'
import type { Ticket } from './model.ts'
import { EnginePart, type EngineOptions } from './part.ts'
import type { Tickets } from './tickets.ts'
import { assertCompletionCurrent, completionCriteriaDigest, sameCandidate, sameContract, validateCompletionCriteria } from './completion-state.ts'

export class Completion extends EnginePart {
  constructor(options: EngineOptions, private readonly tickets: Tickets) { super(options) }

  candidate(ticketId: string): CandidateRef | undefined {
    const ticket = this.require(ticketId)
    assertCompletionCurrent(this.options, ticket)
    return liveTicket(ticket) ? ticket.completion?.candidate : undefined
  }
  invalidate(ref: AssignmentRef): Ticket {
    const ticket = this.require(ref.ticketId)
    this.current(ticket, ref)
    this.invalidateCompletion(ticket)
    ticket.updatedAt = this.now()
    this.repo.tickets.save(ticket)
    return this.require(ticket.id)
  }
  confirm(proposal: CompletionProposal): Ticket {
    const expected = structuredClone(proposal)
    let ticket = this.require(expected.ticketId)
    this.ready(ticket, expected)
    if (!this.options.completionVerifier) throw new UserError('verificationUnavailable')
    const evidence = this.options.completionVerifier.resolve(structuredClone(expected))
    if (!evidence) throw new UserError('verificationUnavailable')
    // Trusted proof lookup must be read-only; rereading also rejects accidental reentrant mutations.
    ticket = this.require(expected.ticketId)
    this.ready(ticket, expected)
    const completion = ticket.completion!
    const verification = evidence.verification
    if (!verification || !Array.isArray(verification.results) || !expected.verificationId || verification.id !== expected.verificationId || !sameCandidate(verification, expected)
      || verification.artifactDigest !== expected.artifactDigest || !/^[a-f0-9]{64}$/.test(expected.artifactDigest)
      || verification.criteriaDigest !== completionCriteriaDigest(completion.criteria)) throw new UserError('verificationMismatch')
    if (!evidence.quiescence?.id || !sameCandidate(evidence.quiescence.candidate, expected)
      || evidence.quiescence.artifactDigest !== expected.artifactDigest) throw new UserError('writerNotQuiescent')
    if (verification.results.some(item => !item || !Array.isArray(item.evidenceRefs))) throw new UserError('verificationMismatch')
    const ids = verification.results.map(item => item.criterionId)
    if (new Set(ids).size !== ids.length) throw new UserError('verificationMismatch')
    for (const criterion of completion.criteria) {
      if (!criterion.required || criterion.kind !== 'machine') continue
      const result = verification.results.find(item => item.criterionId === criterion.id)
      if (result?.outcome !== 'PASS' || !result.evidenceRefs.length) throw new UserError('verificationFailed')
    }
    const human = completion.criteria.filter(item => item.required && item.kind === 'human').map(item => item.id)
    if (completion.mode === 'human_review' || human.length) {
      const accepted = evidence.humanAcceptance
      if (!expected.humanAcceptanceRef || accepted?.id !== expected.humanAcceptanceRef || !sameCandidate(accepted.candidate, expected)
        || accepted.artifactDigest !== expected.artifactDigest || human.some(id => !accepted.criterionIds.includes(id))) throw new UserError('acceptanceRequired')
    }
    completion.confirmed = { proposal: expected, at: this.now() }
    this.repo.tickets.save(ticket)
    this.tickets.end(ticket.id, 'executor', 'completed')
    this.emit('completion.confirmed', { ticketId: ticket.id, assignmentId: expected.assignmentId, generation: expected.candidateGeneration, verificationId: expected.verificationId })
    return this.require(ticket.id)
  }
  retire(ticketId: string, reason: string): Ticket {
    const ticket = this.require(ticketId)
    if (!ticket.completion) throw new UserError('notPersonalTicket')
    if (!reason.trim()) throw new UserError('staleContract')
    if (ticket.completion.retired) return ticket
    if (liveTicket(ticket)) this.tickets.stop(ticket.id, reason)
    const current = this.require(ticket.id)
    current.completion!.retired = { reason, at: this.now() }
    for (const id of current.completion!.resultReplyIds ?? []) this.options.outbox.withdraw(id)
    current.updatedAt = this.now()
    this.repo.tickets.save(current)
    this.emit('ticket.retired', { ticketId, reason })
    return this.require(ticketId)
  }
  private current(ticket: Ticket, ref: AssignmentRef): void {
    if (!ticket.completion) throw new UserError('notPersonalTicket')
    assertCompletionCurrent(this.options, ticket)
    if (!liveTicket(ticket)) throw new UserError('ticketEnded')
    const assignment = latestAssignment(ticket)
    if (!assignment || assignment.id !== ref.assignmentId || assignment.state === 'ended') throw new UserError('staleAssignment')
    if (!sameContract(ticket.completion.contract, ref.contract)) throw new UserError('staleContract')
  }
  private ready(ticket: Ticket, ref: CandidateRef): void {
    this.current(ticket, ref)
    const completion = ticket.completion!
    validateCompletionCriteria(completion.criteria)
    if (!completion.candidate || !sameCandidate(completion.candidate, ref) || completion.generation !== ref.candidateGeneration) throw new UserError('staleCandidate')
    const assignment = latestAssignment(ticket)!
    if (assignment.state !== 'running' || assignment.report?.state !== 'ready' || ticket.undelivered.length
      || ticket.inputs.some(input => input.kind === 'trigger' && input.deliveredTo === assignment.id && input.readAt === null)) throw new UserError('completionBusy')
  }
}
