import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  ContextComposer,
  buildSourceManifest,
  compareSourceManifests,
  sha256Text,
  type ComposedSourceManifest,
} from '../src/index.ts'
import { NOW, descriptor, makeGrant, staticPort } from './helpers.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const grant = (sourceKinds: readonly string[] = ['decision']) =>
  makeGrant({
    purpose: 'conversation_discussion',
    scope,
    sourceKinds: sourceKinds as never,
    maxFiles: 6,
    maxBytes: 8192,
    maxTokens: 4000,
    maxDurationMs: 1000,
    confirmedAt: '2026-11-09T00:00:00.000Z',
  })
const decision = (content: string, id = 'decision-1') => ({
  decisionId: id,
  content,
  scope,
  sourceMessageId: 'msg-1',
  recordedAt: NOW,
})
const compose = async (options: {
  decisions?: readonly ReturnType<typeof decision>[]
  budget?: Record<string, number>
  kinds?: readonly string[]
  port?: ReturnType<typeof staticPort>
} = {}) =>
  new ContextComposer(
    {
      port: options.port ?? staticPort([]),
      decisions: { listEffective: async () => ({ decisions: options.decisions ?? [decision('Keep checks')] }) },
    },
    { now: () => new Date(NOW) },
  ).compose({
    requestId: 'manifest',
    projectId: 'project-1',
    purpose: 'conversation_discussion',
    query: '',
    grant: grant(options.kinds),
    budget: options.budget ?? { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 },
    groups: [{ name: 'decisions', priority: 1, sourceKinds: (options.kinds ?? ['decision']) as never, share: 1 }],
  })

test('the manifest keeps whole-source and visible-preview digests separately', async () => {
  const full = buildSourceManifest(await compose({ decisions: [decision('short')], budget: { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 } }))
  const fullEntry = full.sources[0]!
  assert.equal(fullEntry.truncated, false)
  assert.equal(fullEntry.wholeSourceDigest, fullEntry.visiblePreviewDigest)
  assert.equal(fullEntry.digestScope, 'content')

  const truncatedComposition = await compose({
    decisions: [decision('x'.repeat(4000))],
    budget: { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 40, maxDurationMs: 1000 },
  })
  const truncated = buildSourceManifest(truncatedComposition)
  const entry = truncated.sources[0]!
  assert.equal(entry.truncated, true)
  assert.notEqual(entry.wholeSourceDigest, entry.visiblePreviewDigest)
  assert.equal(entry.wholeSourceDigest, truncatedComposition.slices[0]!.baseline.contentDigest)
  assert.equal(entry.visiblePreviewDigest, sha256Text(truncatedComposition.slices[0]!.content))
})

test('the manifest exposes selection and completeness, and never claims completeness for a partial scan', async () => {
  const complete = buildSourceManifest(await compose())
  assert.deepEqual(complete.selection, { projectId: 'project-1' })
  assert.equal(complete.coverage.complete, true)
  assert.equal(complete.coverage.truncated, 0)
  assert.deepEqual(complete.coverage.groups, [{ name: 'decisions', status: 'included' }])

  const previewTruncated = buildSourceManifest(
    await compose({ decisions: [decision('x'.repeat(4000))], budget: { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 40, maxDurationMs: 1000 } }),
  )
  // A bounded preview is recorded, but it did not hide a source: the scan itself is complete.
  assert.equal(previewTruncated.coverage.truncated, 1)
  assert.equal(previewTruncated.coverage.complete, true)

  const scanTruncated = buildSourceManifest(
    await compose({
      decisions: [decision('one', 'd1'), decision('two', 'd2'), decision('three', 'd3')],
      budget: { maxFiles: 1, maxSlices: 1, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 },
    }),
  )
  assert.equal(scanTruncated.coverage.complete, false)
  assert.ok(scanTruncated.coverage.omitted > 0)
})

test('comparison reports unchanged, content, preview, missing, added and replaced without masking', async () => {
  const base = buildSourceManifest(await compose({ decisions: [decision('Keep checks')] }))
  const same = buildSourceManifest(await compose({ decisions: [decision('Keep checks')] }))
  assert.equal(compareSourceManifests(base, same).status, 'unchanged')

  const changedContent = buildSourceManifest(await compose({ decisions: [decision('Different body')] }))
  const content = compareSourceManifests(base, changedContent)
  assert.equal(content.status, 'changed')
  assert.deepEqual(content.changes.map((change) => change.reason), ['content'])

  const long = 'x'.repeat(4000)
  const fullPreview = buildSourceManifest(await compose({ decisions: [decision(long)], budget: { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 4000, maxDurationMs: 1000 } }))
  const shortPreview = buildSourceManifest(await compose({ decisions: [decision(long)], budget: { maxFiles: 6, maxSlices: 6, maxBytes: 8192, maxTokens: 40, maxDurationMs: 1000 } }))
  const preview = compareSourceManifests(fullPreview, shortPreview)
  assert.equal(preview.status, 'changed')
  assert.deepEqual(preview.changes.map((change) => change.reason), ['preview'])

  const twoSources = buildSourceManifest(await compose({ decisions: [decision('Keep checks', 'decision-1'), decision('Second', 'decision-2')] }))
  const oneSource = buildSourceManifest(await compose({ decisions: [decision('Keep checks', 'decision-1')] }))
  const missing = compareSourceManifests(twoSources, oneSource)
  assert.equal(missing.status, 'changed')
  assert.deepEqual(missing.changes.map((change) => change.reason), ['missing'])

  // Same sourceId with another path/kind is a replacement, not an unchanged source.
  const replaced = { ...base, sources: base.sources.map((source) => ({ ...source, path: 'decisions/other.json' })) } as ComposedSourceManifest
  assert.equal(compareSourceManifests(base, replaced).changes[0]?.reason, 'replaced')

  const added = { ...base, sources: [...base.sources, { ...base.sources[0]!, sourceId: 'extra', path: 'decisions/extra.json' }] } as ComposedSourceManifest
  assert.ok(compareSourceManifests(base, added).changes.some((change) => change.reason === 'added'))
})

test('comparison treats selection, contract, incomplete scans and budget movement as non-unchanged', async () => {
  const base = buildSourceManifest(await compose())
  const selection = { ...base, selection: { ...base.selection, workId: 'work-2' }, workId: 'work-2' } as ComposedSourceManifest
  const selectionResult = compareSourceManifests(base, selection)
  assert.equal(selectionResult.status, 'incomplete')
  assert.deepEqual(selectionResult.incompleteReasons, ['selection_changed'])

  const contract = {
    ...base,
    selection: { ...base.selection, contract: { workId: 'work-1', revision: 2, digest: 'a'.repeat(64) } },
  } as ComposedSourceManifest
  const contractResult = compareSourceManifests(base, contract)
  assert.equal(contractResult.status, 'incomplete')
  assert.deepEqual(contractResult.incompleteReasons, ['contract_changed'])

  const incomplete = { ...base, coverage: { ...base.coverage, complete: false } } as ComposedSourceManifest
  const incompleteResult = compareSourceManifests(base, incomplete)
  assert.equal(incompleteResult.status, 'incomplete')
  assert.ok(incompleteResult.incompleteReasons.includes('current_incomplete'))

  const budget = { ...base, budgetClamped: ['maxBytes'] } as ComposedSourceManifest
  const budgetResult = compareSourceManifests(base, budget)
  assert.equal(budgetResult.status, 'changed')
  assert.ok(budgetResult.changes.some((change) => change.reason === 'budget'))
})

test('an empty composition is reported as incomplete knowledge, not as an empty truth', async () => {
  const empty = buildSourceManifest(
    await new ContextComposer(
      {
        port: staticPort([{ descriptor: descriptor('src/a.ts', 'x', { kind: 'source_file' }), content: 'x' }]),
        decisions: { listEffective: async () => ({ decisions: [] }) },
      },
      { now: () => new Date(NOW) },
    ).compose({
      requestId: 'empty',
      projectId: 'project-1',
      purpose: 'conversation_discussion',
      query: '',
      grant: grant(['source_file']),
      budget: { maxFiles: 1, maxSlices: 1, maxBytes: 16, maxTokens: 4, maxDurationMs: 1000 },
      groups: [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }],
    }),
  )
  assert.equal(empty.coverage.complete, false)
})
