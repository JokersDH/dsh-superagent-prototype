import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Scope } from '@personal-agent/contracts'
import {
  ContextComposer,
  ContextError,
  validateComposedGroups,
  type ComposedGroupPlan,
} from '../src/index.ts'
import { NOW, makeGrant } from './helpers.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const decision = {
  decisionId: 'decision-1',
  content: 'Keep required checks',
  scope,
  sourceMessageId: 'msg-1',
  recordedAt: NOW,
}
const baseGrant = (sourceKinds: readonly string[]) =>
  makeGrant({
    purpose: 'conversation_discussion',
    scope,
    sourceKinds: sourceKinds as never,
    maxFiles: 5,
    maxBytes: 4096,
    maxTokens: 4096,
    maxDurationMs: 1000,
    confirmedAt: '2026-11-09T08:00:00.000Z',
  })

const request = (grant: ReturnType<typeof baseGrant>, groups: readonly ComposedGroupPlan[]) => ({
  requestId: 'group-binding',
  projectId: 'project-1',
  purpose: 'conversation_discussion' as const,
  query: '',
  grant,
  budget: {},
  groups,
})

test('an artifact-only grant cannot call the decision provider through a group name', async () => {
  let reads = 0
  const composer = new ContextComposer(
    {
      port: {
        projectBaseline: async () => ({ capturedAt: NOW }),
        listSources: async () => [],
        readSource: async () => {
          throw new Error('no file source in this probe')
        },
      },
      decisions: {
        listEffective: async () => {
          reads += 1
          return { decisions: [decision] }
        },
      },
    },
    { now: () => new Date(NOW) },
  )
  await assert.rejects(
    composer.compose(
      request(baseGrant(['artifact']), [{ name: 'decisions', priority: 1, sourceKinds: ['artifact'], share: 1 }]),
    ),
    (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
  )
  assert.equal(reads, 0)

  // Positive control: a decision grant with the decisions group still reads exactly once.
  const control = await composer.compose(
    request(baseGrant(['decision']), [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 }]),
  )
  assert.equal(reads, 1)
  assert.deepEqual(control.slices.map((slice) => slice.kind), ['decision'])
})

test('an invalid custom group plan is refused before any provider is read', async () => {
  const calls = { decisions: 0, listSources: 0 }
  const composer = new ContextComposer(
    {
      port: {
        projectBaseline: async () => ({ capturedAt: NOW }),
        listSources: async () => {
          calls.listSources += 1
          return []
        },
        readSource: async () => {
          throw new Error('unused')
        },
      },
      decisions: {
        listEffective: async () => {
          calls.decisions += 1
          return { decisions: [decision] }
        },
      },
    },
    { now: () => new Date(NOW) },
  )
  const invalidPlans: readonly (readonly ComposedGroupPlan[])[] = [
    [{ name: 'not_a_group' as never, priority: 1, sourceKinds: ['decision'], share: 1 }],
    [{ name: 'decisions', priority: 1, sourceKinds: ['decision', 'decision'], share: 1 }],
    [{ name: 'decisions', priority: -1, sourceKinds: ['decision'], share: 1 }],
    [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: Number.NaN }],
    [{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share: Number.NEGATIVE_INFINITY }],
    [
      { name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 },
      { name: 'files', priority: 1, sourceKinds: ['document'], share: 1 },
    ],
  ]
  for (const groups of invalidPlans) {
    await assert.rejects(
      composer.compose(request(baseGrant(['decision', 'document']), groups)),
      (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
      JSON.stringify(groups),
    )
  }
  assert.deepEqual(calls, { decisions: 0, listSources: 0 })
})

test('a group name can never declare another provider family', () => {
  for (const [name, kinds] of [
    ['decisions', ['artifact']],
    ['artifacts', ['decision']],
    ['conversation', ['document']],
    ['contract', ['decision']],
    ['files', ['artifact']],
  ] as const) {
    assert.throws(
      () => validateComposedGroups([{ name, priority: 1, sourceKinds: kinds as never, share: 1 }]),
      (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
      `${name} must not declare ${kinds.join(',')}`,
    )
  }
  assert.throws(
    () => validateComposedGroups([]),
    (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
  )
  assert.throws(
    () =>
      validateComposedGroups([
        { name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 },
        { name: 'decisions', priority: 2, sourceKinds: ['decision'], share: 1 },
      ]),
    (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
  )
  assert.throws(
    () =>
      validateComposedGroups([
        { name: 'decisions', priority: 1, sourceKinds: ['decision'], share: 1 },
        { name: 'artifacts', priority: 1, sourceKinds: ['artifact'], share: 1 },
      ]),
    (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
  )
  for (const share of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validateComposedGroups([{ name: 'decisions', priority: 1, sourceKinds: ['decision'], share }]),
      (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
      `share ${String(share)} must be refused`,
    )
  }
  assert.throws(
    () => validateComposedGroups([{ name: 'decisions', priority: 0, sourceKinds: ['decision'], share: 1 }]),
    (error: unknown) => error instanceof ContextError && error.code === 'composition_invalid',
  )
  // Default plan is valid.
  assert.doesNotThrow(() => validateComposedGroups([...[
    { name: 'contract', priority: 1, sourceKinds: ['contract', 'work'], share: 0.3 },
    { name: 'decisions', priority: 2, sourceKinds: ['decision'], share: 0.25 },
  ] as const]))
})
