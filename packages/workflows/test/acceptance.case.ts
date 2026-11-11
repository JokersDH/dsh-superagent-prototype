/** Wave-06 A2: accepted event -> exact outcome projection, no duplicate acceptance or invented facts. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import type { CandidateRef, ExecutionProfileRef } from '@personal-agent/contracts'
import { createWorkflowPorts } from '../src/index.ts'

const at = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-author', revision: 1, digest: 'a'.repeat(64) }
const profileRef: ExecutionProfileRef = { profileId: 'codex', revision: 3, identityDigest: 'a'.repeat(64) }
const candidate: CandidateRef = { ticketId: 'author-ticket', assignmentId: 'author-assignment', contract, candidateGeneration: 1 }
const timed = {
  candidateReadyAt: '2026-11-10T00:00:00.000Z', acceptedAt: '2026-11-10T00:00:10.000Z',
  readyToAcceptanceMs: 10000, activeReviewMs: null, activeReviewSource: 'unknown' as const,
  activeReviewCompleteness: 'unknown' as const, evidenceRefs: [],
}
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

function fixture(): { store: ProductStore; seq: number } {
  const store = new ProductStore({ path: join(tmp('acceptance-'), 'state.sqlite') })
  let seq = 0
  store.uow.atomic(() => {
    store.product.works.insert({ id: 'work-author', projectId: 'project-1', conversationId: 'conversation-1', title: 'Author', createdAt: at })
    store.product.contracts.append({ ...contract, goal: 'Deliver', scope,
      criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
      authorityRef: 'authority-1', createdAt: at })
    store.product.links.attach({ contract, ticketId: 'author-ticket', role: 'primary', authorityRef: 'authority-1' })
    store.bindings.record({
      attemptId: 'author-attempt', ticketId: 'author-ticket', assignmentId: 'author-assignment', fenceEpoch: 2,
      contract, state: 'ended', runnerIdentityRef: 'runner-1', source: 'controlled-product-fixture', resources: [],
    })
    store.db.prepare(`INSERT INTO completion_verifications
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
       environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('verification-1', 'author-ticket', 'author-assignment', 1, JSON.stringify(contract), 'd'.repeat(64),
        'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
    store.db.prepare(`INSERT INTO completion_acceptances
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criterion_ids, actor_ref, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('acceptance-1', 'author-ticket', 'author-assignment', 1, JSON.stringify(contract), 'd'.repeat(64),
        '["unit"]', 'actor-1', at)
    seq = store.events.append({ topic: 'application.candidate.accepted', entityRef: 'work-author',
      payload: { candidate, actorRef: 'actor-1', reviewTiming: timed } })
  })
  return { store, seq }
}

test('accepted event projects one exact outcome and preserves unknown timing as null', () => {
  const { store, seq } = fixture()
  try {
    const ports = createWorkflowPorts(store)
    const result = ports.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' })
    assert.equal(result.status, 'recorded')
    if (result.status !== 'recorded') return
    assert.equal(result.outcome.candidate!.assignmentId, 'author-assignment')
    assert.equal(result.outcome.attempt.attemptId, 'author-attempt')
    assert.equal(result.outcome.profileRef.identityDigest, profileRef.identityDigest)
    assert.equal(result.outcome.verificationRef, 'verification-1')
    assert.equal(result.outcome.acceptanceRef, 'acceptance-1')
    assert.equal(result.outcome.reviewTiming!.readyToAcceptanceMs, 10000)
    assert.equal(result.outcome.reviewTiming!.activeReviewMs, null)
    assert.equal(ports.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' }).status, 'replayed')
    assert.equal(store.events.after(0, 100).filter(event => event.topic === 'application.candidate.accepted').length, 1, 'never append a second accepted event')
    assert.equal(ports.routingEvidence.outcomes.get(result.outcome.id)!.acceptance, 'accepted')

    const timeline = ports.index.timeline({ workId: 'work-author', projectIds: ['project-1'] })!
    assert.equal(timeline.entries.some(entry => entry.kind === 'execution.outcome'), true)
    assert.equal((timeline.entries.find(entry => entry.kind === 'execution.outcome')!.detail as { reviewTiming: { activeReviewMs: null } }).reviewTiming.activeReviewMs, null)
  } finally {
    store.close()
    rmSync(join(store.database.path, '..'), { recursive: true, force: true })
  }
})

test('missing attempt/verification/acceptance or wrong project yields an auditable gap and writes no outcome', () => {
  const { store, seq } = fixture()
  try {
    const ports = createWorkflowPorts(store)
    const wrongProject = ports.acceptance.consume({ eventSeq: seq, projectId: 'project-2', profileRef, layer: 'controlled' })
    assert.equal(wrongProject.status, 'incomplete')
    if (wrongProject.status === 'incomplete') assert.deepEqual(wrongProject.reasons, ['work_project_mismatch'])
    assert.equal(ports.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 0)

    store.db.prepare('DELETE FROM completion_acceptances').run()
    const eventAccepted = ports.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' })
    assert.equal(eventAccepted.status, 'recorded')
    if (eventAccepted.status === 'recorded') assert.equal(eventAccepted.outcome.acceptanceRef, `accepted-event-${seq}`)
    store.db.prepare('DELETE FROM completion_verifications').run()
    assert.equal(ports.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 1)
    const missing = ports.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' })
    assert.equal(missing.status, 'incomplete')
    if (missing.status === 'incomplete') assert.deepEqual(missing.reasons, ['verification_missing'])
    assert.equal(ports.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 1)
    assert.equal(ports.acceptance.consume({ eventSeq: 9999, projectId: 'project-1', profileRef, layer: 'controlled' }).status, 'incomplete')
  } finally {
    store.close()
    rmSync(join(store.database.path, '..'), { recursive: true, force: true })
  }
})
