import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContextPreviewInputSchema, ContextPreviewSchema } from '../src/context-preview.ts'

test('context preview cannot accept caller authority or claim unselected sources and excess budget', () => {
  const input = { projectId: 'project', conversationId: 'original', selections: ['conversation'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } }
  assert.equal(ContextPreviewInputSchema.safeParse(input).success, true)
  for (const extra of [{ actor: { userId: 'someone' } }, { grant: {} }, { providers: ['files'] }])
    assert.equal(ContextPreviewInputSchema.safeParse({ ...input, ...extra }).success, false)
  assert.equal(ContextPreviewInputSchema.safeParse({ ...input, selections: ['artifacts'] }).success, false)
  const source = { sourceId: 'source', kind: 'conversation_message', title: 'Message', path: 'conversation/message.json', content: 'text',
    sourceDigest: 'a'.repeat(64), previewDigest: 'a'.repeat(64), bytes: 4, estimatedTokens: 1, truncated: false }
  const preview = { protocol: 'context-preview/1', requestId: 'request', projectId: 'project', conversationId: 'original',
    observedAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z', status: 'sufficient', trust: 'untrusted_data',
    selections: ['conversation'], sources: [source], groups: [], omitted: [], injectionFlags: [], issues: [], budgetClamped: [],
    budget: input.budget, totals: { files: 1, bytes: 4, tokens: 1 } }
  assert.equal(ContextPreviewSchema.safeParse(preview).success, true)
  assert.equal(ContextPreviewSchema.safeParse({ ...preview, sources: [{ ...source, kind: 'decision' }] }).success, false)
  assert.equal(ContextPreviewSchema.safeParse({ ...preview, totals: { files: 1, bytes: 1, tokens: 1 } }).success, false)
  assert.equal(ContextPreviewSchema.safeParse({ ...preview, budget: { ...input.budget, maxBytes: 3 } }).success, false)
  assert.equal(ContextPreviewSchema.safeParse({ ...preview, expiresAt: preview.observedAt }).success, false)
})
