/**
 * Wave-02 A2 product records: frozen Work/contract/link records, sequenced conversation messages,
 * versioned questions with CAS, the dispatch switch, and real-SQLite upgrade/reopen. The tests also
 * prove a product write participates in the caller's UnitOfWork (commit and rollback).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContractRevision, TicketLink, UserQuestion, WorkRecord } from '@personal-agent/contracts'
import { applyMigrations, DispatchConflict, MIGRATIONS, ProductConflict, ProductStore } from '../src/index.ts'
import type { NewConversationMessage } from '../src/index.ts'

const at = '2026-11-08T00:00:00.000Z'
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const revision = (revisionNumber = 1): ContractRevision => ({
  workId: 'work-1', revision: revisionNumber, digest: revisionNumber === 1 ? 'a'.repeat(64) : 'c'.repeat(64),
  goal: 'Deliver the change.', scope,
  criteria: [{ id: 'unit', kind: 'machine', description: 'Unit checks pass.', required: true, checkDefinitionRef: 'unit-check' }],
  authorityRef: 'authority-1', createdAt: at,
})
const work = (id: string, createdAt = at): WorkRecord => ({ id, projectId: 'project-1', conversationId: 'conv-1', title: `Work ${id}`, createdAt })
const link = (role: 'primary' | 'child', ticketId: string): TicketLink => ({ contract, ticketId, role, authorityRef: 'authority-1' })
const message = (id: string, text: string, conversationId = 'conv-1'): NewConversationMessage => ({
  id, conversationId, role: 'user', provenance: 'trusted_user', text, sourceRefs: [], createdAt: at,
})
const question = (overrides: Partial<UserQuestion> = {}): UserQuestion => ({
  id: 'q-1', version: 1, kind: 'clarification', contract, scope, prompt: 'Which target?', nativePayloadRef: 'payload-1',
  presentation: {
    kind: 'choices', multiple: false,
    options: [
      { id: 'opt-a', label: 'A', semantic: 'business_choice' },
      { id: 'opt-b', label: 'B', semantic: 'business_choice' },
    ],
  },
  targets: [{
    ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract,
    id: 'target-1', connectionEpoch: 1, nativeRequestId: { kind: 'string', value: 'req-1' }, nativeMethod: 'ask_user', provenanceRef: 'prov-1',
  }],
  openedAt: at, validity: 'open',
  ...overrides,
})
const freshDir = (): string => mkdtempSync(join(tmpdir(), 'product-records-'))

test('Work identity is frozen and indexed by project; contract revisions are append-only', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    assert.deepEqual(store.product.works.insert(work('work-1')), { created: true })
    assert.deepEqual(store.product.works.insert(work('work-1')), { created: false }, 'same body is idempotent')
    assert.throws(() => store.product.works.insert({ ...work('work-1'), title: 'Changed' }), ProductConflict)
    assert.equal(store.product.works.get('work-1')!.title, 'Work work-1')
    assert.equal('phase' in (store.product.works.get('work-1') as object), false, 'Work stores no execution phase')

    store.product.works.insert(work('work-2', '2026-11-08T00:00:01.000Z'))
    store.product.works.insert(work('work-3', '2026-11-08T00:00:02.000Z'))
    assert.deepEqual(store.product.works.listByProject('project-1', { limit: 2 }).map(item => item.id), ['work-3', 'work-2'])
    assert.deepEqual(store.product.works.listByProject('project-1', { limit: 5, before: '2026-11-08T00:00:02.000Z' }).map(item => item.id), ['work-2', 'work-1'])
    assert.deepEqual(store.product.works.listByProject('other', { limit: 5 }), [])

    assert.deepEqual(store.product.contracts.append(revision(1)), { created: true })
    assert.deepEqual(store.product.contracts.append(revision(1)), { created: false })
    assert.throws(() => store.product.contracts.append({ ...revision(1), goal: 'Rewritten' }), ProductConflict)
    assert.deepEqual(store.product.contracts.append(revision(2)), { created: true })
    assert.equal(store.product.contracts.getByRef(contract)!.goal, 'Deliver the change.')
    assert.deepEqual(store.product.contracts.history('work-1').map(item => item.revision), [2, 1])
    assert.equal(store.authority.current('work-1'), undefined, 'appending a revision does not grant authority')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ticket links are idempotent, one primary per contract revision, and ordered deterministically', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    assert.deepEqual(store.product.links.attach(link('primary', 'ticket-1')), { created: true })
    assert.deepEqual(store.product.links.attach(link('primary', 'ticket-1')), { created: false })
    assert.throws(() => store.product.links.attach({ ...link('primary', 'ticket-1'), role: 'child' }), ProductConflict)
    assert.throws(() => store.product.links.attach(link('primary', 'ticket-2')), ProductConflict, 'a second primary for the same revision is refused')
    assert.deepEqual(store.product.links.attach(link('child', 'ticket-2')), { created: true })
    assert.deepEqual(store.product.links.listByWork('work-1').map(item => `${item.role}:${item.ticketId}`), ['primary:ticket-1', 'child:ticket-2'])
    assert.deepEqual(store.product.links.listByRef(contract).map(item => item.ticketId), ['ticket-1', 'ticket-2'])
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('messages receive a persisted per-conversation sequence, replay idempotently, and page exclusively', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const first = store.product.messages.append(message('m1', 'one'))
    const second = store.product.messages.append(message('m2', 'two'))
    const third = store.product.messages.append(message('m3', 'three'))
    assert.deepEqual([first.sequence, second.sequence, third.sequence], [1, 2, 3])
    const replay = store.product.messages.append(message('m2', 'two'))
    assert.equal(replay.sequence, 2, 'a replay keeps its original order')
    assert.equal(store.product.messages.append(message('c1', 'other', 'conv-2')).sequence, 1, 'sequences are per conversation')
    assert.throws(() => store.product.messages.append(message('m2', 'changed')), ProductConflict)

    const page = store.product.messages.page('conv-1', { limit: 2 })
    assert.deepEqual(page.messages.map(item => item.id), ['m2', 'm3'], 'newest page in ascending order')
    assert.equal(page.hasMore, true)
    assert.equal(page.beforeCursor, 2)
    const older = store.product.messages.page('conv-1', { before: page.beforeCursor, limit: 2 })
    assert.deepEqual(older.messages.map(item => item.id), ['m1'])
    assert.equal(older.hasMore, false)
    assert.equal(store.product.messages.page('conv-1', { before: 1, limit: 2 }).messages.length, 0)
    assert.equal(store.product.messages.getById('m3')!.sequence, 3)
    assert.throws(() => store.product.messages.append({ ...message('bad', 'x'), role: 'tool' as never }))
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('questions are frozen by id and replaced only through a newer version with a matching validity CAS', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    assert.deepEqual(store.product.questions.insert(question()), { created: true })
    assert.deepEqual(store.product.questions.insert(question()), { created: false })
    assert.throws(() => store.product.questions.insert(question({ prompt: 'Rewritten' })), ProductConflict)
    assert.deepEqual(store.product.questions.listOpen().map(item => item.id), ['q-1'])
    assert.deepEqual(store.product.questions.listOpen({ workId: 'work-other' }), [])

    const answered = question({ version: 2, validity: 'answered' })
    assert.deepEqual(store.product.questions.replaceExpected(answered, { version: 1, validity: 'open' }), { updated: true })
    assert.equal(store.product.questions.get('q-1')!.validity, 'answered')
    assert.deepEqual(store.product.questions.listOpen(), [])
    assert.throws(() => store.product.questions.replaceExpected(question({ version: 2, validity: 'answered' }), { version: 1, validity: 'open' }), ProductConflict, 'a stale expected version is refused')
    assert.throws(() => store.product.questions.replaceExpected(question({ version: 2, validity: 'answered' }), { version: 2, validity: 'open' }), ProductConflict, 'validity is part of the CAS')
    assert.throws(() => store.product.questions.replaceExpected(question({ version: 2, validity: 'answered' }), { version: 2, validity: 'answered' }), ProductConflict, 'the version must advance')
    const otherContract = { workId: 'work-1', revision: 2, digest: 'c'.repeat(64) }
    assert.throws(() => store.product.questions.replaceExpected({
      ...question({ version: 3, validity: 'expired' }), contract: otherContract,
      targets: [{ ...question().targets[0]!, contract: otherContract }],
    }, { version: 2, validity: 'answered' }), ProductConflict, 'a question cannot change its contract identity')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the dispatch switch is a CAS record, not a Work phase', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    assert.equal(store.product.dispatchControls.get('global'), undefined)
    assert.deepEqual(store.product.dispatchControls.compareAndSet('global', 0, false), { paused: false, revision: 1 })
    assert.deepEqual(store.product.dispatchControls.compareAndSet('global', 1, true), { paused: true, revision: 2 })
    assert.throws(() => store.product.dispatchControls.compareAndSet('global', 1, false), DispatchConflict)
    assert.throws(() => store.product.dispatchControls.compareAndSet('global', 0, true), DispatchConflict)
    assert.deepEqual(store.product.dispatchControls.get('global'), { paused: true, revision: 2 })
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('product writes join the caller transaction and roll back with it', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    assert.throws(() => store.uow.atomic(() => {
      store.domain.tickets.save({ id: 'ticket-1', title: 'Committed candidate' })
      store.events.append({ topic: 'work.created', entityRef: 'work-1', payload: { ok: true } })
      store.product.works.insert(work('work-1'))
      store.product.links.attach(link('primary', 'ticket-1'))
      throw new Error('business rejection after product writes')
    }), /business rejection/)
    assert.equal(store.product.works.get('work-1'), undefined)
    assert.deepEqual(store.product.links.listByWork('work-1'), [])
    assert.equal(store.domain.tickets.get('ticket-1'), undefined)
    assert.equal(store.events.after(0, 10).length, 0)

    store.uow.atomic(() => {
      store.domain.tickets.save({ id: 'ticket-1', title: 'Committed candidate' })
      store.events.append({ topic: 'work.created', entityRef: 'work-1', payload: { ok: true } })
      store.product.works.insert(work('work-1'))
      store.product.links.attach(link('primary', 'ticket-1'))
    })
    assert.ok(store.domain.tickets.get('ticket-1'))
    assert.ok(store.product.works.get('work-1'))
    assert.equal(store.product.links.listByWork('work-1').length, 1)
    assert.equal(store.events.after(0, 10).length, 1)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a v6 database upgrades to v7, keeps completion tables, and reopens with product records', () => {
  const dir = freshDir()
  const path = join(dir, 'state.sqlite')
  try {
    const legacy = new Database(path)
    applyMigrations(legacy, { registry: MIGRATIONS.slice(0, 6) })
    legacy.close()

    const store = new ProductStore({ path })
    try {
      assert.equal(store.database.productSchema, 7)
      const completion = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'completion_%' ORDER BY name").all()
        .map(row => String((row as { name: string }).name))
      assert.deepEqual(completion, ['completion_acceptances', 'completion_quiescence', 'completion_verifications'])
      store.product.works.insert(work('work-1'))
      store.product.contracts.append(revision(1))
    } finally {
      store.close()
    }

    const reopened = new ProductStore({ path })
    try {
      assert.equal(reopened.database.productSchema, 7)
      assert.equal(reopened.product.works.get('work-1')!.title, 'Work work-1')
      assert.equal(reopened.product.contracts.history('work-1').length, 1)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid product records are refused before they reach the database', async () => {
  const dir = freshDir()
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    assert.throws(() => store.product.works.insert({ id: 'work-1', projectId: 'p', conversationId: 'c' } as never))
    assert.throws(() => store.product.questions.insert({ ...question(), targets: [{ ...question().targets[0]!, contract: { ...contract, digest: 'd'.repeat(64) } }] }))
    assert.equal(store.product.works.get('work-1'), undefined)
    assert.equal(store.product.questions.get('q-1'), undefined)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
