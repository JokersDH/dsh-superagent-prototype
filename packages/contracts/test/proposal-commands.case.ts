import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProposalCommandSchema, ProposalPrepareSchema } from '../src/index.ts'

const scope = { projectId: 'project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
test('proposal preview accepts structured suggestions without actor or raw native authority', () => {
  const value = { projectId: 'project', conversationId: 'conversation', sourceMessageId: 'source',
    payload: { kind: 'propose_work', projectId: 'project', sourceMessageId: 'source', goal: 'Implement' } }
  assert.equal(ProposalPrepareSchema.safeParse(value).success, true)
  assert.equal(ProposalPrepareSchema.safeParse({ ...value, actor: 'model' }).success, false)
  assert.equal(ProposalPrepareSchema.safeParse({ ...value, payload: { kind: 'reply', text: 'Hello', sourceRefs: [] } }).success, false)
})
test('proposal commands cannot inject actor or force execution; reject carries no work parameters', () => {
  const value = { kind: 'confirm_proposal', commandId: 'command', projectId: 'project', conversationId: 'conversation', token: 'previewtoken.signature' }
  assert.equal(ProposalCommandSchema.safeParse(value).success, true, 'Missing confirmation details are an explicit needs-input rejection at composition')
  for (const change of [{ actor: 'forged' }, { force: true }, { profileId: 'native' }])
    assert.equal(ProposalCommandSchema.safeParse({ ...value, ...change }).success, false)
  assert.equal(ProposalCommandSchema.safeParse({ ...value, kind: 'reject_proposal', work: { scope } }).success, false)
})
