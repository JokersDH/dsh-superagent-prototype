import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkVerificationStatusSchema, VerificationRetryCommandSchema } from '../src/index.ts'

const candidate = { ticketId: 'ticket-1', assignmentId: 'assignment-1',
  contract: { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }, candidateGeneration: 1 }
const blocked = { protocol: 'work-verification/1', workId: 'work-1', state: 'blocked', candidate,
  failure: { id: 'block-1', code: 'storage_unavailable', failureCount: 3 }, retryAvailable: true }

test('verification recovery status binds identity, result and permitted action without raw diagnostics', () => {
  assert.equal(WorkVerificationStatusSchema.safeParse(blocked).success, true)
  for (const change of [
    { workId: 'another-work' }, { candidate: undefined }, { failure: undefined },
    { verificationId: 'verification-1' }, { state: 'running' },
    { stderr: 'private-output' }, { failure: { ...blocked.failure, message: 'private-output' } },
  ]) assert.equal(WorkVerificationStatusSchema.safeParse({ ...blocked, ...change }).success, false)
  assert.equal(WorkVerificationStatusSchema.safeParse({ protocol: 'work-verification/1', workId: 'work-1',
    state: 'finished', verificationId: 'verification-1', retryAvailable: true }).success, false)
})

test('recheck requires an explicit current candidate and block identity, without commands or actor injection', () => {
  const command = { kind: 'retry_verification', commandId: 'retry-1', conversationId: 'conversation-1', candidate, blockedId: 'block-1' }
  assert.equal(VerificationRetryCommandSchema.safeParse(command).success, true)
  for (const change of [{ blockedId: undefined }, { candidate: undefined }, { actor: { userId: 'forged' } },
    { executable: '/bin/sh' }, { kind: 'retry_assignment' }])
    assert.equal(VerificationRetryCommandSchema.safeParse({ ...command, ...change }).success, false)
})
