/** Wave-05 A: immutable routing/review/outcome evidence, scoped bounded queries and source projection. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore, canonicalDigest } from '@personal-agent/storage'
import type {
  ExecutionOutcome, ReviewEvidence, RouteAdvice, ReviewSubject,
} from '@personal-agent/contracts'
import { createWorkflowPorts, WorkflowConflict, WorkflowSnapshots } from '../src/index.ts'

const at = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-author', revision: 1, digest: 'a'.repeat(64) }
const reviewerContract = { workId: 'work-review', revision: 1, digest: 'b'.repeat(64) }
const profile = { profileId: 'codex', revision: 3, identityDigest: 'a'.repeat(64) }
const subject: ReviewSubject = {
  candidate: { ticketId: 'author-ticket', assignmentId: 'author-assignment', contract, candidateGeneration: 2 },
  artifactDigest: 'd'.repeat(64), baseCommit: 'b'.repeat(40), environmentRef: 'environment-1', checkPolicyRef: 'policy-1',
}
const advice = (overrides: Partial<RouteAdvice> = {}): RouteAdvice => ({
  protocol: 'route-advice/1', id: 'advice-1', projectId: 'project-1', sourceRef: 'source-1',
  taskContextDigest: 'a'.repeat(64), catalogRevision: 'c'.repeat(64), policyRevision: 'policy-1',
  eligibleProfileRefs: [profile], suggestedProfileRef: profile, excluded: [], basis: 'only_eligible',
  evidenceRefs: ['evidence-1'], reviewSuggested: true,
  createdAt: at, expiresAt: '2026-11-11T00:00:00.000Z', ...overrides,
})
const review = (overrides: Partial<ReviewEvidence> = {}): ReviewEvidence => ({
  protocol: 'review-evidence/1', id: 'review-1', projectId: 'project-1', subject,
  reviewerProfileRef: profile,
  reviewAttempt: { ticketId: 'review-ticket', assignmentId: 'review-assignment', attemptId: 'review-attempt', fenceEpoch: 1, contract: reviewerContract },
  inputDigest: 'a'.repeat(64), reportDigest: 'e'.repeat(64), reportArtifactRef: 'review-report-1',
  isolation: { kind: 'sealed_copy', proofRef: 'capsule-proof-1', capsuleManifestDigest: 'a'.repeat(64) },
  evidenceRefs: ['review-evidence-1'], layer: 'controlled', disposition: 'no_findings', observedAt: at, ...overrides,
})
const outcome = (overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome => ({
  protocol: 'execution-outcome/1', id: 'outcome-1', projectId: 'project-1',
  attempt: { ticketId: 'author-ticket', assignmentId: 'author-assignment', attemptId: 'author-attempt', fenceEpoch: 1, contract },
  profileRef: profile, candidate: subject.candidate, verificationRef: 'verification-1', artifactDigest: 'd'.repeat(64),
  acceptance: 'accepted', acceptanceRef: 'acceptance-1', evidenceRefs: ['outcome-evidence-1'],
  layer: 'actual_native', usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: at,
  ...overrides,
})
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

test('routing evidence is immutable, project-scoped, replayable and cursor-bounded', () => {
  const dir = tmp('routing-evidence-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const port = createWorkflowPorts(store).routingEvidence
    assert.equal(port.advice.put(advice()).replayed, false)
    assert.equal(port.advice.put(advice()).replayed, true)
    assert.throws(() => port.advice.put(advice({ reviewSuggested: false })), WorkflowConflict)
    assert.equal(port.advice.get('advice-1')!.projectId, 'project-1')
    assert.equal(port.advice.list({ projectId: 'project-1' }).records.length, 1)
    assert.equal(port.advice.list({ projectId: 'project-2' }).records.length, 0)
    assert.throws(() => port.advice.list({ projectId: '' }), WorkflowConflict)

    assert.equal(port.reviews.put(review()).replayed, false)
    assert.equal(port.reviews.put(review()).replayed, true)
    assert.throws(() => port.reviews.put(review({ layer: 'schema' })), WorkflowConflict)
    assert.equal(port.reviews.list({ projectId: 'project-1', subject }).records.length, 1)
    assert.equal(port.reviews.list({ projectId: 'project-1', subject: { ...subject, artifactDigest: 'e'.repeat(64) } }).records.length, 0)
    assert.equal(port.reviews.list({ projectId: 'project-2', subject }).records.length, 0)

    assert.equal(port.outcomes.put(outcome()).replayed, false)
    assert.equal(port.outcomes.put(outcome()).replayed, true)
    assert.throws(() => port.outcomes.put(outcome({ acceptance: 'rejected' })), WorkflowConflict)
    assert.equal(port.outcomes.list({ projectId: 'project-1', profile }).records.length, 1)
    assert.equal(port.outcomes.list({ projectId: 'project-1', profile: { ...profile, identityDigest: 'b'.repeat(64) } }).records.length, 0)

    // Stable cursor: two records with distinct times, no duplicate or skipped row.
    assert.equal(port.advice.put(advice({ id: 'advice-2', createdAt: '2026-11-10T00:01:00.000Z', expiresAt: '2026-11-11T00:01:00.000Z' })).replayed, false)
    const first = port.advice.list({ projectId: 'project-1', limit: 1 })
    assert.equal(first.records.length, 1)
    assert.ok(first.nextCursor)
    const second = port.advice.list({ projectId: 'project-1', limit: 1, cursor: first.nextCursor })
    assert.equal(second.records.length, 1)
    assert.notEqual(first.records[0]!.id, second.records[0]!.id)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('routing evidence joins the caller transaction and rolls back every record on failure', () => {
  const dir = tmp('routing-tx-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const port = createWorkflowPorts(store).routingEvidence
    assert.throws(() => store.uow.atomic(() => {
      port.advice.put(advice())
      port.reviews.put(review())
      store.events.append({ topic: 'routing.evidence.changed', entityRef: 'advice-1', payload: { ok: true } })
      throw new Error('injected failure')
    }), /injected failure/)
    assert.equal(port.advice.get('advice-1'), undefined)
    assert.equal(port.reviews.get('review-1'), undefined)
    assert.equal(store.events.after(0, 10).length, 0)
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM route_advice').get() as { n: number }).n, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('source projection rebuilds attempt evidence without claiming artifact ownership', () => {
  const dir = tmp('routing-sources-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    store.uow.atomic(() => {
      store.product.works.insert({ id: 'work-author', projectId: 'project-1', conversationId: 'conversation-1', title: 'Author', createdAt: at })
      store.bindings.record({
        attemptId: 'author-attempt', ticketId: 'author-ticket', assignmentId: 'author-assignment', fenceEpoch: 1,
        contract, state: 'ended', runnerIdentityRef: 'runner-1', source: 'controlled', resources: [],
      })
      store.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('verification-1', 'author-ticket', 'author-assignment', 2, JSON.stringify(contract), 'd'.repeat(64),
          'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
      store.db.prepare(`INSERT INTO completion_acceptances
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criterion_ids, actor_ref, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('acceptance-1', 'author-ticket', 'author-assignment', 2, JSON.stringify(contract), 'd'.repeat(64),
          '["unit"]', 'actor-1', at)
    })
    const sources = createWorkflowPorts(store).routingEvidence.sources('author-attempt', 'project-1')!
    assert.equal(sources.attempt.ticketId, 'author-ticket')
    assert.equal(sources.attempt.state, 'ended')
    assert.equal(sources.verifications[0]!.artifactDigest, 'd'.repeat(64))
    assert.equal(sources.acceptances[0]!.criterionIds[0], 'unit')
    assert.equal(sources.usage.completeness, 'unknown', 'missing usage is unknown, never zero cost/time')
    assert.equal((sources as unknown as { artifacts?: unknown }).artifacts, undefined)
    assert.equal(createWorkflowPorts(store).routingEvidence.sources('author-attempt', 'project-2'), undefined)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('routing records re-open in a second process and review report artifacts are snapshot-complete', async () => {
  const dir = tmp('routing-reopen-')
  const missingDir = tmp('routing-missing-artifact-')
  let store = new ProductStore({ path: join(dir, 'state.sqlite') })
  let destination = join(dir, 'snapshot')
  try {
    const missingStore = new ProductStore({ path: join(missingDir, 'state.sqlite') })
    try {
      createWorkflowPorts(missingStore).routingEvidence.reviews.put(review())
      const missing = await new WorkflowSnapshots(missingStore).create({ destination: join(missingDir, 'snapshot') })
      assert.equal(missing.status, 'blocked', 'review report artifact is not present in the artifact registry')
      assert.equal(missing.manifest.missingReferences.includes('review-report-1'), true)
    } finally { missingStore.close() }

    const port = createWorkflowPorts(store).routingEvidence
    port.advice.put(advice())
    port.outcomes.put(outcome())
    const report = store.artifacts.write(Buffer.from('review report\n'))
    store.artifacts.insert(report)
    port.reviews.put(review({ id: 'review-with-artifact', reportArtifactRef: report.id }))
    const complete = await new WorkflowSnapshots(store).create({ destination })
    assert.equal(complete.status, 'ok', complete.message)
    assert.equal(complete.manifest.referencedArtifacts.includes(report.id), true)
    store.close()

    store = new ProductStore({ path: join(dir, 'state.sqlite') })
    try {
      const reopened = createWorkflowPorts(store).routingEvidence
      assert.equal(reopened.reviews.get('review-with-artifact')!.reportArtifactRef, report.id)
      assert.equal(reopened.outcomes.get('outcome-1')!.acceptance, 'accepted')
      await assert.rejects(() => new WorkflowSnapshots(store).create({ destination }), /must not already exist/)
    } finally { store.close() }
  } finally {
    if (store.database.productSchema) store.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(missingDir, { recursive: true, force: true })
  }
})


test('single-work timeline links persisted evidence without inventing causality', () => {
  const dir = tmp('routing-timeline-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    store.uow.atomic(() => {
      store.product.works.insert({ id: 'work-author', projectId: 'project-1', conversationId: 'conversation-1', title: 'Author', createdAt: at })
      store.product.contracts.append({
        ...contract, goal: 'Deliver', scope,
        criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
        authorityRef: 'authority-1', createdAt: at,
      })
      store.product.links.attach({ contract, ticketId: 'author-ticket', role: 'primary', authorityRef: 'authority-1' })
      ports.routingEvidence.reviews.put(review())
      ports.routingEvidence.outcomes.put(outcome())
    })
    const timeline = ports.index.timeline({ workId: 'work-author', projectIds: ['project-1'], limit: 50 })!
    assert.equal(timeline.truncated, false)
    assert.deepEqual(new Set(timeline.entries.map(item => item.kind)), new Set([
      'work.created', 'contract.revision', 'ticket.link', 'review.recorded', 'execution.outcome',
    ]))
    assert.equal(timeline.entries.some(item => item.kind === 'review.recorded' && item.sourceRef === 'review-1'), true)
    assert.equal(ports.index.timeline({ workId: 'work-author', projectIds: ['project-2'] }), undefined)
    assert.equal(ports.index.timeline({ workId: 'missing', projectIds: ['project-1'] }), undefined)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
