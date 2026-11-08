/**
 * WP-04 admission fixes: the trusted completion-evidence store consumes a host barrier receipt
 * (ended binding + confirmed event + host writer fact covering every registered resource), refuses
 * subsets and untrusted calls, compares full record bodies, strictly validates Verifications, and
 * invalidates evidence after a late resource/manifest change. Integration tests drive the real core
 * completion gate over SQLite.
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
  CheckRegistry, CompletionEvidenceStore, EvidenceConflict, InvalidEvidence, manifestDigest, QuiescenceUnavailable,
  VerificationRunner, type BarrierReceipt, type VerificationPlan,
} from '../src/index.ts'
import { makeStore } from './helpers.ts'

const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const artifact = 'b'.repeat(64)
const proofRef = `payload:${'p'.repeat(64)}`
const criteria: Criterion[] = [
  { id: 'unit', kind: 'machine', description: 'Unit checks pass.', required: true, checkDefinitionRef: 'unit-check' },
  { id: 'review', kind: 'human', description: 'The user accepts the result.', required: true },
]
const contractRevision = {
  ...contract, goal: 'Deliver the change.', criteria: criteria as [Criterion, ...Criterion[]], authorityRef: 'authority-1', createdAt: '2026-11-07T00:00:00.000Z',
  scope: { projectId: 'project-1', allowedPaths: [], excludedPaths: [], externalActions: [] },
}
const resources = [{ ref: 'resource-1', ownership: 'spawned_process' as const }]
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

interface TestResource { ref: string; ownership: 'spawned_process' | 'shared_service_session' }

/** Records a test-side barrier exactly the way the host barrier writes it (public repositories only). */
function confirmBarrier(store: ProductStore, candidate: CandidateRef, attemptId: string, quiescent: readonly TestResource[] = resources, registered: readonly TestResource[] = resources): BarrierReceipt {
  const manifest = manifestDigest(registered)
  const commandId = `confirm-owned-quiescence/v2:${attemptId}:${manifest}`
  let confirmedEventSeq = 0
  let writerFactId: string | undefined
  store.uow.atomic(() => {
    if (registered.length) {
      writerFactId = `fact-writer-${attemptId}-${quiescent.length}`
      const fact = {
        ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, attemptId, fenceEpoch: 1, contract: candidate.contract,
        source: 'codex', factId: writerFactId, kind: 'writer.observed' as const, payloadRef: `sha256:${'e'.repeat(64)}`,
      }
      const raw = { kind: 'writer.observed', value: { resources: registered.map(resource => ({
        resourceRef: resource.ref, ownership: resource.ownership,
        status: quiescent.some(item => item.ref === resource.ref) ? 'quiescent' : 'active', evidenceRefs: [proofRef],
      })) } }
      store.facts.record(fact.factId, canonicalDigest({ fact, payloadDigest: canonicalDigest(raw as Json) } as Json), () => {
        store.observations.record({ fact, payload: parseRuntimeFactPayload(fact, raw), disposition: 'physical_only', payloadSha256: canonicalDigest(raw as Json) })
      })
    }
    store.bindings.end(attemptId)
    confirmedEventSeq = store.events.append({ topic: 'runtime.barrier.confirmed', entityRef: attemptId, payload: {
      barrierCommandId: commandId, proofRef, resourceManifestDigest: manifest, scope: 'registered_owned_resources_only',
      writerFactId: writerFactId ?? null, runnerIdentityRef: 'runner-1', source: 'codex', contract: candidate.contract,
      attempt: { attemptId, ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, fenceEpoch: 1, contract: candidate.contract },
    } })
    const receipt: BarrierReceipt = { scope: 'registered_owned_resources_only', attemptId, proofRef, resourceManifestDigest: manifest, confirmedEventSeq,
      ...(writerFactId ? { writerFactId } : {}) }
    store.commands.record(commandId, canonicalDigest({ attemptId, manifest, scope: receipt.scope } as Json), () => receipt)
  })
  return { scope: 'registered_owned_resources_only', attemptId, proofRef, resourceManifestDigest: manifest, confirmedEventSeq,
    ...(writerFactId ? { writerFactId } : {}) }
}

const seedBinding = (store: ProductStore, candidate: CandidateRef, registered: readonly TestResource[] = resources, attemptId = 'attempt-1'): void => {
  store.uow.atomic(() => {
    store.bindings.record({
      ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, attemptId, fenceEpoch: 1, contract: candidate.contract,
      runnerIdentityRef: 'runner-1', source: 'codex', state: 'active', resources: registered,
    })
    store.bindings.setCurrent(candidate.ticketId, attemptId)
  })
}

const prepare = async (store: ProductStore, evidence: CompletionEvidenceStore, workspacePath: string, code: string, options: { exclusions?: VerificationPlan['exclusions'] } = {}) => {
  store.domain.tickets.save(ticket())
  const engine = engineFor(store, evidence)
  engine.reportAssignment('ticket-1', 'assignment-1', { state: 'ready', summary: 'candidate ready' })
  const candidate = engine.completionCandidate('ticket-1')!
  const runner = new VerificationRunner(registry(code))
  const run = await runner.run({ candidate, criteria, artifactDigest: artifact, workspacePath, environmentRef: 'env-1', verifyArtifact: () => true, ...(options.exclusions ? { exclusions: options.exclusions } : {}) })
  evidence.recordVerification(run.verification)
  seedBinding(store, candidate)
  const barrier = confirmBarrier(store, candidate, 'attempt-1')
  evidence.recordQuiescence({ id: 'q1', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier })
  evidence.recordAcceptance({ id: 'a1', candidate, artifactDigest: artifact, criterionIds: ['review'], actorRef: 'user-1' })
  const proposal: CompletionProposal = { ...candidate, verificationId: run.verification.id, artifactDigest: artifact, humanAcceptanceRef: 'a1' }
  return { engine, candidate, verification: run.verification, proposal, barrier }
}

test('the evidence store resolves only matching candidate/artifact records, read-only', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-evidence-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { candidate, verification, proposal } = await prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    const counts = () => ['completion_verifications', 'completion_quiescence', 'completion_acceptances']
      .map(table => Number((context.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n))
    const before = counts()
    const resolved = evidence.resolve(proposal)!
    assert.equal(resolved.verification.id, verification.id)
    assert.equal(resolved.quiescence.id, 'q1')
    assert.equal(resolved.humanAcceptance?.id, 'a1')
    assert.deepEqual(resolved.humanAcceptance?.criterionIds, ['review'])
    assert.deepEqual(counts(), before, 'resolution is read-only')

    assert.equal(evidence.resolve({ ...proposal, verificationId: 'missing' }), undefined)
    assert.equal(evidence.resolve({ ...proposal, candidateGeneration: candidate.candidateGeneration + 1 }), undefined, 'a newer generation cannot adopt the old verification')
    assert.equal(evidence.resolve({ ...proposal, artifactDigest: 'd'.repeat(64) }), undefined, 'another artifact cannot adopt the result')
    assert.equal(evidence.resolve({ ...proposal, humanAcceptanceRef: 'missing' }), undefined)
    assert.equal(evidence.resolve({ ...proposal, contract: { ...contract, revision: 2 } }), undefined)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('quiescence requires a trusted complete-inventory barrier, never a caller subset or plain observations', async () => {
  const context = makeStore()
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const candidate: CandidateRef = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 }
    const two: TestResource[] = [{ ref: 'res-quiet', ownership: 'spawned_process' }, { ref: 'res-active', ownership: 'spawned_process' }]
    seedBinding(context.store, candidate, two)

    // No barrier at all (the old observed-summary style) is refused.
    assert.throws(() => evidence.recordQuiescence({ id: 'q0', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier: undefined as never }), QuiescenceUnavailable)
    // A barrier receipt claiming the full manifest while the host fact proves only one resource is refused.
    const partial = confirmBarrier(context.store, candidate, 'attempt-1', [two[0]!], two)
    assert.throws(() => evidence.recordQuiescence({ id: 'q1', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier: partial }), (error: unknown) =>
      error instanceof QuiescenceUnavailable && /not proven quiescent/.test((error as Error).message))
    // A manifest digest that no longer matches the registered resources is refused.
    const wrong = { ...partial, resourceManifestDigest: 'f'.repeat(64) }
    assert.throws(() => evidence.recordQuiescence({ id: 'q2', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier: wrong }), QuiescenceUnavailable)
    // Another attempt's receipt is refused.
    assert.throws(() => evidence.recordQuiescence({ id: 'q3', candidate, artifactDigest: artifact, attemptId: 'other-attempt', barrier: partial }), QuiescenceUnavailable)
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
    const { engine, proposal } = await prepare(context.store, evidence, workspacePath, 'process.stdout.write("ok")')
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
    const { engine, proposal } = await prepare(context.store, evidence, workspacePath, 'process.exit(2)')
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
    const { engine, proposal } = await prepare(context.store, evidence, workspacePath, 'process.exit(0)', {
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
    const { engine, candidate, proposal } = await prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    assert.equal(evidence.resolve({ ...proposal, artifactDigest: 'd'.repeat(64) }), undefined)
    assert.throws(() => engine.confirmCompletion({ ...proposal, artifactDigest: 'd'.repeat(64) }), (error: unknown) =>
      error instanceof UserError && (error.code === 'verificationUnavailable' || error.code === 'verificationMismatch'))
    engine.invalidateCandidate({ ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, contract })
    assert.throws(() => engine.confirmCompletion(proposal), (error: unknown) => error instanceof UserError && error.code === 'staleCandidate')
    assert.equal(context.store.domain.tickets.get<{ ended?: unknown }>('ticket-1')?.ended, undefined)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('a late resource append invalidates the recorded completion evidence', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-late-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { engine, candidate, proposal } = await prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    assert.ok(evidence.resolve(proposal), 'the evidence resolves while the manifest is unchanged')
    // A late resource registration changes the registered manifest after the barrier.
    context.store.uow.atomic(() => {
      const binding = context.store.bindings.binding<{ ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: typeof contract; runnerIdentityRef: string; source: string; state: 'ended'; resources: TestResource[] }>('attempt-1')!
      context.store.bindings.record({ ...binding, resources: [...binding.resources, { ref: 'resource-late', ownership: 'spawned_process' as const }] })
    })
    assert.equal(evidence.resolve(proposal), undefined, 'the prior witness no longer matches the registered manifest')
    assert.throws(() => engine.confirmCompletion(proposal), (error: unknown) => error instanceof UserError && error.code === 'verificationUnavailable')
    assert.equal(context.store.domain.tickets.get<{ ended?: unknown }>('ticket-1')?.ended, undefined)
    void candidate
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('acceptance and quiescence records are immutable over their full body', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-immutable-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { candidate, barrier } = await prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    const accepted = { id: 'a1', candidate, artifactDigest: artifact, criterionIds: ['review'], actorRef: 'user-1' }
    evidence.recordAcceptance(accepted)
    assert.throws(() => evidence.recordAcceptance({ ...accepted, actorRef: 'actor-2' }), EvidenceConflict, 'a different actor conflicts')
    assert.throws(() => evidence.recordAcceptance({ ...accepted, artifactDigest: 'd'.repeat(64) }), EvidenceConflict)
    assert.throws(() => evidence.recordAcceptance({ ...accepted, candidate: { ...candidate, candidateGeneration: candidate.candidateGeneration + 1 } }), EvidenceConflict)
    assert.throws(() => evidence.recordAcceptance({ ...accepted, criterionIds: ['other'] }), EvidenceConflict)

    evidence.recordQuiescence({ id: 'q2', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier })
    assert.throws(() => evidence.recordQuiescence({ id: 'q2', candidate, artifactDigest: 'd'.repeat(64), attemptId: 'attempt-1', barrier }), EvidenceConflict)
    assert.throws(() => evidence.recordQuiescence({ id: 'q2', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier: { ...barrier, confirmedEventSeq: barrier.confirmedEventSeq + 1 } }), QuiescenceUnavailable)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('quiescence requires the current pointer, the barrier topic, the producer identity and a committed command result', async () => {
  const context = makeStore()
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const candidate: CandidateRef = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 }
    seedBinding(context.store, candidate)
    const barrier = confirmBarrier(context.store, candidate, 'attempt-1')
    const event = context.store.events.after(barrier.confirmedEventSeq - 1, 1)[0]!
    const payload = event.payload as Record<string, unknown>
    const commandId = String(payload.barrierCommandId)
    const record = (id: string) => evidence.recordQuiescence({ id, candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier })
    const restorePayload = (value: Record<string, unknown>) => context.store.db.prepare('UPDATE event_log SET payload = ? WHERE seq = ?')
      .run(JSON.stringify(value), barrier.confirmedEventSeq)

    context.store.db.prepare('UPDATE event_log SET topic = ? WHERE seq = ?').run('unrelated.observation', barrier.confirmedEventSeq)
    assert.throws(() => record('q-topic'), QuiescenceUnavailable, 'an unrelated event topic is not a host barrier')
    context.store.db.prepare('UPDATE event_log SET topic = ? WHERE seq = ?').run('runtime.barrier.confirmed', barrier.confirmedEventSeq)

    context.store.db.prepare('DELETE FROM command_receipts WHERE command_id = ?').run(commandId)
    assert.throws(() => record('q-command'), QuiescenceUnavailable, 'an uncommitted barrier command result is not proof')
    context.store.commands.record(commandId, 'a'.repeat(64), () => barrier)

    restorePayload({ ...payload, runnerIdentityRef: 'runner-other' })
    assert.throws(() => record('q-producer'), QuiescenceUnavailable, 'another producer identity cannot confirm this barrier')
    restorePayload({ ...payload, source: 'other-source' })
    assert.throws(() => record('q-source'), QuiescenceUnavailable)
    restorePayload(payload)

    assert.doesNotThrow(() => record('q-good'))
    // A newer current epoch invalidates the attempt even though its own binding remains ended.
    context.store.uow.atomic(() => {
      context.store.bindings.record({
        ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, attemptId: 'attempt-2', fenceEpoch: 2, contract,
        runnerIdentityRef: 'runner-1', source: 'codex', state: 'active', resources: [],
      })
      context.store.bindings.setCurrent(candidate.ticketId, 'attempt-2')
    })
    assert.throws(() => record('q-late'), QuiescenceUnavailable, 'the barrier attempt is no longer the current registration')
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
})

test('an empty registered manifest completes only without a writer fact', async () => {
  const context = makeStore()
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const candidate: CandidateRef = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 }
    seedBinding(context.store, candidate, [])
    const barrier = confirmBarrier(context.store, candidate, 'attempt-1', [], [])
    assert.equal(barrier.writerFactId, undefined)
    assert.throws(() => evidence.recordQuiescence({ id: 'q-empty-bad', candidate, artifactDigest: artifact, attemptId: 'attempt-1',
      barrier: { ...barrier, writerFactId: 'fact-forged' } }), QuiescenceUnavailable)
    evidence.recordQuiescence({ id: 'q-empty', candidate, artifactDigest: artifact, attemptId: 'attempt-1', barrier })
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
})

test('moving the current pointer after recording invalidates the resolved evidence', async () => {
  const context = makeStore()
  const workspacePath = mkdtempSync(join(tmpdir(), 'wp04-pointer-'))
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const { engine, candidate, proposal } = await prepare(context.store, evidence, workspacePath, 'process.exit(0)')
    assert.ok(evidence.resolve(proposal))
    context.store.uow.atomic(() => {
      context.store.bindings.record({
        ticketId: candidate.ticketId, assignmentId: candidate.assignmentId, attemptId: 'attempt-2', fenceEpoch: 2, contract,
        runnerIdentityRef: 'runner-2', source: 'codex', state: 'active', resources: [{ ref: 'active-writer-2', ownership: 'spawned_process' }],
      })
      context.store.bindings.setCurrent(candidate.ticketId, 'attempt-2')
    })
    assert.equal(evidence.resolve(proposal), undefined, 'a newer current attempt invalidates the prior barrier')
    assert.throws(() => engine.confirmCompletion(proposal), (error: unknown) => error instanceof UserError && error.code === 'verificationUnavailable')
    assert.equal(context.store.domain.tickets.get<{ ended?: unknown }>('ticket-1')?.ended, undefined)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  }
})

test('Verification intake is strictly validated', async () => {
  const context = makeStore()
  try {
    const evidence = new CompletionEvidenceStore(context.store)
    const candidate: CandidateRef = { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 }
    const malformed = { ...candidate, id: 'verification:x' } as unknown as Verification
    assert.throws(() => evidence.recordVerification(malformed), InvalidEvidence)
    const formal: Verification = {
      ...candidate, id: 'verification:1', artifactDigest: artifact, criteriaDigest: 'c'.repeat(64), environmentRef: 'env-1',
      verifierIdentityRef: 'verifier:test', results: [{ criterionId: 'unit', outcome: 'PASS', evidenceRefs: ['ev-1'] }],
    }
    evidence.recordVerification(formal)
    evidence.recordVerification(formal)
    assert.throws(() => evidence.recordVerification({ ...formal, artifactDigest: 'd'.repeat(64) }), EvidenceConflict)
  } finally {
    context.store.close()
    rmSync(context.dir, { recursive: true, force: true })
  }
})
