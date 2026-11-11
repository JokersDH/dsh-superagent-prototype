import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { actor, fixture, scope } from '../../application/test/helpers.ts'

/**
 * Independent consumer through main's real HTTP entry (proposal prepare/commands and decision
 * prepare/commands). C owns no HTTP; this only asserts the C library semantics are reachable and
 * that unconfirmed input has no effect.
 */
function setup(t: { after(fn: () => void): void }) {
  const h = fixture(t)
  const fixtureScope = { ...scope, excludedPaths: [] }
  h.store.product.messages.append({
    id: 'http-c-source',
    conversationId: 'conversation-main',
    projectId: scope.projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'Delegate the change',
    sourceRefs: [],
    createdAt: '2026-11-11T00:00:00.000Z',
  })
  const runtime = createProductRuntime({
    store: h.store,
    principal: actor,
    projects: [{ id: scope.projectId, scope: fixtureScope }],
    stateRoot: h.directory,
    scratchProject: h.directory,
    actionSecret: Buffer.alloc(32, 13),
  })
  t.after(async () => {
    await runtime.close()
  })
  const apiToken = 'b'.repeat(64)
  const api = createLocalHttpApp({
    application: runtime.application,
    operations: runtime.operations,
    principal: actor,
    bootstrapToken: 'a'.repeat(64),
    apiToken,
    allowedOrigins: ['http://127.0.0.1:4400'],
    mode: 'fixture',
  })
  return {
    h,
    api,
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    scope: fixtureScope,
    conversationId: 'conversation-main',
    sourceMessageId: 'http-c-source',
  }
}

test('main proposal HTTP drives the C confirmation rules end to end', async (t) => {
  const s = setup(t)
  const prepareBody = {
    projectId: scope.projectId,
    conversationId: s.conversationId,
    sourceMessageId: s.sourceMessageId,
    payload: { kind: 'propose_decision', content: 'Keep validation before acceptance', scope: s.scope, sourceMessageId: s.sourceMessageId },
  }

  // Unauthenticated and unknown-actor requests are refused before anything is written.
  assert.equal((await s.api.request('/v1/proposals/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prepareBody) })).status, 401)
  const previewResponse = await s.api.request('/v1/proposals/prepare', { method: 'POST', headers: s.headers, body: JSON.stringify(prepareBody) })
  assert.equal(previewResponse.status, 200)
  const preview = await previewResponse.json()
  assert.deepEqual(preview.requiredInputs, [])
  assert.equal(s.h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)

  // A body carrying a client actor field is rejected by the strict command schema.
  const command = {
    kind: 'confirm_proposal',
    commandId: 'http-c-confirm',
    projectId: scope.projectId,
    conversationId: s.conversationId,
    token: preview.token,
  }
  assert.equal(
    (await s.api.request('/v1/proposals/commands', { method: 'POST', headers: s.headers, body: JSON.stringify({ ...command, actor }) })).status,
    400,
  )
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)

  const confirmed = await s.api.request('/v1/proposals/commands', { method: 'POST', headers: s.headers, body: JSON.stringify(command) })
  assert.equal(confirmed.status, 200)
  const confirmedBody = await confirmed.json()
  assert.equal(confirmedBody.status, 'recorded')
  const record = s.h.store.workflows.assistant.proposals.get(preview.record.proposalId)
  assert.equal(record?.state, 'confirmed')
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 1)

  // Replaying the same command id returns the original receipt and creates no second effect.
  const replayResponse = await s.api.request('/v1/proposals/commands', { method: 'POST', headers: s.headers, body: JSON.stringify(command) })
  assert.equal(replayResponse.status, 200)
  assert.deepEqual(await replayResponse.json(), confirmedBody)
  assert.equal(s.h.store.workflows.assistant.proposals.history(record!.proposalId).length, 2)
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 1)

  // A different command id for the same preview conflicts rather than producing another effect.
  const conflicting = await s.api.request('/v1/proposals/commands', {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify({ ...command, commandId: 'http-c-confirm-2' }),
  })
  assert.notEqual(conflicting.status, 200)
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 1)
})

test('main proposal HTTP rejection is terminal and writes no business effect', async (t) => {
  const s = setup(t)
  const previewResponse = await s.api.request('/v1/proposals/prepare', {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify({
      projectId: scope.projectId,
      conversationId: s.conversationId,
      sourceMessageId: s.sourceMessageId,
      payload: { kind: 'propose_decision', content: 'Do not keep this', scope: s.scope, sourceMessageId: s.sourceMessageId },
    }),
  })
  const preview = await previewResponse.json()
  const rejected = await s.api.request('/v1/proposals/commands', {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify({ kind: 'reject_proposal', commandId: 'http-c-reject', projectId: scope.projectId, conversationId: s.conversationId, token: preview.token }),
  })
  assert.equal(rejected.status, 200)
  const record = s.h.store.workflows.assistant.proposals.get(preview.record.proposalId)
  assert.equal(record?.state, 'rejected')
  assert.equal(record?.effectCommandId, undefined)
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)
  assert.equal(s.h.store.events.after(0, 200).filter((event) => event.topic === 'application.proposal.changed').length, 1)

  // A later confirmation of the same rejected preview stays rejected.
  const afterReject = await s.api.request('/v1/proposals/commands', {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify({ kind: 'confirm_proposal', commandId: 'http-c-confirm-after-reject', projectId: scope.projectId, conversationId: s.conversationId, token: preview.token }),
  })
  // Main surfaces a terminal-state confirmation as 409 conflict; the proposal stays rejected.
  assert.equal(afterReject.status, 409)
  assert.equal(s.h.store.workflows.assistant.proposals.get(preview.record.proposalId)?.state, 'rejected')
  assert.equal(s.h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)
})
