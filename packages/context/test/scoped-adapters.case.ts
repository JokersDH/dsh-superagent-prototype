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
    message({ id: 'selected', sequence: 6 }),
    message({ id: 'foreign', sequence: 5, projectId: 'project-2' }),
    unprovenProject('unproven', 4),
    message({ id: 'permission', sequence: 3, provenance: 'question_answer_display' }),
    message({ id: 'reasoner', sequence: 2, role: 'assistant', provenance: 'reasoner_reply' }),
    message({ id: 'untrusted', sequence: 7, provenance: 'native_notice' }),
    message({ id: 'system', sequence: 8, role: 'system' }),
    message({ id: 'other-conversation', sequence: 9, conversationId: 'conv-2' }),
  ])
  const adapter = createScopedConversationProvider(source, { projectId, conversationId })
  const messages = await adapter.recent({ projectId, conversationId, limit: 20 })
  // A legitimate completed reasoner reply is reusable discussion context, exactly like main's reader.
  assert.deepEqual(messages.map((value) => value.messageId), ['selected', 'reasoner'])
  const coverage = adapter.coverage()
  assert.equal(coverage.excluded.foreignProject, 1)
  assert.equal(coverage.excluded.unprovenProject, 1)
  assert.equal(coverage.excluded.permissionDisplay, 1)
  assert.equal(coverage.excluded.untrustedProvenance, 1)
  assert.equal(coverage.excluded.systemRole, 1)
  assert.equal(coverage.complete, true)
})

test('question anchors and unselected work supplements never become reusable discussion context', async () => {
  const anchored = createScopedConversationProvider(
    reader([
      message({ id: 'discussion', sequence: 3 }),
      message({ id: 'auth-answer', sequence: 2, anchor: { questionId: 'q-1' } }),
      message({ id: 'work-supplement', sequence: 1, anchor: { workId: 'work-9' } }),
    ]),
    { projectId, conversationId },
  )
  const messages = await anchored.recent({ projectId, conversationId, limit: 20 })
  assert.deepEqual(messages.map((value) => value.messageId), ['discussion'])
  assert.equal(anchored.coverage().excluded.questionAnchor, 1)
  assert.equal(anchored.coverage().excluded.otherWork, 1)

  // Even a trusted user message carrying a question anchor is excluded before provenance is checked.
  const trustedQuestion = createScopedConversationProvider(
    reader([message({ id: 'trusted-question', sequence: 1, anchor: { questionId: 'q-2' } })]),
    { projectId, conversationId },
  )
  assert.deepEqual(await trustedQuestion.recent({ projectId, conversationId, limit: 20 }), [])
  assert.equal(trustedQuestion.coverage().excluded.questionAnchor, 1)
  assert.equal(trustedQuestion.coverage().excluded.untrustedProvenance, 0)
})

test('a misbehaving reader page that does not move the cursor is reported as incomplete', async () => {
  let calls = 0
  const stuck = {
    page(): ScopedConversationPage {
      calls += 1
      return { messages: [message({ id: 'a', sequence: 5 })], hasMore: true }
    },
  }
  const adapter = createScopedConversationProvider(stuck, { projectId, conversationId }, { pageSize: 1, maxPages: 5 })
  const messages = await adapter.recent({ projectId, conversationId, limit: 5 })
  assert.equal(messages.length, 1)
  assert.equal(calls, 2)
  assert.equal(adapter.coverage().complete, false)
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
  assert.deepEqual(adapter.coverage(), { requested: 2, lookedUp: 2, returned: 1, missing: 1, oversized: 0, complete: false })
})

test('the published-artifact adapter is bounded by maxIds', async () => {
  const lookup = { get: (id: string) => ({ id, digest: 'b'.repeat(64), bytes: 1, createdAt: NOW }) }
  const adapter = createPublishedArtifactProvider(lookup, { publishedArtifactIds: ['a', 'b', 'c', 'd'] }, { maxIds: 2 })
  assert.equal((await adapter.recent({ projectId, limit: 10 })).length, 2)
  assert.equal(adapter.coverage().lookedUp, 2)
  assert.equal(adapter.coverage().complete, false)
})

test('maxIds bounds lookups even when every metadata row is missing', async () => {
  let lookups = 0
  const adapter = createPublishedArtifactProvider(
    { get: () => { lookups += 1; return undefined } },
    { publishedArtifactIds: Array.from({ length: 100 }, (_, index) => `missing-${index}`) },
    { maxIds: 2 },
  )
  assert.deepEqual(await adapter.recent({ projectId, limit: 10 }), [])
  assert.equal(lookups, 2)
  assert.deepEqual(adapter.coverage(), { requested: 100, lookedUp: 2, returned: 0, missing: 2, oversized: 0, complete: false })
})

test('metadata that belongs to another id or exceeds the byte cap is never returned as evidence', async () => {
  const adapter = createPublishedArtifactProvider(
    {
      get: (id) => ({
        id: id === 'substituted' ? 'someone-else' : id,
        digest: 'd'.repeat(64),
        bytes: id === 'huge' ? 1_000_000 : 5,
        createdAt: NOW,
      }),
    },
    { publishedArtifactIds: ['ok', 'substituted', 'huge'] },
    { maxArtifactBytes: 1024 },
  )
  const artifacts = await adapter.recent({ projectId, limit: 10 })
  assert.deepEqual(artifacts.map((value) => value.artifactId), ['ok'])
  assert.deepEqual(adapter.coverage(), { requested: 3, lookedUp: 3, returned: 1, missing: 1, oversized: 1, complete: false })
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

test('the conversation scan cap preserves the 600-message production boundary', async () => {
  const many = Array.from({ length: 700 }, (_, index) => message({ id: `m-${index + 1}`, sequence: index + 1 }))
  const adapter = createScopedConversationProvider(reader(many), { projectId, conversationId },
    { pageSize: 200, maxPages: 10, maxScannedMessages: 600 })
  const messages = await adapter.recent({ projectId, conversationId, limit: 700 })
  assert.equal(adapter.coverage().scanned, 600)
  assert.equal(adapter.coverage().complete, false)
  assert.equal(messages.length, 600)
  assert.equal(messages[0]!.messageId, 'm-700')
  assert.equal(messages[599]!.messageId, 'm-101')

  // Raising the explicit cap is the only way to walk further.
  const full = createScopedConversationProvider(reader(many), { projectId, conversationId },
    { pageSize: 200, maxPages: 10, maxScannedMessages: 5000 })
  // Ask for more than exists so the walk ends on hasMore=false rather than its own result cap.
  await full.recent({ projectId, conversationId, limit: 2000 })
  assert.equal(full.coverage().scanned, 700)
  assert.equal(full.coverage().complete, true)
})

test('the published-artifact provider returns newest first with a stable id tie-break', async () => {
  const metadata = new Map([
    ['old', { id: 'old', digest: 'a'.repeat(64), bytes: 1, createdAt: '2026-01-01T00:00:00.000Z' }],
    ['new', { id: 'new', digest: 'b'.repeat(64), bytes: 2, createdAt: '2026-06-01T00:00:00.000Z' }],
    ['tie-b', { id: 'tie-b', digest: 'c'.repeat(64), bytes: 3, createdAt: '2026-03-01T00:00:00.000Z' }],
    ['tie-a', { id: 'tie-a', digest: 'd'.repeat(64), bytes: 4, createdAt: '2026-03-01T00:00:00.000Z' }],
  ])
  const provider = createPublishedArtifactProvider({ get: (id) => metadata.get(id) },
    { publishedArtifactIds: ['old', 'tie-b', 'new', 'tie-a', 'old'] })
  const newest = await provider.recent({ projectId, limit: 1 })
  assert.deepEqual(newest.map((item) => item.artifactId), ['new'])
  const all = await provider.recent({ projectId, limit: 10 })
  assert.deepEqual(all.map((item) => item.artifactId), ['new', 'tie-a', 'tie-b', 'old'])
  assert.deepEqual(provider.coverage(), { requested: 4, lookedUp: 4, returned: 4, missing: 0, oversized: 0, complete: true })
})

test('source fingerprints stay stable for the same identity and never come from unpublished ids', async () => {
  const make = (text: string) => createScopedConversationProvider(
    reader([message({ id: 'stable-message', sequence: 1, text })]),
    { projectId, conversationId },
  )
  const first = await make('first body').recent({ projectId, conversationId, limit: 10 })
  const second = await make('changed body').recent({ projectId, conversationId, limit: 10 })
  assert.equal(first[0]!.messageId, second[0]!.messageId)

  const looked: string[] = []
  const provider = createPublishedArtifactProvider(
    { get: (id) => { looked.push(id); return { id, digest: 'e'.repeat(64), bytes: 1, createdAt: NOW } } },
    { publishedArtifactIds: ['published-only'] },
  )
  await provider.recent({ projectId, limit: 50 })
  assert.deepEqual(looked, ['published-only'])
})
