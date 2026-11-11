import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DecisionCommandSchema, DecisionPageSchema, DecisionPrepareSchema } from '../src/index.ts'
test('explicit decision input is scoped and cannot smuggle an actor or native command', () => {
  const input = { projectId: 'project-one', conversationId: 'conversation-one', sourceMessageId: 'message-one', content: 'Keep validation',
    scope: { projectId: 'project-one', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }
  assert.equal(DecisionPrepareSchema.safeParse(input).success, true)
  for (const change of [{ actor: 'forged' }, { command: 'run' }, { projectId: 'project-other' }, { content: '\0' }])
    assert.equal(DecisionPrepareSchema.safeParse({ ...input, ...change }).success, false)
})
test('decision commands require a signed preview or exact revocation version, and pages declare continuation', () => {
  const command = { commandId: 'command-one', projectId: 'project-one', conversationId: 'conversation-one', kind: 'record_decision', token: 'a'.repeat(20) + '.' + 'b'.repeat(43) }
  assert.equal(DecisionCommandSchema.safeParse(command).success, true)
  assert.equal(DecisionCommandSchema.safeParse({ ...command, actorRef: 'forged' }).success, false)
  assert.equal(DecisionPageSchema.safeParse({ protocol: 'decision-catalog/1', decisions: [], hasMore: true }).success, false)
})
