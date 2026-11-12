import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UserCommandSchema } from '@personal-agent/contracts'
import type { Scope } from '@personal-agent/contracts'
import {
  AssistantProposalService,
  InMemoryAssistantState,
  ProposalError,
  planProposalCommand,
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
const workPayload = { kind: 'propose_work', goal: 'Add a parser setting', projectId: 'project-1', sourceMessageId: 'msg-1' }

function fixture() {
  const port = new InMemoryAssistantState()
  const service = new AssistantProposalService(port, { now: () => new Date(NOW) })
  return { port, service }
}

const prepare = (service: AssistantProposalService, payload: unknown = workPayload) =>
  service.prepare({ proposalId: 'proposal-1', payload, trusted, conversationId: 'conv-1', sourceTextDigest: 'a'.repeat(64) })

const commitInput = (prepared: { payloadDigest: string }, overrides: Record<string, unknown> = {}) => ({
  expectedVersion: 1,
  expectedDigest: prepared.payloadDigest,
  actorRef: 'user-1',
  effectCommandId: 'command-1',
  revalidate: () => ({ ok: true }),
  barrier: () => ({ ok: true }),
  ...overrides,
})

test('the admitted main path confirms once and derives the command from the persisted intent', async () => {
  const { port, service } = fixture()
  const prepared = await prepare(service)
  const pending = service.persistPending(prepared)
  assert.equal(pending.state, 'pending')
  // The persisted proposal carries no dispatchable command body; main's own receipt is the authority.
  assert.equal(Object.hasOwn(pending, 'command'), false)
  assert.equal(Object.hasOwn(pending, 'plan'), false)

  const confirmed = service.commit(prepared, commitInput(prepared))
  assert.equal(confirmed.record.state, 'confirmed')
  assert.equal(confirmed.record.effectCommandId, 'command-1')
  assert.equal(confirmed.replayed, false)

  const plan = planProposalCommand(confirmed.intent, {
    commandId: 'command-1',
    conversationId: 'conv-1',
    work: { scope, criteria: criteria as never, profileId: 'codex-native' },
  })
  assert.equal(plan.kind, 'command')
  if (plan.kind !== 'command') throw new Error('unreachable')
  assert.deepEqual(UserCommandSchema.parse(plan.command), plan.command)
  assert.equal(plan.command.kind, 'create_work')

  // The same reviewed body replays idempotently and yields the same deterministic plan.
  const replay = service.commit(prepared, commitInput(prepared))
  assert.equal(replay.replayed, true)
  const replayPlan = planProposalCommand(replay.intent, {
    commandId: 'command-1',
    conversationId: 'conv-1',
    work: { scope, criteria: criteria as never, profileId: 'codex-native' },
  })
  assert.deepEqual(replayPlan, plan)
  assert.equal(port.proposals.history('proposal-1').length, 2)
})

test('a replay with another effect id, actor, reviewed digest or payload is refused', async () => {
  const { service } = fixture()
  const prepared = await prepare(service)
  service.persistPending(prepared)
  service.commit(prepared, commitInput(prepared))
  assert.throws(
    () => service.commit(prepared, commitInput(prepared, { effectCommandId: 'command-2' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'conflict',
  )
  assert.throws(
    () => service.commit(prepared, commitInput(prepared, { actorRef: 'other-user' })),
    (error: unknown) => error instanceof ProposalError && error.code === 'forbidden',
  )
  assert.throws(
    () => service.commit(prepared, commitInput(prepared, { expectedDigest: '0'.repeat(64) })),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_mutated',
  )
})

test('an under-specified work proposal plans as needs_user_input, and a reply has no effect', async () => {
  const { service } = fixture()
  const prepared = await prepare(service)
  service.persistPending(prepared)
  const confirmed = service.commit(prepared, commitInput(prepared))
  const plan = planProposalCommand(confirmed.intent, { commandId: 'command-1', conversationId: 'conv-1' })
  assert.equal(plan.kind, 'needs_user_input')
  if (plan.kind === 'needs_user_input') assert.deepEqual(plan.missing, ['work.scope', 'work.criteria', 'work.profileId'])

  const reply = await prepare(service, { kind: 'reply', text: 'Discussion only', sourceRefs: [] })
  assert.equal(reply.payload.kind, 'reply')
  const replyIntent = planProposalCommand({ kind: 'reply', text: 'Discussion only', sourceRefs: [] }, {
    commandId: 'command-2',
    conversationId: 'conv-1',
  })
  assert.equal(replyIntent.kind, 'no_effect')
})
