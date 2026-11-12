import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductApplication } from '../../packages/application/dist/index.js'
import { AssistantContextBindingSchema } from '../../packages/contracts/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { ProductContextPreview } from '../../apps/coordinator/product/context-preview.ts'
import { ProductAssistantContext } from '../../apps/coordinator/product/assistant-context-use.ts'

const principal = { userId: 'selected-context-user', authorityRef: 'selected-context-authority' }
const actor = { ...principal, source: 'local_ui' }
const scope = { projectId: 'context-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const errorCode = expected => error => error?.error?.code === expected

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pa-selected-context-'))
  let store = new ProductStore({ path: join(root, 'state.sqlite') }), time = '2026-11-11T12:00:00.000Z', calls = 0
  const projects = [{ id: scope.projectId, scope: structuredClone(scope) }], records = new Map()
  let app, service, preview, bindings, afterPrepare
  const setup = () => {
    app = createProductApplication({ store, principal, projects, profileIds: ['fixture'], registeredChecks: ['fixture-check'],
      actionSecret: Buffer.alloc(32, 21), assistantReplies: true, now: () => time })
    // Until A's port is integrated, this fixture participates only through afterCommit. It proves
    // main's composition and SQL rollback, not A's eventual persistence or crash certification.
    bindings = store.workflows.assistant.contextBindings ?? {
      forMessage: id => { const value = [...records.values()].find(value => value.messageId === id); return value && structuredClone(value) },
      forCommand: id => { const value = records.get(id); return value && structuredClone(value) },
      put: value => {
        assert.ok(store.uow.nesting > 0)
        const record = AssistantContextBindingSchema.parse(value)
        const existing = records.get(record.commandId) ?? [...records.values()].find(value => value.messageId === record.messageId)
        if (existing) { assert.deepEqual(existing, record); return { binding: structuredClone(existing), replayed: true } }
        store.uow.afterCommit(() => records.set(record.commandId, structuredClone(record)))
        return { binding: record, replayed: false }
      },
    }
    const actual = new ProductContextPreview(store, app, principal, () => projects,
      { verification: async () => undefined, workEvidence: async () => { throw new Error('No work selected') } }, () => time)
    preview = { prepareGuarded: async (...args) => {
      calls++
      const value = await actual.prepareGuarded(...args)
      await afterPrepare?.()
      return value
    } }
    service = new ProductAssistantContext({ store, application: app, principal, preview, bindings,
      projects: () => projects, secret: Buffer.alloc(32, 29), now: () => time })
  }
  setup()
  store.product.messages.append({ id: 'original-source', conversationId: 'context-conversation', projectId: scope.projectId,
    role: 'user', provenance: 'trusted_user', text: 'Keep the original payment error codes.', sourceRefs: [], createdAt: time })
  const input = (commandId = 'context-chat') => ({ commandId, text: 'Explain the selected payment constraints.',
    context: { projectId: scope.projectId, conversationId: 'context-conversation', selections: ['conversation', 'project'],
      budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } })
  const snapshot = () => ({ events: store.events.cursor(), messages: store.product.messages.page('context-conversation').messages.length,
    artifacts: store.artifacts.list({ limit: 200 }).artifacts.length,
    queued: store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100).length })
  const changeSource = () => {
    const source = store.product.messages.getById('original-source')
    store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...source, text: 'Changed payment constraint.' }), source.id)
  }
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, input, snapshot, changeSource, projects, records,
    get store() { return store }, get app() { return app }, get service() { return service }, get preview() { return preview }, get bindings() { return bindings },
    get calls() { return calls }, resetCalls: () => { calls = 0 }, setTime: value => { time = value }, afterPrepare: value => { afterPrepare = value },
    reopen: () => { store.close(); store = new ProductStore({ path: join(root, 'state.sqlite') }); setup() },
    message: id => store.product.messages.getById(key('message', id)),
  }
}

test('explicit prepare is readonly and one confirm commits actual chat, bundle, binding and original receipt', async t => {
  const h = fixture(t), before = h.snapshot(), prepared = await h.service.prepare(h.input(), actor)
  assert.deepEqual(h.snapshot(), before)
  assert.equal(prepared.preview.trust, 'untrusted_data')
  assert.equal(Buffer.from(prepared.token.split('.')[0], 'base64url').toString().includes('Keep the original payment error codes.'), false)
  const receipt = await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
  assert.equal(receipt.status, 'recorded')
  const binding = h.bindings.forCommand(prepared.commandId), message = h.message(prepared.commandId)
  assert.equal(binding.messageId, message.id); assert.equal(binding.projectId, scope.projectId)
  assert.equal(message.anchor, undefined, 'A selected work must never turn the message into a running-work supplement')
  assert.equal(h.snapshot().queued, 1); assert.equal(h.store.domain.tickets.list().length, 0)
  const frozen = h.store.artifacts.read(binding.bundleRef)
  assert.equal(frozen.record.digest, binding.bundleDigest)
  assert.equal(JSON.parse(Buffer.from(frozen.data).toString()).protocol, 'assistant-context-bundle/1')
  assert.deepEqual(h.service.audit(message.id), binding)
})

test('tampering, caller authority, wrong actor and command identity fail before source reads or writes', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input(), actor), before = h.snapshot()
  h.resetCalls()
  for (const command of [
    { commandId: 'another-command', token: prepared.token },
    { commandId: prepared.commandId, token: `A${prepared.token.slice(1)}` },
    { commandId: prepared.commandId, token: prepared.token, actor },
  ]) await assert.rejects(h.service.dispatch(command, actor))
  for (const identity of [{ ...actor, userId: 'foreign' }, { ...actor, authorityRef: 'foreign' }, { ...actor, source: 'explicit_rule' }])
    await assert.rejects(h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, identity), errorCode('forbidden'))
  await assert.rejects(h.service.prepare({ ...h.input('invalid'), actor }, actor))
  assert.equal(h.calls, 0); assert.deepEqual(h.snapshot(), before)
})

test('a source change or expired confirmation cannot silently fall back to ordinary chat', async t => {
  for (const mutation of ['source', 'expiry', 'scope']) await t.test(mutation, async t => {
    const h = fixture(t), prepared = await h.service.prepare(h.input(), actor), before = h.snapshot()
    if (mutation === 'source') h.changeSource()
    if (mutation === 'expiry') h.setTime('2026-11-11T12:05:00.000Z')
    if (mutation === 'scope') h.projects[0].scope.excludedPaths.push('src/private/')
    const receipt = await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
    assert.equal(receipt.status, 'rejected')
    assert.equal(h.store.commands.get(prepared.commandId).status, 'rejected')
    assert.equal(h.snapshot().events, before.events + 1)
    assert.deepEqual({ ...h.snapshot(), events: before.events }, before)
    assert.equal(h.bindings.forCommand(prepared.commandId), undefined)
    h.setTime('2026-11-11T13:00:00.000Z'); h.resetCalls()
    assert.deepEqual(await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor), receipt)
    assert.equal(h.calls, 0)
  })
})

test('same original confirmation replays after expiry and source drift, including receipt/bundle reopen', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input(), actor), command = { commandId: prepared.commandId, token: prepared.token }
  const receipt = await h.service.dispatch(command, actor), before = h.snapshot()
  h.setTime('2026-11-11T13:00:00.000Z'); h.changeSource(); h.resetCalls()
  assert.deepEqual(await h.service.dispatch(command, { ...actor, source: 'local_cli' }), receipt)
  assert.equal(h.calls, 0); assert.deepEqual(h.snapshot(), before)
  h.reopen(); h.resetCalls()
  assert.deepEqual(await h.service.dispatch(command, actor), receipt)
  assert.equal(h.calls, 0); assert.deepEqual(h.snapshot(), before)
  await assert.rejects(h.service.prepare(h.input(), actor), errorCode('conflict'))
})

test('ordinary prior chat cannot gain context later and another signed body conflicts under the same command', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input(), actor)
  const second = await h.service.prepare({ ...h.input(), text: 'A different user question.' }, actor)
  await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
  h.resetCalls()
  await assert.rejects(h.service.dispatch({ commandId: second.commandId, token: second.token }, actor), errorCode('conflict'))
  assert.equal(h.calls, 0)
  const ordinary = h.input('ordinary-chat')
  const beforeOrdinary = await h.service.prepare(ordinary, actor)
  await h.app.dispatch({ kind: 'chat', commandId: ordinary.commandId, conversationId: ordinary.context.conversationId,
    projectId: ordinary.context.projectId, text: ordinary.text }, actor)
  const before = h.snapshot()
  await assert.rejects(h.service.dispatch({ commandId: ordinary.commandId, token: beforeOrdinary.token }, actor), errorCode('conflict'))
  assert.deepEqual(h.snapshot(), before)
})

test('outer failures roll back chat, binding fixture, artifact reference, effect and receipt together', async t => {
  for (const injection of ['receipt', 'binding', 'binding-result', 'rejected']) await t.test(injection, async t => {
    const h = fixture(t), prepared = await h.service.prepare(h.input(), actor), before = h.snapshot()
    if (injection === 'receipt') h.store.db.exec("CREATE TRIGGER fail_context_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
    if (injection === 'binding') h.bindings.put = () => { throw new Error('injected binding failure') }
    if (injection === 'binding-result') {
      const put = h.bindings.put.bind(h.bindings)
      h.bindings.put = value => ({ ...put(value), binding: { ...value, requestId: 'different-request' } })
    }
    if (injection === 'rejected') {
      const commit = h.app.commitPrepared.bind(h.app)
      h.app.commitPrepared = value => ({ ...commit(value), status: 'rejected', error: { code: 'policy_unprepared', message: 'injected refusal', retry: 'user_action' } })
    }
    if (injection === 'rejected') {
      const receipt = await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
      assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'policy_unprepared')
      assert.equal(h.snapshot().events, before.events + 1)
      assert.deepEqual({ ...h.snapshot(), events: before.events }, before)
      assert.equal(h.store.commands.get(prepared.commandId).status, 'rejected')
    } else {
      await assert.rejects(h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor))
      assert.deepEqual(h.snapshot(), before); assert.equal(h.store.commands.get(prepared.commandId), undefined)
    }
    assert.equal(h.bindings.forCommand(prepared.commandId), undefined)
  })
})

test('source guards close both preview-return and application-preflight await windows', async t => {
  for (const injection of ['preview', 'application']) await t.test(injection, async t => {
    const h = fixture(t), prepared = await h.service.prepare(h.input(), actor), before = h.snapshot()
    if (injection === 'preview') h.afterPrepare(() => { h.changeSource() })
    else {
      const prepare = h.app.prepareCommand.bind(h.app)
      h.app.prepareCommand = async (...args) => { const value = await prepare(...args); h.changeSource(); return value }
    }
    const receipt = await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
    assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'conflict')
    assert.equal(h.snapshot().events, before.events + 1)
    assert.deepEqual({ ...h.snapshot(), events: before.events }, before)
  })
})

test('pre-send consumer verifies the frozen original snapshot and excludes its own newly appended message', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input(), actor)
  await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
  const message = h.message(prepared.commandId), before = h.snapshot(), selected = await h.service.forMessage(message)
  assert.ok(selected)
  const content = JSON.parse(selected.content)
  assert.equal(content.protocol, 'user-selected-context/1'); assert.equal(content.trust, 'untrusted_data')
  assert.match(selected.content, /Keep the original payment error codes/)
  assert.equal(selected.content.includes(message.text), false, 'The current message must not perturb its own selected snapshot')
  assert.equal(content.role, undefined); assert.equal(content.tools, undefined)
  selected.assertCurrent(); assert.deepEqual(h.snapshot(), before)
  const ordinary = { ...message, id: 'ordinary-without-binding' }
  assert.equal(await h.service.forMessage(ordinary), undefined)
})

test('pre-send revalidation refuses changed source, scope, expiry or artifact instead of omitting selected data', async t => {
  for (const mutation of ['source', 'scope', 'expiry', 'artifact']) await t.test(mutation, async t => {
    const h = fixture(t), prepared = await h.service.prepare(h.input(), actor)
    await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
    const message = h.message(prepared.commandId), binding = h.bindings.forMessage(message.id), before = h.snapshot()
    if (mutation === 'source') h.changeSource()
    if (mutation === 'scope') h.projects[0].scope.excludedPaths.push('src/hidden/')
    if (mutation === 'expiry') h.setTime('2026-11-11T12:05:00.000Z')
    if (mutation === 'artifact') h.store.db.prepare('UPDATE artifacts SET digest = ? WHERE id = ?').run('0'.repeat(64), binding.bundleRef)
    await assert.rejects(h.service.forMessage(message))
    assert.deepEqual(h.snapshot(), before)
  })
})

test('the returned synchronous guard checks source and binding immediately before request reservation', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input(), actor)
  await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
  const selected = await h.service.forMessage(h.message(prepared.commandId))
  selected.assertCurrent()
  h.changeSource()
  assert.throws(() => selected.assertCurrent(), errorCode('conflict'))
})

test('historical audit remains readable after expiry but never permits a new send', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input(), actor)
  await h.service.dispatch({ commandId: prepared.commandId, token: prepared.token }, actor)
  const message = h.message(prepared.commandId), binding = h.service.audit(message.id)
  h.setTime('2026-11-11T13:00:00.000Z')
  assert.deepEqual(h.service.audit(message.id), binding)
  await assert.rejects(h.service.forMessage(message), errorCode('stale_contract'))
  h.projects.splice(0)
  assert.throws(() => h.service.audit(message.id), errorCode('forbidden'))
})

test('a rejected source confirmation replays after reopen and another token cannot claim its command', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input('rejected-original'), actor)
  const other = await h.service.prepare({ ...h.input('rejected-original'), text: 'Another signed question.' }, actor)
  const command = { commandId: prepared.commandId, token: prepared.token }
  h.setTime('2026-11-11T12:06:00.000Z')
  const receipt = await h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'stale_contract')
  const before = h.snapshot()
  h.reopen(); h.resetCalls()
  assert.deepEqual(await h.service.dispatch(command, { ...actor, source: 'local_cli' }), receipt)
  assert.deepEqual(h.snapshot(), before); assert.equal(h.calls, 0)
  assert.equal(h.service.audit(key('message', prepared.commandId)), undefined)
  await assert.rejects(h.service.dispatch({ commandId: other.commandId, token: other.token }, actor), errorCode('conflict'))
  assert.deepEqual(h.snapshot(), before)
})

test('a failure while storing a deterministic rejection remains unknown until the original request can be recorded', async t => {
  const h = fixture(t), prepared = await h.service.prepare(h.input('rejection-store-fault'), actor), before = h.snapshot()
  const command = { commandId: prepared.commandId, token: prepared.token }
  h.setTime('2026-11-11T12:06:00.000Z')
  h.store.db.exec("CREATE TRIGGER fail_rejection_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected rejection storage failure'); END")
  await assert.rejects(h.service.dispatch(command, actor), /injected rejection storage failure/)
  assert.deepEqual(h.snapshot(), before); assert.equal(h.store.commands.get(prepared.commandId), undefined)
  assert.equal(h.bindings.forCommand(prepared.commandId), undefined)
  h.store.db.exec('DROP TRIGGER fail_rejection_receipt')
  const receipt = await h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'rejected')
  assert.equal(h.snapshot().messages, before.messages); assert.equal(h.snapshot().queued, 0)
  assert.deepEqual(await h.service.dispatch(command, actor), receipt)
})
