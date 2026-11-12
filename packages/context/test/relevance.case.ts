import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  createConversationRelevanceCandidates,
  createDecisionRelevanceCandidates,
  createReadIndexWorkCandidates,
  createScopedConversationProvider,
  selectRelevantSources,
  sha256Text,
} from '../src/index.ts'
import type { RelevanceCandidate, WorkspaceReadIndex } from '../src/index.ts'
import type { ScopedConversationMessageView, ScopedConversationPage } from '../src/index.ts'
import { COMMIT, NOW } from './helpers.ts'

const projectId = 'project-1'
const conversationId = 'conversation-1'
const scope: Scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }

const at = (sequence: number) => `2026-11-10T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`

function dataset(): ScopedConversationMessageView[] {
  const messages: ScopedConversationMessageView[] = []
  const special: Record<number, string> = {
    100: 'payment timeout retry policy discussion',
    250: 'payment timeout handling during retries',
    380: 'retry payment timeout budget decision',
  }
  for (let sequence = 1; sequence <= 400; sequence += 1) {
    messages.push({
      id: `m-${sequence}`,
      conversationId,
      projectId,
      sequence,
      role: sequence % 2 === 0 ? 'user' : 'assistant',
      provenance: sequence % 2 === 0 ? 'trusted_user' : 'reasoner_reply',
      text: special[sequence] ?? `routine status update ${sequence}`,
      createdAt: at(sequence),
    })
  }
  // High-relevance material that must never be retrievable as shared knowledge.
  messages.push({
    id: 'auth-display',
    conversationId,
    projectId,
    sequence: 401,
    role: 'user',
    provenance: 'question_answer_display',
    text: 'payment timeout retry authentication answer',
    createdAt: at(1),
    anchor: { questionId: 'q-auth' },
  })
  messages.push({
    id: 'foreign-message',
    conversationId,
    projectId: 'project-2',
    sequence: 402,
    role: 'user',
    provenance: 'trusted_user',
    text: 'payment timeout retry for another project',
    createdAt: at(2),
  })
  messages.push({
    id: 'system-notice',
    conversationId,
    projectId,
    sequence: 403,
    role: 'system',
    provenance: 'trusted_user',
    text: 'payment timeout retry system notice',
    createdAt: at(3),
  })
  return messages
}

function reader(messages: readonly ScopedConversationMessageView[]) {
  const pages: number[] = []
  return {
    pages,
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
}

interface WorkFixture {
  readonly id: string
  readonly title: string
  readonly goal?: string
  readonly contractState?: 'current' | 'missing' | 'stale'
}

function workIndex(works: readonly WorkFixture[]): { index: WorkspaceReadIndex; listCalls: () => number } {
  let listCalls = 0
  const byId = new Map(works.map((work) => [work.id, work]))
  const record = (work: WorkFixture) => ({
    id: work.id,
    projectId,
    conversationId,
    title: work.title,
    createdAt: NOW,
  })
  const entry = (work: WorkFixture) => ({
    work: record(work),
    authority: { workId: work.id, revision: 1, digest: 'a'.repeat(64) },
    authorityState: 'current',
    ...(work.goal === undefined
      ? {}
      : {
          contract: {
            workId: work.id,
            revision: 1,
            digest: 'b'.repeat(64),
            goal: work.goal,
            scope,
            criteria: [],
            authorityRef: 'authority-1',
            createdAt: NOW,
          },
        }),
    contractState: work.contractState ?? (work.goal === undefined ? 'missing' : 'current'),
    verificationIds: [],
    acceptanceIds: [],
    deliverables: [],
    project: { id: projectId, state: 'current' },
  })
  const index = {
    project: (id: string) => ({
      current: id === projectId ? { projectId, revision: 1, digest: 'c'.repeat(64), createdAt: NOW, settings: {} } : undefined,
      history: [],
      state: id === projectId ? 'current' : 'missing',
    }),
    listWorks: (input: { projectIds: readonly string[]; limit?: number }) => {
      listCalls += 1
      const cap = input.limit ?? 64
      const listed = works.filter(() => input.projectIds.includes(projectId)).slice(0, cap).map(record)
      return { works: listed, hasMore: listed.length < works.length }
    },
    work: (workId: string) => {
      const work = byId.get(workId)
      return work === undefined ? undefined : entry(work)
    },
  }
  return { index: index as unknown as WorkspaceReadIndex, listCalls: () => listCalls }
}

function worksFixture(): WorkFixture[] {
  const works: WorkFixture[] = []
  for (let index = 0; index < 60; index += 1) works.push({ id: `w-${index}`, title: `Routine task ${index}` })
  works.push({ id: 'w-pay-1', title: 'Payment retry', goal: 'Handle payment timeout retry with backoff' })
  works.push({ id: 'w-pay-2', title: 'Payment retry budget', goal: 'Cap payment retry timeout budget' })
  works.push({ id: 'w-stale', title: 'Payment retry legacy', goal: 'Old payment retry timeout rule', contractState: 'stale' })
  return works
}

async function candidates() {
  const conversationReader = reader(dataset())
  const provider = createScopedConversationProvider(conversationReader, { projectId, conversationId }, { pageSize: 100, maxPages: 4 })
  const conversation = await createConversationRelevanceCandidates(provider, { projectId, conversationId }, { limit: 500 })
  const decisions = createDecisionRelevanceCandidates(
    [
      { decisionId: 'decision-pay-1', content: 'Payment retry timeout is five minutes.', scope, sourceMessageId: 'm-1', recordedAt: NOW },
      { decisionId: 'decision-pay-old', content: 'Payment timeout retry used to be one minute.', scope, sourceMessageId: 'm-2', recordedAt: NOW },
      {
        decisionId: 'decision-foreign',
        content: 'Payment timeout retry for another project',
        scope: { ...scope, projectId: 'project-2' },
        sourceMessageId: 'm-3',
        recordedAt: NOW,
      },
    ],
    { supersededIds: ['decision-pay-old'] },
  )
  const { index, listCalls } = workIndex(worksFixture())
  const works = createReadIndexWorkCandidates(index, projectId, { limit: 64 })
  return { conversation, decisions, works, conversationReader, provider, listCalls }
}

test('retrieval finds expected sources in a long conversation and many works without mixing in forbidden data', async () => {
  const { conversation, decisions, works, conversationReader, provider, listCalls } = await candidates()
  const all: RelevanceCandidate[] = [...conversation, ...decisions, ...works]
  const selection = selectRelevantSources(all, {
    projectId,
    query: 'payment timeout retry',
    maxItems: 12,
    maxBytes: 32 * 1024,
  })

  const selected = selection.items.map((item) => item.sourceId)
  const expected = ['m-100', 'm-250', 'm-380', 'decision-pay-1', 'work-w-pay-1', 'contract-w-pay-1', 'work-w-pay-2', 'contract-w-pay-2']
  for (const id of expected) assert.ok(selected.includes(id), `expected ${id} in ${selected.join(',')}`)

  const forbidden = ['auth-display', 'foreign-message', 'system-notice', 'decision-pay-old', 'decision-foreign', 'contract-w-stale']
  for (const id of forbidden) assert.equal(selected.includes(id), false, `${id} must not be selected`)

  // The scoped adapter refuses anchors/foreign/system material before any candidate exists...
  const excluded = provider.coverage().excluded
  assert.equal(excluded.questionAnchor, 1)
  assert.equal(excluded.foreignProject, 1)
  assert.equal(excluded.systemRole, 1)
  assert.equal(conversation.some((candidate) => candidate.sourceId === 'auth-display'), false)
  assert.equal(conversation.some((candidate) => candidate.sourceId === 'foreign-message'), false)
  assert.equal(conversation.some((candidate) => candidate.sourceId === 'system-notice'), false)
  // ...and the selector refuses superseded/foreign records that do reach it.
  assert.ok(selection.omitted.some((entry) => entry.reason === 'superseded' && entry.sourceId === 'decision-pay-old'))
  assert.ok(selection.omitted.some((entry) => entry.reason === 'foreign_project' && entry.sourceId === 'decision-foreign'))
  // The stale contract produced no candidate at all; only its work record exists.
  assert.equal(works.some((candidate) => candidate.sourceId === 'contract-w-stale'), false)

  // Bounded operations: four pages of the long conversation, one indexed work listing. The walk did
  // not exhaust 403 messages, so coverage is honestly incomplete rather than claimed complete.
  assert.equal(conversationReader.pages.length, 4)
  assert.equal(provider.coverage().scanned, 400)
  assert.equal(provider.coverage().complete, false)
  assert.equal(listCalls(), 1)
  assert.equal(selection.complete, true)

  // The selector returns metadata only: source text never leaves through this surface.
  for (const item of selection.items) assert.equal(Object.hasOwn(item, 'content'), false)
  const decisionItem = selection.items.find((item) => item.sourceId === 'decision-pay-1')
  assert.equal(decisionItem?.contentDigest, sha256Text('Payment retry timeout is five minutes.'))
})

test('the same candidates in any input order produce the identical ordered selection', async () => {
  const { conversation, decisions, works } = await candidates()
  const forward = [...conversation, ...decisions, ...works]
  const backward = [...works].reverse().concat([...decisions].reverse(), [...conversation].reverse())
  const options = { projectId, query: 'payment retry timeout', maxItems: 10, maxBytes: 32 * 1024 }
  const first = selectRelevantSources(forward, options)
  const second = selectRelevantSources(backward, options)
  assert.deepEqual(
    first.items.map((item) => item.sourceId),
    second.items.map((item) => item.sourceId),
  )
  assert.deepEqual(first.items.map((item) => item.score), second.items.map((item) => item.score))
})

test('budgets end the selection explicitly and never present a truncated ranking as complete', async () => {
  const { conversation } = await candidates()
  const items = selectRelevantSources(conversation, { projectId, query: 'payment retry timeout', maxItems: 1 })
  assert.equal(items.items.length, 1)
  assert.ok(items.omitted.some((entry) => entry.reason === 'budget_items'))
  assert.equal(items.complete, false)

  const bytes = selectRelevantSources(conversation, { projectId, query: 'payment retry timeout', maxItems: 10, maxBytes: 1 })
  assert.equal(bytes.items.length, 0)
  assert.ok(bytes.omitted.some((entry) => entry.reason === 'budget_bytes'))
  assert.equal(bytes.complete, false)
})

test('a granted-kind restriction is applied before ranking, and invalid budgets are refused', () => {
  const candidates: RelevanceCandidate[] = [
    { sourceId: 'decision-a', kind: 'decision', path: 'decisions/a.json', content: 'payment retry', projectId },
    { sourceId: 'message-a', kind: 'conversation_message', path: 'conversation/a.json', content: 'payment retry', projectId },
  ]
  const restricted = selectRelevantSources(candidates, { projectId, query: 'payment', allowedKinds: ['decision'] })
  assert.deepEqual(restricted.items.map((item) => item.sourceId), ['decision-a'])
  assert.deepEqual(restricted.omitted, [{ sourceId: 'message-a', path: 'conversation/a.json', reason: 'denied_kind' }])

  const unqueried = selectRelevantSources(candidates, { projectId })
  assert.equal(unqueried.items.length, 2)
  assert.deepEqual(unqueried.terms, [])

  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(() => selectRelevantSources(candidates, { projectId, maxItems: invalid }), TypeError)
  }
})
