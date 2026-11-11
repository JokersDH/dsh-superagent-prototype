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

function fixture(): { store: ProductStore; seq: number; reopen(): ProductStore; path: string } {
  let dir = tmp('acceptance-')
  const path = join(dir, 'state.sqlite')
  let store = new ProductStore({ path })
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
  return {
    get store() { return store }, seq, path,
    reopen() {
      store.close()
      store = new ProductStore({ path })
      return store
    },
  }
}

test('accepted event projects one exact outcome and preserves unknown timing as null', () => {
  const fixtureA = fixture()
  const { store, seq } = fixtureA
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

    const reopened = fixtureA.reopen()
    const reopenedPorts = createWorkflowPorts(reopened)
    const replayed = reopenedPorts.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' })
    assert.equal(replayed.status, 'replayed')
    assert.equal(reopenedPorts.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 1, 'reopen does not double-count')
    assert.equal(reopened.events.after(0, 100).filter(event => event.topic === 'application.candidate.accepted').length, 1)
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


test('acceptance.consume joins the accepting transaction and a later failure rolls the outcome back', () => {
  const { store, seq: _ } = fixture()
  try {
    const ports = createWorkflowPorts(store)
    let seq = 0
    assert.throws(() => store.uow.atomic(() => {
      seq = store.events.append({ topic: 'application.candidate.accepted', entityRef: 'work-author',
        payload: { candidate, actorRef: 'actor-1', reviewTiming: timed } })
      const result = ports.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' })
      assert.equal(result.status, 'recorded')
      store.events.append({ topic: 'application.work.changed', entityRef: 'work-author', payload: { workId: 'work-author' } })
      throw new Error('injected post-accept failure')
    }), /injected post-accept failure/)
    assert.equal(ports.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 0, 'outcome rolls back with the acceptance')
    assert.equal(store.events.after(0, 100).filter(event => event.topic === 'application.candidate.accepted').length, 1, 'only the fixture event exists')
    assert.equal(store.events.after(0, 100).some(event => event.topic === 'application.work.changed'), false)
  } finally {
    store.close()
    rmSync(join(store.database.path, '..'), { recursive: true, force: true })
  }
})

test('a new candidate on the same work gets its own outcome; the older accepted outcome stays readable', () => {
  const { store, seq } = fixture()
  try {
    const ports = createWorkflowPorts(store)
    const first = ports.acceptance.consume({ eventSeq: seq, projectId: 'project-1', profileRef, layer: 'controlled' })
    assert.equal(first.status, 'recorded')
    const second: CandidateRef = { ...candidate, candidateGeneration: 2 }
    store.uow.atomic(() => {
      // The same ended attempt produced a second candidate generation; a different attempt for the
      // same assignment would be ambiguous and must not be silently chosen.
      store.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('verification-2', 'author-ticket', 'author-assignment', 2, JSON.stringify(contract), 'e'.repeat(64),
          'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
    })
    const secondSeq = store.events.append({ topic: 'application.candidate.accepted', entityRef: 'work-author',
      payload: { candidate: second, actorRef: 'actor-1', reviewTiming: { ...timed, activeReviewMs: 5000,
        activeReviewSource: 'ui_visibility_proxy', activeReviewCompleteness: 'partial' } } })
    const next = ports.acceptance.consume({ eventSeq: secondSeq, projectId: 'project-1', profileRef, layer: 'controlled' })
    assert.equal(next.status, 'recorded')
    if (first.status !== 'recorded' || next.status !== 'recorded') return
    assert.notEqual(next.outcome.id, first.outcome.id)
    assert.equal(next.outcome.reviewTiming!.activeReviewMs, 5000)
    assert.equal(ports.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 2)
    assert.equal(ports.routingEvidence.outcomes.get(first.outcome.id)!.candidate!.candidateGeneration, 1)
    assert.equal(ports.acceptance.consume({ eventSeq: secondSeq, projectId: 'project-1', profileRef, layer: 'controlled' }).status, 'replayed')
    assert.equal(ports.routingEvidence.outcomes.list({ projectId: 'project-1' }).records.length, 2, 'replay does not double-count')
  } finally {
    store.close()
    rmSync(join(store.database.path, '..'), { recursive: true, force: true })
  }
})
