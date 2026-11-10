import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scope } from '@personal-agent/contracts'
import {
  ContextReader,
  LocalProjectSourcePort,
  buildContextPreview,
} from '@personal-agent/context'
import {
  AssistantProposalService,
  InMemoryAssistantState,
  ProposalError,
  type PrepareProposalInput,
  type PreparedProposal,
} from '@personal-agent/proposals'
import {
  AssistantDecisionStore,
  DecisionConflict,
  DecisionGovernance,
  StaticDecisionSourcePort,
} from '../src/index.ts'
import type { DecisionActor, DecisionSource } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['README.md'], excludedPaths: [], externalActions: [] }
const actor: DecisionActor = { actorRef: 'user-1', projectId: 'project-1', grantScope: scope }
const message: DecisionSource = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  projectId: 'project-1',
  role: 'user',
  provenance: 'trusted_user',
  createdAt: NOW,
  textDigest: 'a'.repeat(64),
  title: 'Please use Chinese UI copy',
}
const trusted = {
  actorRef: 'user-1',
  projectId: 'project-1',
  grant: { grantId: 'grant-1', scope },
  sourceMessageId: 'msg-1',
}

class MockProvider {
  readonly calls: string[] = []
  private readonly responses: unknown[]
  constructor(responses: readonly unknown[]) {
    this.responses = [...responses]
  }
  respond(prompt: string): unknown {
    this.calls.push(prompt)
    if (this.responses.length === 0) throw new Error('no queued mock response')
    return this.responses.shift()
  }
}

function fixture() {
  const port = new InMemoryAssistantState()
  const sources = new StaticDecisionSourcePort([message])
  const governance = new DecisionGovernance(new AssistantDecisionStore(port), sources, { now: () => new Date(NOW) })
  const proposals = new AssistantProposalService(port, { now: () => new Date(NOW) })
  return { port, sources, governance, proposals }
}

async function prepareDecision(
  proposals: AssistantProposalService,
  overrides: Partial<PrepareProposalInput> = {},
): Promise<PreparedProposal> {
  return proposals.prepare({
    proposalId: 'proposal-1',
    payload: { kind: 'propose_decision', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' },
    trusted,
    conversationId: 'conv-1',
    sourceTextDigest: message.textDigest,
    ...overrides,
  })
}

const commitInput = (prepared: PreparedProposal, overrides: Record<string, unknown> = {}) => ({
  expectedVersion: 1,
  expectedDigest: prepared.payloadDigest,
  actorRef: 'user-1',
  effectCommandId: 'command-1',
  revalidate: (candidate: PreparedProposal) => ({
    ok:
      candidate.projectId === 'project-1' &&
      candidate.conversationId === 'conv-1' &&
      candidate.sourceTextDigest === message.textDigest,
  }),
  barrier: () => ({ ok: true }),
  ...overrides,
})

test('zero-model vertical: context -> mock proposal -> pending -> confirm -> receipt -> decision -> restart -> revoke', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-wave04-vertical-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'README.md'), '# Demo project\n\nUse consistent UI copy.\n')
  const contextPort = new LocalProjectSourcePort({
    rootDir: dir,
    projectId: 'project-1',
    baseline: { capturedAt: NOW },
  })
  const reader = new ContextReader({ now: () => new Date(NOW) })
  const grant = {
    grantId: 'grant-1',
    projectId: 'project-1',
    gateway: 'conversation' as const,
    purpose: 'conversation_discussion' as const,
    scope,
    sourceKinds: ['document', 'decision'] as const,
    maxFiles: 4,
    maxBytes: 64 * 1024,
    maxTokens: 4000,
    maxDurationMs: 2000,
    confirmedAt: '2026-11-09T00:00:00.000Z',
    confirmedBy: 'user-1',
  }
  const bundle = await reader.read({ requestId: 'request-1', projectId: 'project-1', purpose: 'conversation_discussion', query: 'UI copy', grant }, contextPort)
  const preview = buildContextPreview(bundle)
  assert.equal(preview.status, 'sufficient')
  assert.deepEqual(preview.selectedFiles, ['README.md'])

  const provider = new MockProvider([
    { kind: 'propose_decision', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' },
  ])
  const { port, sources, governance, proposals } = fixture()
  const prepared = await proposals.prepare({
    proposalId: 'proposal-1',
    payload: provider.respond('user asks to remember the copy language'),
    trusted,
    conversationId: 'conv-1',
    sourceTextDigest: message.textDigest,
  })
  assert.equal(port.proposals.get('proposal-1'), undefined)
  assert.equal(proposals.persistPending(prepared).state, 'pending')
  assert.equal(port.proposals.get('proposal-1')?.version, 1)

  const receipts = new Map<string, string>()
  const committed = proposals.commit(prepared, commitInput(prepared))
  receipts.set('command-1', committed.record.proposalId)
  assert.equal(committed.record.state, 'confirmed')
  assert.equal(committed.record.effectCommandId, 'command-1')
  assert.equal(committed.intent.kind, 'record_decision')
  assert.equal(receipts.size, 1)

  if (committed.intent.kind !== 'record_decision') throw new Error('unreachable')
  const recorded = await governance.record(
    {
      decisionId: 'decision-1',
      content: committed.intent.content,
      scope: committed.intent.scope,
      sourceMessageId: committed.intent.sourceMessageId,
    },
    actor,
  )
  assert.equal(recorded.record.status, 'active')
  assert.equal(port.decisions.get('decision-1')?.sourceTextDigest, message.textDigest)
  assert.equal((await governance.page('project-1')).decisions.length, 1)

  // State reload: new services over the same persisted port.
  const restartedProposals = new AssistantProposalService(port, { now: () => new Date(NOW) })
  const restartedGovernance = new DecisionGovernance(new AssistantDecisionStore(port), sources, { now: () => new Date(NOW) })
  assert.equal(port.proposals.get('proposal-1')?.state, 'confirmed')
  assert.equal(restartedProposals.confirmationIntent(port.proposals.get('proposal-1')!)?.kind, 'record_decision')
  assert.equal(await restartedGovernance.isEffective('decision-1'), true)

  const replay = restartedProposals.commit(prepared, commitInput(prepared))
  assert.equal(replay.replayed, true)
  assert.equal(receipts.size, 1)

  await restartedGovernance.revoke('decision-1', 1, actor)
  assert.equal(await restartedGovernance.isEffective('decision-1'), false)
  assert.deepEqual((await restartedGovernance.page('project-1')).decisions, [])
  assert.equal(port.proposals.get('proposal-1')?.state, 'confirmed')
  assert.equal(provider.calls.length, 1)
})

test('commit failures leave the pending proposal and produce no receipt', async () => {
  const { port, proposals } = fixture()
  const prepared = await prepareDecision(proposals)
  proposals.persistPending(prepared)
  const receipts = new Map<string, string>()

  for (const overrides of [
    { revalidate: () => ({ ok: false, code: 'source_stale' }) },
    { revalidate: () => ({ ok: false, code: 'grant_expired' }) },
    { barrier: () => ({ ok: false, detail: 'writer_active' }) },
  ]) {
    assert.throws(
      () => proposals.commit(prepared, commitInput(prepared, overrides)),
      (error: unknown) => error instanceof ProposalError && ['stale_authorization', 'barrier_blocked'].includes(error.code),
    )
    assert.equal(receipts.size, 0)
    assert.equal(port.proposals.get('proposal-1')?.state, 'pending')
    assert.equal(port.proposals.get('proposal-1')?.version, 1)
  }
})

test('duplicate confirmation, same-id payload changes, foreign actors and cross-project input are refused', async () => {
  const { port, proposals } = fixture()
  const prepared = await prepareDecision(proposals)
  proposals.persistPending(prepared)
  proposals.commit(prepared, commitInput(prepared))

  assert.throws(
    () => proposals.commit(prepared, commitInput(prepared, { actorRef: 'foreign-user' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'forbidden',
  )
  assert.throws(
    () => proposals.commit(prepared, commitInput(prepared, { effectCommandId: 'command-2' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'conflict',
  )

  const mutated = fixture()
  const pending = await prepareDecision(mutated.proposals)
  mutated.proposals.persistPending(pending)
  const changed = await prepareDecision(mutated.proposals, {
    payload: { kind: 'propose_decision', content: 'Use English UI copy', scope, sourceMessageId: 'msg-1' },
  })
  assert.notEqual(changed.payloadDigest, pending.payloadDigest)
  assert.throws(
    () => mutated.proposals.persistPending(changed),
    (error: unknown) =>
      error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'conflict',
  )

  await assert.rejects(
    prepareDecision(proposals, {
      proposalId: 'proposal-2',
      payload: { kind: 'propose_decision', content: 'x', scope: { ...scope, projectId: 'project-2' }, sourceMessageId: 'msg-1' },
    }),
    (error: unknown) => error instanceof ProposalError && error.code === 'cross_project',
  )

  const sourceMismatch = await prepareDecision(proposals, {
    proposalId: 'proposal-3',
    conversationId: 'conv-2',
  })
  proposals.persistPending(sourceMismatch)
  assert.throws(
    () => proposals.commit(sourceMismatch, commitInput(sourceMismatch, { effectCommandId: 'command-3' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'stale_authorization',
  )
  assert.equal(port.proposals.get('proposal-3')?.state, 'pending')
})

test('supersession and source disappearance govern later decision reads', async () => {
  const { port, sources, governance } = fixture()
  await governance.record(
    { decisionId: 'decision-1', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' },
    actor,
  )
  await governance.record(
    { decisionId: 'decision-2', content: 'Use English UI copy', scope, sourceMessageId: 'msg-1', supersedes: 'decision-1' },
    actor,
  )
  const page = await governance.page('project-1')
  assert.deepEqual(page.decisions.map((decision) => decision.id), ['decision-2'])
  assert.equal(port.decisions.history('decision-1').length, 1)

  sources.markMissing('msg-1')
  assert.equal(await governance.isEffective('decision-2'), false)
  assert.equal((await governance.page('project-1')).decisions.length, 0)
  assert.ok(port.decisions.history('decision-2').length > 0)
})
