import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProposalCommand, ProposalPrepare } from '@personal-agent/contracts'
import { HttpTransport, TransportError } from '../src/transport.ts'

const scope = { projectId: 'project-one', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const input: ProposalPrepare = { projectId: scope.projectId, conversationId: 'conversation-one', sourceMessageId: 'message-one',
  payload: { kind: 'propose_work', projectId: scope.projectId, sourceMessageId: 'message-one', goal: 'Implement the requested change' } }
const preview = () => ({ protocol: 'proposal-preview/1', record: { proposalId: 'proposal-one', version: 1, state: 'pending',
  projectId: scope.projectId, conversationId: input.conversationId, sourceMessageId: input.sourceMessageId,
  sourceTextDigest: 'a'.repeat(64), actorRef: 'local-authority', grantId: 'grant-one', grantScope: scope, payload: input.payload,
  payloadDigest: 'b'.repeat(64), createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' },
  requiredInputs: ['work.scope', 'work.criteria', 'work.profileId'], expiresAt: '2026-11-11T00:05:00.000Z', token: 'signedpreview.signature' })
const command: ProposalCommand = { kind: 'reject_proposal', commandId: 'reject-one', projectId: scope.projectId, conversationId: input.conversationId, token: 'signedpreview.signature' }

test('proposal preview validates original source and payload; requests contain no caller actor', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/v1/proposals/prepare')
    assert.equal(options?.credentials, 'include')
    assert.deepEqual(JSON.parse(String(options?.body)), input)
    return new Response(JSON.stringify(preview()))
  }
  assert.deepEqual(await new HttpTransport().prepareProposal(input), preview())
  for (const change of [{ sourceMessageId: 'another-message' }, { conversationId: 'another-conversation' },
    { payload: { ...input.payload, goal: 'Changed goal' } }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ ...preview(), record: { ...preview().record, ...change } }))
    await assert.rejects(new HttpTransport().prepareProposal(input))
  }
})

test('a schema-valid rejected proposal receipt settles even on HTTP422; mismatched receipt stays unknown', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const rejected = { status: 'rejected', commandId: command.commandId, seq: 4,
    error: { code: 'stale_contract', message: 'Grant changed', retry: 'user_action' } }
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), '/v1/proposals/commands')
    assert.deepEqual(JSON.parse(String(options?.body)), command)
    return new Response(JSON.stringify(rejected), { status: 422 })
  }
  assert.deepEqual(await new HttpTransport().proposalCommand(command), rejected)
  globalThis.fetch = async () => new Response(JSON.stringify({ ...rejected, commandId: 'different-command' }), { status: 422 })
  await assert.rejects(new HttpTransport().proposalCommand(command), error => error instanceof TransportError && error.code === 'schema_mismatch')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'auth_required', message: 'Sign in', retry: 'user_action' } }), { status: 401 })
  await assert.rejects(new HttpTransport().proposalCommand(command), error => error instanceof TransportError && error.code === 'auth_required')
})

test('proposal request identity cannot carry an actor or an unknown command field', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let sends = 0
  globalThis.fetch = async () => { sends++; return new Response('{}') }
  await assert.rejects(new HttpTransport().proposalCommand({ ...command, actor: 'model' } as unknown as ProposalCommand))
  await assert.rejects(new HttpTransport().prepareProposal({ ...input, nativeCommand: 'turn/start' } as unknown as ProposalPrepare))
  assert.equal(sends, 0)
})
