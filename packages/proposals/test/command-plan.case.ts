import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UserCommandSchema } from '@personal-agent/contracts'
import type { Scope } from '@personal-agent/contracts'
import { planProposalCommand, ProposalError } from '../src/index.ts'
import type { ProposalIntent } from '../src/index.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const criteria = [{ id: 'criterion-1', description: 'tests pass', kind: 'machine', required: true, checkDefinitionRef: 'check-1' }] as const
const base = { commandId: 'command-1', conversationId: 'conversation-1' }

test('a replied proposal has no business effect', () => {
  const intent: ProposalIntent = { kind: 'reply', text: 'Discussion only', sourceRefs: [] }
  assert.deepEqual(planProposalCommand(intent, base), { kind: 'no_effect', reason: 'reply' })
})

test('create_work maps to the existing command only with user-confirmed scope/criteria/profile', () => {
  const intent: ProposalIntent = {
    kind: 'create_work',
    projectId: 'project-1',
    goal: 'Add a parser setting',
    sourceMessageId: 'msg-1',
  }
  assert.deepEqual(planProposalCommand(intent, base), {
    kind: 'needs_user_input',
    intent: 'create_work',
    missing: ['work.scope', 'work.criteria', 'work.profileId'],
  })

  const plan = planProposalCommand(intent, {
    ...base,
    work: { scope, criteria: criteria as never, profileId: 'codex-native' },
  })
  assert.equal(plan.kind, 'command')
  if (plan.kind !== 'command') throw new Error('unreachable')
  assert.deepEqual(UserCommandSchema.parse(plan.command), plan.command)
  assert.equal(plan.command.kind, 'create_work')
  if (plan.command.kind !== 'create_work') throw new Error('unreachable')
  assert.equal(plan.command.goal, 'Add a parser setting')
  assert.deepEqual(plan.command.scope, scope)
  assert.equal(Object.hasOwn(plan.command, 'actorRef'), false)
  assert.equal(Object.hasOwn(plan.command, 'actor'), false)
})

test('a revision proposal needs the complete new contract instead of guessing from rationale', () => {
  const intent: ProposalIntent = {
    kind: 'revise_work',
    expected: { workId: 'work-1', revision: 2, digest: 'a'.repeat(64) },
    rationale: 'Need one more check',
    sourceMessageId: 'msg-1',
  }
  const missing = planProposalCommand(intent, base)
  assert.equal(missing.kind, 'needs_user_input')
  if (missing.kind === 'needs_user_input') assert.deepEqual(missing.missing, ['revision.goal', 'revision.scope', 'revision.criteria'])

  const plan = planProposalCommand(intent, {
    ...base,
    revision: { goal: 'Revised goal', scope, criteria: criteria as never },
  })
  assert.equal(plan.kind, 'command')
  if (plan.kind !== 'command' || plan.command.kind !== 'revise_work') throw new Error('unreachable')
  assert.deepEqual(plan.command.expected, intent.expected)
  assert.equal(plan.command.goal, 'Revised goal')
  assert.notEqual(plan.command.goal, intent.rationale)
})

test('a decision proposal maps to record_decision with its exact scope and source', () => {
  const intent: ProposalIntent = {
    kind: 'record_decision',
    content: 'Use Chinese UI copy',
    scope,
    sourceMessageId: 'msg-1',
  }
  const plan = planProposalCommand(intent, base)
  assert.equal(plan.kind, 'command')
  if (plan.kind !== 'command' || plan.command.kind !== 'record_decision') throw new Error('unreachable')
  assert.equal(plan.command.content, 'Use Chinese UI copy')
  assert.deepEqual(plan.command.scope, scope)
  assert.equal(plan.command.sourceMessageId, 'msg-1')
  assert.deepEqual(UserCommandSchema.parse(plan.command), plan.command)
})

test('a confirmed scope from another project is refused rather than widened', () => {
  const intent: ProposalIntent = {
    kind: 'create_work',
    projectId: 'project-1',
    goal: 'Add a parser setting',
    sourceMessageId: 'msg-1',
  }
  assert.throws(
    () =>
      planProposalCommand(intent, {
        ...base,
        work: { scope: { ...scope, projectId: 'project-2' }, criteria: criteria as never, profileId: 'codex-native' },
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'cross_project',
  )
})
