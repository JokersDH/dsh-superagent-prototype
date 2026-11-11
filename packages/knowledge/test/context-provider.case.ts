import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import { ContextComposer, ContextError } from '@personal-agent/context'
import { InMemoryAssistantState } from '@personal-agent/proposals'
import {
  AssistantDecisionStore,
  DecisionGovernance,
  decisionContextProvider,
  StaticDecisionSourcePort,
} from '../src/index.ts'
import { StaticContextPort } from '@personal-agent/context'

const NOW = '2026-11-11T00:00:00.000Z'
const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const source = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  projectId: 'project-1',
  role: 'user' as const,
  provenance: 'trusted_user' as const,
  createdAt: NOW,
  textDigest: 'a'.repeat(64),
}

function setup(limits: { pageSize?: number; maxPages?: number } = {}) {
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port, limits)
  const governance = new DecisionGovernance(store, new StaticDecisionSourcePort([source]), {
    now: () => new Date(NOW),
  })
  return { port, store, governance }
}

const record = (governance: DecisionGovernance, id: string, supersedes?: string) =>
  governance.record(
    {
      decisionId: id,
      content: `Rule ${id}`,
      scope,
      sourceMessageId: 'msg-1',
      ...(supersedes === undefined ? {} : { supersedes }),
    },
    { actorRef: 'user-1', projectId: 'project-1', grantScope: scope },
  )

test('only effective decisions reach the composer provider', async () => {
  const { governance } = setup()
  await record(governance, 'active')
  await record(governance, 'revoked')
  await governance.revoke('revoked', 1, { actorRef: 'user-1', projectId: 'project-1' })
  await record(governance, 'old')
  await record(governance, 'replacement', 'old')

  const provider = decisionContextProvider(governance, () => new Date(NOW))
  const page = await provider.listEffective('project-1', 50)
  assert.deepEqual(page.decisions.map((decision) => decision.decisionId).sort(), ['active', 'replacement'])
  assert.equal(page.truncatedByLimit, false)
})

test('the provider reports the caller cap instead of pretending completeness', async () => {
  const { governance } = setup()
  for (let index = 0; index < 5; index += 1) await record(governance, `decision-${index}`)
  const provider = decisionContextProvider(governance, () => new Date(NOW))
  const capped = await provider.listEffective('project-1', 2)
  assert.equal(capped.decisions.length, 2)
  assert.equal(capped.truncatedByLimit, true)
})

test('an incomplete effectiveness scan fails composition instead of leaking stale knowledge', async () => {
  const { governance } = setup({ pageSize: 2, maxPages: 1 })
  for (let index = 0; index < 5; index += 1) await record(governance, `decision-${index}`)
  const provider = decisionContextProvider(governance, () => new Date(NOW))

  // Provider refuses directly.
  await assert.rejects(provider.listEffective('project-1', 10), (error: unknown) =>
    error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'scan_incomplete')

  // And the composer surfaces it as a fatal composition error.
  const composer = new ContextComposer(
    { port: new StaticContextPort({ projectId: 'project-1', baseline: { capturedAt: NOW }, sources: [] }), decisions: provider },
    { now: () => new Date(NOW) },
  )
  await assert.rejects(
    composer.compose({
      requestId: 'request-1',
      projectId: 'project-1',
      purpose: 'conversation_discussion',
      query: 'rules',
      grant: {
        grantId: 'grant-1',
        projectId: 'project-1',
        gateway: 'conversation',
        purpose: 'conversation_discussion',
        scope,
        sourceKinds: ['decision'],
        maxFiles: 8,
        maxBytes: 64 * 1024,
        maxTokens: 8000,
        maxDurationMs: 2000,
        confirmedAt: '2026-11-10T00:00:00.000Z',
        confirmedBy: 'user-1',
      },
      budget: { maxBytes: 64 * 1024, maxTokens: 8000, maxFiles: 8, maxSlices: 8, maxDurationMs: 2000 },
    }),
    (error: unknown) => error instanceof ContextError && error.code === 'scan_incomplete',
  )
})

test('a revoked or replaced decision never becomes effective again after reopen', async () => {
  const { governance, port } = setup()
  await record(governance, 'old')
  await record(governance, 'replacement', 'old')
  await governance.revoke('replacement', 1, { actorRef: 'user-1', projectId: 'project-1' })

  const reopened = new DecisionGovernance(new AssistantDecisionStore(port), new StaticDecisionSourcePort([source]), {
    now: () => new Date(NOW),
  })
  const provider = decisionContextProvider(reopened, () => new Date(NOW))
  const page = await provider.listEffective('project-1', 50)
  assert.deepEqual(page.decisions, [])
  assert.equal(port.decisions.history('old').length, 1)
})
