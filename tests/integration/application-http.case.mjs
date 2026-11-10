import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'
import { fixture, actor, createCommand, scope } from '../../packages/application/test/helpers.ts'
import { Effects } from '../../packages/effects/dist/index.js'
import { handleQuestionAnswers } from '../../apps/coordinator/http/question-effects.ts'
import { ApplicationConversations } from '../../packages/application/dist/index.js'

const BASE = 'http://127.0.0.1:4318',
  API = 'a'.repeat(64),
  BOOT = 'b'.repeat(64)
function setup(t, extra = {}) {
  const h = fixture(t)
  const server = createLocalHttpApp({
    application: h.app,
    principal: actor,
    bootstrapToken: BOOT,
    apiToken: API,
    allowedOrigins: [BASE],
    mode: 'fixture',
    read: { deliveries: async (id) => h.app.questions.currentDeliveries(id) },
    ...extra,
  })
  const request = (path, init = {}) => server.request(`${BASE}${path}`, init)
  const command = (body, headers = { authorization: `Bearer ${API}` }) =>
    request('/v1/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  return { ...h, server, request, command }
}
test('health is public but data and commands require local credentials', async (t) => {
  const h = setup(t)
  assert.equal((await h.request('/v1/health')).status, 200)
  assert.equal((await h.request('/v1/snapshot')).status, 401)
  const denied = await h.command(createCommand(), {})
  assert.equal(denied.status, 401)
  assert.equal((await denied.json()).error.code, 'auth_required')
})
test('recovery read-only blocks business writes and removes action grants while preserving authenticated reads', async t => {
  const h = fixture(t)
  await h.app.dispatch(createCommand('restore-existing-work'), actor)
  const server = createLocalHttpApp({ application: h.app, principal: actor, bootstrapToken: BOOT, apiToken: API,
    allowedOrigins: [BASE], mode: 'fixture', startupMode: 'recovery_readonly' })
  const headers = { authorization: `Bearer ${API}`, 'content-type': 'application/json' }
  assert.equal((await (await server.request(`${BASE}/v1/health`)).json()).startupMode, 'recovery_readonly')
  const snapshot = await (await server.request(`${BASE}/v1/snapshot`, { headers })).json()
  assert.equal(snapshot.works.length, 1)
  assert.deepEqual(snapshot.works[0].actions.available, [])
  const work = await (await server.request(`${BASE}/v1/works/${snapshot.works[0].work.id}`, { headers })).json()
  assert.deepEqual(work.actions.available, [])
  for (const route of ['/v1/commands', '/v1/projects', '/v1/projects/project-one/settings', '/v1/conversations/commands', '/v1/assistant/model', '/v1/works/work-one/verification/retry', '/v1/works/work-one/review-activity']) {
    const response = await server.request(`${BASE}${route}`, { method: 'POST', headers, body: '{}' })
    assert.equal(response.status, 422)
    assert.equal((await response.json()).error.retry, 'none')
  }
  assert.equal(h.store.commands.get('restore-existing-work')?.status, 'recorded')
  assert.equal(h.store.domain.tickets.list().length, 1)
})
test('conversation catalog is authenticated, scoped and uses immutable command receipts', async t => {
  const h = fixture(t), catalog = new ApplicationConversations(h.store, actor, () => ['project-atlas'], Buffer.alloc(32, 1))
  const server = createLocalHttpApp({ application: h.app, principal: actor, bootstrapToken: BOOT, apiToken: API,
    allowedOrigins: [BASE], mode: 'fixture', read: { conversations: async query => catalog.list(query), conversation: async id => catalog.get(id) },
    operations: { retryVerification: h.app.retryVerification.bind(h.app), conversation: async (command, trusted) => catalog.dispatch(command, trusted) } })
  const headers = { authorization: `Bearer ${API}`, 'content-type': 'application/json' }
  const request = (path, init = {}) => server.request(`${BASE}${path}`, init)
  const command = { kind: 'create_conversation', commandId: 'http-catalog', conversationId: 'http-conversation', projectId: 'project-atlas', title: '持久对话' }
  const post = value => request('/v1/conversations/commands', { method: 'POST', headers, body: JSON.stringify(value) })
  assert.equal((await request('/v1/conversations')).status, 401)
  assert.equal((await request('/v1/conversations/http-conversation')).status, 401)
  assert.equal((await request('/v1/conversations/commands', { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await post({ ...command, actor })).status, 400)
  const receipt = await (await post(command)).json()
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(await (await post(command)).json(), receipt)
  assert.equal((await post({ ...command, title: 'Changed payload' })).status, 409)
  const page = await (await request('/v1/conversations?limit=1&includeArchived=false', { headers })).json()
  assert.equal(page.protocol, 'conversation-catalog/1')
  assert.equal(page.conversations[0].title, '持久对话')
  assert.equal((await request('/v1/conversations?projectId=project-other', { headers })).status, 403)
  for (const query of ['includeArchived=1', 'limit=51', 'actor=forged'])
    assert.equal((await request(`/v1/conversations?${query}`, { headers })).status, 400)
  assert.equal((await request('/v1/conversations/http-conversation?unexpected=1', { headers })).status, 400)
  assert.equal((await request('/v1/conversations/unknown-conversation', { headers })).status, 403)
})
test('local development access opens directly without a token, cookie or browser storage', async (t) => {
  const h = setup(t, { localDevelopmentAccess: true })
  assert.equal((await h.request('/v1/session')).status, 200)
  assert.equal((await h.request('/v1/snapshot')).status, 200)
  const response = await h.command(createCommand(), { origin: BASE })
  assert.equal((await response.json()).status, 'recorded')
  assert.equal(h.store.domain.tickets.list()[0].mandate.actor.source, 'local_ui')
  assert.equal((await h.request('/v1/session')).headers.get('set-cookie'), null)
})
test('local development access keeps Origin, Host and actor checks and is fixture-only', async (t) => {
  const h = setup(t, { localDevelopmentAccess: true })
  assert.equal((await h.command(createCommand(), {})).status, 403)
  assert.equal((await h.command(createCommand(), { origin: 'http://evil.invalid' })).status, 403)
  assert.equal((await h.request('/v1/snapshot', { headers: { host: 'evil.invalid' } })).status, 403)
  assert.equal((await h.request('/v1/session', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await h.command({ ...createCommand(), actor: { userId: 'forged' } }, { origin: BASE })).status, 400)
  assert.equal((await h.command(createCommand(), { authorization: 'Bearer runner-secret', origin: BASE })).status, 401)
  assert.throws(() => setup(t, { mode: 'product', localDevelopmentAccess: true }), /fixture/)
})
test('model settings expose a safe status and accept only a model selection command', async (t) => {
  const status = {
    protocol: 'assistant-provider/1',
    configured: true,
    baseURL: 'http://127.0.0.1/v1',
    model: 'model-1',
    models: ['model-1'],
    state: 'configured',
    secureTransport: false,
  }
  let selected
  const h = setup(t, {
    read: {
      assistant: async () => status,
      selectModel: async (model) => {
        selected = model
        return status
      },
    },
  })
  assert.equal((await h.request('/v1/assistant')).status, 401)
  assert.deepEqual(
    await (await h.request('/v1/assistant', { headers: { authorization: `Bearer ${API}` } })).json(),
    status,
  )
  const response = await h.request('/v1/assistant/model', {
    method: 'POST',
    headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'model-1' }),
  })
  assert.equal(response.status, 200)
  assert.equal(selected, 'model-1')
  assert.equal(
    (
      await h.request('/v1/assistant/model', {
        method: 'POST',
        headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'model-1', apiKey: 'forged' }),
      })
    ).status,
    400,
  )
})
test('a model status containing credentials is rejected without disclosing them', async (t) => {
  const h = setup(t, { read: { assistant: async () => ({ apiKey: 'private-provider-key' }) } })
  const response = await h.request('/v1/assistant', { headers: { authorization: `Bearer ${API}` } })
  assert.equal(response.status, 400)
  assert.doesNotMatch(await response.text(), /private-provider-key/)
})
test('assistant SSE is authenticated and forwards text before the producer finishes', async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  t.after(() => release())
  const update = {
    protocol: 'assistant-stream/1',
    messageId: 'message-1',
    conversationId: 'conversation-1',
    projectId: 'project-1',
    replyId: 'reply-1',
    model: 'model-1',
    revision: 1,
    phase: 'streaming',
    text: '第一段',
  }
  const h = setup(t, {
    read: {
      assistantStream: async function* (conversationId) {
        assert.equal(conversationId, update.conversationId)
        yield update
        await gate
        yield { ...update, revision: 2, phase: 'complete', text: '第一段第二段' }
      },
    },
  })
  assert.equal((await h.request('/v1/assistant/stream?conversationId=conversation-1')).status, 401)
  const headers = { authorization: `Bearer ${API}` }
  assert.equal(
    (await h.request('/v1/assistant/stream?conversationId=conversation-1&apiKey=forged', { headers })).status,
    400,
  )
  const response = await h.request('/v1/assistant/stream?conversationId=conversation-1', { headers })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const reader = response.body.getReader(),
    decoder = new TextDecoder()
  const first = decoder.decode((await reader.read()).value)
  assert.match(first, /第一段/)
  assert.doesNotMatch(first, /第二段/)
  release()
  let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    rest += decoder.decode(value)
  }
  assert.match(rest, /第一段第二段/)
})
test('a bearer command uses a server-generated actor and returns the original durable receipt on replay', async (t) => {
  const h = setup(t),
    command = createCommand(),
    first = await h.command(command),
    receipt = await first.json()
  assert.equal(first.status, 200)
  assert.equal(receipt.status, 'recorded')
  assert.deepEqual(await (await h.command(command)).json(), receipt)
  const snapshot = await (
    await h.request('/v1/snapshot?conversationId=conversation-main', { headers: { authorization: `Bearer ${API}` } })
  ).json()
  assert.equal(snapshot.works.length, 1)
  const detail = await (
    await h.request(`/v1/works/${receipt.workId}`, { headers: { authorization: `Bearer ${API}` } })
  ).json()
  assert.equal(detail.work.id, receipt.workId)
  assert.equal(snapshot.conversation.messages.length, 1)
  assert.equal(h.store.domain.tickets.list()[0].mandate.actor.source, 'local_cli')
})
test('cookie sessions are HttpOnly/SameSite and Origin-protected JSON writes do not accept actor spoofing', async (t) => {
  const h = setup(t),
    bootstrap = await h.request('/v1/session', {
      method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/json' },
      body: JSON.stringify({ bootstrapToken: BOOT }),
    })
  assert.equal(bootstrap.status, 200)
  const set = bootstrap.headers.get('set-cookie')
  assert.match(set, /HttpOnly/i)
  assert.match(set, /SameSite=Strict/i)
  const cookie = set.split(';')[0]
  assert.equal((await h.command(createCommand(), { cookie })).status, 403)
  assert.equal((await h.command(createCommand(), { cookie, origin: 'http://evil.invalid' })).status, 403)
  assert.equal(
    (await h.command({ ...createCommand(), actor: { source: 'local_ui', userId: 'forged' } }, { cookie, origin: BASE }))
      .status,
    400,
  )
  assert.equal((await h.command(createCommand(), { cookie, origin: BASE })).status, 200)
  assert.equal(h.store.domain.tickets.list()[0].mandate.actor.source, 'local_ui')
})
test('a forged Origin/Host, expired session, malformed query and oversized body fail with bounded stable errors', async (t) => {
  let now = 0
  const h = setup(t, { now: () => now, sessionTtlMs: 1000 })
  assert.equal((await h.request('/v1/health', { headers: { host: 'evil.invalid' } })).status, 403)
  assert.equal(
    (await h.request('/v1/snapshot', { headers: { authorization: `Bearer ${API}`, origin: 'null' } })).status,
    403,
  )
  assert.equal((await h.request('/v1/snapshot?limit=NaN', { headers: { authorization: `Bearer ${API}` } })).status, 400)
  const session = await h.request('/v1/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bootstrapToken: BOOT }),
  })
  const cookie = session.headers.get('set-cookie').split(';')[0]
  now = 1001
  assert.equal((await h.request('/v1/snapshot', { headers: { cookie } })).status, 401)
  assert.equal((await h.command({ ...createCommand(), goal: 'x'.repeat(100000) })).status, 413)
})
test('schema-valid rejected commands are normal receipts, while native credentials cannot act as a human', async (t) => {
  const h = setup(t),
    response = await h.command({ ...createCommand(), profileId: 'missing-profile' })
  assert.equal(response.status, 200)
  const receipt = await response.json()
  assert.equal(receipt.status, 'rejected')
  assert.equal(receipt.error.code, 'unsupported_capability')
  assert.equal((await h.command(createCommand(), { authorization: 'Bearer runner-secret' })).status, 401)
})
test('message paging is typed/exclusive and event streaming exposes only schema-valid public changes', async (t) => {
  const h = setup(t)
  await h.command(createCommand())
  const headers = { authorization: `Bearer ${API}` }
  const page = await (await h.request('/v1/conversations/conversation-main/messages?limit=1', { headers })).json()
  assert.equal(page.messages.length, 1)
  const old = await (
    await h.request(`/v1/conversations/conversation-main/messages?before=${page.beforeCursor}&limit=1`, { headers })
  ).json()
  assert.equal(old.messages.length, 0)
  const stream = await h.request('/v1/events?after=0', { headers }),
    reader = stream.body.getReader(),
    first = await reader.read()
  const text = new TextDecoder().decode(first.value)
  assert.match(text, /application.work.changed/)
  assert.doesNotMatch(text, /"actor"|private.secret|bootstrapToken/)
  await reader.cancel()
  assert.equal((await h.request('/v1/events?after=999999', { headers })).status, 409)
  const expired = await h.request('/v1/events?after=999999', { headers: { ...headers, accept: 'text/event-stream' } })
  assert.equal(expired.status, 200)
  assert.match(await expired.text(), /event: cursor_expired/)
})
test('HTTP answers use the Broker and add display history without an extra generic core Input', async (t) => {
  const h = setup(t),
    created = await (await h.command(createCommand())).json(),
    active = await h.start(created.workId)
  const target = {
    ...active.ref,
    attemptId: active.binding.attemptId,
    fenceEpoch: 1,
    id: 'native-binding',
    connectionEpoch: 1,
    nativeRequestId: { kind: 'integer', decimal: '9223372036854775807' },
    nativeMethod: 'tool/input',
    provenanceRef: 'provenance-1',
  }
  const q = {
    id: 'question-http',
    version: 1,
    kind: 'clarification',
    contract: active.ref.contract,
    scope,
    prompt: 'Which option?',
    nativePayloadRef: 'raw-1',
    targets: [target],
    presentation: { kind: 'free_text' },
    validity: 'open',
    openedAt: '2026-11-08T09:00:00.000Z',
  }
  h.app.questions.open(q)
  const before = h.store.domain.tickets.get(active.ref.ticketId).inputs.length
  const response = await h.command({
    kind: 'answer_question',
    commandId: 'answer-http',
    conversationId: 'conversation-main',
    questionId: q.id,
    expectedVersion: 1,
    answer: { kind: 'free_text', text: 'Use the first option' },
  })
  assert.equal((await response.json()).status, 'recorded')
  assert.equal(h.store.domain.tickets.get(active.ref.ticketId).inputs.length, before)
  const deliveries = await (
    await h.request(`/v1/questions/${q.id}/deliveries`, { headers: { authorization: `Bearer ${API}` } })
  ).json()
  assert.equal(deliveries[0].status, 'local_recorded')
  const effects = new Effects(h.store.queue)
  handleQuestionAnswers(effects, h.app.questions, {
    send: async (id, _payload, before) => {
      before()
      throw new Error('lost native ACK')
    },
  })
  effects.start()
  try {
    await effects.idle()
  } finally {
    await effects.drain()
  }
  assert.equal(h.store.queue.parked('question.answer').length, 1)
  assert.equal(h.app.questions.currentDeliveries(q.id)[0].status, 'indeterminate')
})
test('unexpected backend failures are redacted and unconnected detail ports never fake data', async (t) => {
  const h = setup(t)
  const detail = await h.request('/v1/verifications/unknown', { headers: { authorization: `Bearer ${API}` } })
  assert.equal(detail.status, 422)
  const failing = setup(t, {
    application: {
      dispatch: async () => {
        throw new Error('secret-token-do-not-show')
      },
      inspect: async () => {
        throw new Error('private/path')
      },
      changes: () => {
        throw new Error('private/path')
      },
    },
  })
  const response = await failing.command(createCommand())
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes('secret-token'), false)
})
test('the Node adapter serves actual loopback HTTP requests and shuts down without orphaned streams', async (t) => {
  const h = setup(t)
  const node = listenLocalHttp(h.server, 0)
  await new Promise((resolve) => node.once('listening', resolve))
  t.after(() => new Promise((resolve, reject) => node.close((error) => (error ? reject(error) : resolve()))))
  const response = await fetch(`http://127.0.0.1:${node.address().port}/v1/health`, {
    signal: AbortSignal.timeout(3000),
  })
  assert.deepEqual(await response.json(), { status: 'ok', mode: 'fixture' })
})
