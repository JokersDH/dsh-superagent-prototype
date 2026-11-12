import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { ProductContextRecords } from '../../apps/coordinator/product/context-records.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const principal = { userId: 'records-user', authorityRef: 'records-authority' }, actor = { ...principal, source: 'local_cli' }
const scope = { projectId: 'records-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const token = 'a'.repeat(64), at = '2026-11-12T00:00:00.000Z'
async function fixture(t) {
  const root = mkdtempSync('/tmp/pa-context-records-'), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(project, 'src'), { recursive: true })
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), runtime, now = at, calls = 0
  let projects = [{ id: scope.projectId, scope }, { id: 'other-project', scope: { ...scope, projectId: 'other-project' } }]
  const status = () => ({ protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
    model: 'fixture', models: ['fixture'], state: 'configured', secureTransport: true })
  const provider = { status, selectModel: status, reply: async () => { calls++; throw new Error('Read-only tests must not start the provider') } }
  const setup = () => { runtime = createProductRuntime({ store, stateRoot, scratchProject: project, principal, projects,
    actionSecret: Buffer.alloc(32, 37), assistantProvider: provider, now: () => now }) }
  setup()
  store.product.messages.append({ id: 'records-source', conversationId: 'records-conversation', projectId: scope.projectId,
    role: 'user', provenance: 'trusted_user', text: 'SOURCE: Preserve the existing error codes.', sourceRefs: [], createdAt: at })
  const servers = []
  const app = override => createLocalHttpApp({ application: runtime.application, principal, apiToken: token,
    bootstrapToken: 'b'.repeat(64), allowedOrigins: ['http://127.0.0.1:4406'], mode: 'fixture',
    read: runtime.read, operations: runtime.operations, ...override })
  const listen = async value => { const server = listenLocalHttp(value, 0); servers.push(server); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}` }
  let url = await listen(app())
  const request = (path, body, options = {}) => fetch(`${options.url ?? url}${path}`, { ...options,
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers } })
  const json = async (path, body, options) => { const response = await request(path, body, options), value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value }
  const historyPath = query => `/v1/context/history?${new URLSearchParams(query)}`
  const history = query => json(historyPath({ projectId: scope.projectId, conversationId: 'records-conversation', ...query }))
  const send = async (commandId, extra = {}) => {
    const context = { projectId: scope.projectId, conversationId: 'records-conversation', selections: ['project', 'conversation'],
      budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 }, ...extra }
    const prepared = await json('/v1/assistant/context/prepare', { commandId, text: `Read original ${commandId}.`, context })
    await json('/v1/assistant/context/send', { commandId, token: prepared.token })
    return { prepared, messageId: key('message', commandId) }
  }
  const closeServers = async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
  t.after(async () => { await closeServers(); await runtime.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, send, history, historyPath, request, json, app, listen,
    get calls() { return calls }, get store() { return store }, get runtime() { return runtime },
    time: value => { now = value },
    service: (override = {}) => new ProductContextRecords({ store, principal, bindings: store.workflows.assistant.contextBindings,
      history: store.workflows.assistant.contextHistory, projects: () => projects, secret: Buffer.alloc(32, 37), now: () => now, ...override }),
    narrowScope: () => { projects = [{ id: scope.projectId, scope: { ...scope, allowedPaths: ['docs/'] } }] },
    reopen: async () => { await closeServers(); await runtime.close(); store.close(); store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }); setup(); url = await listen(app()) },
  }
}
test('actual SQLite context history pages with signed original scope, no writes and no provider sends', async t => {
  const h = await fixture(t), ids = []
  for (const id of ['one', 'two', 'three']) ids.push((await h.send(id)).messageId)
  const event = h.store.events.cursor(), first = await h.history({ limit: 2 })
  assert.equal(first.entries.length, 2); assert.equal(first.hasMore, true); assert.ok(first.nextCursor.includes('.'))
  const second = await h.history({ limit: 2, cursor: first.nextCursor })
  assert.equal(second.entries.length, 1); assert.equal(second.hasMore, false)
  assert.deepEqual([...first.entries, ...second.entries].map(entry => entry.messageId).sort(), ids.sort())
  assert.ok(first.entries.every(entry => entry.message.text.startsWith('Read original')))
  assert.equal(h.store.events.cursor(), event); assert.equal(h.calls, 0)
})
test('historical source content survives expiry and SQLite reopen without requesting fresh sources', async t => {
  const h = await fixture(t), { messageId, prepared } = await h.send('historical')
  h.time('2026-11-12T00:06:00.000Z'); await h.reopen()
  const before = h.store.events.cursor(), view = await h.json(`/v1/messages/${messageId}/context/sources`)
  assert.equal(view.state, 'verified'); assert.equal(view.binding.requestId, prepared.preview.requestId)
  assert.deepEqual(view.sources, prepared.preview.sources)
  assert.equal((await h.history()).entries[0].messageId, messageId)
  assert.equal(h.store.events.cursor(), before); assert.equal(h.calls, 0)
})
test('signed history cursors bind filters, principal, limits, configured scope and expiry', async t => {
  const h = await fixture(t)
  await h.send('cursor-one'); await h.send('cursor-two')
  const first = await h.history({ limit: 1 }), cursor = first.nextCursor
  for (const change of [{ conversationId: 'other-conversation' }, { projectId: 'other-project' }, { limit: 2 }, { cursor: `${cursor.slice(0, -3)}abc` }]) {
    const response = await h.request(h.historyPath({ projectId: scope.projectId, conversationId: 'records-conversation', limit: 1, cursor, ...change }))
    assert.equal(response.status, 409)
  }
  assert.throws(() => h.service({ principal: { ...principal, userId: 'other-user' } }).history({ projectId: scope.projectId,
    conversationId: 'records-conversation', limit: 1, cursor }), error => error.error?.code === 'conflict')
  h.time('2026-11-12T00:06:00.000Z')
  assert.equal((await h.request(h.historyPath({ projectId: scope.projectId, conversationId: 'records-conversation', limit: 1, cursor }))).status, 409)
  h.time(at); h.narrowScope()
  assert.throws(() => h.service().history({ projectId: scope.projectId, conversationId: 'records-conversation', limit: 1, cursor }), error => error.error?.code === 'conflict')
  assert.equal(h.calls, 0)
})
test('history and sources authenticate callers, reject strict/duplicate bodies, and remain readable in readonly mode', async t => {
  const h = await fixture(t), { messageId } = await h.send('auth')
  assert.equal((await fetch(`${(await h.listen(h.app()))}/v1/context/history?projectId=${scope.projectId}`)).status, 401)
  for (const suffix of ['&projectIds=foreign', '&limit=51', '&limit=2.1', '&projectId=other-project', '&actor=foreign'])
    assert.equal((await h.request(`/v1/context/history?projectId=${scope.projectId}${suffix}`)).status, 400)
  assert.equal((await h.request(`/v1/messages/${messageId}/context/sources?force=true`)).status, 400)
  assert.equal((await h.request('/v1/messages/no-record/context/sources')).status, 404)
  assert.equal((await h.request('/v1/context/history?projectId=unconfigured')).status, 403)
  const readonly = await h.listen(h.app({ startupMode: 'recovery_readonly' }))
  assert.equal((await h.json(`/v1/messages/${messageId}/context/sources`, undefined, { url: readonly })).state, 'verified')
  assert.equal((await h.json(`/v1/context/history?projectId=${scope.projectId}`, undefined, { url: readonly })).entries.length, 1)
  const config = await h.json('/v1/configuration', undefined, { url: readonly })
  assert.equal(config.assistantContextAvailable, false); assert.equal(config.contextSourcesAvailable, true)
  assert.equal(h.calls, 0)
})
test('missing, corrupt, oversized and symlink bundle files never expose unverified content', async t => {
  for (const fault of ['missing', 'corrupt', 'oversized', 'symlink']) await t.test(fault, async t => {
    const h = await fixture(t), { messageId } = await h.send(`body-${fault}`)
    const binding = h.store.workflows.assistant.contextBindings.forMessage(messageId), file = h.store.artifacts.filePath(binding.bundleRef)
    if (fault === 'missing') unlinkSync(file)
    if (fault === 'corrupt') writeFileSync(file, 'private-unverified-fixture')
    if (fault === 'oversized') writeFileSync(file, Buffer.alloc(1048577, 97))
    if (fault === 'symlink') { unlinkSync(file); const privateFile = join(h.root, 'private.txt'); writeFileSync(privateFile, 'private-unverified-fixture'); symlinkSync(privateFile, file) }
    const view = await h.json(`/v1/messages/${messageId}/context/sources`)
    assert.equal(view.state, fault === 'missing' ? 'missing' : 'unverified')
    assert.deepEqual(view.sources, []); assert.deepEqual(view.omitted, []); assert.doesNotMatch(JSON.stringify(view), /private-unverified-fixture/)
    assert.equal(h.calls, 0)
  })
})
test('scope narrowing withholds the frozen body and a different principal cannot read its binding', async t => {
  const h = await fixture(t), { messageId } = await h.send('narrow')
  let artifactReads = 0
  const original = h.store.artifacts.get.bind(h.store.artifacts)
  h.store.artifacts.get = (...args) => { artifactReads++; return original(...args) }
  h.narrowScope()
  const view = h.service().sources(messageId)
  assert.equal(view.state, 'scope_changed'); assert.deepEqual(view.sources, []); assert.equal(artifactReads, 0)
  assert.throws(() => h.service({ principal: { ...principal, authorityRef: 'other-authority' } }).sources(messageId), error => error.error?.code === 'forbidden')
  assert.equal(artifactReads, 0); assert.equal(h.calls, 0)
})
test('main rechecks raw history work scope before it can reach a public page', async t => {
  const h = await fixture(t), config = await h.runtime.read.configuration(), project = config.projects[0]
  const create = id => h.runtime.application.dispatch({ kind: 'create_work', commandId: id, conversationId: 'records-conversation',
    projectId: scope.projectId, goal: id, profileId: project.defaultProfileId, scope, criteria: project.defaultCriteria }, actor)
  const first = await create('first-work'), second = await create('second-work')
  assert.equal(first.status, 'recorded'); assert.equal(second.status, 'recorded')
  const { messageId } = await h.send('work-context', { workId: first.workId, selections: ['work'] })
  assert.equal((await h.history({ workId: first.workId })).entries[0].messageId, messageId)
  h.store.db.prepare('UPDATE assistant_context_bindings SET work_id = ? WHERE message_id = ?').run(second.workId, messageId)
  assert.equal((await h.request(h.historyPath({ projectId: scope.projectId, conversationId: 'records-conversation', workId: second.workId }))).status, 503)
})
test('missing original messages stay explicit in history and cannot disclose a frozen source body', async t => {
  const h = await fixture(t), { messageId } = await h.send('missing-original')
  h.store.db.prepare('DELETE FROM conversation_messages WHERE id = ?').run(messageId)
  assert.deepEqual((await h.history()).entries[0].message, { state: 'missing', truncated: false })
  const view = await h.json(`/v1/messages/${messageId}/context/sources`)
  assert.equal(view.state, 'unverified'); assert.deepEqual(view.sources, [])
})
test('HTTP refuses mismatched history or source read-port projections', async t => {
  const h = await fixture(t), { messageId } = await h.send('bad-port')
  const wrong = await h.listen(h.app({ read: { ...h.runtime.read,
    contextHistory: async () => ({ protocol: 'context-history/1', projectId: 'other-project', observedAt: at, entries: [], hasMore: false }),
    contextSources: async () => { const value = await h.runtime.read.contextSources(messageId); return { ...value, binding: { ...value.binding, messageId: 'foreign-message' } } },
  } }))
  assert.equal((await h.request(`/v1/context/history?projectId=${scope.projectId}`, undefined, { url: wrong })).status, 503)
  assert.equal((await h.request(`/v1/messages/${messageId}/context/sources`, undefined, { url: wrong })).status, 503)
})
