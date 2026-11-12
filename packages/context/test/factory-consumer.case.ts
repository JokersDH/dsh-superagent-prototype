import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  ContextComposer,
  buildSourceManifest,
  createPublishedArtifactProvider,
  createScopedConversationProvider,
} from '../src/index.ts'
import type { ScopedConversationMessageView, ScopedConversationPage } from '../src/index.ts'
import { NOW, makeGrant } from './helpers.ts'

const projectId = 'project-factory'
const conversationId = 'conversation-factory'
const scope: Scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const secretScope: Scope = { ...scope, allowedPaths: ['private'] }

/**
 * The replaceable factories must survive the real composer, not only the standalone selector:
 * their call counts, source ids and incomplete coverage are observed through the composition and
 * the manifest that main would receive.
 */
test('the scoped factories are actually called by the composer and keep ids and coverage', async () => {
  const pages: number[] = []
  const messages: ScopedConversationMessageView[] = Array.from({ length: 5 }, (_, index) => ({
    id: `m-${index + 1}`,
    conversationId,
    projectId,
    sequence: index + 1,
    role: 'user',
    provenance: 'trusted_user',
    text: `discussion ${index + 1}`,
    createdAt: NOW,
  }))
  const reader = {
    page(id: string, input: { before?: number; limit?: number }): ScopedConversationPage {
      pages.push(input.limit ?? 50)
      const before = input.before ?? Number.MAX_SAFE_INTEGER
      const eligible = messages
        .filter((message) => message.conversationId === id && message.sequence < before)
        .sort((left, right) => right.sequence - left.sequence)
      const page = eligible.slice(0, input.limit ?? 50)
      return { messages: page, hasMore: eligible.length > page.length }
    },
  }
  const looked: string[] = []
  const lookup = {
    get(id: string) {
      looked.push(id)
      return { id, digest: 'a'.repeat(64), bytes: 5, createdAt: NOW }
    },
  }
  const conversation = createScopedConversationProvider(reader, { projectId, conversationId }, { pageSize: 2, maxPages: 1 })
  const artifacts = createPublishedArtifactProvider(lookup, { publishedArtifactIds: ['artifact-1'] })
  let decisionReads = 0
  const composition = await new ContextComposer(
    {
      port: {
        projectBaseline: async () => ({ capturedAt: NOW }),
        listSources: async () => [],
        readSource: async () => {
          throw new Error('no files')
        },
      },
      conversation,
      artifacts,
      decisions: {
        listEffective: async () => {
          decisionReads += 1
          return {
            decisions: [
              { decisionId: 'decision-visible', content: 'Keep checks.', scope, sourceMessageId: 'm-1', recordedAt: NOW },
              { decisionId: 'decision-private', content: 'SECRET plan', scope: secretScope, sourceMessageId: 'm-2', recordedAt: NOW },
            ],
          }
        },
      },
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'factory-consumer',
    projectId,
    conversationId,
    purpose: 'conversation_discussion',
    query: '',
    grant: makeGrant({
      projectId,
      purpose: 'conversation_discussion',
      scope,
      sourceKinds: ['conversation_message', 'artifact', 'decision'],
      maxFiles: 8,
      maxBytes: 8192,
      maxTokens: 4000,
      maxDurationMs: 1000,
    }),
    budget: { maxFiles: 8, maxSlices: 8, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 },
    groups: [
      { name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 0.3 },
      { name: 'conversation', priority: 2, sourceKinds: ['conversation_message'], share: 0.5 },
      { name: 'artifacts', priority: 3, sourceKinds: ['artifact'], share: 0.2 },
    ],
  })

  // Every factory was actually driven through the composer.
  assert.ok(pages.length >= 1)
  assert.deepEqual(looked, ['artifact-1'])
  assert.equal(decisionReads, 1)
  assert.equal(conversation.coverage().scanned, 2)
  assert.equal(conversation.coverage().complete, false)

  const conversationSlices = composition.slices.filter((slice) => slice.kind === 'conversation_message')
  assertEqualsNumber(conversationSlices.length, 2)
  for (const slice of conversationSlices) assert.match(slice.sourceId, /^message-/)
  assert.equal(composition.slices.some((slice) => slice.kind === 'artifact'), true)
  assert.equal(composition.slices.some((slice) => slice.content.includes('SECRET')), false)

  // The incomplete provider scan is visible in the composition and the manifest main receives.
  const conversationGroup = composition.groups.find((group) => group.name === 'conversation')!
  assert.equal(conversationGroup.status, 'truncated')
  assert.ok(conversationGroup.omitted.some((item) => item.detail === 'conversation provider scan is incomplete'))
  assert.notEqual(composition.status, 'sufficient')
  const manifest = buildSourceManifest(composition)
  assert.equal(manifest.coverage.complete, false)
  assert.equal(manifest.budget.maxBytes, composition.budget.maxBytes)
  assert.ok(manifest.sources.some((source) => source.sourceId.startsWith('artifact-')))
  assert.ok(manifest.sources.every((source) => source.trust === 'untrusted_data'))
})

function assertEqualsNumber(actual: number, expected: number): void {
  assert.equal(actual, expected)
}

test('an artifact selection that could not return every published id keeps the group incomplete', async () => {
  const artifacts = createPublishedArtifactProvider(
    { get: (id) => (id === 'missing' ? undefined : { id, digest: 'b'.repeat(64), bytes: 4, createdAt: NOW }) },
    { publishedArtifactIds: ['present', 'missing'] },
  )
  const composition = await new ContextComposer(
    {
      port: {
        projectBaseline: async () => ({ capturedAt: NOW }),
        listSources: async () => [],
        readSource: async () => {
          throw new Error('no files')
        },
      },
      artifacts,
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'factory-artifact',
    projectId,
    purpose: 'conversation_discussion',
    query: '',
    grant: makeGrant({
      projectId,
      purpose: 'conversation_discussion',
      scope,
      sourceKinds: ['artifact'],
      maxFiles: 4,
      maxBytes: 4096,
      maxTokens: 2000,
      maxDurationMs: 1000,
    }),
    budget: { maxFiles: 4, maxSlices: 4, maxBytes: 4096, maxTokens: 2000, maxDurationMs: 1000 },
    groups: [{ name: 'artifacts', priority: 1, sourceKinds: ['artifact'], share: 1 }],
  })
  const group = composition.groups[0]!
  assert.equal(group.status, 'truncated')
  assert.ok(group.omitted.some((item) => item.detail === 'artifact provider selection is incomplete'))
  assert.equal(artifacts.coverage().complete, false)
})
