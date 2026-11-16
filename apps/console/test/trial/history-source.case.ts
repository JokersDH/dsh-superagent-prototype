import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ContextHistory, ContextSources } from '@personal-agent/contracts'
import {
  trialHistoryAdmission, trialHistoryMerge, trialSourceExcerpt, trialSourceStateLabel, trialSourcesAdmission,
} from '../../src/trial/history-source.ts'

const entry = (id: string, over: { projectId?: string; conversationId?: string } = {}) => ({
  messageId: id, projectId: over.projectId ?? 'project-atlas', conversationId: over.conversationId ?? 'conv-alpha',
  confirmedAt: '2026-11-16T00:00:00.000Z', expiresAt: '2026-11-16T00:05:00.000Z',
  selections: ['work'] as const, sourceCount: 1, message: { state: 'available' as const, text: `message ${id}`, truncated: false },
})
const history = (over: Partial<ContextHistory> = {}): ContextHistory => ({
  protocol: 'context-history/1', projectId: 'project-atlas', conversationId: 'conv-alpha',
  observedAt: '2026-11-16T00:10:00.000Z', entries: [entry('msg-1'), entry('msg-2')], hasMore: false, ...over,
} as ContextHistory)
const page = (value: ContextHistory) => {
  const admitted = trialHistoryAdmission(value, { projectId: 'project-atlas', conversationId: 'conv-alpha' })
  assert.equal(admitted.ok, true)
  return admitted.ok ? admitted.page : undefined
}

test('a valid page is admitted with its live continuation state', () => {
  const current = history({ hasMore: true, nextCursor: 'cursor-1' })
  const admitted = trialHistoryAdmission(current, { projectId: 'project-atlas', conversationId: 'conv-alpha' })
  assert.equal(admitted.ok, true)
  if (admitted.ok) {
    assert.equal(admitted.page.entries.length, 2)
    assert.equal(admitted.page.hasMore, true)
    assert.equal(admitted.page.nextCursor, 'cursor-1')
  }
})

test('a foreign project or conversation page is refused', () => {
  assert.equal(trialHistoryAdmission(history({ projectId: 'project-beta' }), { projectId: 'project-atlas' }).ok, false)
  const foreign = trialHistoryAdmission(history({ projectId: 'project-beta' }), { projectId: 'project-atlas' })
  assert.equal(!foreign.ok && foreign.reason, 'foreign_project')
  const conversation = trialHistoryAdmission(history({ conversationId: 'conv-beta' }), { conversationId: 'conv-alpha' })
  assert.equal(!conversation.ok && conversation.reason, 'foreign_conversation')
})

test('an entry outside the page scope is refused', () => {
  const mixed = history({ entries: [entry('msg-1'), entry('msg-2', { projectId: 'project-beta' })] })
  const admitted = trialHistoryAdmission(mixed, { projectId: 'project-atlas' })
  assert.equal(!admitted.ok && admitted.reason, 'foreign_project')
})

test('duplicate IDs or an inconsistent continuation are refused', () => {
  const duplicate = history({ entries: [entry('msg-1'), entry('msg-1')] })
  assert.equal(trialHistoryAdmission(duplicate).ok, false)
  const missingCursor = history({ hasMore: true })
  assert.equal(trialHistoryAdmission(missingCursor).ok, false)
  const extraCursor = history({ hasMore: false, nextCursor: 'cursor-1' })
  assert.equal(trialHistoryAdmission(extraCursor).ok, false)
})

test('more than one public page is refused rather than silently truncated', () => {
  const oversized = history({ entries: Array.from({ length: 51 }, (_, index) => entry(`msg-${index}`)) })
  const admitted = trialHistoryAdmission(oversized)
  assert.equal(!admitted.ok && admitted.reason, 'page_limit')
})

test('continuation merges new rows and refuses overlap or overflow', () => {
  const first = page(history({ hasMore: true, nextCursor: 'cursor-1' }))
  assert.ok(first)
  const next = history({ entries: [entry('msg-3')] })
  const merged = first ? trialHistoryMerge(first, next, { projectId: 'project-atlas' }) : undefined
  assert.equal(merged?.ok, true)
  if (merged?.ok) assert.deepEqual(merged.page.entries.map(item => item.messageId), ['msg-1', 'msg-2', 'msg-3'])
  const overlap = first ? trialHistoryMerge(first, history({ entries: [entry('msg-2')] }), { projectId: 'project-atlas' }) : undefined
  assert.equal(overlap?.ok, false)
  if (overlap && !overlap.ok) assert.equal(overlap.reason, 'duplicate_entry')
})

test('source records must bind the selected message, project and conversation', () => {
  const sources = {
    state: 'verified',
    binding: { messageId: 'msg-1', projectId: 'project-atlas', conversationId: 'conv-alpha', sources: [{ sourceId: 'source-1' }] },
    sources: [{ sourceId: 'source-1', content: 'body' }], omitted: [], injectionFlags: [], scopeReview: undefined,
  } as unknown as ContextSources
  assert.equal(trialSourcesAdmission(sources, { messageId: 'msg-1', projectId: 'project-atlas', conversationId: 'conv-alpha' }).ok, true)
  const foreign = trialSourcesAdmission(sources, { messageId: 'msg-2', projectId: 'project-atlas', conversationId: 'conv-alpha' })
  assert.equal(!foreign.ok && foreign.reason, 'foreign_message')
  const project = trialSourcesAdmission(sources, { messageId: 'msg-1', projectId: 'project-beta', conversationId: 'conv-alpha' })
  assert.equal(!project.ok && project.reason, 'foreign_project')
})

test('a rewritten verified source binding is refused', () => {
  const sources = {
    state: 'verified',
    binding: { messageId: 'msg-1', projectId: 'project-atlas', conversationId: 'conv-alpha', sources: [{ sourceId: 'source-1' }] },
    sources: [{ sourceId: 'source-2', content: 'body' }], omitted: [], injectionFlags: [], scopeReview: undefined,
  } as unknown as ContextSources
  const admitted = trialSourcesAdmission(sources, { messageId: 'msg-1', projectId: 'project-atlas', conversationId: 'conv-alpha' })
  assert.equal(!admitted.ok && admitted.reason, 'unbound_source')
})

test('missing and scope-changed states stay explicit', () => {
  assert.equal(trialSourceStateLabel.missing, '冻结原文文件缺失')
  assert.equal(trialSourceStateLabel.scope_changed, '当前只读选择与冻结时不同')
})

test('the body excerpt is bounded and marks its own truncation', () => {
  assert.deepEqual(trialSourceExcerpt('short'), { text: 'short', truncated: false })
  const long = trialSourceExcerpt('x'.repeat(1300), 1200)
  assert.equal(long.truncated, true)
  assert.equal(long.text.length, 1201)
})
