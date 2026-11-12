import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import type { TrustedActor } from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import { collectContextHistory } from '../../context/src/index.ts'
import { AssistantProposalService, planProposalCommand, proposalDigest, reviewVerifiedReplyCandidates } from '../../proposals/src/index.ts'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { CompletedAssistantReplies } from '../../../apps/coordinator/product/assistant-reply-results.ts'

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
 * checks what the provider actually receives, what the durable A binding keeps, and how revocation,
 * expiry, replay and cutoff behave. Bindings and completed replies are the real A18 store ports:
 * there is no in-test Map fallback here.
 */
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'pa-context-consumer-'))
  const stateRoot = join(root, 'state')
  const scratchProject = join(root, 'project')
  mkdirSync(stateRoot)
  mkdirSync(scratchProject)
  const storePath = join(stateRoot, 'state.sqlite')
  const artifactsRoot = join(stateRoot, 'artifacts')
  let store = new ProductStore({ path: storePath, artifactsRoot })
  const stores = [store]
  let productClosed = false
  let now = '2026-11-12T09:00:00.000Z'
  const requests: { role: string; content: string }[][] = []
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
  const closeProduct = async () => {
    if (productClosed) return
    productClosed = true
    await product.close()
  }
  const reopenStore = async () => {
    await closeProduct()
    store.close()
    store = new ProductStore({ path: storePath, artifactsRoot })
    stores.push(store)
    return store
  }
  t.after(async () => {
    await closeProduct()
    for (const open of stores) {
      try {
        open.close()
      } catch {
        // Already closed by reopenStore/after; a second close is not evidence.
      }
    }
    rmSync(root, { recursive: true, force: true })
  })
  return {
    get store() {
      return store
    },
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
    reopenStore,
    historyInput: (workId?: string) => ({
      projectIds: [projectId],
      conversationId,
      ...(workId === undefined ? {} : { workId }),
    }),
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

test('the real A18 history and completed reply are consumed through the durable store ports', async (t) => {
  const h = fixture(t)
  const prepared = await h.prepare(h.input('history-1', 'Explain and answer from the selection.'))
  await (await h.send(prepared)).json()
  await h.flush()
  const messageId = key('message', prepared.commandId)
  const requestId = key('assistant-request', messageId)

  // Real A ports: the binding and the completed result live in SQLite, not an in-test Map.
  const binding = h.store.workflows.assistant.contextBindings.forMessage(messageId)
  assert.ok(binding)
  assert.equal(binding.requestId, prepared.preview.requestId)
  const result = h.store.workflows.assistant.replyResults.forRequest(requestId)
  assert.ok(result)
  assert.equal(result.replyMessageId, key('assistant-reply', messageId))
  assert.equal(result.sourceMessageId, messageId)
  assert.equal(result.projectId, projectId)
  assert.equal(result.conversationId, conversationId)
  assert.equal(result.principal.userId, principal.userId)
  assert.equal(result.principal.authorityRef, principal.authorityRef)
  assert.equal(result.model, 'mock-context')
  assert.equal(result.artifactRef, result.artifactDigest)
  assert.equal(h.store.workflows.assistant.replyResults.forReply(result.replyMessageId)?.requestDigest, result.requestDigest)

  const now = () => new Date('2026-11-12T09:03:00.000Z')
  const readerFor = (target: typeof h.store) => {
    // Main verification: original receipt + artifact bytes + reply body identity.
    const completed = new CompletedAssistantReplies(
      target,
      target.workflows.assistant.replyResults,
      principal,
      () => [projectId],
    )
    return (id: string) => {
      try {
        const requestId = key('assistant-request', id)
        if (completed.read(requestId) === undefined) return undefined
        const stored = target.workflows.assistant.replyResults.forRequest(requestId)
        return stored === undefined ? undefined : { result: stored, verifiedBy: 'main-completed-reply' as const }
      } catch {
        return undefined
      }
    }
  }
  const view = collectContextHistory(h.store.workflows.assistant.contextHistory, h.historyInput(), {
    now,
    replyReader: readerFor(h.store),
  })
  assert.equal(view.entries.length, 1)
  const entry = view.entries[0]!
  assert.equal(entry.messageId, messageId)
  assert.equal(entry.projectId, projectId)
  assert.equal(entry.conversationId, conversationId)
  assert.equal(entry.state, 'current_window')
  assert.equal(entry.replyUnknown, false)
  assert.equal(entry.completedReply?.replyMessageId, key('assistant-reply', messageId))
  assert.equal(entry.completedReply?.requestDigest, result.requestDigest)
  assert.equal(entry.completedReply?.artifactDigest, result.artifactDigest)
  assert.equal(entry.requiresExplicitReauthorization, true)
  assert.equal(Object.hasOwn(entry.completedReply ?? {}, 'text'), false)
  assert.equal(view.totals.completedReplies, 1)
  assert.equal(view.totals.mismatchedReplies, 0)

  // A work filter the binding does not carry is not this work's history.
  const workView = collectContextHistory(h.store.workflows.assistant.contextHistory, h.historyInput('other-work'), {
    now,
    replyReader: readerFor(h.store),
  })
  assert.equal(workView.entries.length, 0)

  // The rows survive a real SQLite reopen; durability is A's data property, not a new grant.
  const reopened = await h.reopenStore()
  const durable = collectContextHistory(reopened.workflows.assistant.contextHistory, h.historyInput(), {
    now: () => new Date('2026-11-12T09:03:00.000Z'),
    replyReader: readerFor(reopened),
  })
  assert.equal(durable.entries.length, 1)
  assert.equal(durable.entries[0]!.completedReply?.artifactDigest, result.artifactDigest)
})

test('the verified completed reply feeds the candidate reviewer without minting a new authority', async (t) => {
  const h = fixture(t)
  const prepared = await h.prepare(h.input('candidate-1', 'Answer and suggest.'))
  await (await h.send(prepared)).json()
  await h.flush()
  const messageId = key('message', prepared.commandId)
  const requestId = key('assistant-request', messageId)
  const completed = new CompletedAssistantReplies(
    h.store,
    h.store.workflows.assistant.replyResults,
    principal,
    () => [projectId],
  )
  const body = completed.read(requestId)
  assert.ok(body)
  const result = h.store.workflows.assistant.replyResults.forRequest(requestId)
  assert.ok(result)
  const bindings = {
    projectId,
    conversationId,
    sourceMessageId: messageId,
    grantId: 'candidate-grant',
    grantScope: scope,
    principal,
  }

  const verified = reviewVerifiedReplyCandidates(
    {
      verifiedBy: 'main-completed-reply',
      body,
      identity: {
        requestId,
        replyMessageId: result.replyMessageId,
        sourceMessageId: result.sourceMessageId,
        projectId: result.projectId,
        conversationId: result.conversationId,
        model: result.model,
        principal: result.principal,
      },
    },
    bindings,
  )
  // main currently persists suggestions=[]; the reviewer must say so instead of inventing candidates.
  assert.equal(verified.status, 'no_candidates')
  assert.equal(verified.verifiedBy, 'main-completed-reply')
  assert.equal(verified.reply, 'CONSUMER-REPLY')
  assert.equal(verified.hasExecutableCandidates, false)
  assert.equal(verified.modelCallPerformed, false)
  assert.equal(verified.candidates.length, 0)

  // A raw body is not accepted as a completed reply: no marker, no candidates.
  const raw = reviewVerifiedReplyCandidates(body, bindings)
  assert.equal(raw.status, 'invalid_body')
  assert.deepEqual(raw.rejected.map((entry) => entry.reason), ['unverified_reply'])
})

test('history keeps the frozen body after the live source text changes', async (t) => {
  const h = fixture(t)
  const prepared = await h.prepare(h.input('frozen-1', 'Explain the frozen selection.'))
  await (await h.send(prepared)).json()
  await h.flush()
  const messageId = key('message', prepared.commandId)
  const before = await h.read(`/v1/messages/${messageId}/context`)
  const frozenDigest = before.bundleDigest
  assert.equal(frozenDigest.length, 64)

  // Mutate the live message row: the audit must still return the originally frozen bundle.
  const source = h.store.product.messages.getById('source-message')!
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?')
    .run(JSON.stringify({ ...source, text: 'CHANGED-SOURCE: this text no longer matches the frozen bundle.' }), source.id)
  const after = await h.read(`/v1/messages/${messageId}/context`)
  assert.equal(after.bundleDigest, frozenDigest)
  assert.deepEqual(after.sources, before.sources)

  // A fresh preparation reads the live text, proving history was not re-implemented as a read of now.
  const fresh = await h.prepare(h.input('frozen-2', 'Explain the new selection.'))
  assert.ok(fresh.preview.sources.some((source: { content: string }) => source.content.includes('CHANGED-SOURCE')))
})

test('a non-empty verified candidate joins the original proposal service over real A state', async (t) => {
  const h = fixture(t)
  const suggestion = {
    kind: 'propose_work',
    goal: 'Add retry budget checks',
    projectId,
    sourceMessageId: 'source-message',
  }
  const replyBody = {
    protocol: 'assistant-reply-body/1',
    projectId,
    conversationId,
    sourceMessageId: 'source-message',
    replyMessageId: 'reply-candidate-1',
    model: 'mock-context',
    text: 'Here is a plan.',
    suggestions: [suggestion],
  }
  const artifactDigest = 'e'.repeat(64)
  const review = reviewVerifiedReplyCandidates(
    {
      verifiedBy: 'main-completed-reply',
      body: replyBody,
      identity: {
        requestId: 'assistant-request:source-message',
        replyMessageId: 'reply-candidate-1',
        sourceMessageId: 'source-message',
        projectId,
        conversationId,
        model: 'mock-context',
        principal,
        requestDigest: 'f'.repeat(64),
        artifactRef: artifactDigest,
        artifactDigest,
      },
    },
    {
      projectId,
      conversationId,
      sourceMessageId: 'source-message',
      grantId: 'candidate-grant',
      grantScope: scope,
      principal,
    },
  )
  assert.equal(review.status, 'candidates')
  const candidate = review.candidates[0]!
  assert.equal(candidate.index, 0)
  assert.equal(candidate.payloadDigest, proposalDigest(suggestion as never))
  assert.equal(candidate.plan.kind, 'needs_user_input')

  const service = new AssistantProposalService(h.store.workflows.assistant, {
    now: () => new Date('2026-11-12T09:03:00.000Z'),
  })
  const trusted = { actorRef: principal.userId, projectId, grant: { grantId: 'candidate-grant', scope }, sourceMessageId: 'source-message' }
  const prepared = await service.prepare({
    proposalId: 'proposal-1',
    payload: suggestion,
    trusted,
    conversationId,
    sourceTextDigest: 'a'.repeat(64),
  })
  // The persisted proposal digest is the original suggestion digest, not a summary-derived one.
  assert.equal(prepared.payloadDigest, candidate.payloadDigest)
  service.persistPending(prepared)
  assert.equal(h.store.workflows.assistant.proposals.get('proposal-1')?.state, 'pending')
  assert.equal(h.store.workflows.assistant.proposals.get('proposal-1')?.effectCommandId, undefined)

  const commitInput = {
    expectedVersion: 1,
    expectedDigest: prepared.payloadDigest,
    actorRef: principal.userId,
    effectCommandId: 'candidate-command-1',
    revalidate: () => ({ ok: true }),
    barrier: () => ({ ok: true }),
  }
  const confirmed = service.commit(prepared, commitInput)
  assert.equal(confirmed.record.state, 'confirmed')
  assert.equal(confirmed.record.effectCommandId, 'candidate-command-1')
  const replay = service.commit(prepared, commitInput)
  assert.equal(replay.replayed, true)
  assert.equal(h.store.workflows.assistant.proposals.history('proposal-1').length, 2)

  // Missing user inputs stay a plan; the command body is derived from the original payload + inputs.
  const missing = planProposalCommand(confirmed.intent, { commandId: 'candidate-command-1', conversationId })
  assert.equal(missing.kind, 'needs_user_input')
  const planned = planProposalCommand(confirmed.intent, {
    commandId: 'candidate-command-1',
    conversationId,
    work: {
      scope,
      criteria: [{ id: 'criterion-1', description: 'checks pass', kind: 'machine', required: true, checkDefinitionRef: 'check-1' }],
      profileId: 'codex-native',
    },
  })
  assert.equal(planned.kind, 'command')
  if (planned.kind !== 'command') throw new Error('unreachable')
  assert.equal('goal' in planned.command && planned.command.goal, 'Add retry budget checks')

  // Rejection is a separate terminal state in the same A proposal state; no command id appears.
  const rejected = await service.prepare({
    proposalId: 'proposal-2',
    payload: suggestion,
    trusted,
    conversationId,
    sourceTextDigest: 'a'.repeat(64),
  })
  service.persistPending(rejected)
  const rejectedRecord = service.reject(rejected, { actorRef: principal.userId, reason: 'user declined' })
  assert.equal(rejectedRecord.state, 'rejected')
  assert.equal(rejectedRecord.effectCommandId, undefined)
  assert.equal(h.store.workflows.assistant.proposals.history('proposal-2').length, 2)
})

test('a verified decision candidate flows through main ProductProposals confirm/reject data', async (t) => {
  const h = fixture(t)
  const suggestion = { kind: 'propose_decision', content: 'CANDIDATE-DECISION: keep retries bounded.', scope, sourceMessageId: 'source-message' }
  const replyBody = {
    protocol: 'assistant-reply-body/1',
    projectId,
    conversationId,
    sourceMessageId: 'source-message',
    replyMessageId: 'reply-candidate-2',
    model: 'mock-context',
    text: 'Answer with a decision candidate.',
    suggestions: [suggestion],
  }
  const artifactDigest = '1'.repeat(64)
  const review = reviewVerifiedReplyCandidates(
    {
      verifiedBy: 'main-completed-reply',
      body: replyBody,
      identity: {
        requestId: 'assistant-request:source-message',
        replyMessageId: 'reply-candidate-2',
        sourceMessageId: 'source-message',
        projectId,
        conversationId,
        model: 'mock-context',
        principal,
        requestDigest: '2'.repeat(64),
        artifactRef: artifactDigest,
        artifactDigest,
      },
    },
    { projectId, conversationId, sourceMessageId: 'source-message', grantId: 'candidate-grant-2', grantScope: scope, principal },
  )
  const candidate = review.candidates[0]!
  assert.equal(candidate.plan.kind, 'requires_explicit_confirmation')
  assert.equal(candidate.payloadDigest, proposalDigest(suggestion as never))

  // Main's own preview signs the original payload digest; C only supplied the data.
  const prepareBody = { projectId, conversationId, sourceMessageId: 'source-message', payload: suggestion }
  const preview = await h.read('/v1/proposals/prepare', prepareBody)
  assert.equal(preview.protocol, 'proposal-preview/1')
  assert.equal(preview.record.payloadDigest, candidate.payloadDigest)
  assert.deepEqual(preview.requiredInputs, [])

  // Confirmation is the user's explicit command: the original payload becomes one decision command.
  const confirm = await h.read('/v1/proposals/commands', {
    kind: 'confirm_proposal',
    commandId: 'proposal-command-1',
    projectId,
    conversationId,
    token: preview.token,
  })
  assert.equal(confirm.status, 'recorded')
  assert.equal(confirm.commandId, 'proposal-command-1')
  const stored = h.store.workflows.assistant.proposals.get(preview.record.proposalId)
  assert.equal(stored?.state, 'confirmed')
  // Main derives its own deterministic effect command id; the client command id is the receipt id.
  assert.equal(typeof stored?.effectCommandId, 'string')
  assert.ok((stored?.effectCommandId ?? '').length > 0)
  const decisions = h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records
  assert.ok(decisions.some((entry) => entry.decision.content.includes('CANDIDATE-DECISION')))

  // Lost-response replay returns the same receipt and adds no second decision.
  const replay = await h.read('/v1/proposals/commands', {
    kind: 'confirm_proposal',
    commandId: 'proposal-command-1',
    projectId,
    conversationId,
    token: preview.token,
  })
  assert.deepEqual(replay, confirm)
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, decisions.length)

  // Rejection is a separate terminal state with its own receipt and no effect command.
  const rejectedPreview = await h.read('/v1/proposals/prepare', prepareBody)
  const rejectReceipt = await h.read('/v1/proposals/commands', {
    kind: 'reject_proposal',
    commandId: 'proposal-command-2',
    projectId,
    conversationId,
    token: rejectedPreview.token,
  })
  // Rejection is a successful command that records the rejected proposal state.
  assert.equal(rejectReceipt.status, 'recorded')
  const rejectedRecord = h.store.workflows.assistant.proposals.get(rejectedPreview.record.proposalId)
  assert.equal(rejectedRecord?.state, 'rejected')
  assert.equal(rejectedRecord?.effectCommandId, undefined)
})
