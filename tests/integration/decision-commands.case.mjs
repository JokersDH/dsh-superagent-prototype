import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductDecisions } from '../../apps/coordinator/product/decisions.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { fixture, actor, scope } from '../../packages/application/test/helpers.ts'

function setup(t) {
  const h = fixture(t)
  let time = '2026-11-11T00:00:00.000Z'
  const projects = [{ id: scope.projectId, scope: structuredClone(scope) }, { id: 'project-other', scope: { ...scope, projectId: 'project-other' } }]
  h.store.product.messages.append({ id: 'decision-source', conversationId: 'conversation-main', projectId: scope.projectId,
    role: 'user', provenance: 'trusted_user', text: 'Keep the validation contract', sourceRefs: [], createdAt: time })
  const make = () => new ProductDecisions(h.store, actor, () => projects, Buffer.alloc(32, 11), () => time)
  let service = make()
  return { ...h, projects, get service() { return service }, setTime: at => { time = at },
    reopen: () => { h.reopen(); service = make() },
    input: { projectId: scope.projectId, conversationId: 'conversation-main', sourceMessageId: 'decision-source', content: 'Keep validation before acceptance', scope },
    command: preview => ({ kind: 'record_decision', commandId: 'record-decision', projectId: scope.projectId, conversationId: 'conversation-main', token: preview.token }) }
}
test('preparation is read-only; explicit record and its event/receipt commit once and survive reopen', t => {
  const h = setup(t), cursor = h.store.events.cursor()
  const preview = h.service.prepare(h.input, actor), command = h.command(preview)
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.workflows.assistant.decisions.get(preview.decision.id), undefined)
  const receipt = h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(h.service.dispatch(command, actor), receipt)
  assert.equal(h.store.events.after(cursor, 100).filter(e => e.topic === 'application.decision.changed').length, 1)
  assert.equal(h.service.list({ projectId: scope.projectId }).decisions[0].sourceState, 'current')
  h.reopen()
  h.setTime('2026-11-11T01:00:00.000Z')
  assert.deepEqual(h.service.dispatch(command, actor), receipt, 'Replayed business receipt does not create a new authorization')
  assert.equal(h.service.list({ projectId: scope.projectId }).decisions[0].record.decision.content, h.input.content)
})
test('source digest, source conversation, actor and configured grant are rechecked on confirmation', t => {
  const h = setup(t), preview = h.service.prepare(h.input, actor)
  const original = h.store.product.messages.getById('decision-source')
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...original, text: 'Changed' }), original.id)
  assert.equal(h.service.dispatch(h.command(preview), actor).status, 'rejected')
  assert.equal(h.store.workflows.assistant.decisions.get(preview.decision.id), undefined)
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify(original), original.id)
  assert.throws(() => h.service.prepare({ ...h.input, conversationId: 'another-conversation' }, actor), e => e.error.code === 'forbidden')
  assert.throws(() => h.service.prepare(h.input, { ...actor, userId: 'foreign-user' }), e => e.error.code === 'forbidden')
  h.projects[0].scope.excludedPaths.push('src/new-private/')
  const changed = h.service.dispatch({ ...h.command(preview), commandId: 'changed-grant' }, actor)
  assert.equal(changed.error.code, 'stale_contract')
})
test('expired previews/scopes and tampered tokens cannot record or dispatch work', t => {
  const h = setup(t)
  const preview = h.service.prepare(h.input, actor)
  const forged = preview.token.slice(0, -1) + (preview.token.at(-1) === 'a' ? 'b' : 'a')
  assert.equal(h.service.dispatch({ ...h.command(preview), token: forged }, actor).error.code, 'forbidden')
  h.setTime('2026-11-11T00:06:00.000Z')
  assert.equal(h.service.dispatch({ ...h.command(preview), commandId: 'expired-preview' }, actor).error.code, 'stale_contract')
  h.setTime('2026-11-11T00:00:00.000Z')
  const timed = h.service.prepare({ ...h.input, scope: { ...scope, expiresAt: '2026-11-11T00:00:10.000Z' } }, actor)
  h.setTime('2026-11-11T00:00:11.000Z')
  assert.equal(h.service.dispatch({ ...h.command(timed), commandId: 'expired-scope' }, actor).error.code, 'stale_contract')
  assert.equal(h.store.product.works.listByProject(scope.projectId, { limit: 200 }).length, 0)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100).length, 0)
})
test('a receipt failure rolls the decision and event back, with a later identical command allowed', t => {
  const h = setup(t), preview = h.service.prepare(h.input, actor), command = h.command(preview), cursor = h.store.events.cursor()
  h.store.db.exec("CREATE TRIGGER reject_decision_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id = 'record-decision' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
  assert.throws(() => h.service.dispatch(command, actor))
  assert.equal(h.store.workflows.assistant.decisions.get(preview.decision.id), undefined)
  assert.equal(h.store.events.cursor(), cursor)
  h.store.db.exec('DROP TRIGGER reject_decision_receipt')
  assert.equal(h.service.dispatch(command, actor).status, 'recorded')
})
test('revocation persists audit history, foreign scope is refused and old previews cannot resurrect it', t => {
  const h = setup(t), preview = h.service.prepare(h.input, actor), command = h.command(preview)
  assert.equal(h.service.dispatch(command, actor).status, 'recorded')
  const revoke = { kind: 'revoke_decision', commandId: 'revoke-one', decisionId: preview.decision.id,
    projectId: scope.projectId, conversationId: 'conversation-main', expectedVersion: 1 }
  assert.equal(h.service.dispatch({ ...revoke, commandId: 'foreign-revoke', projectId: 'project-other' }, actor).error.code, 'forbidden')
  const receipt = h.service.dispatch(revoke, actor)
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(h.service.dispatch(revoke, actor), receipt)
  assert.equal(h.service.list({ projectId: scope.projectId }).decisions[0].status, 'revoked')
  h.service.dispatch({ ...command, commandId: 'old-preview-another-command' }, actor)
  assert.equal(h.service.list({ projectId: scope.projectId }).decisions[0].status, 'revoked')
  assert.equal(h.store.workflows.assistant.decisions.history(preview.decision.id).length, 2)
  assert.throws(() => h.service.dispatch({ ...command, token: command.token + 'a' }, actor), e => e.error.code === 'conflict')
})
test('source disappearance is visible in the catalog and project-bound continuation is enforced', t => {
  const h = setup(t)
  for (let i = 0; i < 3; i++) {
    const preview = h.service.prepare({ ...h.input, content: `Decision ${i}` }, actor)
    h.service.dispatch({ ...h.command(preview), commandId: `record-${i}` }, actor)
  }
  const first = h.service.list({ projectId: scope.projectId, limit: 1 })
  assert.equal(first.hasMore, true)
  const second = h.service.list({ projectId: scope.projectId, limit: 1, cursor: first.nextCursor })
  assert.notEqual(first.decisions[0].record.decision.id, second.decisions[0].record.decision.id)
  assert.throws(() => h.service.list({ projectId: 'project-other', cursor: first.nextCursor }), e => e.error.code === 'invalid_request')
  h.store.db.prepare('DELETE FROM conversation_messages WHERE id = ?').run('decision-source')
  assert.equal(h.service.list({ projectId: scope.projectId }).decisions[0].sourceState, 'missing')
})
test('model messages and native answer display cannot become reusable user decisions', t => {
  const h = setup(t)
  for (const [id, role, provenance] of [['assistant-source', 'assistant', 'reasoner_reply'], ['permission-display', 'user', 'question_answer_display']]) {
    h.store.product.messages.append({ id, conversationId: 'conversation-main', projectId: scope.projectId, role, provenance,
      text: 'Do not promote this', sourceRefs: [], createdAt: '2026-11-11T00:00:00.000Z' })
    assert.throws(() => h.service.prepare({ ...h.input, sourceMessageId: id }, actor))
  }
})
test('HTTP identity/schema and recovery read-only guard apply to every decision mutation', async t => {
  const h = setup(t), options = { application: h.app, principal: actor, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', localDevelopmentAccess: true,
    operations: { retryVerification: h.app.retryVerification.bind(h.app), prepareDecision: async (value, trusted) => h.service.prepare(value, trusted),
      decision: async (value, trusted) => h.service.dispatch(value, trusted) }, read: { decisions: async query => h.service.list(query) } }
  const http = createLocalHttpApp(options), headers = { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }
  const response = await http.request('http://127.0.0.1/v1/decisions/prepare', { method: 'POST', headers, body: JSON.stringify(h.input) })
  assert.equal(response.status, 200)
  const preview = await response.json()
  assert.equal((await http.request('http://127.0.0.1/v1/decisions/commands', { method: 'POST', headers, body: JSON.stringify(h.command(preview)) })).status, 200)
  assert.equal((await http.request('http://127.0.0.1/v1/decisions/prepare', { method: 'POST', headers, body: JSON.stringify({ ...h.input, actor }) })).status, 400)
  assert.equal((await http.request('http://127.0.0.1/v1/decisions?projectId=project-atlas&actor=forged')).status, 400)
  const recovery = createLocalHttpApp({ ...options, startupMode: 'recovery_readonly' })
  assert.equal((await recovery.request('http://127.0.0.1/v1/decisions?projectId=project-atlas')).status, 200)
  for (const route of ['/v1/decisions/prepare', '/v1/decisions/commands'])
    assert.equal((await recovery.request(`http://127.0.0.1${route}`, { method: 'POST', headers, body: '{}' })).status, 422)
})
