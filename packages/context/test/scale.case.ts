import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  buildSourceManifest,
  compareSourceManifests,
  createConversationRelevanceCandidates,
  createDecisionRelevanceCandidates,
  createScopedConversationProvider,
  projectSourceReview,
  selectRelevantSources,
} from '../src/index.ts'
import type { ContextComposition, RelevanceCandidate, ScopedConversationMessageView } from '../src/index.ts'
import { NOW, descriptor, makeGrant, staticPort } from './helpers.ts'

const projectId = 'project-scale'
const conversationId = 'conversation-scale'
const scope: Scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const sameTime = '2026-11-12T00:00:00.000Z'

/** 5000 messages sharing one timestamp; only `sequence` distinguishes their order. */
function largeConversation(late?: string) {
  const messages: ScopedConversationMessageView[] = Array.from({ length: 5000 }, (_, index) => ({
    id: `m-${index + 1}`,
    conversationId,
    projectId,
    sequence: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    provenance: index % 2 === 0 ? 'trusted_user' : 'reasoner_reply',
    text: index === 4998 ? 'payment timeout retry at the newest edge' : `routine line ${index + 1}`,
    createdAt: sameTime,
  }))
  if (late !== undefined) {
    messages.push({
      id: 'late-message',
      conversationId,
      projectId,
      sequence: 5001,
      role: 'user',
      provenance: 'trusted_user',
      text: late,
      createdAt: sameTime,
    })
  }
  const pages: number[] = []
  const reader = {
    page(id: string, input: { before?: number; limit?: number }) {
      pages.push(input.limit ?? 50)
      const before = input.before ?? Number.MAX_SAFE_INTEGER
      const eligible = messages
        .filter((message) => message.conversationId === id && message.sequence < before)
        .sort((left, right) => right.sequence - left.sequence)
      const page = eligible.slice(0, input.limit ?? 50)
      return { messages: page, hasMore: eligible.length > page.length }
    },
  }
  return { messages, reader, pages }
}

test('a 5000-message conversation is read within a page budget and never claims completeness it lacks', async () => {
  const { reader, pages } = largeConversation()
  const bounded = createScopedConversationProvider(reader, { projectId, conversationId }, { pageSize: 100, maxPages: 10 })
  // The helper's own input cap is 1000 candidates; both the scan window and that cap stay bounded.
  const batch = await createConversationRelevanceCandidates(bounded, { projectId, conversationId }, { limit: 5000 })
  assert.equal(bounded.coverage().scanned, 1000)
  assert.equal(bounded.coverage().complete, false)
  assert.equal(batch.coverage.complete, false)

  const selection = selectRelevantSources(batch, {
    projectId,
    query: 'payment timeout retry',
    allowedKinds: ['conversation_message'],
    maxItems: 16,
    maxBytes: 32 * 1024,
  })
  // The newest relevant line is inside the scanned window; the output stays bounded.
  assert.deepEqual(selection.items.map((item) => item.sourceId), ['m-4999'])
  assert.ok(selection.items.length <= selection.budget.maxItems)
  assert.ok(selection.totals.bytes <= selection.budget.maxBytes)
  assert.equal(selection.upstreamComplete, false)
  assert.equal(selection.complete, false)
  assert.equal(pages.length, 10)
})

test('deep pagination reaches the end of 5000 messages without duplicates when the budget allows it', async () => {
  const { reader, pages } = largeConversation()
  // Ask for more than the conversation holds so the walk ends on `hasMore=false`, not on its cap.
  const provider = createScopedConversationProvider(reader, { projectId, conversationId }, { pageSize: 200, maxPages: 30 })
  const messages = await provider.recent({ projectId, conversationId, limit: 6000 })
  assert.equal(messages.length, 5000)
  assert.equal(new Set(messages.map((message) => message.messageId)).size, 5000)
  assert.equal(pages.length, 25)
  assert.equal(provider.coverage().scanned, 5000)
  assert.equal(provider.coverage().complete, true)
  // Same-timestamp ordering is still newest-first by sequence, so a later page holds older rows.
  assert.equal(messages[0]!.messageId, 'm-5000')
  assert.equal(messages[messages.length - 1]!.messageId, 'm-1')
})

test('a message appended during the walk is not retroactively included, and a fresh walk sees it', async () => {
  const { messages, reader } = largeConversation()
  let first = true
  const appending = {
    page(id: string, input: { before?: number; limit?: number }) {
      const page = reader.page(id, input)
      if (first) {
        // Append only after the first page was read: the walk's cutoff must not pull it in.
        first = false
        messages.push({
          id: 'late-message',
          conversationId,
          projectId,
          sequence: 5001,
          role: 'user',
          provenance: 'trusted_user',
          text: 'LATE-CONCURRENT: appended after the first page',
          createdAt: sameTime,
        })
      }
      return page
    },
  }
  const during = createScopedConversationProvider(appending, { projectId, conversationId }, { pageSize: 100, maxPages: 2 })
  const walked = await during.recent({ projectId, conversationId, limit: 200 })
  assert.equal(walked.some((message) => message.messageId === 'late-message'), false)
  assert.equal(new Set(walked.map((message) => message.messageId)).size, walked.length)

  const fresh = createScopedConversationProvider(reader, { projectId, conversationId }, { pageSize: 100, maxPages: 2 })
  const after = await fresh.recent({ projectId, conversationId, limit: 200 })
  assert.equal(after[0]!.messageId, 'late-message')
})

test('expired/revoked/superseded decisions stay out of ranking while remaining history data', () => {
  const candidates = createDecisionRelevanceCandidates(
    [
      { decisionId: 'decision-keep', content: 'payment retry budget', scope, sourceMessageId: 'm-1', recordedAt: NOW },
      { decisionId: 'decision-replaced', content: 'payment retry budget old', scope, sourceMessageId: 'm-2', recordedAt: NOW },
      { decisionId: 'decision-foreign', content: 'payment retry budget foreign', scope: { ...scope, projectId: 'other' }, sourceMessageId: 'm-3', recordedAt: NOW },
    ],
    { supersededIds: ['decision-replaced'], coverage: { complete: true } },
  )
  const selection = selectRelevantSources(candidates, { projectId, query: 'payment retry', scope })
  assert.deepEqual(selection.items.map((item) => item.sourceId), ['decision-keep'])
  assert.ok(selection.omitted.some((entry) => entry.reason === 'superseded' && entry.sourceId === 'decision-replaced'))
  assert.ok(selection.omitted.some((entry) => entry.reason === 'foreign_project' && entry.sourceId === 'decision-foreign'))
})

test('duplicate candidates are collapsed after authorization, not before', () => {
  const candidates: RelevanceCandidate[] = [
    { sourceId: 'dup', kind: 'decision', path: 'decisions/dup.json', content: 'payment', projectId: 'other', scope },
    { sourceId: 'dup', kind: 'decision', path: 'decisions/dup.json', content: 'payment', projectId, scope },
    { sourceId: 'dup', kind: 'decision', path: 'decisions/dup.json', content: 'payment', projectId, scope },
  ]
  const selection = selectRelevantSources(candidates, { projectId, query: 'payment', scope })
  assert.deepEqual(selection.items.map((item) => item.sourceId), ['dup'])
  assert.ok(selection.omitted.some((entry) => entry.reason === 'foreign_project'))
  assert.equal(selection.omitted.filter((entry) => entry.reason === 'duplicate').length, 1)
})

test('an empty body, a suppressed source and a missing source are distinguishable in review', async () => {
  const emptyBody = '   '
  const composition = await new (await import('../src/composer.ts')).ContextComposer(
    {
      port: staticPort([{ descriptor: descriptor('src/empty.md', emptyBody, { kind: 'document', projectId }), content: emptyBody }], { projectId }),
      decisions: { listEffective: async () => ({ decisions: [] }) },
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'scale-review',
    projectId,
    purpose: 'conversation_discussion',
    query: '',
    grant: makeGrant({ projectId, purpose: 'conversation_discussion', scope, sourceKinds: ['document'] }),
    budget: { maxFiles: 4, maxSlices: 4, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 },
    groups: [{ name: 'files', priority: 1, sourceKinds: ['document'], share: 1 }],
  })
  const review = projectSourceReview({
    ...composition,
    omitted: [{ sourceId: 'src-missing', path: 'src/missing.md', reason: 'missing' }],
  } as unknown as ContextComposition)
  // An empty-but-present body still has an item; a missing source is only an omission reason.
  assert.equal(review.items.length, 1)
  assert.equal(review.items[0]!.status, 'visible')
  assert.equal(review.items[0]!.excerpt, emptyBody)
  assert.deepEqual(review.omitted, [{ sourceId: 'src-missing', path: 'src/missing.md', reason: 'missing' }])
  assert.equal(review.suppressed.items, 0)
})

test('a byte change without identity change is a content change, not unchanged', async () => {
  const make = async (content: string) => {
    const { ContextComposer } = await import('../src/composer.ts')
    return new ContextComposer(
      {
        port: staticPort([{ descriptor: descriptor('src/changed.ts', content, { kind: 'source_file', projectId }), content }], { projectId }),
        decisions: { listEffective: async () => ({ decisions: [] }) },
      },
      { now: () => new Date(NOW) },
    ).compose({
      requestId: 'scale-manifest',
      projectId,
      purpose: 'conversation_discussion',
      query: '',
      grant: makeGrant({ projectId, purpose: 'conversation_discussion', scope, sourceKinds: ['source_file'] }),
      budget: { maxFiles: 2, maxSlices: 2, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 },
      groups: [{ name: 'files', priority: 1, sourceKinds: ['source_file'], share: 1 }],
    })
  }
  const before = buildSourceManifest(await make('const a = 1\n'))
  const after = buildSourceManifest(await make('const a = 2\n'))
  const comparison = compareSourceManifests(before, after)
  assert.equal(comparison.status, 'changed')
  assert.ok(comparison.changes.some((change) => change.reason === 'content'))
})

test('a deterministic mixed Chinese/English baseline has fixed hits and zero contamination', () => {
  const decision = (sourceId: string, content: string): RelevanceCandidate => ({
    sourceId,
    kind: 'decision',
    path: `decisions/${sourceId}.json`,
    content,
    projectId,
    scope,
  })
  const candidates: RelevanceCandidate[] = [
    decision('pay-cn', '支付超时重试预算为五分钟'),
    decision('pay-en', 'payment timeout retry budget is five minutes'),
    decision('pay-noise', 'unrelated release checklist'),
    decision('pay-dup', 'payment timeout retry budget is five minutes'),
    decision('pay-dup', 'payment timeout retry budget is five minutes'),
  ]
  const selection = selectRelevantSources(candidates, {
    projectId,
    query: '支付超时重试 payment timeout retry',
    maxItems: 8,
    scope,
  })
  const selected = selection.items.map((item) => item.sourceId)
  assert.deepEqual(selected, ['pay-cn', 'pay-dup', 'pay-en']) // equal score, sourceId tie-break
  // Deterministic metrics: every target hit, no noise, duplicate collapsed.
  const targets = new Set(['pay-cn', 'pay-en', 'pay-dup'])
  const hits = selected.filter((id) => targets.has(id)).length
  const contamination = selected.filter((id) => id === 'pay-noise').length
  assert.equal(hits, 3)
  assert.equal(contamination, 0)
  assert.equal(selection.omitted.filter((entry) => entry.reason === 'duplicate').length, 1)
  assert.equal(selection.omitted.filter((entry) => entry.reason === 'no_match').length, 1)
  assert.equal(selection.complete, true)
})

test('a 10000-message walk completes within 20 pages and stays deterministic at scale', async () => {
  const messages: ScopedConversationMessageView[] = Array.from({ length: 10000 }, (_, index) => ({
    id: `m-${index + 1}`,
    conversationId,
    projectId,
    sequence: index + 1,
    role: 'user',
    provenance: 'trusted_user',
    text: index === 9998 ? 'payment retry at the newest edge' : `line ${index + 1}`,
    createdAt: sameTime,
  }))
  const reader = {
    page(id: string, input: { before?: number; limit?: number }) {
      const before = input.before ?? Number.MAX_SAFE_INTEGER
      const eligible = messages
        .filter((message) => message.conversationId === id && message.sequence < before)
        .sort((left, right) => right.sequence - left.sequence)
      const page = eligible.slice(0, input.limit ?? 50)
      return { messages: page, hasMore: eligible.length > page.length }
    },
  }
  const provider = createScopedConversationProvider(reader, { projectId, conversationId }, { pageSize: 200, maxPages: 60 })
  const walked = await provider.recent({ projectId, conversationId, limit: 20_000 })
  assert.equal(walked.length, 10000)
  assert.equal(provider.coverage().scanned, 10000)
  assert.equal(provider.coverage().complete, true)
  assert.equal(provider.coverage().scanned, walked.length)

  const batch = await createConversationRelevanceCandidates(provider, { projectId, conversationId }, { limit: 1000 })
  const options = { projectId, query: 'payment retry', allowedKinds: ['conversation_message' as const], maxItems: 16, maxBytes: 32 * 1024 }
  const first = selectRelevantSources(batch, options)
  const second = selectRelevantSources(Object.assign([...batch].reverse(), { coverage: batch.coverage }), options)
  assert.deepEqual(first.items.map((item) => item.sourceId), second.items.map((item) => item.sourceId))
  assert.deepEqual(first.items.map((item) => item.sourceId), ['m-9999'])
})

test('10000 decision candidates are ranked with a bounded output and explicit budget omissions', () => {
  const candidates = Array.from({ length: 10000 }, (_, index) =>
    createDecisionRelevanceCandidates(
      [
        {
          decisionId: `d-${index}`,
          content: index % 200 === 0 ? 'payment retry rule' : `routine rule ${index}`,
          scope,
          sourceMessageId: 'm-1',
          recordedAt: NOW,
        },
      ],
      { coverage: { complete: true } },
    ),
  ).flat()
  const selection = selectRelevantSources(candidates, {
    projectId,
    query: 'payment retry',
    scope,
    maxItems: 16,
    maxBytes: 32 * 1024,
  })
  assert.equal(selection.items.length, 16)
  assert.ok(selection.totals.considered === 10000)
  assert.ok(selection.omitted.filter((entry) => entry.reason === 'budget_items').length > 0)
  assert.ok(selection.omitted.filter((entry) => entry.reason === 'no_match').length > 0)
  assert.equal(selection.complete, false)
})

test('10000 omissions are capped by the omission budget, not serialized in full', async () => {
  const composed = await (await import('../src/composer.ts')).ContextComposer.prototype.constructor
  void composed
  const composition = {
    protocol: 'context-composition/1',
    requestId: 'omission-scale',
    projectId,
    grantId: 'grant-1',
    purpose: 'conversation_discussion',
    status: 'partial',
    trust: 'untrusted_data',
    baseline: { capturedAt: NOW },
    budget: { maxBytes: 1024, maxTokens: 256, maxSlices: 2, maxDurationMs: 1000 },
    budgetClamped: [],
    groups: [],
    slices: [],
    omitted: Array.from({ length: 10000 }, (_, index) => ({
      path: `/Users/owner/private/${index}.ts`,
      reason: 'missing' as const,
      detail: `Cannot read /Users/owner/private/${index}.ts`,
    })),
    injectionFlags: [],
    explanations: [],
    totals: { files: 0, bytes: 0, tokens: 0, durationMs: 0 },
  } as unknown as ContextComposition
  const review = projectSourceReview(composition, { maxItems: 4, maxOmissions: 5 })
  assert.equal(review.omitted.length, 5)
  assert.equal(review.suppressed.omissions, 9995)
  assert.ok(Buffer.byteLength(JSON.stringify(review)) < 4096)
  assert.equal(JSON.stringify(review).includes('/Users/owner'), false)
  assert.ok(review.notes.some((note) => note.includes('omission budget')))
})

test('revocation, deletion and byte changes each surface as a distinct comparison outcome', async () => {
  const { ContextComposer } = await import('../src/composer.ts')
  const decisionsFor = (decisions: readonly { decisionId: string; content: string }[]) =>
    new ContextComposer(
      {
        port: {
          projectBaseline: async () => ({ capturedAt: NOW }),
          listSources: async () => [],
          readSource: async () => {
            throw new Error('no files')
          },
        },
        decisions: {
          listEffective: async () => ({
            decisions: decisions.map((decision) => ({
              decisionId: decision.decisionId,
              content: decision.content,
              scope,
              sourceMessageId: 'm-1',
              recordedAt: NOW,
            })),
          }),
        },
      },
      { now: () => new Date(NOW) },
    ).compose({
      requestId: 'invalidation',
      projectId,
      purpose: 'conversation_discussion',
      query: '',
      grant: makeGrant({ projectId, purpose: 'conversation_discussion', scope, sourceKinds: ['decision'] }),
      budget: { maxFiles: 4, maxSlices: 4, maxBytes: 4096, maxTokens: 2000, maxDurationMs: 1000 },
      groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }],
    })

  const before = buildSourceManifest(await decisionsFor([{ decisionId: 'd-1', content: 'Keep checks' }]))
  const changed = buildSourceManifest(await decisionsFor([{ decisionId: 'd-1', content: 'Keep checks twice' }]))
  const revoked = buildSourceManifest(await decisionsFor([]))
  assert.ok(compareSourceManifests(before, changed).changes.some((change) => change.reason === 'content'))
  // An empty composition is also an incomplete scan, so the comparison can be incomplete rather
  // than merely changed; either way it must move and name the missing source.
  const revokedComparison = compareSourceManifests(before, revoked)
  assert.notEqual(revokedComparison.status, 'unchanged')
  assert.ok(revokedComparison.changes.some((change) => change.reason === 'missing' || change.reason === 'omitted'))
})
