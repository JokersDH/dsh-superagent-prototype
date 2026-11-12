import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AssistantContextBindingSchema, AssistantReplyResultSchema } from '@personal-agent/contracts'
import type { ContractRef } from '@personal-agent/contracts'
import { collectContextHistory } from '../src/index.ts'

const projectId = 'project-1'
const conversationId = 'conversation-1'
const confirmedAt = '2026-11-12T00:00:00.000Z'
const expiresAt = '2026-11-12T00:04:00.000Z'
const digest = (char: string) => char.repeat(64)
const contract: ContractRef = { workId: 'work-1', revision: 2, digest: digest('e') }
const otherContract: ContractRef = { workId: 'work-1', revision: 3, digest: digest('f') }
const scope = { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] }

function binding(index: number, overrides: Record<string, unknown> = {}) {
  return AssistantContextBindingSchema.parse({
    protocol: 'assistant-context-binding/1',
    commandId: `cmd-${index}`,
    messageId: `msg-${index}`,
    requestId: `req-${index}`,
    projectId,
    conversationId,
    userTextDigest: digest('a'),
    principal: { userId: 'user-1', authorityRef: 'authority-1' },
    purpose: 'conversation_discussion',
    scope,
    selections: ['decisions'],
    bundleRef: `bundle-${index}`,
    bundleDigest: digest('b'),
    sources: [
      { sourceId: `decision-${index}`, kind: 'decision', sourceDigest: digest('c'), previewDigest: digest('d'), truncated: false },
    ],
    confirmedAt,
    expiresAt,
    ...overrides,
  })
}

function pagedHistory(bindings: readonly ReturnType<typeof binding>[], pageSize = 100) {
  let calls = 0
  return {
    calls: () => calls,
    page(query: { cursor?: string | undefined }) {
      calls += 1
      const offset = query.cursor === undefined ? 0 : Number(query.cursor.slice(2))
      const slice = bindings.slice(offset, offset + pageSize)
      const next = offset + slice.length
      const hasMore = next < bindings.length
      return {
        protocol: 'assistant-context-history/1' as const,
        observedAt: '2026-11-12T00:01:00.000Z',
        records: slice,
        hasMore,
        ...(hasMore ? { nextCursor: `c-${next}` } : {}),
      }
    },
  }
}

const now = () => new Date('2026-11-12T00:01:00.000Z')
const query = { projectIds: [projectId], conversationId }

test('a long history is read within a page budget and reports the exact continuation', () => {
  const bindings = Array.from({ length: 250 }, (_, index) => binding(index))
  const history = pagedHistory(bindings)

  const full = collectContextHistory(history, query, { now })
  assert.equal(full.pages, 3)
  assert.equal(full.entries.length, 250)
  assert.equal(full.complete, true)
  assert.equal(full.hasMore, false)
  assert.equal(full.nextCursor, undefined)
  assert.equal(new Set(full.entries.map((entry) => entry.messageId)).size, 250)

  const bounded = collectContextHistory(history, query, { now, maxPages: 1 })
  assert.equal(bounded.pages, 1)
  assert.equal(bounded.entries.length, 100)
  assert.equal(bounded.hasMore, true)
  assert.equal(bounded.complete, false)
  assert.equal(bounded.nextCursor, 'c-100')
})

test('expiry, contract, work and scope drift are described as data, never as authorization', () => {
  const history = pagedHistory([
    binding(1),
    binding(2, { expiresAt: '2026-11-12T00:00:30.000Z' }),
    binding(3, { contract, selections: ['work', 'decisions'] }),
    binding(4, { contract: otherContract, selections: ['work', 'decisions'] }),
  ])
  // Without a current contract/work selection, only expiry is derivable from recorded data.
  const plain = collectContextHistory(history, { projectIds: [projectId] }, { now })
  const plainStates = Object.fromEntries(plain.entries.map((entry) => [entry.messageId, entry.state]))
  assert.equal(plainStates['msg-1'], 'current_window')
  assert.equal(plainStates['msg-2'], 'expired')
  assert.equal(plainStates['msg-3'], 'current_window')
  assert.equal(plainStates['msg-4'], 'current_window')

  // With the current work/contract selected, a missing or different historical contract is drift.
  const view = collectContextHistory(history, { projectIds: [projectId] }, { now, workId: 'work-1', contract })
  const states = Object.fromEntries(view.entries.map((entry) => [entry.messageId, entry.state]))
  assert.equal(states['msg-3'], 'current_window') // the recorded contract matches the current one
  assert.equal(states['msg-4'], 'contract_changed') // contract revision 3 is not the current revision 2
  for (const entry of view.entries) {
    assert.equal(entry.requiresExplicitReauthorization, true)
    assert.equal(entry.trust, 'untrusted_data')
  }
  assert.equal(view.authorization, 'none')
  assert.equal(view.untrusted, true)

  const otherWork = collectContextHistory(history, { projectIds: [projectId] }, { now, workId: 'work-9' })
  assert.equal(otherWork.entries.find((entry) => entry.messageId === 'msg-3')?.state, 'other_work')

  const scopeDrift = collectContextHistory(history, { projectIds: [projectId] }, {
    now,
    scope: { ...scope, allowedPaths: ['src', 'docs'] },
  })
  assert.ok(scopeDrift.entries.every((entry) => entry.state === 'scope_changed'))
})

test('foreign, other-conversation and duplicated bindings are omitted with reasons', () => {
  const history = pagedHistory([
    binding(1),
    // A misbehaving port can return another project's valid binding; it must be omitted, not mixed.
    binding(2, { projectId: 'project-2', scope: { ...scope, projectId: 'project-2' } }),
    binding(3, { conversationId: 'conversation-2' }),
    binding(1),
  ])
  const view = collectContextHistory(history, query, { now })
  assert.deepEqual(view.entries.map((entry) => entry.messageId), ['msg-1'])
  assert.ok(view.omitted.some((entry) => entry.reason === 'foreign_project' && entry.messageId === 'msg-2'))
  assert.ok(view.omitted.some((entry) => entry.reason === 'other_conversation' && entry.messageId === 'msg-3'))
  assert.ok(view.omitted.some((entry) => entry.reason === 'duplicate' && entry.messageId === 'msg-1'))
})

test('a completed reply is attached as recorded data; a request receipt alone stays unknown', () => {
  const reply = AssistantReplyResultSchema.parse({
    protocol: 'assistant-reply-result/1',
    requestId: 'req-2',
    requestDigest: digest('a'),
    sourceMessageId: 'msg-2',
    replyMessageId: 'reply-2',
    projectId,
    conversationId,
    principal: { userId: 'user-1', authorityRef: 'authority-1' },
    model: 'test-model',
    artifactRef: 'artifact-2',
    artifactDigest: digest('b'),
    textDigest: digest('c'),
    recordedAt: confirmedAt,
  })
  let lookups = 0
  const history = pagedHistory([binding(1), binding(2)])
  const view = collectContextHistory(history, query, {
    now,
    replyReader(messageId: string) {
      lookups += 1
      return messageId === 'msg-2' ? { result: reply, verifiedBy: 'main-completed-reply' } : undefined
    },
  })
  assert.equal(lookups, 2)
  assert.equal(view.totals.completedReplies, 1)
  assert.equal(view.totals.unknownReplies, 1)
  const first = view.entries.find((entry) => entry.messageId === 'msg-1')!
  const second = view.entries.find((entry) => entry.messageId === 'msg-2')!
  assert.equal(first.replyUnknown, true)
  assert.equal(first.completedReply, undefined)
  assert.equal(second.replyUnknown, false)
  assert.equal(second.completedReply?.replyMessageId, 'reply-2')
  assert.equal(second.completedReply?.artifactRef, 'artifact-2')
  // No reply body or model text is projected: only recorded digest/artifact references.
  assert.equal(Object.hasOwn(second.completedReply ?? {}, 'text'), false)
})

test("main's reply lookup attaches only matching results; a foreign result is counted, not shown", () => {
  const bindingRow = binding(1)
  const matched = AssistantReplyResultSchema.parse({
    protocol: 'assistant-reply-result/1',
    requestId: 'req-1',
    requestDigest: digest('a'),
    sourceMessageId: 'msg-1',
    replyMessageId: 'reply-1',
    projectId,
    conversationId,
    principal: { userId: 'user-1', authorityRef: 'authority-1' },
    model: 'test-model',
    artifactRef: 'artifact-1',
    artifactDigest: digest('b'),
    textDigest: digest('c'),
    recordedAt: confirmedAt,
  })
  const foreignConversation = { ...matched, conversationId: 'other-conversation' }
  const foreignPrincipal = { ...matched, principal: { userId: 'foreign-user', authorityRef: 'foreign-authority' } }
  const history = pagedHistory([bindingRow])
  const trusted = (result: typeof matched) => () => ({ result, verifiedBy: 'main-completed-reply' as const })

  const attached = collectContextHistory(history, query, { now, replyReader: trusted(matched) })
  assert.equal(attached.entries[0]!.replyUnknown, false)
  assert.equal(attached.totals.mismatchedReplies, 0)

  for (const result of [foreignConversation, foreignPrincipal]) {
    const refused = collectContextHistory(history, query, { now, replyReader: trusted(result) })
    assert.equal(refused.entries[0]!.completedReply, undefined)
    assert.equal(refused.entries[0]!.replyUnknown, true)
    assert.equal(refused.totals.mismatchedReplies, 1)
  }

  // A raw row is not a verified reply: only a reader that marks main's verification may attach.
  const rawRow = collectContextHistory(history, query, {
    now,
    replyReader: () => ({ result: matched, verifiedBy: 'raw-row' as never }),
  })
  assert.equal(rawRow.entries[0]!.completedReply, undefined)
  assert.equal(rawRow.entries[0]!.replyUnknown, true)
  assert.equal(rawRow.totals.mismatchedReplies, 0)
})

test('a non-advancing history cursor stops the walk instead of looping or duplicating pages', () => {
  let calls = 0
  const stuck = {
    page() {
      calls += 1
      return {
        protocol: 'assistant-context-history/1' as const,
        observedAt: '2026-11-12T00:01:00.000Z',
        records: [binding(calls)],
        hasMore: true,
        nextCursor: 'c-stuck',
      }
    },
  }
  const view = collectContextHistory(stuck, query, { now, maxPages: 5 })
  assert.equal(calls, 2)
  assert.equal(view.pages, 2)
  assert.equal(view.complete, false)
  assert.equal(view.entries.length, 2)
})

test('the history query is validated before any page is read', () => {
  const history = pagedHistory([binding(1)])
  assert.throws(() => collectContextHistory(history, { projectIds: [] }, { now }))
  assert.throws(() => collectContextHistory(history, { projectIds: [projectId], limit: 101 }, { now }))
  assert.equal(history.calls(), 0)
})
