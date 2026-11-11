import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import { ContextComposer, ContextError, type ComposedDecisionView } from '../src/index.ts'
import { NOW, descriptor, makeGrant, staticPort } from './helpers.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const decision = (id: string): ComposedDecisionView => ({
  decisionId: id,
  content: JSON.stringify({ id, note: 'x'.repeat(200) }),
  scope,
  sourceMessageId: 'msg-1',
  recordedAt: NOW,
})

const grant = () =>
  makeGrant({
    purpose: 'conversation_discussion',
    scope,
    sourceKinds: ['contract', 'work', 'decision', 'conversation_message', 'artifact', 'document'],
    maxFiles: 8,
    maxBytes: 64 * 1024,
    maxTokens: 8000,
    maxDurationMs: 5000,
    confirmedAt: '2026-11-09T00:00:00.000Z',
    expiresAt: '2026-11-10T00:30:00.000Z',
  })

const portSources = () => [
  { descriptor: descriptor('contract/work-1.json', '{"goal":"x"}', { kind: 'contract' }), content: '{"goal":"x"}' },
]

/**
 * A clock that advances one hour per call after the first, so the grant expires between groups.
 */
function advancingClock() {
  let calls = 0
  const start = Date.parse(NOW)
  return () => {
    const value = new Date(start + Math.max(0, calls - 1) * 3_600_000)
    calls += 1
    return value
  }
}

test('a grant that expires mid-composition refuses instead of returning a partial result', async () => {
  const now = advancingClock()
  let laterReads = 0
  const composer = new ContextComposer(
    {
      port: staticPort(portSources()),
      decisions: {
        listEffective: async () => {
          laterReads += 1
          return { decisions: [decision('d1')] }
        },
      },
    },
    { now },
  )
  await assert.rejects(
    composer.compose({
      requestId: 'mid-flight',
      projectId: 'project-1',
      purpose: 'conversation_discussion',
      query: 'x',
      grant: grant(),
      budget: { maxBytes: 64 * 1024, maxTokens: 8000, maxFiles: 8, maxSlices: 8, maxDurationMs: 60_000 },
    }),
    (error: unknown) => error instanceof ContextError && error.code === 'grant_expired',
  )
  assert.equal(laterReads, 0, 'the decision provider must not be reached after expiry')
})

test('a one-slice budget reads at most one item across all groups', async () => {
  let reads = 0
  const composer = new ContextComposer(
    {
      port: staticPort(portSources()),
      decisions: {
        listEffective: async () => {
          reads += 1
          return { decisions: [decision('d1'), decision('d2'), decision('d3')] }
        },
      },
      conversation: {
        recent: async () => {
          reads += 1
          return [{ messageId: 'm1', conversationId: 'conv-1', sequence: 1, role: 'user', provenance: 'trusted_user', text: 'x', createdAt: NOW }]
        },
      },
    },
    { now: () => new Date(NOW) },
  )
  const composition = await composer.compose({
    requestId: 'one-slice',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: 'x',
    grant: { ...grant(), maxFiles: 1, maxBytes: 4096, maxTokens: 4000 },
    budget: { maxFiles: 1, maxSlices: 1, maxBytes: 4096, maxTokens: 4000, maxDurationMs: 5000 },
  })
  assert.ok(composition.totals.files <= 1)
  assert.ok(composition.totals.bytes <= 4096)
  assert.ok(composition.omitted.some((item) => item.reason === 'budget_slices' || item.reason === 'budget_group'))
})

test('an unavailable provider, a caller truncation and a failed scan stay distinguishable', async () => {
  // 1) unavailable provider
  const noProvider = await new ContextComposer({ port: staticPort([]) }, { now: () => new Date(NOW) }).compose({
    requestId: 'no-provider',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: 'x',
    grant: grant(),
    budget: { maxBytes: 4096, maxTokens: 4000, maxFiles: 4, maxSlices: 4, maxDurationMs: 5000 },
  })
  const decisions = noProvider.groups.find((group) => group.name === 'decisions')!
  assert.equal(decisions.status, 'unavailable')
  assert.ok(decisions.omitted.some((item) => item.reason === 'source_unavailable'))

  // 2) caller truncation
  const truncated = await new ContextComposer(
    { port: staticPort([]), decisions: { listEffective: async () => ({ decisions: [decision('a'), decision('b'), decision('c')], truncatedByLimit: true }) } },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'truncated',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: 'x',
    grant: grant(),
    budget: { maxBytes: 4096, maxTokens: 4000, maxFiles: 3, maxSlices: 3, maxDurationMs: 5000 },
  })
  const truncatedGroup = truncated.groups.find((group) => group.name === 'decisions')!
  assert.equal(truncatedGroup.status, 'truncated')
  assert.ok(truncatedGroup.omitted.some((item) => item.reason === 'budget_group'))

  // 3) failed effectiveness scan is fatal, never an empty/partial knowledge result
  await assert.rejects(
    new ContextComposer(
      {
        port: staticPort([]),
        decisions: {
          listEffective: async () => {
            const error = new Error('scan exceeded bound')
            ;(error as unknown as { code: string }).code = 'scan_incomplete'
            throw error
          },
        },
      },
      { now: () => new Date(NOW) },
    ).compose({
      requestId: 'failed-scan',
      projectId: 'project-1',
      purpose: 'conversation_discussion',
      query: 'x',
      grant: grant(),
      budget: { maxBytes: 4096, maxTokens: 4000, maxFiles: 4, maxSlices: 4, maxDurationMs: 5000 },
    }),
    (error: unknown) => error instanceof ContextError && error.code === 'scan_incomplete',
  )
})

test('bytes/tokens are labelled estimates, and the output never claims a model injection', async () => {
  const composition = await new ContextComposer(
    { port: staticPort(portSources()), decisions: { listEffective: async () => ({ decisions: [decision('d1')] }) } },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'estimate',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: 'x',
    grant: grant(),
    budget: { maxBytes: 64 * 1024, maxTokens: 8000, maxFiles: 8, maxSlices: 8, maxDurationMs: 5000 },
  })
  assert.equal(composition.trust, 'untrusted_data')
  assert.ok(composition.totals.tokens >= 0)
  assert.equal(Object.hasOwn(composition, 'injected'), false)
  assert.equal(Object.hasOwn(composition, 'modelRequest'), false)
  assert.ok(composition.explanations.every((text) => !text.includes('billable')))
})
