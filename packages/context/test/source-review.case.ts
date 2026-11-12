import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  ContextComposer,
  projectSourceReview,
  sha256Text,
  SOURCE_REVIEW_CEILINGS,
} from '../src/index.ts'
import type { ContextComposition } from '../src/index.ts'
import { COMMIT, NOW, descriptor, makeGrant, staticPort } from './helpers.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src', 'docs'], excludedPaths: [], externalActions: [] }
const decision = (id: string, content: string) => ({
  decisionId: id,
  content,
  scope,
  sourceMessageId: 'msg-1',
  recordedAt: NOW,
})

async function composition(): Promise<ContextComposition> {
  return new ContextComposer(
    {
      port: staticPort([
        {
          descriptor: descriptor('src/parser.ts', 'export const parse = () => 1\n', { kind: 'source_file' }),
          content: 'export const parse = () => 1\n',
        },
      ]),
      decisions: { listEffective: async () => ({ decisions: [decision('d-1', 'Keep response codes stable.')] }) },
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'review',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: 'parser',
    grant: makeGrant({
      purpose: 'conversation_discussion',
      scope,
      sourceKinds: ['decision', 'source_file'],
      maxFiles: 4,
      maxBytes: 16 * 1024,
      maxTokens: 8000,
      maxDurationMs: 1000,
    }),
    budget: { maxFiles: 4, maxSlices: 4, maxBytes: 16 * 1024, maxTokens: 8000, maxDurationMs: 1000 },
    groups: [
      { name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 0.5 },
      { name: 'files', priority: 2, sourceKinds: ['source_file'], share: 0.5 },
    ],
  })
}

test('review items carry recognizable titles, categories and stable citations from trusted records', async () => {
  const composed = await composition()
  const review = projectSourceReview(composed)
  assert.equal(review.protocol, 'context-source-review/1')
  assert.equal(review.untrusted, true)
  assert.equal(review.items.length, composed.slices.length)

  const file = review.items.find((item) => item.kind === 'source_file')!
  assert.equal(file.category, 'file')
  assert.equal(file.title, 'parser.ts')
  assert.equal(file.citation, `source_file:src/parser.ts@${COMMIT.slice(0, 8)}`)
  assert.equal(file.visiblePreviewDigest, sha256Text(composed.slices.find((slice) => slice.kind === 'source_file')!.content))
  assert.equal(file.excerptDigest, sha256Text(file.excerpt))

  const decisionItem = review.items.find((item) => item.kind === 'decision')!
  assert.equal(decisionItem.category, 'decision')
  assert.ok(decisionItem.citation.startsWith('decision:decisions/'))
  assert.ok(decisionItem.excerpt.includes('Keep response codes stable.'))

  // No host path, actor, tool, permission or command field leaks into the review data.
  for (const item of review.items) {
    assert.equal(Object.hasOwn(item, 'actor'), false)
    assert.equal(Object.hasOwn(item, 'tool'), false)
    assert.equal(Object.hasOwn(item, 'permissions'), false)
    assert.equal(Object.hasOwn(item, 'command'), false)
    assert.equal(item.citation.includes(process.cwd()), false)
  }
})

test('excerpts are bounded per item and globally, and nothing is silently dropped', async () => {
  const composed = await composition()
  const review = projectSourceReview(composed, { maxItems: 1, maxBytes: 32 * 1024, maxExcerptBytes: 8 })
  assert.equal(review.totals.items, composed.slices.length)
  const first = review.items[0]!
  assert.equal(first.status, 'excerpt_budget')
  assert.ok(first.excerptBytes <= 8)
  // Items beyond maxItems are still listed with a reason instead of disappearing.
  assert.ok(review.items.slice(1).every((item) => item.status === 'excerpt_budget' && item.excerpt === ''))
  assert.equal(review.truncated, true)
})

test('a CJK excerpt cut on a byte boundary never yields a replacement character', async () => {
  const text = '中文内容'.repeat(200)
  const composed = await new ContextComposer(
    {
      port: staticPort([{ descriptor: descriptor('docs/notes.md', text, { kind: 'document' }), content: text }]),
      decisions: { listEffective: async () => ({ decisions: [] }) },
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'review-cjk',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: '',
    grant: makeGrant({ purpose: 'conversation_discussion', scope, sourceKinds: ['document'] }),
    budget: { maxFiles: 2, maxSlices: 2, maxBytes: 16 * 1024, maxTokens: 8000, maxDurationMs: 1000 },
    groups: [{ name: 'files', priority: 1, sourceKinds: ['document'], share: 1 }],
  })
  for (const bytes of [1, 2, 3, 4, 5, 7]) {
    const review = projectSourceReview(composed, { maxExcerptBytes: bytes })
    assert.equal(review.items[0]!.excerpt.includes('\uFFFD'), false)
    assert.ok(review.items[0]!.excerptBytes <= bytes)
  }
})

test('non-project-relative paths and recorded omissions are reported without inventing citations', () => {
  const composed = {
    protocol: 'context-composition/1',
    requestId: 'synthetic',
    projectId: 'project-1',
    grantId: 'grant-1',
    purpose: 'conversation_discussion',
    status: 'included',
    trust: 'untrusted_data',
    baseline: { capturedAt: NOW },
    budget: { maxBytes: 1024, maxTokens: 256, maxSlices: 2, maxDurationMs: 1000 },
    budgetClamped: [],
    groups: [],
    slices: [
      {
        sourceId: 'src-absolute',
        kind: 'source_file',
        path: '/Users/someone/secret.ts',
        content: 'do not show host paths',
        range: { start: 0, end: 24 },
        truncated: false,
        bytes: 24,
        tokens: 6,
        relevance: 1,
        trust: 'untrusted_data',
        baseline: { contentDigest: sha256Text('do not show host paths'), digestScope: 'content', capturedAt: NOW },
      },
    ],
    omitted: [
      { sourceId: 'src-missing', path: 'docs/missing.md', reason: 'missing' },
      { path: 'src/stale.ts', reason: 'stale', detail: 'baseline changed' },
    ],
    injectionFlags: [],
    explanations: [],
    totals: { files: 1, bytes: 24, tokens: 6, durationMs: 1 },
  } as unknown as ContextComposition
  const review = projectSourceReview(composed)
  const item = review.items[0]!
  assert.equal(item.citation.includes('/Users'), false)
  assert.equal(item.citation, 'source_file:redacted/src-absolute')
  assert.ok(review.notes.some((note) => note.includes('project-relative')))
  assert.deepEqual(review.omitted.map((entry) => entry.reason), ['missing', 'stale'])
  assert.equal(review.omitted[0]!.sourceId, 'src-missing')
  assert.equal(review.totals.omitted, 2)
})

test('review budgets are clamped to ceilings and invalid values are refused', async () => {
  const composed = await composition()
  const clamped = projectSourceReview(composed, { maxItems: 10_000, maxBytes: 10_000_000, maxExcerptBytes: 10_000_000 })
  assert.deepEqual(clamped.budget, SOURCE_REVIEW_CEILINGS)
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(() => projectSourceReview(composed, { maxItems: invalid }), TypeError)
  }
})
