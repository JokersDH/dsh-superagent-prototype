import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { AssistantContextBindingSchema } from '../../packages/contracts/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const principal = { userId: 'context-product-user', authorityRef: 'context-product-authority' }
const actor = { ...principal, source: 'local_cli' }
const scope = { projectId: 'context-product', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const API = 'a'.repeat(64)
const timeout = (promise, milliseconds = 5000) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Product condition timed out')), milliseconds) })])
    .finally(() => clearTimeout(timer))
}
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value }); return { promise, resolve } }

async function fixture(t, respond = async () => ({ text: 'Bounded context reply.', model: 'mock-context' }), completedResults = false) {
  const root = mkdtempSync(join(tmpdir(), 'pa-context-product-')), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(projectRoot); mkdirSync(join(projectRoot, 'src'))
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), product, now = new Date().toISOString(), beforeStatus
  const records = new Map(), completedRecords = new Map(), requests = [], servers = [], releases = []
  const status = () => {
    const hook = beforeStatus; beforeStatus = undefined; hook?.()
    return { protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
      model: 'mock-context', models: ['mock-context'], state: 'configured', secureTransport: true }
  }
  const provider = { status, selectModel: () => status(), reply: async (...args) => {
    requests.push(structuredClone(args[0])); return respond(...args)
  } }
  const setup = () => {
    // A is the only production SQL writer. This fallback commits only after the caller UoW and
    // is explicitly a composition fixture, never evidence of A's binding-table durability.
    const bindings = store.workflows.assistant.contextBindings ?? {
      forMessage: id => { const record = [...records.values()].find(value => value.messageId === id); return record && structuredClone(record) },
      forCommand: id => { const record = records.get(id); return record && structuredClone(record) },
      put: value => {
        assert.ok(store.uow.nesting > 0)
        const binding = AssistantContextBindingSchema.parse(value), existing = records.get(binding.commandId)
        if (existing) { assert.deepEqual(existing, binding); return { binding: structuredClone(existing), replayed: true } }
        store.uow.afterCommit(() => records.set(binding.commandId, structuredClone(binding)))
        return { binding, replayed: false }
      },
    }
    // This result-port fallback survives only in the test process. Reopening SQLite below proves
    // the product consumer/receipts/artifact path, not A's pending durable result implementation.
    const replyResults = completedResults ? store.workflows.assistant.replyResults ?? {
      forRequest: id => structuredClone(completedRecords.get(id)),
      forReply: id => structuredClone([...completedRecords.values()].find(value => value.replyMessageId === id)),
      put: value => {
        assert.ok(store.uow.nesting > 0)
        const result = structuredClone(value)
        store.uow.afterCommit(() => completedRecords.set(result.requestId, result))
        return { result, replayed: false }
      },
    } : undefined
    product = createProductRuntime({ store, principal, stateRoot, scratchProject: projectRoot,
      projects: [{ id: scope.projectId, displayName: 'Payment project', scope }], actionSecret: Buffer.alloc(32, 38),
      assistantProvider: provider, assistantContextBindings: bindings,
      ...(replyResults ? { assistantReplyResults: replyResults } : {}), now: () => now })
  }
  setup()
  store.product.messages.append({ id: 'payment-source', conversationId: 'context-conversation', projectId: scope.projectId,
    role: 'user', provenance: 'trusted_user', text: 'SOURCE-PAYMENT: Preserve existing error codes.', sourceRefs: [], createdAt: now })
  const makeApp = (override = {}) => createLocalHttpApp({ application: product.application, principal,
    apiToken: API, bootstrapToken: 'b'.repeat(64), allowedOrigins: ['http://127.0.0.1:4405'], mode: 'fixture',
    read: product.read, operations: product.operations, ...override })
  const listen = async app => {
    const server = listenLocalHttp(app, 0)
    servers.push(server); await once(server, 'listening')
    return `http://127.0.0.1:${server.address().port}`
  }
  let url = await listen(makeApp())
  const request = (path, body, options = {}) => fetch(`${options.url ?? url}${path}`, {
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    ...options, headers: { authorization: `Bearer ${API}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
  })
  const read = async (path, body, options) => {
    const response = await request(path, body, options), value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value)); return value
  }
  const input = (commandId = 'selected-message', text = 'Explain the payment constraints.', selections = ['conversation', 'project']) => ({
    commandId, text, context: { projectId: scope.projectId, conversationId: 'context-conversation', selections,
      budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } },
  })
  const prepare = value => read('/v1/assistant/context/prepare', value ?? input())
  const send = prepared => read('/v1/assistant/context/send', { commandId: prepared.commandId, token: prepared.token })
  const flush = async () => { product.execution.effects.start(); product.execution.effects.kick(); await product.execution.effects.idle('application.assistant.reply') }
  const messages = () => store.product.messages.page('context-conversation').messages
  const changeSource = () => {
    const source = store.product.messages.getById('payment-source')
    store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...source, text: 'Changed payment source.' }), source.id)
  }
  const closeServers = async () => {
    for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  }
  t.after(async () => {
    for (const release of releases) release()
    await closeServers(); await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  })
  return { input, prepare, send, read, request, requests, messages, flush, changeSource, provider,
    get store() { return store }, get product() { return product }, get url() { return url },
    cleanup: fn => releases.push(fn), beforeStatus: fn => { beforeStatus = fn },
    setTime: value => { now = value }, makeApp, listen,
    requeueDue: () => {
      for (const row of store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100))
        store.queue.reschedule(row.kind, row.key, row.seq, row.generation, 0)
    },
    reopen: async () => { await closeServers(); await product.close(); store.close(); store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }); setup(); url = await listen(makeApp()) },
  }
}

test('a selected decision expiring at the final reservation blocks the provider without a write event', async t => {
  const h = await fixture(t), at = new Date().toISOString(), expiresAt = new Date(Date.parse(at) + 1000).toISOString()
  h.setTime(at)
  const decision = await h.product.operations.prepareDecision({ projectId: scope.projectId, conversationId: 'context-conversation',
    sourceMessageId: 'payment-source', content: 'TEMPORARY-PAYMENT-CONSTRAINT', scope: { ...scope, expiresAt } }, actor)
  const recorded = await h.product.operations.decision({ kind: 'record_decision', commandId: 'temporary-decision',
    projectId: scope.projectId, conversationId: 'context-conversation', token: decision.token }, actor)
  assert.equal(recorded.status, 'recorded')
  const prepared = await h.prepare(h.input('temporary-context', 'Review the temporary constraint.', ['decisions']))
  assert.equal(prepared.expiresAt, expiresAt)
  await h.send(prepared)
  h.beforeStatus(() => h.setTime(new Date(Date.parse(expiresAt) + 1).toISOString()))
  await h.flush()
  assert.equal(h.requests.length, 0)
  assert.equal(h.store.commands.get(key('assistant-request', key('message', prepared.commandId))), undefined)
  assert.ok(h.messages().some(message => message.provenance === 'application_notice' && message.text.includes('未发送给模型')))
})

test('HTTP context replies use the completed-result consumer after SQLite reopen with an explicitly in-process result port', async t => {
  const h = await fixture(t, async () => ({ text: 'Recovered selected-context reply.', model: 'mock-context' }), true)
  const prepared = await h.prepare()
  await h.send(prepared)
  const messageId = key('message', prepared.commandId)
  h.store.db.exec("CREATE TRIGGER fail_reply BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'injected reply failure'); END")
  await h.flush()
  assert.equal(h.requests.length, 1)
  assert.equal(h.messages().filter(message => message.provenance === 'reasoner_reply').length, 0)
  const audit = await h.read(`/v1/messages/${messageId}/context`)
  h.store.db.exec('DROP TRIGGER fail_reply'); h.requeueDue(); await h.reopen(); await h.flush()
  assert.equal(h.requests.length, 1)
  const replies = h.messages().filter(message => message.provenance === 'reasoner_reply')
  assert.equal(replies.length, 1); assert.equal(replies[0].text, 'Recovered selected-context reply.')
  assert.deepEqual(replies[0].sourceRefs, [messageId])
  assert.deepEqual(await h.read(`/v1/messages/${messageId}/context`), audit)
})

test('provider unavailability does not block an original receipt replay but rejects an unsent confirmation durably', async t => {
  const h = await fixture(t), accepted = await h.prepare(h.input('provider-accepted'))
  const original = await h.send(accepted)
  const pending = await h.prepare(h.input('provider-unsent'))
  const status = h.provider.status
  h.provider.status = () => ({ ...status(), configured: false, state: 'not_configured' })
  assert.deepEqual(await h.send(accepted), original)
  const response = await h.request('/v1/assistant/context/send', { commandId: pending.commandId, token: pending.token })
  const receipt = await response.json()
  assert.equal(response.status, 422); assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'unsupported_capability')
  const replay = await h.request('/v1/assistant/context/send', { commandId: pending.commandId, token: pending.token })
  assert.deepEqual(await replay.json(), receipt)
  assert.equal(h.requests.length, 0)
  assert.equal(h.messages().some(message => message.id === key('message', pending.commandId)), false)
})

test('real HTTP selection reaches the existing provider and SSE once, with a durable source audit', { timeout: 10000 }, async t => {
  const begun = deferred(), release = deferred()
  const h = await fixture(t, async (_messages, onDelta) => { onDelta('First part.'); begun.resolve(); await release.promise; onDelta(' Second part.'); return { text: 'First part. Second part.', model: 'mock-context' } })
  h.cleanup(() => release.resolve())
  const configuration = await h.read('/v1/configuration')
  assert.equal(configuration.assistantContextAvailable, true)
  const before = h.store.events.cursor(), prepared = await h.prepare()
  assert.equal(h.store.events.cursor(), before); assert.equal(h.requests.length, 0)
  const receipt = await h.send(prepared)
  assert.equal(receipt.status, 'recorded'); assert.equal(h.requests.length, 0)
  const running = h.flush()
  await timeout(begun.promise)
  assert.equal(h.requests.length, 1)
  const sent = h.requests[0], selected = JSON.parse(sent.at(-2).content)
  assert.equal(sent[0].role, 'system'); assert.equal(sent.at(-2).role, 'user'); assert.equal(sent.at(-1).content, prepared.text)
  assert.equal(selected.trust, 'untrusted_data'); assert.equal(selected.protocol, 'user-selected-context/1')
  assert.ok(selected.sources.some(source => source.content.includes('SOURCE-PAYMENT')))
  assert.equal(h.messages().some(message => message.role === 'assistant'), false)
  const controller = new AbortController()
  h.cleanup(() => controller.abort())
  const response = await h.request('/v1/assistant/stream?conversationId=context-conversation', undefined, { signal: controller.signal })
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  h.cleanup(() => { void reader.cancel().catch(() => {}) })
  const first = decoder.decode((await timeout(reader.read())).value)
  assert.match(first, /assistant_update/); assert.match(first, /First part/); assert.doesNotMatch(first, /Second part/)
  release.resolve(); await running
  let streamed = first
  while (!streamed.includes('"phase":"complete"')) streamed += decoder.decode((await timeout(reader.read())).value)
  assert.match(streamed, /Second part/)
  controller.abort(); await reader.cancel().catch(() => {})
  const userId = key('message', prepared.commandId), audit = await h.read(`/v1/messages/${userId}/context`)
  assert.equal(audit.messageId, userId); assert.equal(audit.requestId, prepared.preview.requestId)
  assert.equal(audit.sources.length, prepared.preview.sources.length)
  assert.equal(h.messages().find(message => message.role === 'assistant').text, 'First part. Second part.')
  assert.deepEqual(await h.send(prepared), receipt); await h.flush(); assert.equal(h.requests.length, 1)
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('revoked decision and the final source guard refuse before provider send and keep safe notices', async t => {
  for (const change of ['revocation', 'final-guard']) await t.test(change, async t => {
    const h = await fixture(t)
    let decision
    if (change === 'revocation') {
      const preparedDecision = await h.product.operations.prepareDecision({ projectId: scope.projectId, conversationId: 'context-conversation',
        sourceMessageId: 'payment-source', content: 'DECISION-PAYMENT: preserve compatibility.', scope }, actor)
      await h.product.operations.decision({ kind: 'record_decision', commandId: 'record-payment-decision', projectId: scope.projectId,
        conversationId: 'context-conversation', token: preparedDecision.token }, actor)
      decision = preparedDecision.decision
    }
    const prepared = await h.prepare(h.input('source-change', 'Explain the current constraint.', change === 'revocation' ? ['decisions'] : ['conversation']))
    await h.send(prepared)
    if (change === 'revocation') await h.product.operations.decision({ kind: 'revoke_decision', commandId: 'revoke-payment-decision',
      projectId: scope.projectId, conversationId: 'context-conversation', decisionId: decision.id, expectedVersion: 1 }, actor)
    else h.beforeStatus(() => h.changeSource())
    await h.flush()
    assert.equal(h.requests.length, 0)
    const notice = h.messages().find(message => message.provenance === 'application_notice')
    assert.match(notice.text, /上下文/); assert.match(notice.text, /未发送给模型/)
    assert.equal(h.store.commands.get(key('assistant-request', key('message', prepared.commandId))), undefined)
    assert.equal((await h.read(`/v1/messages/${key('message', prepared.commandId)}/context`)).requestId, prepared.preview.requestId)
  })
})

test('provider failure and a post-inference reply commit failure never cause a second model request', async t => {
  for (const fault of ['unknown-result', 'reply-commit']) await t.test(fault, async t => {
    const h = await fixture(t, async () => {
      if (fault === 'unknown-result') throw new Error('fixture-secret-upstream-diagnostic')
      return { text: 'Completed generation.', model: 'mock-context' }
    })
    const prepared = await h.prepare(h.input(`failure-${fault}`)), receipt = await h.send(prepared)
    if (fault === 'reply-commit') h.store.db.exec("CREATE TRIGGER fail_context_answer BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'injected answer commit failure'); END")
    await h.flush()
    assert.equal(h.requests.length, 1)
    assert.ok(h.store.commands.get(key('assistant-request', key('message', prepared.commandId))))
    if (fault === 'reply-commit') {
      assert.equal(h.messages().some(message => message.provenance === 'application_notice'), false)
      h.store.db.exec('DROP TRIGGER fail_context_answer')
      await h.reopen(); h.requeueDue(); await h.flush()
    }
    assert.deepEqual(await h.send(prepared), receipt); await h.flush()
    assert.equal(h.requests.length, 1)
    const notice = h.messages().find(message => message.provenance === 'application_notice')
    const recovered = h.messages().find(message => message.provenance === 'reasoner_reply')
    // The real A reply-result port survives the failed reply transaction, so a requeued effect
    // appends the stable reply instead of the older unknown-result notice. Either path is valid;
    // only one model request may exist.
    assert.ok(notice || recovered)
    if (notice) assert.doesNotMatch(notice.text, /fixture-secret|injected answer/)
    if (recovered) assert.deepEqual(recovered.sourceRefs, [key('message', prepared.commandId)])
    assert.equal(h.store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100).length, 0)
  })
})

test('HTTP auth, strict bodies, readonly mode and audit identities remain enforced', async t => {
  const h = await fixture(t), prepareBody = h.input('auth-context')
  assert.equal((await fetch(`${h.url}/v1/assistant/context/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prepareBody) })).status, 401)
  assert.equal((await h.request('/v1/assistant/context/prepare', { ...prepareBody, actor })).status, 400)
  assert.equal((await h.request('/v1/assistant/context/prepare', { ...prepareBody, context: { ...prepareBody.context, grant: {} } })).status, 400)
  const prepared = await h.prepare(prepareBody)
  assert.equal((await h.request('/v1/assistant/context/send', { commandId: 'another-command', token: prepared.token })).status, 403)
  assert.equal((await h.request('/v1/assistant/context/send', { commandId: prepared.commandId, token: prepared.token, force: true })).status, 400)
  assert.equal((await h.request('/v1/messages/missing/context')).status, 404)
  const readonlyURL = await h.listen(h.makeApp({ startupMode: 'recovery_readonly' }))
  assert.equal((await h.request('/v1/assistant/context/prepare', prepareBody, { url: readonlyURL })).status, 422)
  assert.equal((await h.request('/v1/assistant/context/send', { commandId: prepared.commandId, token: prepared.token }, { url: readonlyURL })).status, 422)
  const originalAudit = h.product.read.assistantContext
  const badURL = await h.listen(h.makeApp({ read: { ...h.product.read, assistantContext: async () => ({
    ...await originalAudit(key('message', prepared.commandId)), messageId: 'different-message',
  }) } }))
  await h.send(prepared)
  assert.equal((await h.request(`/v1/messages/${key('message', prepared.commandId)}/context`, undefined, { url: badURL })).status, 503)
  assert.equal((await h.request(`/v1/messages/${key('message', prepared.commandId)}/context?force=true`)).status, 400)
  assert.equal(h.requests.length, 0)
})

test('ordinary chats retain their original history and never inherit a previous selected bundle', async t => {
  const h = await fixture(t)
  const chat = (id, text) => h.read('/v1/commands', { kind: 'chat', commandId: id, conversationId: 'context-conversation', projectId: scope.projectId, text })
  await chat('ordinary-before', 'First ordinary question.'); await h.flush()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].at(-1).content, 'First ordinary question.')
  assert.equal(h.requests[0].some(message => message.content.includes('user-selected-context/1')), false)
  const prepared = await h.prepare(h.input('context-between')); await h.send(prepared); await h.flush()
  assert.equal(h.requests.length, 2); assert.match(h.requests[1].at(-2).content, /user-selected-context/)
  await chat('ordinary-after', 'Second ordinary question.'); await h.flush()
  assert.equal(h.requests.length, 3)
  assert.equal(h.requests[2].at(-1).content, 'Second ordinary question.')
  assert.equal(h.requests[2].some(message => message.content.includes('user-selected-context/1')), false)
  assert.equal((await h.request(`/v1/messages/${key('message', 'ordinary-after')}/context`)).status, 404)
})

test('simultaneous original confirmations settle on one receipt, queue entry and provider request', async t => {
  const h = await fixture(t), prepared = await h.prepare(h.input('parallel-confirm'))
  const [first, second] = await Promise.all([h.send(prepared), h.send(prepared)])
  assert.deepEqual(first, second)
  assert.equal(h.store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100).length, 1)
  await h.flush(); assert.equal(h.requests.length, 1)
  assert.equal(h.messages().filter(message => message.id === key('message', prepared.commandId)).length, 1)
})

test('a corrupt original receipt cannot reach the provider before loading or during final reservation', async t => {
  for (const window of ['before-load', 'before-reservation']) await t.test(window, async t => {
    const h = await fixture(t), prepared = await h.prepare(h.input(`receipt-${window}`))
    await h.send(prepared)
    const corrupt = () => h.store.db.prepare('UPDATE command_receipts SET result = ? WHERE command_id = ?')
      .run(JSON.stringify({ status: 'rejected', error: { code: 'policy_unprepared', message: 'corrupt record', retry: 'none' } }), prepared.commandId)
    if (window === 'before-load') corrupt()
    else h.beforeStatus(corrupt)
    await h.flush()
    assert.equal(h.requests.length, 0)
    assert.equal(h.store.commands.get(key('assistant-request', key('message', prepared.commandId))), undefined)
    assert.match(h.messages().find(message => message.provenance === 'application_notice').text, /未发送给模型/)
  })
})

test('confirmed source changes and expiry return a settled rejected HTTP receipt replayable after reopen', async t => {
  for (const mutation of ['source', 'expiry']) await t.test(mutation, async t => {
    const h = await fixture(t), prepared = await h.prepare(h.input(`settled-${mutation}`))
    const before = { messages: h.messages().length, events: h.store.events.cursor(), artifacts: h.store.artifacts.list().artifacts.length }
    if (mutation === 'source') h.changeSource()
    else h.setTime(new Date(Date.parse(prepared.expiresAt) + 1000).toISOString())
    const body = { commandId: prepared.commandId, token: prepared.token }
    const response = await h.request('/v1/assistant/context/send', body), receipt = await response.json()
    assert.equal(response.status, 409); assert.equal(receipt.commandId, prepared.commandId); assert.equal(receipt.status, 'rejected')
    assert.equal(h.store.commands.get(prepared.commandId).status, 'rejected')
    assert.equal(h.messages().length, before.messages); assert.equal(h.store.events.cursor(), before.events + 1)
    assert.equal(h.store.artifacts.list().artifacts.length, before.artifacts)
    assert.equal(h.store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100).length, 0)
    assert.equal((await h.request(`/v1/messages/${key('message', prepared.commandId)}/context`)).status, 404)
    h.setTime(new Date(Date.parse(prepared.expiresAt) + 3600000).toISOString())
    await h.reopen()
    const replayResponse = await h.request('/v1/assistant/context/send', body)
    assert.equal(replayResponse.status, 409); assert.deepEqual(await replayResponse.json(), receipt)
    await h.flush(); assert.equal(h.requests.length, 0)
    assert.equal(h.store.events.cursor(), before.events + 1)
  })
})

test('rejected application effects roll back before one definitive rejection receipt is recorded', async t => {
  const h = await fixture(t), prepared = await h.prepare(h.input('application-business-refusal'))
  const before = { messages: h.messages().length, events: h.store.events.cursor(), artifacts: h.store.artifacts.list().artifacts.length }
  const commit = h.product.application.commitPrepared.bind(h.product.application)
  h.product.application.commitPrepared = value => ({ ...commit(value), status: 'rejected',
    error: { code: 'policy_unprepared', message: 'Controlled application refusal.', retry: 'user_action' } })
  const response = await h.request('/v1/assistant/context/send', { commandId: prepared.commandId, token: prepared.token })
  const receipt = await response.json()
  assert.equal(response.status, 422); assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'policy_unprepared')
  assert.equal(h.messages().length, before.messages); assert.equal(h.store.artifacts.list().artifacts.length, before.artifacts)
  assert.equal(h.store.events.cursor(), before.events + 1)
  assert.equal(h.store.commands.get(prepared.commandId).status, 'rejected')
  assert.equal((await h.request(`/v1/messages/${key('message', prepared.commandId)}/context`)).status, 404)
  await h.flush(); assert.equal(h.requests.length, 0)
})

test('a rejection-storage fault stays an unknown HTTP error until the original request can be settled', async t => {
  const h = await fixture(t), prepared = await h.prepare(h.input('rejection-http-storage-fault'))
  const before = h.store.events.cursor(), body = { commandId: prepared.commandId, token: prepared.token }
  h.setTime(new Date(Date.parse(prepared.expiresAt) + 1000).toISOString())
  h.store.db.exec("CREATE TRIGGER fail_rejection_http BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'injected rejection storage fault'); END")
  const failedResponse = await h.request('/v1/assistant/context/send', body), failed = await failedResponse.json()
  assert.equal(failedResponse.status, 503); assert.equal(failed.status, undefined); assert.equal(failed.error.code, 'storage_unavailable')
  assert.doesNotMatch(JSON.stringify(failed), /injected|TRIGGER/)
  assert.equal(h.store.commands.get(prepared.commandId), undefined); assert.equal(h.store.events.cursor(), before)
  h.store.db.exec('DROP TRIGGER fail_rejection_http')
  const response = await h.request('/v1/assistant/context/send', body), receipt = await response.json()
  assert.equal(response.status, 409); assert.equal(receipt.status, 'rejected')
  assert.equal(h.store.events.cursor(), before + 1)
  await h.flush(); assert.equal(h.requests.length, 0)
})
