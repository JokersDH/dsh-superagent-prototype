import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import { AssistantContextBindingSchema } from '@personal-agent/contracts'
import type { AssistantContextBindings, TrustedActor } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'consumer-user', authorityRef: 'consumer-authority' }
const actor: TrustedActor = { ...principal, source: 'local_cli' }
const projectId = 'consumer-project'
const conversationId = 'consumer-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const API = 'c'.repeat(64)

/**
 * Independent consumer of main's real assistant context-use HTTP/SSE path.
 *
 * It drives prepare/send/audit through the product entry points with a mock AssistantModelPort and
 * checks what the provider actually receives, what the durable binding keeps, and how revocation,
 * expiry, replay and cutoff behave. The bindings port fallback is explicitly an in-test composition
 * fixture (main's own product test documents the same), never evidence of A's durable table.
 */
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'pa-context-consumer-'))
  const stateRoot = join(root, 'state')
  const scratchProject = join(root, 'project')
  mkdirSync(stateRoot)
  mkdirSync(scratchProject)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })
  let now = '2026-11-12T09:00:00.000Z'
  const requests: { role: string; content: string }[][] = []
  const records = new Map<string, unknown>()
  let configured = true
  const status = () => ({
    protocol: 'assistant-provider/1' as const,
    configured,
    baseURL: 'https://fixture.invalid/v1',
    model: 'mock-context',
    models: ['mock-context'],
    state: configured ? ('configured' as const) : ('not_configured' as const),
    secureTransport: true,
  })
  const provider = {
    status,
    selectModel: () => status(),
    reply: async (messages: readonly { role: string; content: string }[]) => {
      requests.push(structuredClone([...messages]) as { role: string; content: string }[])
      return { text: 'CONSUMER-REPLY', model: 'mock-context' }
    },
  }
  const bindings = {
    forMessage(id: string) {
      for (const value of records.values()) {
        const binding = value as { messageId?: string }
        if (binding.messageId === id) return structuredClone(value)
      }
      return undefined
    },
    forCommand(id: string) {
      const value = records.get(id)
      return value === undefined ? undefined : structuredClone(value)
    },
    put(value: unknown) {
      assert.ok(store.uow.nesting > 0)
      const binding = AssistantContextBindingSchema.parse(value)
      const existing = records.get(binding.commandId)
      if (existing) {
        assert.deepEqual(existing, binding)
        return { binding: structuredClone(existing), replayed: true }
      }
      store.uow.afterCommit(() => records.set(binding.commandId, structuredClone(binding)))
      return { binding, replayed: false }
    },
  }
  const product = createProductRuntime({
    store,
    principal,
    projects: [{ id: projectId, displayName: 'Consumer project', scope }],
    stateRoot,
    scratchProject,
    actionSecret: Buffer.alloc(32, 29),
    // The runtime option is typed as the concrete private provider; this fixture only needs the
    // published AssistantModelPort surface of status/selectModel/reply.
    assistantProvider: provider as unknown as NonNullable<Parameters<typeof createProductRuntime>[0]['assistantProvider']>,
    assistantContextBindings: bindings as unknown as AssistantContextBindings,
    now: () => now,
  })
  store.product.messages.append({
    id: 'source-message',
    conversationId,
    projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'SOURCE-CONSTRAINT: preserve the existing error codes.',
    sourceRefs: [],
    createdAt: now,
  })
  const api = createLocalHttpApp({
    application: product.application,
    operations: product.operations,
    read: product.read,
    principal,
    bootstrapToken: 'd'.repeat(64),
    apiToken: API,
    allowedOrigins: ['http://127.0.0.1:4410'],
    mode: 'fixture',
  })
  const headers = { authorization: `Bearer ${API}`, 'content-type': 'application/json' }
  const request = (path: string, body?: unknown) =>
    api.request(path, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers,
    })
  const read = async (path: string, body?: unknown) => {
    const response = await request(path, body)
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  const input = (commandId: string, text: string, selections: string[] = ['conversation', 'project']) => ({
    commandId,
    text,
    context: { projectId, conversationId, selections, budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } },
  })
  const prepare = (value: unknown) => read('/v1/assistant/context/prepare', value)
  const send = (prepared: { commandId: string; token: string }) =>
    request('/v1/assistant/context/send', { commandId: prepared.commandId, token: prepared.token })
  const flush = async () => {
    product.execution.effects.start()
    product.execution.effects.kick()
    await product.execution.effects.idle('application.assistant.reply')
  }
  const messages = () => store.product.messages.page(conversationId).messages
  t.after(async () => {
    await product.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    store,
    product,
    requests,
    prepare,
    send,
    request,
    read,
    input,
    flush,
    messages,
    setTime: (value: string) => {
      now = value
    },
    setConfigured: (value: boolean) => {
      configured = value
    },
    bindings,
  }
}

const contextLayer = (messages: readonly { role: string; content: string }[]) =>
  messages.find((message) => message.content.includes('user-selected-context/1'))

test('the mock provider receives the frozen selected context as untrusted data and the audit keeps its identity', async (t) => {
  const h = fixture(t)
  const prepared = await h.prepare(h.input('consumer-1', 'Explain the current constraint.'))
  assert.equal(prepared.protocol, 'assistant-context-prepared/1')
  assert.ok(prepared.preview.sources.some((source: { content: string }) => source.content.includes('SOURCE-CONSTRAINT')))
  for (const source of prepared.preview.sources) {
    assert.equal(source.sourceDigest.length, 64)
    assert.equal(source.previewDigest.length, 64)
  }
  const receipt = await (await h.send(prepared)).json()
  assert.equal(receipt.status, 'recorded')
  await h.flush()

  assert.equal(h.requests.length, 1)
  const [sent] = h.requests
  assert.equal(sent![0]!.role, 'system')
  const last = sent![sent!.length - 1]!
  assert.equal(last.role, 'user')
  assert.equal(last.content, 'Explain the current constraint.')
  const layer = contextLayer(sent!)
  assert.ok(layer, 'selected context must be sent as a separate untrusted user layer')
  const selected = JSON.parse(layer!.content)
  assert.equal(selected.protocol, 'user-selected-context/1')
  assert.equal(selected.trust, 'untrusted_data')
  assert.ok(selected.sources.some((source: { content: string }) => source.content.includes('SOURCE-CONSTRAINT')))

  const messageId = key('message', prepared.commandId)
  const audit = await h.read(`/v1/messages/${messageId}/context`)
  assert.equal(audit.messageId, messageId)
  assert.equal(audit.requestId, prepared.preview.requestId)
  assert.equal(audit.bundleDigest.length, 64)
  assert.equal(audit.sources.length, prepared.preview.sources.length)
  assert.deepEqual(
    audit.sources.map((source: { sourceId: string }) => source.sourceId),
    prepared.preview.sources.map((source: { sourceId: string }) => source.sourceId),
  )
  assert.equal(h.messages().find((message) => message.provenance === 'reasoner_reply')?.text, 'CONSUMER-REPLY')

  // Replaying the original token returns the same receipt and never calls the provider again.
  const replay = await (await h.send(prepared)).json()
  assert.deepEqual(replay, receipt)
  await h.flush()
  assert.equal(h.requests.length, 1)
  assert.equal(h.messages().filter((message) => message.id === messageId).length, 1)
})

test('a message appended after preparation stays out of the frozen bundle while a new prepare sees it', async (t) => {
  const h = fixture(t)
  const prepared = await h.prepare(h.input('cutoff-1', 'Review the frozen selection.'))
  h.store.product.messages.append({
    id: 'late-message',
    conversationId,
    projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'LATE-MESSAGE: appended after preparation.',
    sourceRefs: [],
    createdAt: '2026-11-12T09:00:01.000Z',
  })
  const receipt = await (await h.send(prepared)).json()
  assert.equal(receipt.status, 'recorded')
  await h.flush()
  assert.equal(h.requests.length, 1)
  const layer = contextLayer(h.requests[0]!)
  assert.ok(layer)
  assert.equal(layer!.content.includes('LATE-MESSAGE'), false)

  const fresh = await h.prepare(h.input('cutoff-2', 'Review again.'))
  assert.ok(fresh.preview.sources.some((source: { content: string }) => source.content.includes('LATE-MESSAGE')))
})

test('revocation after a completed send keeps the original receipt/audit while a new prepare excludes the decision', async (t) => {
  const h = fixture(t)
  const decision = await h.product.operations.prepareDecision({
    projectId,
    conversationId,
    sourceMessageId: 'source-message',
    content: 'DECISION-CONSUMER: keep compatibility.',
    scope,
  }, actor)
  await h.product.operations.decision({
    kind: 'record_decision',
    commandId: 'consumer-decision',
    projectId,
    conversationId,
    token: decision.token,
  }, actor)

  const prepared = await h.prepare(h.input('revoke-1', 'Use the recorded decision.', ['decisions', 'conversation']))
  assert.ok(prepared.preview.sources.some((source: { kind: string }) => source.kind === 'decision'))
  const receipt = await (await h.send(prepared)).json()
  await h.flush()
  assert.equal(h.requests.length, 1)
  assert.match(contextLayer(h.requests[0]!)!.content, /DECISION-CONSUMER/)

  await h.product.operations.decision({
    kind: 'revoke_decision',
    commandId: 'consumer-revoke',
    projectId,
    conversationId,
    decisionId: decision.decision.id,
    expectedVersion: 1,
  }, actor)

  // The already-recorded request replays its original receipt; it is not re-sent to the model.
  const replay = await (await h.send(prepared)).json()
  assert.deepEqual(replay, receipt)
  await h.flush()
  assert.equal(h.requests.length, 1)
  const audit = await h.read(`/v1/messages/${key('message', prepared.commandId)}/context`)
  assert.equal(audit.requestId, prepared.preview.requestId)

  const afterRevocation = await h.prepare(h.input('revoke-2', 'Use the recorded decision.', ['decisions', 'conversation']))
  assert.equal(afterRevocation.preview.sources.some((source: { kind: string }) => source.kind === 'decision'), false)
  assert.ok(afterRevocation.preview.sources.some((source: { kind: string }) => source.kind === 'conversation_message'))
})

test('natural expiry and an offline provider settle a rejection before any model request', async (t) => {
  const expired = fixture(t)
  const prepared = await expired.prepare(expired.input('expired-1', 'Explain.'))
  expired.setTime(new Date(Date.parse(prepared.expiresAt) + 1000).toISOString())
  const response = await expired.send(prepared)
  const receipt = await response.json()
  assert.equal(response.status, 409)
  assert.equal(receipt.status, 'rejected')
  await expired.flush()
  assert.equal(expired.requests.length, 0)
  assert.equal((await expired.request(`/v1/messages/${key('message', prepared.commandId)}/context`)).status, 404)

  const offline = fixture(t)
  const pending = await offline.prepare(offline.input('offline-1', 'Explain.'))
  offline.setConfigured(false)
  const refused = await offline.send(pending)
  const rejection = await refused.json()
  assert.equal(refused.status, 422)
  assert.equal(rejection.status, 'rejected')
  assert.equal(rejection.error.code, 'unsupported_capability')
  const replay = await (await offline.send(pending)).json()
  assert.deepEqual(replay, rejection)
  await offline.flush()
  assert.equal(offline.requests.length, 0)
  assert.equal(offline.messages().some((message) => message.id === key('message', pending.commandId)), false)
})
