/**
 * WP-04 batch 2: the trusted completion-evidence store. Adapter semantics (stale/mismatched
 * records never resolve), quiescence that must be proven by runtime observations, and the real core
 * completion gate: a machine FAIL/SKIPPED cannot be overridden by human acceptance, an old
 * generation or artifact cannot be adopted, and a fully proven candidate completes.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseRuntimeFactPayload } from '@personal-agent/contracts'
import type { CandidateRef, CompletionProposal, Criterion, Json, Verification } from '@personal-agent/contracts'
import { createPersonalEngine, UserError } from '@personal-agent/orchestrator-core'
import { canonicalDigest, ProductStore } from '@personal-agent/storage'
import { bindCoreRepositories } from '../../../apps/coordinator/main.ts'
import {
  CheckRegistry, CompletionEvidenceStore, EvidenceConflict, QuiescenceUnavailable, VerificationRunner,
  type VerificationPlan,
} from '../src/index.ts'
import { makeStore } from './helpers.ts'

const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const artifact = 'b'.repeat(64)
const criteria: Criterion[] = [
  { id: 'unit', kind: 'machine', description: 'Unit checks pass.', required: true, checkDefinitionRef: 'unit-check' },
  { id: 'review', kind: 'human', description: 'The user accepts the result.', required: true },
]
const contractRevision = {
  ...contract, goal: 'Deliver the change.', criteria: criteria as [Criterion, ...Criterion[]], authorityRef: 'authority-1', createdAt: '2026-11-07T00:00:00.000Z',
  scope: { projectId: 'project-1', allowedPaths: [], excludedPaths: [], externalActions: [] },
}
const ticket = () => ({
  id: 'ticket-1', title: 'Deliver', decisionId: 'decision-1',
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed' }, actor: { source: 'local', id: 'user-1' }, scope: 'project' },
  channels: [], assignments: [{ id: 'assignment-1', state: 'running', createdAt: '2026-11-07T00:00:00.000Z' }],
  inputs: [], undelivered: [], createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z',
  origin: { triggerId: 'request-1', triggerIds: ['request-1'] },
  completion: { mode: 'verified', contract, criteria, generation: 0 },
})
const registry = (code: string): CheckRegistry => {
  const checks = new CheckRegistry()
  checks.register({ id: 'unit-check', revision: 1, executable: process.execPath, argv: ['-e', code], deadlineMs: 5_000, outputLimitBytes: 64_000 })
  return checks
}
const engineFor = (store: ProductStore, evidence: CompletionEvidenceStore) => createPersonalEngine({
  repo: bindCoreRepositories(store),
  policy: () => ({ version: 'v1', paused: false, gate: () => ({ admissible: false, reason: 'fixture' }), revalidate: () => true, admitsInferred: () => false, evalTimeoutMs: 1000 }),
  scope: { scope: () => ({ listened: true, observed: false }) },
  assessor: { request: () => {} },
  executor: { start: () => {}, deliver: () => {}, stop: () => {} },
  outbox: { send: () => {}, withdraw: () => {}, status: () => undefined },
  completionPolicy: () => ({ mode: 'verified', contract: contractRevision }),
  isCurrentContract: ref => ref.workId === contract.workId && ref.revision === contract.revision && ref.digest === contract.digest,
  completionVerifier: evidence,
})

/** Records an explicit writer.observed quiescent fact for the candidate's runtime attempt. */
const seedQuiescence = (store: ProductStore, status: 'active' | 'quiescent' | 'indeterminate' = 'quiescent'): void => {
  store.uow.atomic(() => {
    store.bindings.record({
      ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract,
      runnerIdentityRef: 'runner-1', source: 'codex', state: 'active',
      resources: [{ ref: 'resource-1', ownership: 'spawned_process' }],
    })
    const fact = {
      ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract,
      factId: `fact-writer-${status}`, source: 'codex', kind: 'writer.observed' as const, payloadRef: `sha256:${'c'.repeat(64)}`,
    }
    const raw = { kind: 'writer.observed', value: { resources: [{ resourceRef: 'resource-1', ownership: 'spawned_process', status, evidenceRefs: ['ev-1'] }] } }
    store.observations.record({ fact, payload: parseRuntimeFactPayload(fact, raw), disposition: 'physical_only', payloadSha256: canonicalDigest(raw as Json) })
  })
}

const prepare = (store: ProductStore, evidence: CompletionEvidenceStore, workspacePath: string, code: string, options: { exclusions?: VerificationPlan['exclusions'] } = {}) => {
  store.domain.tickets.save(ticket())
  const engine = engineFor(store, evidence)
  engine.reportAssignment('ticket-1', 'assignment-1', { state: 'ready', summary: 'candidate ready' })
  const candidate = engine.completionCandidate('ticket-1')!
  const runner = new VerificationRunner(registry(code))
  const run = runner.run({ candidate, criteria, artifactDigest: artifact, workspacePath, environmentRef: 'env-1', ...(options.exclusions ? { exclusions: options.exclusions } : {}) })
  evidence.recordVerification(run.verification)
  seedQuiescence(store)
  evidence.recordQuiescence({ id: 'q1', candidate, artifactDigest: artifact, attemptId: 'attempt-1', resourceRefs: ['resource-1'] })
  evidence.recordAcceptance({ id: 'a1', candidate, artifactDigest: artifact, criterionIds: ['review'], actorRef: 'user-1' })
  const proposal: CompletionProposal = { ...candidate, verificationId: run.verification.id, artifactDigest: artifact, humanAcceptanceRef: 'a1' }
  return { engine, candidate, verification: run.verification, proposal }
}

test('the evidence store resolves only matching candidate/artifact records, read-only', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-evidence-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { candidate, verification, proposal } = prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    const before = ['completion_verifications', 'completion_quiescence', 'completion_acceptances']
      .map(table => Number((context.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n))
    const resolved = evidence.resolve(proposal)!
    assert.equal(resolved.verification.id, verification.id)
    assert.equal(resolved.quiescence.id, 'q1')
    assert.equal(resolved.humanAcceptance?.id, 'a1')
    assert.deepEqual(resolved.humanAcceptance?.criterionIds, ['review'])
    const after = ['completion_verifications', 'completion_quiescence', 'completion_acceptances']
      .map(table => Number((context.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n))
    assert.deepEqual(after, before, 'resolution is read-only')

    assert.equal(evidence.resolve({ ...proposal, verificationId: 'missing' }), undefined)
    assert.equal(evidence.resolve({ ...proposal, candidateGeneration: candidate.candidateGeneration + 1 }), undefined, 'a newer generation cannot adopt the old verification')
    assert.equal(evidence.resolve({ ...proposal, artifactDigest: 'd'.repeat(64) }), undefined, 'another artifact cannot adopt the result')
    assert.equal(evidence.resolve({ ...proposal, humanAcceptanceRef: 'missing' }), undefined)
    assert.equal(evidence.resolve({ ...proposal, contract: { ...contract, revision: 2 } }), undefined)

    // Same record ID with a different body is refused.
    const altered: Verification = { ...resolved.verification, artifactDigest: 'd'.repeat(64) }
    assert.throws(() => evidence.recordVerification(altered), EvidenceConflict)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('quiescence is recorded only from explicit runtime writer observations', async () => {
  const context = makeStore()
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const candidate: CandidateRef = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 }
    // No runtime binding at all: no quiescence.
    assert.throws(() => evidence.recordQuiescence({ id: 'q0', candidate, artifactDigest: artifact, attemptId: 'attempt-1', resourceRefs: ['resource-1'] }), QuiescenceUnavailable)
    // An exit or a cancel ACK is not quiescence; only an explicit writer quiescent fact is.
    seedQuiescence(context.store, 'active')
    assert.throws(() => evidence.recordQuiescence({ id: 'q1', candidate, artifactDigest: artifact, attemptId: 'attempt-1', resourceRefs: ['resource-1'] }), QuiescenceUnavailable)
    assert.throws(() => evidence.recordQuiescence({ id: 'q2', candidate, artifactDigest: artifact, attemptId: 'other-attempt', resourceRefs: ['resource-1'] }), QuiescenceUnavailable)
    seedQuiescence(context.store, 'quiescent')
    evidence.recordQuiescence({ id: 'q3', candidate, artifactDigest: artifact, attemptId: 'attempt-1', resourceRefs: ['resource-1'] })
    const row = context.store.db.prepare("SELECT evidence FROM completion_quiescence WHERE id = 'q3'").get() as { evidence: string }
    assert.deepEqual(JSON.parse(row.evidence), [{ resourceRef: 'resource-1', factId: 'fact-writer-quiescent' }], 'the observation fact is the stored evidence')
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
})

test('the core gate completes only a fully proven candidate', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-gate-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { engine, proposal } = prepare(context.store, evidence, workspacePath, 'process.stdout.write("ok")')
    const completed = engine.confirmCompletion(proposal)
    assert.equal(completed.ended?.outcome, 'completed')
    assert.equal(completed.completion?.confirmed?.proposal.verificationId, proposal.verificationId)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('a machine FAIL cannot be overridden by human acceptance', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-fail-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { engine, proposal } = prepare(context.store, evidence, workspacePath, 'process.exit(2)')
    assert.throws(() => engine.confirmCompletion(proposal), (error: unknown) => error instanceof UserError && error.code === 'verificationFailed')
    assert.equal(context.store.domain.tickets.get<{ ended?: unknown }>('ticket-1')?.ended, undefined, 'the Ticket stays open')
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('a SKIPPED required machine check cannot be overridden by human acceptance either', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-skip-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { engine, proposal } = prepare(context.store, evidence, workspacePath, 'process.exit(0)', {
      exclusions: [{ criterionId: 'unit', outcome: 'SKIPPED', reason: 'environment unavailable' }],
    })
    assert.throws(() => engine.confirmCompletion(proposal), (error: unknown) => error instanceof UserError && error.code === 'verificationFailed')
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('an old generation or a different artifact cannot be completed', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-stale-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { engine, candidate, proposal } = prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    // A proposal naming another artifact cannot resolve its evidence, while the candidate is current.
    assert.equal(evidence.resolve({ ...proposal, artifactDigest: 'd'.repeat(64) }), undefined)
    assert.throws(() => engine.confirmCompletion({ ...proposal, artifactDigest: 'd'.repeat(64) }), (error: unknown) =>
      error instanceof UserError && (error.code === 'verificationUnavailable' || error.code === 'verificationMismatch'))
    // A new input invalidates the candidate and bumps the generation; the old proposal is refused.
    engine.invalidateCandidate({ ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, contract })
    assert.throws(() => engine.confirmCompletion(proposal), (error: unknown) => error instanceof UserError && error.code === 'staleCandidate')
    assert.equal(context.store.domain.tickets.get<{ ended?: unknown }>('ticket-1')?.ended, undefined)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

