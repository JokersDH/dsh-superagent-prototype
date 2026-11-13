import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { key } from '../../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../apps/coordinator/http/server.ts'

const API_TOKEN = 'c'.repeat(64)
const BOOTSTRAP_TOKEN = 'd'.repeat(64)
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/**
 * Independent current-main selected-context fixture: real ProductStore/migrations, real HTTP app,
 * real application/effects and a loopback-only mock provider. No vendor call and no fixture port
 * substitutes for the A contextBindings table; only replyResults stays an explicit in-process map.
 */
export async function startContextProduct({ stateRoot, projectPath, principal, projects, now }) {
  const owner = principal ?? { userId: 'wave11-context-user', authorityRef: 'wave11-context-authority' }
  const configured = projects ?? []
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  let product, server, port
  let clock = now ?? new Date().toISOString()
  const requests = []
  const replies = []
  const completed = new Map()
  const provider = {
    status: () => ({ protocol: 'assistant-provider/1', configured: provider.configured !== false,
      baseURL: 'https://mock.invalid/v1', model: 'mock-context', models: ['mock-context'],
      state: provider.configured === false ? 'not_configured' : 'configured', secureTransport: true,
      suggestionsEnabled: provider.suggestionsEnabled === true }),
    selectModel: () => provider.status(),
    async reply(messages, onDelta) {
      requests.push({ at: new Date().toISOString(), messages: structuredClone(messages), clock })
      const reply = replies.shift()
      if (reply?.failure) throw reply.failure
      const text = reply?.text ?? '默认上下文回复。'
      if (onDelta) for (const part of text.match(/[^。！？]{1,20}[。！？]?/g) ?? [text]) onDelta(part)
      return { text, model: 'mock-context', ...(provider.suggestions?.length ? { suggestions: structuredClone(provider.suggestions) } : {}) }
    },
  }
  const setup = async () => {
    product = createProductRuntime({
      store, principal: owner, stateRoot, scratchProject: projectPath,
      projects: configured.map(item => ({ id: item.id, displayName: item.displayName ?? item.id, scope: item.scope })),
      actionSecret: Buffer.alloc(32, 2), assistantProvider: provider,
      now: () => clock,
    })
    port = await freePort()
    server = listenLocalHttp(createLocalHttpApp({
      application: product.application, principal: owner, apiToken: API_TOKEN, bootstrapToken: BOOTSTRAP_TOKEN,
      allowedOrigins: [`http://127.0.0.1:${port}`], mode: 'fixture', read: product.read, operations: product.operations,
    }), port)
    await once(server, 'listening')
    product.start()
  }
  await setup()
  const baseURL = () => `http://127.0.0.1:${port}`
  const request = async (path, { method = 'GET', body, signal, origin } = {}) => {
    const response = await fetch(`${baseURL()}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
      headers: { authorization: `Bearer ${API_TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(origin ? { origin } : {}) },
    })
    let value
    try { value = await response.json() } catch { value = undefined }
    return { status: response.status, body: value }
  }
  const flush = async () => {
    product.execution.effects.kick()
    await product.execution.effects.idle('application.assistant.reply', 20_000)
  }
  const close = async () => {
    try { await product.close() } finally {}
    if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)) }
    store.close()
  }
  return {
    get store() { return store }, get product() { return product }, get port() { return port },
    get requests() { return requests }, get replies() { return replies }, get replyResults() { return replyResults },
    apiToken: API_TOKEN,
    baseURL, request, flush, close,
    seed: input => store.product.messages.append(input),
    prepare: body => request('/v1/assistant/context/prepare', { method: 'POST', body }),
    send: body => request('/v1/assistant/context/send', { method: 'POST', body }),
    audit: id => request(`/v1/messages/${id}/context`),
    history: query => request(`/v1/context/history?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
    sources: id => request(`/v1/messages/${id}/context/sources`),
    setNow: value => { clock = value },
    now: () => clock,
    bindings: () => store.workflows.assistant.contextBindings,
    completed: () => completed,
    async closeProductOnly() {
      await product.close()
      server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve))
      server = undefined
    },
    async reopen() {
      await this.closeProductOnly()
      store.close()
      store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
      await setup()
    },
    async cleanup() { try { await close() } catch {} rmSync(stateRoot, { recursive: true, force: true }) },
    provider,
    owner,
    messageId: commandId => key('message', commandId),
  }
}

export function contextProjectRoot() {
  const root = mkdtempSync(join(tmpdir(), 'pa-w11-ctx-'))
  const state = join(root, 'state'), project = join(root, 'project')
  mkdirSync(state, { recursive: true, mode: 0o700 }); mkdirSync(project, { recursive: true })
  mkdirSync(join(project, 'src'), { recursive: true })
  return { root, state, project }
}

async function freePort() {
  const { createServer } = await import('node:net')
  const server = createServer()
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  await new Promise(resolve => server.close(resolve))
  return port
}
