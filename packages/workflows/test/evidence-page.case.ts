/** Wave-07 A3: bounded work-evidence pages with explicit caller-limit vs storage-cap vs complete. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowConflict } from '../src/index.ts'

const at = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-evidence', revision: 1, digest: 'a'.repeat(64) }
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

function seed(store: ProductStore) {
  store.uow.atomic(() => {
    store.product.works.insert({ id: 'work-evidence', projectId: 'project-1', conversationId: 'conversation-1', title: 'Evidence', createdAt: at })
    store.product.works.insert({ id: 'work-other', projectId: 'project-2', conversationId: 'conversation-2', title: 'Other', createdAt: at })
    store.product.contracts.append({ ...contract, goal: 'Deliver', scope,
      criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
      authorityRef: 'authority-1', createdAt: at })
    store.product.links.attach({ contract, ticketId: 'ticket-1', role: 'primary', authorityRef: 'authority-1' })
    for (let index = 0; index < 5; index += 1) {
      store.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`verification-${index}`, 'ticket-1', 'assignment-1', index + 1, JSON.stringify(contract),
          String(index).padStart(64, '0'), 'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
    }
  })
  const ports = createWorkflowPorts(store)
  for (let index = 0; index < 3; index += 1) ports.routingEvidence.outcomes.put({
    protocol: 'execution-outcome/1', id: `outcome-${index}`, projectId: 'project-1',
    attempt: { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: `attempt-${index}`, fenceEpoch: 1, contract },
    profileRef: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) }, acceptance: 'unknown',
    evidenceRefs: [], layer: 'controlled', usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: at,
  })
}

test('evidence pages are stable across ties, scoped by project and distinguish window causes', () => {
  const dir = tmp('evidence-page-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    seed(store)
    const index = createWorkflowPorts(store).index
    const first = index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 3 })!
    assert.equal(first.entries.length, 3)
    assert.equal(first.hasMore, true)
    assert.equal(first.window, 'caller_limit')
    assert.ok(first.nextCursor)
    const second = index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 3, cursor: first.nextCursor })!
    const seen = [...first.entries, ...second.entries].map(entry => `${entry.at}|${entry.kind}|${entry.sourceRef}`)
    assert.equal(new Set(seen).size, seen.length, 'pages do not duplicate or skip tied rows')
    let cursor = second.nextCursor, pages = 2
    let last = second
    while (cursor) {
      last = index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 3, cursor })!
      assert.equal(last.hasMore || last.window !== 'caller_limit', true)
      cursor = last.nextCursor
      pages += 1
      assert.ok(pages < 20)
    }
    assert.equal(last.window, 'complete')
    assert.equal(index.evidencePage({ workId: 'work-evidence', projectIds: ['project-2'] }), undefined)
    // Historical/revoked decisions remain auditable with source state separate from effectiveness.
    const full = index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 200 })!
    assert.equal(full.window === 'complete' || full.window === 'storage_cap', true)
    assert.equal(full.entries.some(entry => entry.kind === 'execution.outcome'), true)
    assert.equal(index.evidencePage({ workId: 'work-other', projectIds: ['project-1'] }), undefined)
    assert.throws(() => index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], cursor: 'a\u0000b\u0000c' }), WorkflowConflict)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a capped source is reported as storage_cap, never silently complete', () => {
  const dir = tmp('evidence-cap-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    seed(store)
    store.uow.atomic(() => {
      for (let index = 5; index < 206; index += 1) {
        store.db.prepare(`INSERT INTO completion_verifications
          (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
           environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(`verification-${index}`, 'ticket-1', 'assignment-1', index + 1, JSON.stringify(contract),
            String(index).padStart(64, '0'), 'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
      }
    })
    const index = createWorkflowPorts(store).index
    let page = index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 200 })!
    let pages = 1
    while (page.hasMore) {
      assert.equal(page.window, 'caller_limit')
      assert.ok(page.nextCursor)
      page = index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 200, cursor: page.nextCursor })!
      pages += 1
      assert.ok(pages < 10)
    }
    assert.equal(page.window, 'storage_cap')
    assert.equal(page.sourcesCapped?.includes('verifications'), true)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('partial review timing is visible in pages, and a cursor from another work is refused', () => {
  const dir = tmp('evidence-timing-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    seed(store)
    const ports = createWorkflowPorts(store)
    ports.routingEvidence.outcomes.put({
      protocol: 'execution-outcome/1', id: 'outcome-timed', projectId: 'project-1',
      attempt: { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-timed', fenceEpoch: 1, contract },
      profileRef: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) }, acceptance: 'unknown',
      evidenceRefs: [], layer: 'controlled', usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: at,
      reviewTiming: { candidateReadyAt: at, acceptedAt: '2026-11-11T00:01:40.000Z', readyToAcceptanceMs: 100000,
        activeReviewMs: 5000, activeReviewSource: 'ui_visibility_proxy', activeReviewCompleteness: 'partial',
        evidenceRefs: ['review-activity:1'] },
    })
    const page = ports.index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 200 })!
    const outcome = page.entries.find(entry => entry.sourceRef === 'outcome-timed')!
    assert.equal((outcome.detail as { reviewTiming: { activeReviewMs: number; activeReviewCompleteness: string } })
      .reviewTiming.activeReviewMs, 5000)
    assert.equal((outcome.detail as { reviewTiming: { activeReviewCompleteness: string } }).reviewTiming.activeReviewCompleteness, 'partial')

    const paged = ports.index.evidencePage({ workId: 'work-evidence', projectIds: ['project-1'], limit: 3 })!
    const foreignCursor = paged.nextCursor
    if (!foreignCursor) throw new Error('expected a page cursor')
    assert.throws(() => ports.index.evidencePage({ workId: 'work-other', projectIds: ['project-2'], cursor: foreignCursor }),
      WorkflowConflict)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
