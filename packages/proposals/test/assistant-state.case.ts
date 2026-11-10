import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PersistedProposalSchema } from '@personal-agent/contracts'
import {
  AssistantProposalService,
  AssistantStateConflict,
  InMemoryAssistantState,
  ProposalError,
} from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const trusted = {
  actorRef: 'user-1',
  projectId: 'project-1',
  grant: { grantId: 'grant-1', scope },
  sourceMessageId: 'msg-1',
}
const work = (overrides: Record<string, unknown> = {}) => ({
  kind: 'propose_work',
  goal: 'Add a parser setting',
  projectId: 'project-1',
  sourceMessageId: 'msg-1',
  ...overrides,
})

const prepareInput = (overrides: Record<string, unknown> = {}) => ({
  proposalId: 'proposal-1',
  payload: work(),
  trusted,
  conversationId: 'conv-1',
  sourceTextDigest: 'a'.repeat(64),
  ...overrides,
})

function fixture(now: () => Date = () => new Date(NOW)) {
  const port = new InMemoryAssistantState()
  const service = new AssistantProposalService(port, { now })
  return { port, service }
}

test('the in-memory assistant port enforces create/CAS/replay and history', () => {
  const { port } = fixture()
  const pending = PersistedProposalSchema.parse({
    proposalId: 'p1',
    version: 1,
    state: 'pending',
    projectId: 'project-1',
    conversationId: 'conv-1',
    sourceMessageId: 'msg-1',
    sourceTextDigest: 'a'.repeat(64),
    actorRef: 'user-1',
    grantId: 'grant-1',
    grantScope: scope,
    payload: work(),
    payloadDigest: 'b'.repeat(64),
    createdAt: NOW,
    expiresAt: '2026-11-10T01:00:00.000Z',
    updatedAt: NOW,
  })
  assert.equal(port.proposals.put(pending, 0).replayed, false)
  assert.equal(port.proposals.put(pending, 0).replayed, true)
  assert.throws(() => port.proposals.put({ ...pending, payloadDigest: 'c'.repeat(64) }, 0), (error: unknown) =>
    error instanceof AssistantStateConflict && error.code === 'conflict')
  assert.equal(port.proposals.put(pending, 1).replayed, true)
  assert.throws(
    () => port.proposals.put({ ...pending, version: 2, state: 'rejected' }, 0),
    (error: unknown) => error instanceof AssistantStateConflict && error.code === 'stale_version',
  )
  assert.equal(port.proposals.history('p1').length, 1)
  assert.equal(port.proposals.list({ projectId: 'project-1' }).records.length, 1)
})

test('prepare is read-only, persistPending stores version 1 and commit confirms atomically', async () => {
  const { port, service } = fixture()
  const prepared = await service.prepare(prepareInput())
  assert.equal(port.proposals.get('proposal-1'), undefined)
  assert.equal(prepared.version, 1)

  const pending = service.persistPending(prepared)
  assert.equal(pending.state, 'pending')
  assert.equal(pending.version, 1)
  assert.equal(port.proposals.get('proposal-1')?.state, 'pending')

  const committed = service.commit(prepared, {
    expectedVersion: 1,
    expectedDigest: prepared.payloadDigest,
    actorRef: 'user-1',
    effectCommandId: 'command-1',
    barrier: () => ({ ok: true }),
  })
  assert.equal(committed.record.state, 'confirmed')
  assert.equal(committed.record.version, 2)
  assert.equal(committed.record.effectCommandId, 'command-1')
  assert.equal(committed.intent.kind, 'create_work')
  assert.equal(committed.replayed, false)
  assert.equal(port.proposals.history('proposal-1').length, 2)

  const replay = service.commit(prepared, {
    expectedVersion: 1,
    expectedDigest: prepared.payloadDigest,
    actorRef: 'user-1',
    effectCommandId: 'command-1',
  })
  assert.equal(replay.replayed, true)
  assert.equal(port.proposals.history('proposal-1').length, 2)
  assert.equal(service.confirmationIntent(replay.record)?.kind, 'create_work')
})

test('commit refuses another actor, another effect command, a changed payload and failed current checks', async () => {
  const { service } = fixture()
  const prepared = await service.prepare(prepareInput())
  service.persistPending(prepared)

  assert.throws(
    () => service.commit(prepared, { expectedVersion: 1, expectedDigest: prepared.payloadDigest, actorRef: 'other', effectCommandId: 'c1' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'forbidden',
  )
  assert.throws(
    () => service.commit(prepared, { expectedVersion: 1, expectedDigest: '0'.repeat(64), actorRef: 'user-1', effectCommandId: 'c1' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_mutated',
  )
  assert.throws(
    () =>
      service.commit(prepared, {
        expectedVersion: 1,
        expectedDigest: prepared.payloadDigest,
        actorRef: 'user-1',
        effectCommandId: 'c1',
        revalidate: () => ({ ok: false, code: 'source_stale' }),
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'stale_authorization',
  )
  assert.throws(
    () =>
      service.commit(prepared, {
        expectedVersion: 1,
        expectedDigest: prepared.payloadDigest,
        actorRef: 'user-1',
        effectCommandId: 'c1',
        barrier: () => ({ ok: false, detail: 'writer_active' }),
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'barrier_blocked',
  )
  service.commit(prepared, { expectedVersion: 1, expectedDigest: prepared.payloadDigest, actorRef: 'user-1', effectCommandId: 'c1' })
  assert.throws(
    () => service.commit(prepared, { expectedVersion: 1, expectedDigest: prepared.payloadDigest, actorRef: 'user-1', effectCommandId: 'c2' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'conflict',
  )
})

test('a pending proposal cannot be committed before persistPending', async () => {
  const { service } = fixture()
  const prepared = await service.prepare(prepareInput())
  assert.throws(
    () => service.commit(prepared, { expectedVersion: 1, expectedDigest: prepared.payloadDigest, actorRef: 'user-1', effectCommandId: 'c1' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'not_found',
  )
})

test('rejection, expiry and supersession advance the persisted version and block confirmation', async () => {
  let now = Date.parse(NOW)
  const { service, port } = fixture(() => new Date(now))

  const rejectedPrepared = await service.prepare(prepareInput())
  service.persistPending(rejectedPrepared)
  const rejected = service.reject(rejectedPrepared, { actorRef: 'user-1', reason: 'No' })
  assert.equal(rejected.state, 'rejected')
  assert.equal(rejected.version, 2)
  assert.throws(
    () => service.commit(rejectedPrepared, { expectedVersion: 1, expectedDigest: rejectedPrepared.payloadDigest, actorRef: 'user-1', effectCommandId: 'c1' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_not_pending',
  )

  const expiring = await service.prepare(prepareInput({ proposalId: 'proposal-2', ttlMs: 1 }))
  service.persistPending(expiring)
  now += 1000
  assert.throws(
    () => service.commit(expiring, { expectedVersion: 1, expectedDigest: expiring.payloadDigest, actorRef: 'user-1', effectCommandId: 'c2' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_expired',
  )
  assert.equal(port.proposals.get('proposal-2')?.state, 'expired')

  const older = await service.prepare(prepareInput({ proposalId: 'proposal-3' }))
  service.persistPending(older)
  const newer = await service.prepare(prepareInput({ proposalId: 'proposal-4' }))
  service.persistPending(newer)
  const superseded = service.supersede(older, 'proposal-4', 'user-1')
  assert.equal(superseded.state, 'superseded')
  assert.equal(superseded.supersededBy, 'proposal-4')
  assert.throws(
    () => service.commit(older, { expectedVersion: 1, expectedDigest: older.payloadDigest, actorRef: 'user-1', effectCommandId: 'c3' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_not_pending',
  )
})

test('prepare rejects plain text, foreign scopes and changed pending payloads', async () => {
  const { service } = fixture()
  const plain = service.prepare(prepareInput({ payload: 'Just a discussion reply' }))
  await assert.rejects(plain, (error: unknown) => error instanceof ProposalError && error.code === 'invalid_proposal')

  const crossProject = service.prepare(
    prepareInput({ payload: { kind: 'propose_decision', content: 'x', scope: { ...scope, projectId: 'project-2' }, sourceMessageId: 'msg-1' } }),
  )
  await assert.rejects(crossProject, (error: unknown) => error instanceof ProposalError && error.code === 'cross_project')

  const prepared = await service.prepare(prepareInput())
  service.persistPending(prepared)
  const changed = await service.prepare(prepareInput({ payload: work({ goal: 'Different goal' }) }))
  assert.notEqual(changed.payloadDigest, prepared.payloadDigest)
  assert.throws(() => service.persistPending(changed), (error: unknown) =>
    error instanceof AssistantStateConflict && error.code === 'conflict')
})
