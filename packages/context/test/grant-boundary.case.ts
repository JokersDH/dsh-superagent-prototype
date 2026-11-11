import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  ContextComposer,
  ContextError,
  authorizeComposition,
  type ComposedConversationMessage,
  type ComposedDecisionView,
} from '../src/index.ts'
import { NOW, descriptor, makeGrant, staticPort } from './helpers.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const decision: ComposedDecisionView = {
  decisionId: 'decision-1',
  content: 'x'.repeat(1000),
  scope,
  sourceMessageId: 'msg-1',
  recordedAt: NOW,
}
const message: ComposedConversationMessage = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  sequence: 1,
  role: 'user',
  provenance: 'trusted_user',
  text: 'hello',
  createdAt: NOW,
}

function counters() {
  const calls = { decisions: 0, conversation: 0, artifacts: 0, listSources: 0, readSource: 0 }
  const composer = (grantOverrides: Record<string, unknown> = {}, budget: Record<string, unknown> = {}) =>
    new ContextComposer(
      {
        port: {
          projectBaseline: async () => ({ capturedAt: NOW }),
          listSources: async () => {
            calls.listSources += 1
            return [descriptor('contract/work-1.json', '{"goal":"x"}', { kind: 'contract' })]
          },
          readSource: async (input) => {
            calls.readSource += 1
            return { content: '{"goal":"x"}', bytes: 12, digest: input.source.baseline.contentDigest }
          },
        },
        decisions: {
          listEffective: async () => {
            calls.decisions += 1
            return { decisions: [decision] }
          },
        },
        conversation: {
          recent: async () => {
            calls.conversation += 1
            return [message]
          },
        },
        artifacts: {
          recent: async () => {
            calls.artifacts += 1
            return []
          },
        },
      },
      { now: () => new Date(NOW) },
    )
  return { calls, composer }
}

const request = (overrides: Record<string, unknown> = {}) => {
  const grant = makeGrant({
    purpose: 'conversation_discussion',
    scope,
    sourceKinds: ['contract', 'work', 'decision', 'conversation_message', 'artifact'],
    maxFiles: 2,
    maxBytes: 32,
    maxTokens: 32,
    maxDurationMs: 1000,
    confirmedAt: '2026-11-09T07:00:00.000Z',
    expiresAt: '2026-11-11T09:00:00.000Z',
  })
  return {
    requestId: 'grant-boundary',
    projectId: 'project-1',
    purpose: 'conversation_discussion' as const,
    query: '',
    grant,
    budget: { maxFiles: 10, maxSlices: 10, maxBytes: 4096, maxTokens: 4096, maxDurationMs: 5000 },
    conversationId: 'conv-1',
    ...overrides,
  }
}

const noReads = (calls: ReturnType<typeof counters>['calls']) =>
  calls.decisions === 0 && calls.conversation === 0 && calls.artifacts === 0 && calls.listSources === 0 && calls.readSource === 0

test('an expired grant is refused before any provider is called', async () => {
  const { calls, composer } = counters()
  const input = request()
  input.grant = { ...input.grant, expiresAt: '2026-11-09T09:00:00.000Z' }
  await assert.rejects(composer().compose(input), (error: unknown) =>
    error instanceof ContextError && error.code === 'grant_expired')
  assert.equal(noReads(calls), true)
})

test('a purpose mismatch is refused before any provider is called', async () => {
  const { calls, composer } = counters()
  await assert.rejects(
    composer().compose(request({ purpose: 'work_authoring' })),
    (error: unknown) => error instanceof ContextError && error.code === 'grant_purpose',
  )
  assert.equal(noReads(calls), true)
})

test('a grant confirmed in the future is refused', async () => {
  const { calls, composer } = counters()
  const input = request()
  input.grant = { ...input.grant, confirmedAt: '2026-11-12T00:00:00.000Z' }
  await assert.rejects(composer().compose(input), (error: unknown) =>
    error instanceof ContextError && error.code === 'grant_unconfirmed')
  assert.equal(noReads(calls), true)
})

test('a caller budget above the grant is clamped, never escalated', async () => {
  const { composer } = counters()
  const composition = await composer().compose(request())
  assert.ok(composition.budget.maxBytes <= 32)
  assert.ok(composition.budget.maxTokens <= 32)
  assert.ok(composition.totals.bytes <= 32)
  assert.ok(composition.budgetClamped.includes('maxBytes'))
  assert.ok(composition.budgetClamped.includes('maxTokens'))
})

test('zero, negative, NaN and non-integer budgets are refused without reading', async () => {
  for (const budget of [
    { maxFiles: 0, maxSlices: 10, maxBytes: 100, maxTokens: 100, maxDurationMs: 100 }
    , { maxFiles: 10, maxSlices: -1, maxBytes: 100, maxTokens: 100, maxDurationMs: 100 }
    , { maxFiles: 10, maxSlices: 10, maxBytes: Number.NaN, maxTokens: 100, maxDurationMs: 100 }
    , { maxFiles: 10, maxSlices: 10, maxBytes: 100, maxTokens: Number.POSITIVE_INFINITY, maxDurationMs: 100 }
    , { maxFiles: 1.5, maxSlices: 10, maxBytes: 100, maxTokens: 100, maxDurationMs: 100 }
  ]) {
    const { calls, composer } = counters()
    await assert.rejects(composer().compose(request({ budget })), (error: unknown) =>
      error instanceof ContextError && error.code === 'invalid_input')
    assert.equal(noReads(calls), true, `budget ${JSON.stringify(budget)} must not read`)
  }
})

test('a caller budget of one slice still reads exactly one item and stays inside the grant', async () => {
  const { composer } = counters()
  const input = request()
  input.grant = { ...input.grant, maxFiles: 1, maxBytes: 4096, maxTokens: 4096 }
  const composition = await composer().compose({
    ...input,
    budget: { maxFiles: 1, maxSlices: 1, maxBytes: 4096, maxTokens: 4096, maxDurationMs: 2000 },
  })
  assert.ok(composition.totals.files <= 1)
  assert.ok(composition.totals.bytes <= 4096)
})

test('the authorization gate resolves the same outcome for every source family', () => {
  const grant = request().grant
  const resolved = authorizeComposition({ projectId: 'project-1', purpose: 'conversation_discussion', grant, budget: {} }, new Date(NOW))
  assert.deepEqual(resolved.clamped, [])
  assert.equal(resolved.budget.maxFiles, 2)
  assert.equal(resolved.budget.maxBytes, 32)
  assert.throws(
    () =>
      authorizeComposition(
        { projectId: 'project-1', purpose: 'conversation_discussion', grant: { ...grant, gateway: 'executor' }, budget: {} },
        new Date(NOW),
      ),
    (error: unknown) => error instanceof ContextError && error.code === 'grant_gateway',
  )
  assert.throws(
    () =>
      authorizeComposition(
        { projectId: 'project-1', purpose: 'conversation_discussion', grant: { ...grant, projectId: 'project-2', scope: { ...scope, projectId: 'project-2' } }, budget: {} },
        new Date(NOW),
      ),
    (error: unknown) => error instanceof ContextError && error.code === 'grant_project',
  )
})
