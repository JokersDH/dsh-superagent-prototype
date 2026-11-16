/** Wave-33 A: bounded keyset continuation over existing completion facts. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '../src/index.ts'

const at = '2026-11-16T00:00:00.000Z'
const contract = { workId: 'wave33-work', revision: 1, digest: 'a'.repeat(64) }
const scope = { projectId: 'wave33-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }

test('completion history continues beyond the 50-row source cap by stable keyset pages', () => {
  const root = mkdtempSync(join(tmpdir(), 'wave33-history-')), path = join(root, 'state.sqlite')
  mkdirSync(join(root, 'artifacts'), { recursive: true })
  const store = new ProductStore({ path })
  try {
    store.uow.atomic(() => {
      store.product.works.insert({ id: 'wave33-work', projectId: 'wave33-project', conversationId: 'wave33-chat', title: 'History', createdAt: at })
      store.product.contracts.append({ ...contract, goal: 'History', scope,
        criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
        authorityRef: 'authority-1', createdAt: at })
      store.product.links.attach({ contract, ticketId: 'wave33-ticket', role: 'primary', authorityRef: 'authority-1' })
      const insert = store.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (let index = 0; index < 120; index += 1) insert.run(`verification-${String(index).padStart(3, '0')}`, 'wave33-ticket',
        'wave33-assignment', 1, JSON.stringify(contract), 'd'.repeat(64), 'c'.repeat(64), 'environment-1', 'verifier-1',
        '[]', index % 2 ? at : '2026-11-15T23:59:59.000Z')
    })
    const ports = createWorkflowPorts(store)
    const first = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', limit: 50 })
    assert.equal(first.returned, 50); assert.equal(first.available, 120); assert.equal(first.hasMore, true)
    assert.equal(first.coverage, 'truncated'); assert.ok(first.nextCursor)
    const second = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', limit: 50, cursor: first.nextCursor! })
    const third = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', limit: 50, cursor: second.nextCursor! })
    assert.equal(second.returned, 50); assert.equal(third.returned, 20); assert.equal(third.hasMore, false)
    const ids = [...first.entries, ...second.entries, ...third.entries].map(entry => (entry as any).verification.id)
    assert.equal(new Set(ids).size, 120)
    const zero = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', limit: 0 })
    assert.equal(zero.returned, 0); assert.equal(zero.hasMore, true); assert.equal(zero.nextCursor, null); assert.equal(zero.coverage, 'truncated')
    assert.throws(() => ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['other-project'], kind: 'verifications' }))
    assert.throws(() => ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', cursor: 'not-a-cursor' }))
    assert.throws(() => ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'attempts', cursor: first.nextCursor! }))
    const reviews = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'reviews', limit: 3 })
    assert.equal(reviews.returned, 3); assert.equal(reviews.coverage, 'truncated')
    const huge = 'x'.repeat(4 * 1024 * 1024 + 1024)
    store.db.prepare(`INSERT INTO completion_verifications
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
       environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('verification-huge', 'wave33-ticket', 'wave33-assignment', 1, JSON.stringify(contract), 'd'.repeat(64), 'c'.repeat(64),
        'environment-1', 'verifier-1', JSON.stringify(huge), '2026-11-17T00:00:00.000Z')
    const blocked = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', limit: 1 })
    assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reason, 'entry_too_large')
    assert.equal(blocked.returned, 0); assert.equal(blocked.hasMore, true); assert.equal(blocked.nextCursor, null)
    const medium = JSON.stringify('m'.repeat(22000))
    const insertMedium = store.db.prepare(`INSERT INTO completion_verifications
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
       environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (let index = 0; index < 205; index += 1) insertMedium.run(`verification-medium-${String(index).padStart(3, '0')}`, 'wave33-ticket',
      'wave33-assignment', 1, JSON.stringify(contract), 'd'.repeat(64), 'c'.repeat(64), 'environment-1', 'verifier-1', medium, '2026-11-18T00:00:00.000Z')
    const budget = ports.index.completionHistory({ workId: 'wave33-work', projectIds: ['wave33-project'], kind: 'verifications', limit: 200 })
    assert.equal(budget.status, 'ok'); assert.equal(budget.hasMore, true); assert.ok(budget.nextCursor)
    assert.ok(budget.returned > 0 && budget.returned < 200)
    assert.equal(Buffer.byteLength(JSON.stringify(budget)) <= budget.limits.maxBytes, true)
    console.log('WAVE35_EXACT_BUDGET', JSON.stringify({ status: budget.status, returned: budget.returned, hasMore: budget.hasMore,
      bytes: Buffer.byteLength(JSON.stringify(budget)), maxBytes: budget.limits.maxBytes, nextCursor: Boolean(budget.nextCursor) }))
    console.log('WAVE33_CONTINUATION', JSON.stringify({ pages: [first.returned, second.returned, third.returned], unique: new Set(ids).size,
      available: first.available, zeroHasMore: zero.hasMore, reviewsReturned: reviews.returned }))
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
