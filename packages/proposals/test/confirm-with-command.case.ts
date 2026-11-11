import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UserCommandSchema } from '@personal-agent/contracts'
import type { Scope } from '@personal-agent/contracts'
import {
  AssistantProposalService,
  InMemoryAssistantState,
  ProposalError,
} from '../src/index.ts'

const NOW = '2026-11-11T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const criteria = [{ id: 'criterion-1', description: 'tests pass', kind: 'machine', required: true, checkDefinitionRef: 'check-1' }] as const
const trusted = {
  actorRef: 'user-1',
  projectId: 'project-1',
  grant: { grantId: 'grant-1', scope },
  sourceMessageId: 'msg-1',
}

function fixture() {
  const port = new InMemoryAssistantState()
  const service = new AssistantProposalService(port, { now: () => new Date(NOW) })
  return { port, service }
}

const workPayload = { kind: 'propose_work', goal: 'Add a parser setting', projectId: 'project-1', sourceMessageId: 'msg-1' }
const decisionPayload = { kind: 'propose_decision', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' }

const prepare = (
  service: AssistantProposalService,
  payload: unknown,
  proposalId = 'proposal-1',
  trustedOverride: Record<string, unknown> = trusted,
) => service.prepare({ proposalId, payload, trusted: trustedOverride as never, conversationId: 'conv-1', sourceTextDigest: 'a'.repeat(64) })

const commitInput = (prepared: { payloadDigest: string }, plan: unknown, overrides: Record<string, unknown> = {}) => ({
  expectedVersion: 1,
  expectedDigest: prepared.payloadDigest,
  actorRef: 'user-1',
  effectCommandId: 'command-1',
  revalidate: () => ({ ok: true }),
  barrier: () => ({ ok: true }),
  plan: plan as never,
  ...overrides,
})

test('confirmWithCommand returns the existing UserCommand for a fully specified work proposal', async () => {
  const { port, service } = fixture()
  const prepared = await prepare(service, workPayload)
  service.persistPending(prepared)
  const result = service.confirmWithCommand(
    prepared,
    commitInput(prepared, { commandId: 'command-1', conversationId: 'conv-1', work: { scope, criteria: criteria as never, profileId: 'codex-native' } }),
  )
  assert.equal(result.record.state, 'confirmed')
  assert.equal(result.record.effectCommandId, 'command-1')
  assert.ok(result.command)
  assert.deepEqual(UserCommandSchema.parse(result.command), result.command)
  assert.equal(result.command.kind, 'create_work')
  assert.equal(Object.hasOwn(result.command, 'actor'), false)
  assert.deepEqual(result.intent.kind, 'create_work')
  assert.equal(port.proposals.get('proposal-1')?.state, 'confirmed')
})

test('missing user input is refused before any confirmation write', async () => {
  const { port, service } = fixture()
  const prepared = await prepare(service, workPayload)
  service.persistPending(prepared)
  assert.throws(
    () => service.confirmWithCommand(prepared, commitInput(prepared, { commandId: 'command-1', conversationId: 'conv-1' })),
    (error: unknown) =>
      error instanceof ProposalError &&
      error.code === 'needs_user_input' &&
      Array.isArray((error.details as { missing?: unknown }).missing),
  )
  assert.equal(port.proposals.get('proposal-1')?.state, 'pending')
  assert.equal(port.proposals.get('proposal-1')?.version, 1)
})

test('a revision proposal needs the complete new contract, not the rationale', async () => {
  const { service } = fixture()
  const expected = { workId: 'work-1', revision: 2, digest: 'b'.repeat(64) }
  const prepared = await prepare(
    service,
    { kind: 'propose_revision', expected, rationale: 'Need one more check', sourceMessageId: 'msg-1' },
    'proposal-1',
    { ...trusted, contract: expected },
  )
  service.persistPending(prepared)
  assert.throws(
    () => service.confirmWithCommand(prepared, commitInput(prepared, { commandId: 'command-1', conversationId: 'conv-1' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'needs_user_input',
  )
})

test('a reply proposal confirms nothing and yields no command', async () => {
  const { port, service } = fixture()
  const prepared = await prepare(service, { kind: 'reply', text: 'Discussion only', sourceRefs: [] })
  service.persistPending(prepared)
  const result = service.confirmWithCommand(prepared, commitInput(prepared, { commandId: 'command-1', conversationId: 'conv-1' }))
  assert.equal(result.command, null)
  assert.equal(result.record.state, 'confirmed')
  assert.equal(port.proposals.get('proposal-1')?.effectCommandId, 'command-1')
})

test('duplicate confirmation replays the same command, and a different command id conflicts', async () => {
  const { service } = fixture()
  const prepared = await prepare(service, decisionPayload)
  service.persistPending(prepared)
  const plan = { commandId: 'command-1', conversationId: 'conv-1' }
  const first = service.confirmWithCommand(prepared, commitInput(prepared, plan))
  const replay = service.confirmWithCommand(prepared, commitInput(prepared, plan))
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.command, first.command)
  // A different effect id only conflicts once the plan carries the same (consistent) identity.
  assert.throws(
    () =>
      service.confirmWithCommand(
        prepared,
        commitInput(prepared, { commandId: 'command-2', conversationId: 'conv-1' }, { effectCommandId: 'command-2' }),
      ),
    (error: unknown) => error instanceof ProposalError && error.code === 'conflict',
  )
  // An inconsistent plan/effect identity is refused before any confirmed write.
  assert.throws(
    () => service.confirmWithCommand(prepared, commitInput(prepared, plan, { effectCommandId: 'command-3' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'plan_mismatch',
  )
})

test('a rejected proposal cannot be confirmed with a command', async () => {
  const { service } = fixture()
  const prepared = await prepare(service, decisionPayload)
  service.persistPending(prepared)
  service.reject(prepared, { actorRef: 'user-1', reason: 'No' })
  assert.throws(
    () => service.confirmWithCommand(prepared, commitInput(prepared, { commandId: 'command-1', conversationId: 'conv-1' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_not_pending',
  )
})

test('a changed actor or source still fails before a command is returned', async () => {
  const { port, service } = fixture()
  const prepared = await prepare(service, decisionPayload)
  service.persistPending(prepared)
  const plan = { commandId: 'command-1', conversationId: 'conv-1' }
  assert.throws(
    () => service.confirmWithCommand(prepared, commitInput(prepared, plan, { actorRef: 'other-user' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'forbidden',
  )
  assert.throws(
    () => service.confirmWithCommand(prepared, commitInput(prepared, plan, { expectedDigest: '0'.repeat(64) })),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_mutated',
  )
  assert.equal(port.proposals.get('proposal-1')?.state, 'pending')
})
