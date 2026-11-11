import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductProposals } from '../../apps/coordinator/product/proposals.ts'
import { ProductDecisions } from '../../apps/coordinator/product/decisions.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { actor, createCommand, fixture, scope } from '../../packages/application/test/helpers.ts'

function setup(t) {
  const h = fixture(t), projects = [{ id: scope.projectId, scope: structuredClone(scope) }]
  let time = '2026-11-11T00:00:00.000Z'
  h.store.product.messages.append({ id: 'proposal-source', conversationId: 'conversation-main', projectId: scope.projectId,
    role: 'user', provenance: 'trusted_user', text: 'Please implement the change', sourceRefs: [], createdAt: time })
  const make = () => {
    const decisions = new ProductDecisions(h.store, actor, () => projects, Buffer.alloc(32, 11), () => time)
    return new ProductProposals(h.store, h.app, decisions, actor, () => projects, Buffer.alloc(32, 11), () => time)
  }
  let service = make()
  const input = { projectId: scope.projectId, conversationId: 'conversation-main', sourceMessageId: 'proposal-source',
    payload: { kind: 'propose_work', goal: 'Implement the proposed change', projectId: scope.projectId, sourceMessageId: 'proposal-source' } }
  return { get store() { return h.store }, get app() { return h.app }, get service() { return service }, projects, input,
    setTime: value => { time = value }, reopen: () => { h.reopen(); service = make() },
    command: (preview, commandId = 'confirm-proposal') => ({ kind: 'confirm_proposal', commandId, projectId: scope.projectId,
      conversationId: 'conversation-main', token: preview.token,
      work: { scope, profileId: createCommand().profileId, criteria: createCommand().criteria } }) }
}

test('read-only preview needs explicit inputs; confirmation atomically creates original lifecycle and durable audit', async t => {
  const h = setup(t), cursor = h.store.events.cursor(), preview = await h.service.prepare(h.input, actor)
  assert.deepEqual(preview.requiredInputs, ['work.scope', 'work.criteria', 'work.profileId'])
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)
  const command = h.command(preview), receipt = await h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
  assert.ok(receipt.workId)
  const record = h.store.workflows.assistant.proposals.get(preview.record.proposalId)
  assert.equal(record.state, 'confirmed')
  assert.equal(h.store.commands.get(record.effectCommandId).result.workId, receipt.workId)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 20).length, 1)
  assert.equal(h.store.domain.tickets.list().length, 1)
  h.reopen(); h.setTime('2026-11-12T00:00:00.000Z')
  assert.deepEqual(await h.service.dispatch(command, actor), receipt)
  assert.equal(h.store.workflows.assistant.proposals.history(record.proposalId).length, 2)
  assert.equal(h.store.domain.tickets.list().length, 1)
})

test('missing inputs and application refusal leave no confirmed proposal, work or effect receipt', async t => {
  const h = setup(t), preview = await h.service.prepare(h.input, actor)
  const { work, ...missing } = h.command(preview, 'missing-input')
  assert.equal((await h.service.dispatch(missing, actor)).status, 'rejected')
  assert.equal((await h.service.dispatch({ ...h.command(preview, 'irrelevant-revision'),
    revision: { goal: 'Unrelated input', scope, criteria: createCommand().criteria } }, actor)).status, 'rejected')
  const invalid = { ...h.command(preview, 'invalid-profile'), work: { ...work, profileId: 'unregistered' } }
  const result = await h.service.dispatch(invalid, actor)
  assert.equal(result.status, 'rejected')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.events.after(0, 100).filter(e => e.topic === 'application.proposal.changed').length, 0)
  await assert.rejects(h.service.dispatch(h.command(preview, 'invalid-profile'), actor), /another immutable request/)
  assert.equal((await h.service.dispatch(h.command(preview, 'valid-input'), actor)).status, 'recorded')
})

test('outer receipt failure rolls back proposal revisions, effects, core, queue and messages together', async t => {
  const h = setup(t), preview = await h.service.prepare(h.input, actor), command = h.command(preview), before = h.store.events.cursor()
  h.store.db.exec("CREATE TRIGGER fail_proposal_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id = 'confirm-proposal' BEGIN SELECT RAISE(ABORT, 'outer receipt failure'); END")
  await assert.rejects(h.service.dispatch(command, actor), /outer receipt failure/)
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.commands.get(command.commandId), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 20).length, 0)
  assert.equal(h.store.events.cursor(), before)
  assert.equal(h.store.product.messages.page('conversation-main').messages.length, 1)
  h.store.db.exec('DROP TRIGGER fail_proposal_receipt')
  assert.equal((await h.service.dispatch(command, actor)).status, 'recorded')
})

test('reject is durable audit with no business effect and cannot be confirmed later', async t => {
  const h = setup(t), preview = await h.service.prepare(h.input, actor)
  const command = { kind: 'reject_proposal', commandId: 'reject-proposal', projectId: scope.projectId,
    conversationId: 'conversation-main', token: preview.token }
  const receipt = await h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(await h.service.dispatch(command, actor), receipt)
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId).state, 'rejected')
  assert.equal((await h.service.dispatch(h.command(preview), actor)).status, 'rejected')
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('tampered preview, wrong scope/actor and expired preview cannot confirm work', async t => {
  const h = setup(t), preview = await h.service.prepare(h.input, actor), command = h.command(preview)
  await assert.rejects(h.service.dispatch(command, { ...actor, userId: 'other' }), /authenticated local user/)
  const tampered = { ...command, token: `${preview.token.slice(0, -1)}${preview.token.at(-1) === 'a' ? 'b' : 'a'}` }
  assert.equal((await h.service.dispatch(tampered, actor)).error.code, 'forbidden')
  assert.equal((await h.service.dispatch({ ...command, commandId: 'wrong-conversation', conversationId: 'other' }, actor)).error.code, 'forbidden')
  h.setTime('2026-11-11T00:06:00.000Z')
  assert.equal((await h.service.dispatch({ ...command, commandId: 'expired' }, actor)).error.code, 'stale_contract')
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('source text, current grant and post-preflight drift are rechecked before atomic commit', async t => {
  const h = setup(t), preview = await h.service.prepare(h.input, actor), original = h.store.product.messages.getById('proposal-source')
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...original, text: 'Changed' }), original.id)
  assert.equal((await h.service.dispatch(h.command(preview, 'source-changed'), actor)).status, 'rejected')
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify(original), original.id)
  const prepare = h.app.prepareCommand.bind(h.app)
  h.app.prepareCommand = async (...args) => {
    const result = await prepare(...args)
    h.projects[0].scope.excludedPaths.push('src/new-private/')
    return result
  }
  assert.equal((await h.service.dispatch(h.command(preview, 'grant-race'), actor)).status, 'rejected')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('ordinary replies, forged source provenance and mismatched projects cannot become executable previews', async t => {
  const h = setup(t)
  await assert.rejects(h.service.prepare({ ...h.input, payload: { kind: 'reply', text: 'Hello', sourceRefs: [] } }, actor))
  await assert.rejects(h.service.prepare({ ...h.input, payload: { ...h.input.payload, projectId: 'foreign' } }, actor))
  const message = h.store.product.messages.getById('proposal-source')
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...message, role: 'assistant', provenance: 'reasoner_reply' }), message.id)
  await assert.rejects(h.service.prepare(h.input, actor), /trusted user message/)
  assert.equal(h.store.workflows.assistant.proposals.list({ projectId: scope.projectId }).records.length, 0)
})

test('decision proposal commits through the existing explicit-decision service with no execution queue', async t => {
  const h = setup(t), preview = await h.service.prepare({ ...h.input,
    payload: { kind: 'propose_decision', content: 'Keep required verification', scope, sourceMessageId: 'proposal-source' } }, actor)
  const command = { kind: 'confirm_proposal', commandId: 'confirm-decision-proposal', projectId: scope.projectId,
    conversationId: 'conversation-main', token: preview.token }
  const receipt = await h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
  assert.equal(h.store.workflows.assistant.decisions.get(receipt.entityRefs.decisionId).decision.content, 'Keep required verification')
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records[0].decision.content, 'Keep required verification')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId).state, 'confirmed')
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 20).length, 0)
})

test('revision proposals require complete user-confirmed revision and a still-current contract', async t => {
  const h = setup(t), created = await h.app.dispatch(createCommand('original-work'), actor)
  const contract = (await h.app.inspect({ workId: created.workId })).works[0].contract
  const expected = { workId: contract.workId, revision: contract.revision, digest: contract.digest }
  const input = { ...h.input, payload: { kind: 'propose_revision', expected, rationale: 'Clarify the goal', sourceMessageId: 'proposal-source' } }
  const preview = await h.service.prepare(input, actor)
  const command = { kind: 'confirm_proposal', commandId: 'revise-from-proposal', projectId: scope.projectId,
    conversationId: 'conversation-main', token: preview.token, revision: { goal: 'Revised explicit goal', scope, criteria: createCommand().criteria } }
  assert.equal((await h.service.dispatch(command, actor)).status, 'recorded')
  assert.equal((await h.app.inspect({ workId: created.workId })).works[0].contract.revision, 2)
  assert.equal((await h.service.dispatch({ ...command, commandId: 'stale-revision' }, actor)).status, 'rejected')
  assert.equal(h.store.product.contracts.history(created.workId).length, 2)
})

test('actual runtime HTTP composes proposal confirmation, server actor and restore mutation guard', async t => {
  const h = fixture(t), fixtureScope = { ...scope, excludedPaths: [] }, source = { id: 'http-proposal-source', conversationId: 'conversation-main', projectId: scope.projectId,
    role: 'user', provenance: 'trusted_user', text: 'Delegate the change', sourceRefs: [], createdAt: '2026-11-11T00:00:00.000Z' }
  h.store.product.messages.append(source)
  const runtime = createProductRuntime({ store: h.store, principal: actor, projects: [{ id: scope.projectId, scope: fixtureScope }],
    stateRoot: h.directory, scratchProject: h.directory, actionSecret: Buffer.alloc(32, 13) })
  try {
    const options = { application: runtime.application, operations: runtime.operations, principal: actor,
      bootstrapToken: 'a'.repeat(64), apiToken: 'b'.repeat(64), allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture' }
    const api = createLocalHttpApp(options)
    const headers = { authorization: `Bearer ${options.apiToken}`, 'content-type': 'application/json' }
    const input = { projectId: scope.projectId, conversationId: source.conversationId, sourceMessageId: source.id,
      payload: { kind: 'propose_work', projectId: scope.projectId, goal: 'Write the fixed output', sourceMessageId: source.id } }
    assert.equal((await api.request('/v1/proposals/prepare', { method: 'POST', body: JSON.stringify(input), headers: { 'content-type': 'application/json' } })).status, 401)
    const previewResponse = await api.request('/v1/proposals/prepare', { method: 'POST', body: JSON.stringify(input), headers })
    assert.equal(previewResponse.status, 200)
    const preview = await previewResponse.json()
    const command = { kind: 'confirm_proposal', commandId: 'http-confirm-proposal', projectId: scope.projectId,
      conversationId: source.conversationId, token: preview.token, work: { scope: fixtureScope, profileId: 'profile-fixture-pass', criteria: [
        { id: 'fixed', kind: 'machine', required: true, description: 'Fixed check', checkDefinitionRef: 'check-fixture-output' }] } }
    assert.equal((await api.request('/v1/proposals/commands', { method: 'POST', headers, body: JSON.stringify({ ...command, actor }) })).status, 400)
    const restored = createLocalHttpApp({ ...options, startupMode: 'recovery_readonly' })
    assert.equal((await restored.request('/v1/proposals/commands', { method: 'POST', headers, body: JSON.stringify(command) })).status, 422)
    assert.equal(h.store.domain.tickets.list().length, 0)
    const response = await api.request('/v1/proposals/commands', { method: 'POST', headers, body: JSON.stringify(command) })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'recorded')
    assert.equal(h.store.domain.tickets.list().length, 1)
    const largeInput = { ...input, payload: { kind: 'propose_decision', content: '\u89c4'.repeat(16384), scope: fixtureScope, sourceMessageId: source.id } }
    const largePreviewResponse = await api.request('/v1/proposals/prepare', { method: 'POST', headers, body: JSON.stringify(largeInput) })
    assert.equal(largePreviewResponse.status, 200)
    const largePreview = await largePreviewResponse.json()
    const largeBody = JSON.stringify({ kind: 'confirm_proposal', commandId: 'large-decision', projectId: scope.projectId,
      conversationId: source.conversationId, token: largePreview.token })
    assert.ok(Buffer.byteLength(largeBody) > 64 * 1024)
    assert.equal((await api.request('/v1/proposals/commands', { method: 'POST', headers, body: largeBody })).status, 200)
    const decisionPreviewResponse = await api.request('/v1/decisions/prepare', { method: 'POST', headers, body: JSON.stringify({
      projectId: scope.projectId, conversationId: source.conversationId, sourceMessageId: source.id, scope: fixtureScope, content: largeInput.payload.content }) })
    assert.equal(decisionPreviewResponse.status, 200)
    const decisionPreview = await decisionPreviewResponse.json()
    const decisionBody = JSON.stringify({ kind: 'record_decision', commandId: 'large-direct-decision', projectId: scope.projectId,
      conversationId: source.conversationId, token: decisionPreview.token })
    assert.ok(Buffer.byteLength(decisionBody) > 64 * 1024)
    assert.equal((await api.request('/v1/decisions/commands', { method: 'POST', headers, body: decisionBody })).status, 200)
    assert.equal((await api.request('/v1/commands', { method: 'POST', headers, body: JSON.stringify({ text: 'a'.repeat(70000) }) })).status, 413)
  } finally { await runtime.close() }
})
