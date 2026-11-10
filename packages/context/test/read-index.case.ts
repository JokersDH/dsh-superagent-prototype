import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ContractRef, ContractRevision, Scope, WorkRecord } from '@personal-agent/contracts'
import {
  ContextError,
  ContextReader,
  ReadIndexContextPort,
  buildContextPreview,
} from '../src/index.ts'
import type { ReadIndexProjectView, ReadIndexWorkView, WorkspaceReadIndex } from '../src/index.ts'
import { NOW, makeGrant, makeRequest, scope } from './helpers.ts'

const projectScope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const project = (overrides: Partial<ReadIndexProjectView> = {}): ReadIndexProjectView => ({
  projectId: 'project-1',
  revision: 2,
  digest: 'p'.repeat(64),
  createdAt: NOW,
  settings: { displayName: 'Demo project', check: 'pnpm_test', environment: { policy: 'existing_only' } },
  ...overrides,
})
const work = (id = 'work-1', projectId = 'project-1'): WorkRecord => ({
  id,
  projectId,
  conversationId: 'conv-1',
  title: `Work ${id}`,
  createdAt: NOW,
})
const contractRef = (id = 'work-1', revision = 2): ContractRef => ({
  workId: id,
  revision,
  digest: 'c'.repeat(64),
})
const contract = (id = 'work-1', revision = 2): ContractRevision => ({
  ...contractRef(id, revision),
  goal: 'Add a parser setting',
  scope: projectScope,
  criteria: [{ id: 'criterion-1', description: 'tests pass', kind: 'machine', required: true, checkDefinitionRef: 'check-1' }],
  authorityRef: 'authority-1',
  createdAt: NOW,
})
const entry = (options: {
  work?: WorkRecord
  contractState?: ReadIndexWorkView['contractState']
  authorityState?: ReadIndexWorkView['authorityState']
  projectState?: ReadIndexWorkView['project']['state']
} = {}): ReadIndexWorkView => ({
  work: options.work ?? work(),
  authority: contractRef(),
  authorityState: options.authorityState ?? 'current',
  contract: contract(),
  contractState: options.contractState ?? 'current',
  verificationIds: ['verification-1'],
  acceptanceIds: [],
  deliverables: [{ verificationId: 'verification-1', artifactDigest: 'a'.repeat(64), criteriaDigest: 'b'.repeat(64), accepted: true }],
  project: { id: (options.work ?? work()).projectId, state: options.projectState ?? 'current' },
})

function fakeIndex(options: {
  current?: ReadIndexProjectView | undefined
  state?: 'current' | 'missing' | 'archived'
  works?: readonly WorkRecord[]
  entries?: Readonly<Record<string, ReadIndexWorkView>>
} = {}): WorkspaceReadIndex {
  const current = options.current === undefined ? project() : options.current
  const works = options.works ?? [work()]
  const entries = options.entries ?? { 'work-1': entry() }
  return {
    project: () => ({ current, history: current ? [current] : [], state: options.state ?? 'current' }),
    listWorks: () => ({ works, hasMore: false }),
    work: (id) => entries[id],
  }
}

const grantFor = (kinds: readonly string[]) =>
  makeGrant({
    scope: scope({ projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [] }),
    sourceKinds: kinds as never,
    maxFiles: 8,
    maxBytes: 256 * 1024,
    maxTokens: 20_000,
  })

test('the read-index adapter exposes bounded project, work and contract context', async () => {
  const port = new ReadIndexContextPort({ projectId: 'project-1', index: fakeIndex() })
  const reader = new ContextReader({ now: () => new Date(NOW) })
  const bundle = await reader.read(makeRequest({ grant: grantFor(['project_metadata', 'work', 'contract']) }), port)
  assert.equal(bundle.status, 'sufficient')
  assert.deepEqual(bundle.slices.map((slice) => slice.kind).sort(), ['contract', 'project_metadata', 'work'])
  const workSlice = bundle.slices.find((slice) => slice.kind === 'work')
  assert.ok(workSlice)
  const summary = JSON.parse(workSlice.content) as Record<string, unknown>
  assert.deepEqual(summary.verificationIds, ['verification-1'])
  assert.deepEqual(summary.deliverables, [{ verificationId: 'verification-1', accepted: true }])
  assert.equal(JSON.stringify(bundle).includes('/Users/'), false)
  assert.equal(bundle.baseline.commit, project().digest)

  const preview = buildContextPreview(bundle)
  assert.equal(preview.status, 'sufficient')
  assert.deepEqual(preview.selectedFiles, [])
  assert.equal(preview.totals.files, 3)
  assert.equal(preview.sourceKinds.includes('work'), true)
})

test('a stale or missing contract cannot be used as the current work contract', async () => {
  const stale = new ReadIndexContextPort({
    projectId: 'project-1',
    index: fakeIndex({ entries: { 'work-1': entry({ contractState: 'stale' }) } }),
  })
  const reader = new ContextReader({ now: () => new Date(NOW) })
  await assert.rejects(
    reader.read(
      makeRequest({ workId: 'work-1', contract: contractRef(), grant: grantFor(['project_metadata']) }),
      stale,
    ),
    (error: unknown) => error instanceof ContextError && error.code === 'contract_stale',
  )

  const missingAuthority = new ReadIndexContextPort({
    projectId: 'project-1',
    index: fakeIndex({ entries: { 'work-1': entry({ authorityState: 'missing' }) } }),
  })
  await assert.rejects(
    reader.read(
      makeRequest({ workId: 'work-1', contract: contractRef(), grant: grantFor(['project_metadata']) }),
      missingAuthority,
    ),
    (error: unknown) => error instanceof ContextError && error.code === 'contract_stale',
  )
})

test('effective decisions are projected as context and disappear when revoked', async () => {
  let decisions = [
    {
      decisionId: 'decision-1',
      content: 'Use Chinese UI copy',
      scope: projectScope,
      sourceMessageId: 'msg-1',
      recordedAt: NOW,
    },
  ]
  const port = new ReadIndexContextPort({
    projectId: 'project-1',
    index: fakeIndex(),
    decisions: async () => decisions,
  })
  const reader = new ContextReader({ now: () => new Date(NOW) })
  const first = await reader.read(makeRequest({ query: 'Chinese copy', grant: grantFor(['decision']) }), port)
  const slice = first.slices.find((item) => item.kind === 'decision')
  assert.ok(slice?.content.includes('Use Chinese UI copy'))

  decisions = []
  const afterRevoke = await reader.read(makeRequest({ query: 'Chinese copy', grant: grantFor(['decision']) }), port)
  assert.equal(afterRevoke.slices.some((item) => item.kind === 'decision'), false)
})

test('an archived or missing project yields an explicit insufficient bundle', async () => {
  for (const state of ['archived', 'missing'] as const) {
    const port = new ReadIndexContextPort({ projectId: 'project-1', index: fakeIndex({ state }) })
    const reader = new ContextReader({ now: () => new Date(NOW) })
    const bundle = await reader.read(makeRequest({ grant: grantFor(['project_metadata']) }), port)
    assert.equal(bundle.status, 'insufficient')
    assert.ok(bundle.omitted.some((item) => item.reason === 'missing'))
  }
})

test('foreign works are not projected and budget omissions are visible in the preview', async () => {
  const foreign = work('work-3', 'project-2')
  const second = work('work-2', 'project-1')
  const port = new ReadIndexContextPort({
    projectId: 'project-1',
    index: fakeIndex({
      works: [work(), foreign, second],
      entries: {
        'work-1': entry(),
        'work-2': entry({ work: second }),
        'work-3': entry({ work: foreign }),
      },
    }),
  })
  const reader = new ContextReader({ now: () => new Date(NOW) })
  const bundle = await reader.read(
    makeRequest({ grant: grantFor(['work']), budget: { maxFiles: 1, maxSlices: 1 } }),
    port,
  )
  assert.equal(bundle.slices.filter((slice) => slice.kind === 'work').length, 1)
  assert.ok(bundle.nextCursor)
  const preview = buildContextPreview(bundle)
  assert.equal(preview.status, 'partial')
  assert.ok(preview.omitted.some((item) => item.reason.startsWith('budget_')))
})
