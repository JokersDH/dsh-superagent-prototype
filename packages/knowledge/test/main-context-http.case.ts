import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { actor, fixture, scope } from '../../application/test/helpers.ts'
import { createWorkflowPorts } from '@personal-agent/workflows'
import { AssistantDecisionStore, DecisionTransactionService } from '../src/index.ts'

const NOW = '2026-11-11T00:00:00.000Z'

/**
 * Independent consumer of main's real context-preview HTTP. C owns no HTTP; this asserts the preview
 * the product actually serves keeps the source/scope/budget semantics C's library defines.
 */
function setup(t: { after(fn: () => void): void }) {
  const h = fixture(t)
  const fixtureScope = { ...scope, excludedPaths: [] }
  const conversationId = 'context-conversation'
  type Provenance = 'trusted_user' | 'reasoner_reply' | 'question_answer_display' | 'application_notice'
  const append = (id: string, projectId: string | undefined, provenance: Provenance, text: string) =>
    h.store.product.messages.append({
      id,
      conversationId,
      ...(projectId === undefined ? {} : { projectId }),
      role: 'user',
      provenance,
      text,
      sourceRefs: [],
      createdAt: NOW,
    })
  append('selected-message', scope.projectId, 'trusted_user', 'SELECTED_PROJECT_DISCUSSION')
  append('foreign-message', 'project-other', 'trusted_user', 'FOREIGN_PROJECT_DISCUSSION')
  append('permission-message', scope.projectId, 'question_answer_display', 'PERMISSION_ANSWER_DISPLAY')
  const ports = createWorkflowPorts(h.store)
  const sources = {
    getMessage(id: string) {
      const value = ports.index.sourceMessage(id, [scope.projectId])
      return value && {
        messageId: value.id, conversationId: value.conversationId, projectId: value.projectId ?? scope.projectId,
        role: value.role, provenance: value.provenance as 'trusted_user', createdAt: value.createdAt, textDigest: value.textDigest,
      }
    },
  }
  const transaction = new DecisionTransactionService(new AssistantDecisionStore(h.store.workflows.assistant), sources, {
    now: () => new Date(NOW),
  })
  const actorValue = { actorRef: actor.authorityRef, projectId: scope.projectId, grantScope: fixtureScope }
  h.store.uow.atomic(() =>
    transaction.commit(
      transaction.prepare(
        { decisionId: 'context-http-decision', content: 'Keep validation before acceptance', scope: fixtureScope, sourceMessageId: 'selected-message' },
        actorValue,
      ),
      actorValue,
    ),
  )
  const runtime = createProductRuntime({
    store: h.store,
    principal: actor,
    projects: [{ id: scope.projectId, scope: fixtureScope }],
    stateRoot: h.directory,
    scratchProject: h.directory,
    actionSecret: Buffer.alloc(32, 13),
  })
  t.after(async () => {
    await runtime.close()
  })
  const apiToken = 'b'.repeat(64)
  const options = {
    application: runtime.application,
    operations: runtime.operations,
    principal: actor,
    bootstrapToken: 'a'.repeat(64),
    apiToken,
    allowedOrigins: ['http://127.0.0.1:4400'],
    mode: 'fixture' as const,
  }
  const api = createLocalHttpApp(options)
  const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
  const preview = async (body: Record<string, unknown>, apiOverride = api) =>
    apiOverride.request('/v1/context/preview', { method: 'POST', headers, body: JSON.stringify(body) })
  return {
    h,
    api,
    options,
    headers,
    preview,
    conversationId,
    transaction,
    actorValue,
    request: {
      projectId: scope.projectId,
      conversationId,
      selections: ['project', 'conversation', 'decisions'],
      budget: { maxFiles: 13, maxBytes: 65536, maxTokens: 8192 },
    },
  }
}

test('main context preview serves scoped sources with dual digests and no foreign material', async (t) => {
  const s = setup(t)
  const unauthorised = await s.api.request('/v1/context/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(s.request),
  })
  assert.equal(unauthorised.status, 401)

  const response = await s.preview(s.request)
  assert.equal(response.status, 200)
  const preview = await response.json()
  assert.equal(preview.protocol, 'context-preview/1')
  assert.equal(preview.trust, 'untrusted_data')
  assert.ok(preview.totals.files <= preview.budget.maxFiles)
  assert.ok(preview.totals.bytes <= preview.budget.maxBytes)
  assert.ok(preview.totals.tokens <= preview.budget.maxTokens)
  const text = preview.sources.map((source: { content: string }) => source.content).join('\n')
  assert.ok(text.includes('SELECTED_PROJECT_DISCUSSION'))
  assert.equal(text.includes('FOREIGN_PROJECT_DISCUSSION'), false)
  assert.equal(text.includes('PERMISSION_ANSWER_DISPLAY'), false)
  assert.ok(preview.sources.some((source: { kind: string }) => source.kind === 'decision'))
  for (const source of preview.sources) {
    assert.equal(source.sourceDigest.length, 64)
    assert.equal(source.previewDigest.length, 64)
    assert.equal(Object.hasOwn(source, 'actor'), false)
    assert.equal(source.path.startsWith('/'), false)
  }
  assert.equal(Object.hasOwn(preview, 'actorRef'), false)
})

test('a revoked decision disappears on the next preview, and a decision source change forces a re-preview', async (t) => {
  const s = setup(t)
  const first = await (await s.preview(s.request)).json()
  assert.ok(first.sources.some((source: { kind: string }) => source.kind === 'decision'))

  // Revoking the decision must remove it from the following preview, not serve stale knowledge.
  s.h.store.uow.atomic(() => s.transaction.revoke('context-http-decision', 1, s.actorValue))
  const second = await (await s.preview(s.request)).json()
  assert.equal(second.sources.some((source: { kind: string }) => source.kind === 'decision'), false)
  assert.ok(second.sources.some((source: { kind: string }) => source.kind === 'conversation_message'))

  // A new message changes the conversation sources the next preview reports.
  s.h.store.product.messages.append({
    id: 'new-message',
    conversationId: s.conversationId,
    projectId: scope.projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'A newly appended discussion line',
    sourceRefs: [],
    createdAt: NOW,
  })
  const third = await (await s.preview(s.request)).json()
  const thirdText = third.sources.map((source: { content: string }) => source.content).join('\n')
  assert.ok(thirdText.includes('A newly appended discussion line'))
})

test('the preview clamps an oversized caller budget and reports it', async (t) => {
  const s = setup(t)
  const response = await s.preview({
    ...s.request,
    budget: { maxFiles: 40, maxBytes: 200000, maxTokens: 100000 },
  })
  assert.equal(response.status, 200)
  const preview = await response.json()
  assert.ok(preview.budget.maxBytes <= 131072)
  assert.ok(preview.totals.bytes <= preview.budget.maxBytes)
  assert.ok(Array.isArray(preview.budgetClamped))
  assert.ok(preview.budgetClamped.includes('maxBytes') || preview.totals.bytes <= 131072)
})

test('invalid selections, missing work for artifacts and recovery read-only are refused', async (t) => {
  const s = setup(t)
  const artifactsWithoutWork = await s.preview({ ...s.request, selections: ['artifacts'] })
  assert.equal(artifactsWithoutWork.status, 400)

  const emptySelections = await s.preview({ ...s.request, selections: [] })
  assert.equal(emptySelections.status, 400)

  const restored = createLocalHttpApp({ ...s.options, startupMode: 'recovery_readonly' })
  const response = await restored.request('/v1/context/preview', {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify(s.request),
  })
  assert.equal(response.status, 422)
})

test('the default scoped factory reports its 600-message scan boundary as partial with an issue', async (t) => {
  const s = setup(t)
  const longConversation = 'long-context-conversation'
  // Older excluded displays force the factory to keep scanning until its 600-message boundary.
  for (let index = 0; index < 610; index += 1) {
    s.h.store.product.messages.append({
      id: `long-display-${String(index).padStart(4, '0')}`,
      conversationId: longConversation,
      projectId: scope.projectId,
      role: 'user',
      provenance: 'question_answer_display',
      text: `display answer ${index}`,
      sourceRefs: [],
      createdAt: NOW,
    })
  }
  for (let index = 0; index < 5; index += 1) {
    s.h.store.product.messages.append({
      id: `long-visible-${index}`,
      conversationId: longConversation,
      projectId: scope.projectId,
      role: 'user',
      provenance: 'trusted_user',
      text: `visible discussion ${index}`,
      sourceRefs: [],
      createdAt: NOW,
    })
  }

  const response = await s.preview({ ...s.request, conversationId: longConversation, selections: ['conversation'] })
  assert.equal(response.status, 200)
  const preview = await response.json()
  assert.equal(preview.conversationId, longConversation)
  assert.equal(preview.status, 'partial')
  assert.ok(preview.issues.includes('conversation_scan_incomplete'), JSON.stringify(preview.issues))
  // The same bounded scan is also explained in the public omission list, never silently sufficient.
  assert.ok((preview.omitted as { reason: string }[]).some((entry) => entry.reason === 'source_unavailable'), JSON.stringify(preview.omitted))
  const text = preview.sources.map((source: { content: string }) => source.content).join('\n')
  assert.ok(text.includes('visible discussion'))
  assert.equal(text.includes('display answer'), false)
  for (const source of preview.sources) {
    assert.equal(source.path.startsWith('/'), false)
    assert.equal(source.kind, 'conversation_message')
  }
})
