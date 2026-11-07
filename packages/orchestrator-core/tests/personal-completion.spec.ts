import { describe, it, expect, vi } from 'vitest'
import { Engine, MemoryRepositories, latestAssignment, completionCriteriaDigest, createPersonalEngine } from '../src/core/index.ts'
import type { PersonalEngineOptions } from '../src/core/index.ts'
import type { Candidate, EngineOptions, Executor, OutboundMessage, Policy, Ticket, Trigger } from '../src/core/index.ts'
import type { CompletionEvidence } from '../src/core/completion-model.ts'
import type { CandidateRef, CompletionProposal, ContractRevision } from '@personal-agent/contracts'

const digest = 'a'.repeat(64)
const contract: ContractRevision = { workId: 'work-1', revision: 1, digest, goal: 'Implement CSV.', scope: { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }, criteria: [{ id: 'test-1', description: 'Tests pass.', kind: 'machine', required: true, checkDefinitionRef: 'check-1' }], authorityRef: 'authority-1', createdAt: '2026-11-07T00:00:00Z' }
function harness(mode: 'verified' | 'human_review' = 'verified', overrides: Partial<EngineOptions> = {}, personalFactory = false) {
  const repo = new MemoryRepositories()
  const requests: Candidate[] = []
  const messages = new Map<string, OutboundMessage>()
  const proofs = new Map<string, CompletionEvidence>()
  let current = contract.revision
  const policy: Policy = { version: 'v1', paused: false, evalTimeoutMs: 60000, gate: trigger => trigger.human && trigger.actor.id === 'user-1' ? { admissible: true, strength: 'explicit', basis: { via: 'listed' } } : { admissible: false, reason: 'not authorized' }, revalidate: () => true, admitsInferred: () => false }
  const executor: Executor = { start: vi.fn(), deliver: vi.fn(), stop: vi.fn() }
  const options: EngineOptions = {
    repo, policy: () => policy, scope: { scope: () => ({ listened: true, observed: false }) }, assessor: { request: candidate => { requests.push(candidate) } }, executor,
    outbox: { send: message => { messages.set(message.id, message) }, status: id => messages.has(id) ? 'pending' : undefined, withdraw: id => { messages.delete(id) } },
    now: () => '2026-11-07T00:00:00Z',
    completionPolicy: () => ({ mode, contract }), isCurrentContract: ref => ref.workId === contract.workId && ref.revision === current && ref.digest === digest,
    completionVerifier: { resolve: proposal => proofs.get(proposal.verificationId) }, ...overrides,
  }
  const engine = personalFactory ? createPersonalEngine(options as PersonalEngineOptions) : new Engine(options)
  const receive = (id: string, thread = 'thread-1', human = true) => engine.receive({ id, source: 'local', threads: [{ source: 'local', id: thread }], actor: { source: 'local', id: human ? 'user-1' : 'peer-1' }, human, at: '2026-11-07T00:00:00Z', text: id, channel: { source: 'local', thread, address: {} }, meta: {} } satisfies Trigger)
  function create() {
    receive('request-1'); engine.evaluateDue()
    const request = requests.at(-1)!
    const decision = engine.decide('request-1', { kind: 'accept', title: 'CSV', scope: 'project', reason: 'explicit', evalId: request.evalId })
    const ticket = repo.tickets.get(decision.ticketId!)!
    engine.assignmentStarted(ticket.id, latestAssignment(ticket)!.id)
    return repo.tickets.get(ticket.id)!
  }
  const report = (ticket: Ticket, state: 'ready' | 'progress' | 'blocked' | 'failed' | 'dropped' = 'ready') => engine.reportAssignment(ticket.id, latestAssignment(repo.tickets.get(ticket.id)!)!.id, { state, summary: state })
  function proof(ticket: Ticket) {
    const candidate = engine.completionCandidate(ticket.id)!
    const proposal: CompletionProposal = { ...candidate, verificationId: 'verification-1', artifactDigest: digest }
    const evidence: CompletionEvidence = {
      verification: { ...candidate, id: proposal.verificationId, artifactDigest: digest, criteriaDigest: completionCriteriaDigest(repo.tickets.get(ticket.id)!.completion!.criteria), environmentRef: 'environment-1', verifierIdentityRef: 'verifier-1', results: [{ criterionId: 'test-1', outcome: 'PASS', evidenceRefs: ['evidence-1'] }] },
      quiescence: { id: 'quiescence-1', candidate, artifactDigest: digest },
    }
    proofs.set(proposal.verificationId, evidence)
    return { candidate, proposal, evidence }
  }
  return { repo, engine, executor, messages, proofs, options, receive, create, report, proof, setRevision: (revision: number) => { current = revision } }
}

describe('personal completion gate', () => {
  it('requires policy/current-contract ports at personal assembly time', () => {
    expect(() => harness('verified', { completionPolicy: undefined }, true)).toThrow()
    expect(() => harness('verified', { isCurrentContract: undefined }, true)).toThrow()
  })
  it('does not silently downgrade a personal product ticket if its policy returns undefined', () => {
    const h = harness('verified', { completionPolicy: () => undefined }, true)
    expect(() => h.create()).toThrow()
    expect(h.repo.tickets.list()).toEqual([])
    expect(h.executor.start).not.toHaveBeenCalled()
  })
  it('assembles a personal engine with the same verified lifecycle', () => {
    const h = harness('verified', {}, true), ticket = h.create()
    h.report(ticket)
    expect(h.repo.tickets.get(ticket.id)!.ended).toBeUndefined()
    expect(h.engine.confirmCompletion(h.proof(ticket).proposal).ended?.outcome).toBe('completed')
  })
  it('refuses a stored personal ticket that lost its completion metadata', () => {
    const h = harness('verified', {}, true), ticket = h.create()
    const corrupt = h.repo.tickets.get(ticket.id)!; delete corrupt.completion; h.repo.tickets.save(corrupt)
    expect(() => h.engine.reportAssignment(ticket.id, latestAssignment(ticket)!.id, { state: 'ready', summary: 'unsafe fallback' })).toThrow()
    expect(h.repo.tickets.get(ticket.id)!.ended).toBeUndefined()
  })
  it('rolls creation back if the repository strips personal lifecycle fields', () => {
    const h = harness('verified', {}, true)
    const save = h.repo.tickets.save
    h.repo.tickets.save = ticket => { const copy = structuredClone(ticket); delete copy.completion; save(copy) }
    expect(() => h.create()).toThrow()
    expect(h.repo.tickets.list()).toEqual([])
    expect(h.executor.start).not.toHaveBeenCalled()
  })
  it('holds a ready result open and refuses the ticket-only report entry', () => {
    const h = harness(), ticket = h.create()
    expect(() => h.engine.report(ticket.id, { state: 'ready', summary: 'bypass' })).toThrow()
    h.report(ticket)
    expect(h.repo.tickets.get(ticket.id)?.ended).toBeUndefined()
    expect(h.engine.completionCandidate(ticket.id)).toMatchObject({ ticketId: ticket.id, candidateGeneration: 1, contract: { revision: 1 } })
    expect(() => h.engine.reply({ purpose: 'result', ticketId: ticket.id, text: 'Complete.' })).toThrow()
  })
  it('rejects an old assignment report after retry', () => {
    const h = harness(), ticket = h.create(), old = latestAssignment(ticket)!.id
    h.report(ticket, 'failed'); h.engine.retryTicket(ticket.id)
    expect(() => h.engine.reportAssignment(ticket.id, old, { state: 'ready', summary: 'late' })).toThrow()
    expect(latestAssignment(h.repo.tickets.get(ticket.id)!)?.report).toBeUndefined()
  })
  it('invalidates candidates when a new input is accepted, even at the same timestamp', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket)
    const first = h.engine.completionCandidate(ticket.id)!
    h.receive('supplement-1')
    expect(h.engine.completionCandidate(ticket.id)).toBeUndefined()
    h.report(ticket)
    expect(h.engine.completionCandidate(ticket.id)!.candidateGeneration).toBeGreaterThan(first.candidateGeneration)
  })
  it('requires a configured current-contract guard for personal intake', () => {
    const h = harness('verified', { isCurrentContract: undefined })
    expect(() => h.create()).toThrow()
    expect(h.repo.tickets.list()).toEqual([])
    expect(h.executor.start).not.toHaveBeenCalled()
  })
  it('does not auto-finish a personal ticket when followed threads close', () => {
    const h = harness(), ticket = h.create(), thread = { source: 'local', id: 'pr-1' }
    h.engine.bindThread(ticket.id, thread, true)
    h.engine.threadClosed(thread, 'merged', '2026-11-07T00:00:00Z')
    h.report(ticket)
    expect(h.repo.tickets.get(ticket.id)?.ended).toBeUndefined()
  })
  it('only completes a current candidate using matching trusted proof and quiescence', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket)
    const { proposal } = h.proof(ticket)
    expect(h.engine.confirmCompletion(proposal).ended?.outcome).toBe('completed')
    expect(h.executor.stop).toHaveBeenCalledOnce()
    expect(h.engine.reply({ purpose: 'result', ticketId: ticket.id, text: 'Verified result.' }).status).toBe('pending')
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    expect(h.executor.stop).toHaveBeenCalledOnce()
  })
  it.each(['FAIL', 'SKIPPED', 'NOT_TESTED', 'NOT_APPLICABLE'] as const)('does not let human acceptance override a machine %s', outcome => {
    const h = harness('human_review'), ticket = h.create()
    h.report(ticket)
    const { proposal, candidate, evidence } = h.proof(ticket)
    evidence.verification.results = [{ criterionId: 'test-1', outcome, evidenceRefs: ['evidence-1'] }]
    evidence.humanAcceptance = { id: 'acceptance-1', candidate, artifactDigest: digest, criterionIds: [] }
    expect(() => h.engine.confirmCompletion({ ...proposal, humanAcceptanceRef: 'acceptance-1' })).toThrow()
    expect(h.repo.tickets.get(ticket.id)?.ended).toBeUndefined()
    expect(h.executor.stop).not.toHaveBeenCalled()
  })
  it('rejects absent proof, wrong artifact/criteria/assignment and missing writer evidence', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket)
    const { proposal, evidence } = h.proof(ticket)
    h.proofs.clear()
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    h.proofs.set(proposal.verificationId, evidence)
    for (const mutate of [
      (value: CompletionEvidence) => { value.verification.artifactDigest = 'b'.repeat(64) },
      (value: CompletionEvidence) => { value.verification.criteriaDigest = 'b'.repeat(64) },
      (value: CompletionEvidence) => { value.verification.assignmentId = 'old-assignment' },
      (value: CompletionEvidence) => { value.quiescence.id = '' },
      (value: CompletionEvidence) => { value.quiescence.candidate.candidateGeneration++ },
    ]) {
      const invalid = structuredClone(evidence); mutate(invalid); h.proofs.set(proposal.verificationId, invalid)
      expect(() => h.engine.confirmCompletion(proposal)).toThrow()
      expect(h.repo.tickets.get(ticket.id)?.ended).toBeUndefined()
    }
  })
  it('requires trusted current human acceptance in human_review mode', () => {
    const h = harness('human_review'), ticket = h.create()
    h.report(ticket)
    const { proposal, candidate, evidence } = h.proof(ticket)
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    evidence.humanAcceptance = { id: 'acceptance-1', candidate, artifactDigest: digest, criterionIds: [] }
    expect(h.engine.confirmCompletion({ ...proposal, humanAcceptanceRef: 'acceptance-1' }).ended?.outcome).toBe('completed')
  })
  it('requires acceptance for every required human criterion even in verified mode', () => {
    const h = harness('verified', { completionPolicy: () => ({ mode: 'verified', contract: { ...contract, criteria: [...contract.criteria, { id: 'human-1', description: 'User reviews output.', kind: 'human', required: true }] } }) }), ticket = h.create()
    h.report(ticket)
    const { proposal, candidate, evidence } = h.proof(ticket)
    evidence.humanAcceptance = { id: 'acceptance-1', candidate, artifactDigest: digest, criterionIds: [] }
    expect(() => h.engine.confirmCompletion({ ...proposal, humanAcceptanceRef: 'acceptance-1' })).toThrow()
    evidence.humanAcceptance.criterionIds = ['human-1']
    expect(h.engine.confirmCompletion({ ...proposal, humanAcceptanceRef: 'acceptance-1' }).ended?.outcome).toBe('completed')
  })
  it('invalidates a candidate on a structured answer without creating a duplicate Input', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket)
    const { proposal, candidate } = h.proof(ticket)
    const before = h.repo.tickets.get(ticket.id)!.inputs
    h.engine.invalidateCandidate(candidate)
    expect(h.repo.tickets.get(ticket.id)!.inputs).toEqual(before)
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
  })
  it('does not invalidate again for duplicate received inputs', () => {
    const h = harness(), ticket = h.create()
    h.receive('supplement-1'); h.report(ticket)
    const candidate = h.engine.completionCandidate(ticket.id)
    expect(h.receive('supplement-1')).toBe('duplicate')
    expect(h.engine.completionCandidate(ticket.id)).toEqual(candidate)
  })
  it('requires another ready report after pending input is actually delivered and read', () => {
    const h = harness(), ticket = h.create(), assignmentId = latestAssignment(ticket)!.id
    h.receive('supplement-1'); h.report(ticket)
    const { proposal } = h.proof(ticket)
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    const ids = h.repo.tickets.get(ticket.id)!.undelivered
    h.engine.inputsDelivered(ticket.id, assignmentId, ids)
    h.engine.inputsReadAssignment(ticket.id, assignmentId, ids)
    expect(h.engine.completionCandidate(ticket.id)).toBeUndefined()
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    h.report(ticket)
    expect(h.engine.confirmCompletion(h.proof(ticket).proposal).ended?.outcome).toBe('completed')
  })
  it('refuses stale contract confirmations and pending-assignment ready reports', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket); const { proposal } = h.proof(ticket)
    h.setRevision(2)
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    h.setRevision(1); h.report(ticket, 'failed'); h.engine.retryTicket(ticket.id)
    expect(() => h.report(ticket)).toThrow()
  })
  it('keeps a completed old revision historical and prevents attach/resume or result reuse after retirement', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket); h.engine.confirmCompletion(h.proof(ticket).proposal)
    h.engine.reply({ purpose: 'result', ticketId: ticket.id, text: 'Old result.' })
    expect(h.messages.size).toBe(1)
    const retired = h.engine.retireTicket(ticket.id, 'new revision')
    expect(retired.ended?.outcome).toBe('completed')
    expect(retired.completion?.confirmed).toBeDefined()
    expect(h.messages.size).toBe(0)
    h.receive('request-2', 'thread-2')
    expect(() => h.engine.attach(ticket.id, 'request-2')).toThrow()
    h.receive('followup-1'); h.engine.evaluateDue()
    expect(h.repo.tickets.get(ticket.id)?.ended?.outcome).toBe('completed')
    expect(() => h.engine.reply({ purpose: 'result', ticketId: ticket.id, text: 'Old result.' })).toThrow()
  })
  it('ends dropped as dropped even if a followed thread was merged', () => {
    const h = harness(), ticket = h.create(), thread = { source: 'local', id: 'pr-1' }
    h.engine.bindThread(ticket.id, thread, true); h.engine.threadClosed(thread, 'merged', '2026-11-07T00:00:00Z')
    expect(h.report(ticket, 'dropped').ended?.outcome).toBe('dropped')
  })
  it('hands execution a frozen runtime facade without legacy or privileged completion methods', () => {
    const facade = harness().engine.personalExecutor()
    expect(Object.isFrozen(facade)).toBe(true)
    expect(typeof facade.reportAssignment).toBe('function')
    for (const name of ['report', 'inputsRead', 'confirmCompletion', 'invalidateCandidate', 'retireTicket', 'stopTicket', 'options']) expect(name in facade).toBe(false)
  })
  it('rejects empty completion criteria and a verifier that invalidates the candidate reentrantly', () => {
    const bad = harness('verified', { completionPolicy: () => ({ mode: 'verified', contract: { ...contract, criteria: [] } }) })
    expect(() => bad.create()).toThrow()
    const h = harness(), ticket = h.create()
    h.report(ticket); const { proposal, candidate, evidence } = h.proof(ticket)
    h.options.completionVerifier = { resolve: () => { h.engine.invalidateCandidate(candidate); return evidence } }
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    expect(h.repo.tickets.get(ticket.id)?.ended).toBeUndefined()
  })
  it('refuses ticket-only read acknowledgments and ignores old assignment reads', () => {
    const h = harness(), ticket = h.create(), first = latestAssignment(ticket)!.id
    h.report(ticket, 'failed'); h.engine.retryTicket(ticket.id)
    const next = latestAssignment(h.repo.tickets.get(ticket.id)!)!.id
    h.engine.assignmentStarted(ticket.id, next); h.receive('new-input')
    const ids = h.repo.tickets.get(ticket.id)!.undelivered
    h.engine.inputsDelivered(ticket.id, next, ids)
    expect(() => h.engine.inputsRead(ticket.id, ids)).toThrow()
    h.engine.inputsReadAssignment(ticket.id, first, ids)
    expect(h.repo.tickets.get(ticket.id)!.inputs.find(input => input.kind === 'trigger' && input.triggerId === 'new-input')).toMatchObject({ readAt: null, deliveredTo: next })
  })
  it('withdraws a live revision without waiting for physical stop and rejects all late business reports', () => {
    const h = harness(), ticket = h.create(), assignmentId = latestAssignment(ticket)!.id
    h.report(ticket)
    expect(h.engine.retireTicket(ticket.id, 'scope changed').ended).toMatchObject({ by: 'human', outcome: 'stopped' })
    expect(h.executor.stop).toHaveBeenCalledOnce()
    expect(() => h.engine.reportAssignment(ticket.id, assignmentId, { state: 'ready', summary: 'late' })).toThrow()
    h.engine.assignmentStarted(ticket.id, assignmentId)
    expect(latestAssignment(h.repo.tickets.get(ticket.id)!)!.state).toBe('ended')
  })
  it('does not resurrect even a current completed personal ticket on a human follow-up', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket); h.engine.confirmCompletion(h.proof(ticket).proposal)
    h.receive('followup-1'); h.engine.evaluateDue()
    expect(h.repo.tickets.get(ticket.id)!.assignments).toHaveLength(1)
    expect(h.repo.tickets.get(ticket.id)!.ended?.outcome).toBe('completed')
  })
  it('rechecks policy authority before trusted completion', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket); const { proposal } = h.proof(ticket)
    const original = h.options.policy()
    h.options.policy = () => ({ ...original, revalidate: () => false })
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    expect(h.repo.tickets.get(ticket.id)!.ended).toBeUndefined()
  })
  it('requires fresh verification after a new ready report, without relying on wall-clock changes', () => {
    const h = harness(), ticket = h.create()
    h.report(ticket); const { proposal } = h.proof(ticket)
    h.report(ticket)
    expect(() => h.engine.confirmCompletion(proposal)).toThrow()
    expect(h.engine.confirmCompletion(h.proof(ticket).proposal).ended?.outcome).toBe('completed')
  })
  it('does not call the verifier or stop execution when verification identity is stale', () => {
    const resolve = vi.fn(() => undefined)
    const h = harness('verified', { completionVerifier: { resolve } }), ticket = h.create()
    h.report(ticket)
    const candidate = h.engine.completionCandidate(ticket.id)!
    expect(() => h.engine.confirmCompletion({ ...candidate, assignmentId: 'old', verificationId: 'verification-1', artifactDigest: digest })).toThrow()
    expect(resolve).not.toHaveBeenCalled()
    expect(h.executor.stop).not.toHaveBeenCalled()
  })
  it('does not requeue an input read before a verified result in the same millisecond', () => {
    const h = harness('verified', {}, true), ticket = h.create(), assignmentId = latestAssignment(ticket)!.id
    h.receive('consumed-input')
    const ids = h.repo.tickets.get(ticket.id)!.undelivered
    h.engine.inputsDelivered(ticket.id, assignmentId, ids)
    h.engine.inputsReadAssignment(ticket.id, assignmentId, ids)
    h.report(ticket); h.engine.confirmCompletion(h.proof(ticket).proposal)
    expect(h.repo.threads.get('local:thread-1')!.pending).not.toContain('consumed-input')
  })
})
