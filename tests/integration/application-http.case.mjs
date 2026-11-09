import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'
import { fixture, actor, createCommand, scope } from '../../packages/application/test/helpers.ts'
import { Effects } from '../../packages/effects/dist/index.js'
import { handleQuestionAnswers } from '../../apps/coordinator/http/question-effects.ts'

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
