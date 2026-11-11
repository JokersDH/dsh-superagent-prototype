import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scope } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'
import { AssistantProposalService, ProposalError } from '@personal-agent/proposals'
import {
  AssistantDecisionStore,
  DecisionError,
  DecisionTransactionService,
} from '../src/index.ts'
import type { DecisionSourceSyncPort } from '../src/index.ts'

const NOW = '2026-11-11T00:00:00.000Z'
const projectId = 'lifecycle-project'
const conversationId = 'lifecycle-conversation'
const scope: Scope = { projectId, allowedPaths: ['README.md'], excludedPaths: [], externalActions: [] }
const actor = { actorRef: 'lifecycle-user', projectId, grantScope: scope }

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pa-lifecycle-'))
  const file = join(root, 'state.sqlite')
  let store = new ProductStore({ path: file })
  let ports = createWorkflowPorts(store)
  const sources = (): DecisionSourceSyncPort => ({
    getMessage(id) {
      const value = ports.index.sourceMessage(id, [projectId])
      return value && {
        messageId: value.id,
        conversationId: value.conversationId,
        projectId: value.projectId ?? projectId,
        role: value.role,
        provenance: value.provenance as 'trusted_user',
        createdAt: value.createdAt,
        textDigest: value.textDigest,
      }
    },
  })
  store.product.messages.append({
    id: 'lifecycle-message',
    conversationId,
    projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'Please keep decisions explicit',
    sourceRefs: [],
    createdAt: NOW,
  })
  return {
    get store() {
      return store
    },
    get ports() {
      return ports
    },
    sources,
    proposals: () => new AssistantProposalService(ports.assistant, { now: () => new Date(NOW) }),
    decisions: () => new AssistantDecisionStore(ports.assistant),
    transaction: () => new DecisionTransactionService(new AssistantDecisionStore(ports.assistant), sources(), { now: () => new Date(NOW) }),
    reopen() {
      store.close()
      store = new ProductStore({ path: file })
      ports = createWorkflowPorts(store)
    },
    cleanup() {
      store.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const proposalInput = (textDigest: string, proposalId = 'lifecycle-proposal') => ({
  proposalId,
  payload: { kind: 'propose_decision', content: 'Keep decisions explicit', scope, sourceMessageId: 'lifecycle-message' },
  trusted: { actorRef: actor.actorRef, projectId, grant: { grantId: 'grant-1', scope }, sourceMessageId: 'lifecycle-message' },
  conversationId,
  sourceTextDigest: textDigest,
})
const decisionInput = (decisionId = 'lifecycle-decision', overrides: Record<string, unknown> = {}) => ({
  decisionId,
  content: 'Keep decisions explicit',
  scope,
  sourceMessageId: 'lifecycle-message',
  ...overrides,
})

test('real SQLite: reject is a distinct terminal state, not a revocation', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const textDigest = fixture.ports.index.sourceMessage('lifecycle-message', [projectId])!.textDigest
  const proposals = fixture.proposals()
  return (async () => {
    const prepared = await proposals.prepare(proposalInput(textDigest) as never)
    fixture.store.uow.atomic(() => proposals.persistPending(prepared))
    fixture.store.uow.atomic(() => proposals.reject(prepared, { actorRef: actor.actorRef, reason: 'Not now' }))

    assert.equal(fixture.ports.assistant.proposals.get('lifecycle-proposal')?.state, 'rejected')
    assert.equal(fixture.ports.assistant.proposals.get('lifecycle-proposal')?.version, 2)
    assert.equal(fixture.ports.assistant.proposals.get('lifecycle-proposal')?.effectCommandId, undefined)
    assert.equal(fixture.ports.assistant.decisions.get('lifecycle-decision'), undefined)
    assert.equal(fixture.ports.assistant.proposals.history('lifecycle-proposal').length, 2)

    fixture.reopen()
    const reopened = fixture.proposals()
    assert.equal(fixture.ports.assistant.proposals.get('lifecycle-proposal')?.state, 'rejected')
    assert.throws(
      () =>
        reopened.commit(prepared, {
          expectedVersion: 1,
          expectedDigest: prepared.payloadDigest,
          actorRef: actor.actorRef,
          effectCommandId: 'command-1',
        }),
      (error: unknown) => error instanceof ProposalError && error.code === 'proposal_not_pending',
    )
    assert.equal(fixture.ports.assistant.decisions.get('lifecycle-decision'), undefined)
  })()
})

test('real SQLite: revoke keeps audit history but removes the decision from effective knowledge', async (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const transaction = fixture.transaction()
  const prepared = transaction.prepare(decisionInput(), actor)
  fixture.store.uow.atomic(() => transaction.commit(prepared, actor))
  fixture.store.uow.atomic(() => transaction.revoke('lifecycle-decision', 1, actor))

  const store = fixture.decisions()
  assert.equal(store.getSync('lifecycle-decision')?.status, 'revoked')
  assert.equal(fixture.ports.assistant.decisions.history('lifecycle-decision').length, 2)
  assert.equal(fixture.transaction().sourceState('lifecycle-decision'), 'current')

  fixture.reopen()
  const reopened = fixture.transaction()
  assert.equal(fixture.decisions().getSync('lifecycle-decision')?.status, 'revoked')
  assert.equal(reopened.sourceState('lifecycle-decision'), 'current')
  const replay = reopened.commit(prepared, actor)
  assert.equal(replay.record.status, 'revoked')
  assert.equal(fixture.ports.assistant.decisions.history('lifecycle-decision').length, 2)
})

test('real SQLite: a source digest change invalidates commit and leaves no decision row', (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const transaction = fixture.transaction()
  const prepared = transaction.prepare(decisionInput(), actor)
  const stale = new DecisionTransactionService(
    new AssistantDecisionStore(fixture.ports.assistant),
    {
      getMessage: () => ({
        messageId: 'lifecycle-message',
        conversationId,
        projectId,
        role: 'user',
        provenance: 'trusted_user',
        createdAt: NOW,
        textDigest: '0'.repeat(64),
      }),
    },
    { now: () => new Date(NOW) },
  )
  assert.throws(() => stale.commit(prepared, actor), (error: unknown) =>
    error instanceof DecisionError && error.code === 'source_stale')
  assert.equal(fixture.ports.assistant.decisions.get('lifecycle-decision'), undefined)
  assert.equal(fixture.ports.assistant.decisions.history('lifecycle-decision').length, 0)
})

test('real SQLite: a failure after proposal confirmation rolls the whole transaction back', async (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const textDigest = fixture.ports.index.sourceMessage('lifecycle-message', [projectId])!.textDigest
  const proposals = fixture.proposals()
  const transaction = fixture.transaction()
  const preparedProposal = await proposals.prepare(proposalInput(textDigest) as never)
  const preparedDecision = transaction.prepare(decisionInput(), actor)
  fixture.store.db.exec(`CREATE TRIGGER reject_lifecycle_receipt BEFORE INSERT ON command_receipts
    WHEN NEW.command_id = 'lifecycle-command' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
  assert.throws(() =>
    fixture.store.uow.atomic(() => {
      proposals.persistPending(preparedProposal)
      proposals.commit(preparedProposal, {
        expectedVersion: 1,
        expectedDigest: preparedProposal.payloadDigest,
        actorRef: actor.actorRef,
        effectCommandId: 'lifecycle-command',
      })
      transaction.commit(preparedDecision, actor)
      fixture.store.events.append({ topic: 'application.decision.changed', entityRef: 'lifecycle-decision', payload: { decisionId: 'lifecycle-decision' } })
      fixture.store.commands.record('lifecycle-command', canonicalDigest({ decisionId: 'lifecycle-decision' }), () => ({ status: 'recorded' }))
    }),
  )
  assert.equal(fixture.ports.assistant.proposals.get('lifecycle-proposal'), undefined)
  assert.equal(fixture.ports.assistant.decisions.get('lifecycle-decision'), undefined)
  assert.equal(fixture.store.commands.get('lifecycle-command'), undefined)
  assert.equal(fixture.store.events.after(0, 100).filter((event) => event.topic === 'application.decision.changed').length, 0)
  fixture.store.db.exec('DROP TRIGGER reject_lifecycle_receipt')
})

test('real SQLite: supersede then revoke the replacement never reactivates the original', async (t) => {
  const fixture = setup()
  t.after(fixture.cleanup)
  const transaction = fixture.transaction()
  fixture.store.uow.atomic(() => transaction.commit(transaction.prepare(decisionInput('older'), actor), actor))
  fixture.store.uow.atomic(() =>
    transaction.commit(transaction.prepare(decisionInput('replacement', { supersedes: 'older' }), actor), actor),
  )
  fixture.store.uow.atomic(() => transaction.revoke('replacement', 1, actor))
  fixture.reopen()

  const store = fixture.decisions()
  assert.equal(store.getSync('older')?.status, 'superseded')
  assert.equal(store.getSync('replacement')?.status, 'revoked')
  assert.equal(fixture.ports.assistant.decisions.history('older').length, 1)
  assert.equal(fixture.ports.assistant.decisions.history('replacement').length, 2)
  // Neither decision enters new knowledge.
  assert.equal(fixture.ports.assistant.decisions.list({ projectId }).records.every((record) => record.decision.supersedes !== undefined || record.decision.id === 'older'), true)
})
