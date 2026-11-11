import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContextComposer, createPublishedArtifactProvider, createScopedConversationProvider } from '../src/index.ts'
import type { ScopedConversationMessageView, ScopedConversationPage } from '../src/index.ts'
import { NOW, makeGrant, scope } from './helpers.ts'

const projectId = 'project-1'
const conversationId = 'conv-1'

const message = (
  overrides: Partial<ScopedConversationMessageView> & { id: string; sequence: number },
): ScopedConversationMessageView => ({
  conversationId,
  projectId,
  role: 'user',
  provenance: 'trusted_user',
  text: `text ${overrides.id}`,
  createdAt: NOW,
  ...overrides,
})

const unprovenProject = (id: string, sequence: number): ScopedConversationMessageView => {
  const { projectId: _omitted, ...rest } = message({ id, sequence })
  return rest
}

function reader(messages: readonly ScopedConversationMessageView[], options: { hasMorePerPage?: boolean } = {}) {
  const calls: { before?: number; limit: number }[] = []
  return {
    calls,
    page(id: string, input: { before?: number; limit?: number }): ScopedConversationPage {
      calls.push({ ...(input.before === undefined ? {} : { before: input.before }), limit: input.limit ?? 50 })
      const limit = input.limit ?? 50
      const before = input.before ?? Number.MAX_SAFE_INTEGER
      const page = messages
        .filter((value) => value.conversationId === id && value.sequence < before)
        .sort((left, right) => right.sequence - left.sequence)
        .slice(0, limit)
      return { messages: page, hasMore: options.hasMorePerPage ?? page.length === limit }
    },
  }
}

test('the scoped conversation adapter excludes foreign projects, permission displays and untrusted provenance', async () => {
  const source = reader([
    message({ id: 'selected', sequence: 5 }),
    message({ id: 'foreign', sequence: 4, projectId: 'project-2' }),
    unprovenProject('unproven', 3),
    message({ id: 'permission', sequence: 2, provenance: 'question_answer_display' }),
    message({ id: 'reasoner', sequence: 1, role: 'assistant', provenance: 'reasoner_reply' }),
    message({ id: 'system', sequence: 6, role: 'system' }),
    message({ id: 'other-conversation', sequence: 7, conversationId: 'conv-2' }),
  ])
  const adapter = createScopedConversationProvider(source, { projectId, conversationId })
  const messages = await adapter.recent({ projectId, conversationId, limit: 20 })
  assert.deepEqual(messages.map((value) => value.messageId), ['selected'])
  const coverage = adapter.coverage()
  assert.equal(coverage.excluded.foreignProject, 1)
  assert.equal(coverage.excluded.unprovenProject, 1)
  assert.equal(coverage.excluded.permissionDisplay, 1)
  assert.equal(coverage.excluded.untrustedProvenance, 1)
  assert.equal(coverage.excluded.systemRole, 1)
  assert.equal(coverage.complete, true)
})

test('a misbehaving reader cannot smuggle another conversation into the composition', async () => {
  const smuggler = {
    page: (_id: string, input: { limit?: number }): ScopedConversationPage => ({
      messages: [
        message({ id: 'own', sequence: 2 }),
        message({ id: 'foreign-conversation', sequence: 1, conversationId: 'conv-2' }),
      ],
      hasMore: false,
    }),
  }
  const adapter = createScopedConversationProvider(smuggler, { projectId, conversationId })
  const messages = await adapter.recent({ projectId, conversationId, limit: 10 })
  assert.deepEqual(messages.map((value) => value.messageId), ['own'])
  assert.equal(adapter.coverage().excluded.otherConversation, 1)
})

test('a selected work excludes messages anchored to another work but keeps general messages', async () => {
  const source = reader([
    message({ id: 'selected-work', sequence: 3, anchor: { workId: 'work-1' } }),
    message({ id: 'other-work', sequence: 2, anchor: { workId: 'work-2' } }),
    message({ id: 'general', sequence: 1 }),
  ])
  const adapter = createScopedConversationProvider(source, { projectId, conversationId, workId: 'work-1' })
  const messages = await adapter.recent({ projectId, conversationId, limit: 20 })
  assert.deepEqual(messages.map((value) => value.messageId), ['selected-work', 'general'])
  assert.equal(adapter.coverage().excluded.otherWork, 1)
})

test('the adapter reports an incomplete bounded scan instead of claiming the whole conversation', async () => {
  const many = Array.from({ length: 10 }, (_, index) => message({ id: `m-${index}`, sequence: index + 1 }))
  const adapter = createScopedConversationProvider(reader(many), { projectId, conversationId }, { pageSize: 2, maxPages: 2 })
  const messages = await adapter.recent({ projectId, conversationId, limit: 10 })
  assert.equal(messages.length, 4)
  assert.equal(adapter.coverage().complete, false)

  const exhausted = createScopedConversationProvider(
    reader([
      message({ id: 'a', sequence: 2 }),
      message({ id: 'b', sequence: 1 }),
    ]),
    { projectId, conversationId },
    { pageSize: 5, maxPages: 4 },
  )
  assert.equal((await exhausted.recent({ projectId, conversationId, limit: 10 })).length, 2)
  assert.equal(exhausted.coverage().complete, true)
})

test('a different project or conversation selection returns nothing', async () => {
  const source = reader([message({ id: 'a', sequence: 1 })])
  const adapter = createScopedConversationProvider(source, { projectId, conversationId })
  assert.deepEqual(await adapter.recent({ projectId: 'project-2', conversationId, limit: 10 }), [])
  assert.deepEqual(await adapter.recent({ projectId, conversationId: 'conv-2', limit: 10 }), [])
  assert.equal(adapter.coverage().returned, 0)
})

test('the published-artifact adapter only looks up verified ids and never enumerates', async () => {
  const looked: string[] = []
  const lookup = {
    get(id: string) {
      looked.push(id)
      if (id === 'missing') return undefined
      return { id, digest: 'a'.repeat(64), bytes: 10 + id.length, createdAt: NOW }
    },
  }
  const adapter = createPublishedArtifactProvider(lookup, { publishedArtifactIds: ['pub-1', 'pub-1', 'missing'] })
  const artifacts = await adapter.recent({ projectId, limit: 10 })
  assert.deepEqual(artifacts.map((value) => value.artifactId), ['pub-1'])
  assert.deepEqual(looked, ['pub-1', 'missing'])
  assert.deepEqual(adapter.coverage(), { requested: 2, returned: 1, missing: 1, complete: false })
})

test('the published-artifact adapter is bounded by maxIds', async () => {
  const lookup = { get: (id: string) => ({ id, digest: 'b'.repeat(64), bytes: 1, createdAt: NOW }) }
  const adapter = createPublishedArtifactProvider(lookup, { publishedArtifactIds: ['a', 'b', 'c', 'd'] }, { maxIds: 2 })
  assert.equal((await adapter.recent({ projectId, limit: 10 })).length, 2)
  assert.equal(adapter.coverage().complete, false)
})

test('the scoped adapters compose into the authorized composer without leaking foreign material', async () => {
  const conversationSource = reader([
    message({ id: 'own', sequence: 2, text: 'SELECTED_DISCUSSION' }),
    message({ id: 'foreign', sequence: 1, projectId: 'project-2', text: 'FOREIGN_DISCUSSION' }),
  ])
  const adapter = createScopedConversationProvider(conversationSource, { projectId, conversationId })
  const composition = await new ContextComposer(
    {
      port: {
        projectBaseline: async () => ({ capturedAt: NOW }),
        listSources: async () => [],
        readSource: async () => {
          throw new Error('no files')
        },
      },
      conversation: adapter,
      artifacts: createPublishedArtifactProvider(
        { get: (id) => ({ id, digest: 'c'.repeat(64), bytes: 4, createdAt: NOW }) },
        { publishedArtifactIds: ['published-artifact'] },
      ),
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'scoped',
    projectId,
    purpose: 'conversation_discussion',
    query: '',
    conversationId,
    grant: makeGrant({
      purpose: 'conversation_discussion',
      scope: scope(),
      sourceKinds: ['conversation_message', 'artifact'],
      maxFiles: 6,
      maxBytes: 8192,
      maxTokens: 4000,
      maxDurationMs: 1000,
      confirmedAt: '2026-11-09T00:00:00.000Z',
    }),
    budget: { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 },
  })
  const text = composition.slices.map((slice) => slice.content).join('\n')
  assert.ok(text.includes('SELECTED_DISCUSSION'))
  assert.equal(text.includes('FOREIGN_DISCUSSION'), false)
  assert.ok(text.includes('published-artifact'))
})
