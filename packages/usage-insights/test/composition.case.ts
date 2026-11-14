/**
 * G5 acceptance: the Node composition over an authorized read port.
 *
 * The port stands in for main's authenticated readers. The composition must add no authority of its
 * own: it validates the DTOs it is given, charges the same record units the analyzer charges, keeps
 * every work→project pair for the analyzer's tombstone, and stops on its declared bounds.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import { composeUsageInsightsInput, CompositionFault } from '../src/node-composition.ts'
import type { AuthorizedReadsPort } from '../src/node-composition.ts'
import { toInsightConsumerView, consumerAdmission } from '../src/facing.ts'
import { CONTRACT_ATLAS, makeAttentionPage, makeHistory, makeOutcome, makeWorkEvidence } from './fixtures.ts'

const window = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }
const request = {
  principalRef: 'principal-opaque-1',
  projectIds: ['project-atlas'],
  window,
  timezone: 'UTC',
  capturedAt: '2026-11-13T12:00:00.000Z',
  inputId: 'composed-1',
  sourceDescriptor: 'authorized read composition test',
}

interface PortOptions {
  works?: { workId: string; projectId: string }[]
  evidence?: Record<string, unknown>
  history?: Record<string, unknown[]>
  attention?: unknown[]
  failWorks?: string[]
  delayMs?: number
}

function port(options: PortOptions = {}): AuthorizedReadsPort {
  const works = options.works ?? [{ workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' }]
  return {
    async listWorks({ limit, cursor }) {
      const start = cursor ? Number(cursor) : 0
      const slice = works.slice(start, start + limit)
      return { works: slice, hasMore: start + limit < works.length, ...(start + limit < works.length ? { nextCursor: String(start + limit) } : {}) }
    },
    async workEvidence(workId) {
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs))
      if (options.failWorks?.includes(workId)) throw new Error('authorized reader failed')
      return options.evidence?.[workId] ?? makeWorkEvidence(workId, [{ kind: 'question.opened', sourceRef: `q-${workId}` }])
    },
    async workHistory(workId) {
      const pages = options.history?.[workId] ?? []
      return pages[0] ?? makeHistory(workId, CONTRACT_ATLAS, [])
    },
    async attention() {
      return options.attention?.[0] ?? makeAttentionPage({ observedAt: '2026-11-13T11:00:00.000Z', items: [] })
    },
  }
}

test('positive: a unique authorized read composes a complete bundle', async () => {
  const outcome = makeOutcome({ seed: 'composed-1', acceptance: 'unknown', durationMs: 4_000 })
  const evidence = makeWorkEvidence(CONTRACT_ATLAS.workId, [{ kind: 'question.opened', sourceRef: 'q-1' }], { outcomes: [outcome] })
  const composed = await composeUsageInsightsInput({
    port: port({ evidence: { [CONTRACT_ATLAS.workId]: evidence } }),
    request: { ...request, includeAttention: true },
  })
  assert.equal(composed.issues.length, 0)
  assert.equal(composed.stats.worksListed, 1)
  assert.equal(composed.stats.worksRead, 1)
  assert.equal(composed.stats.stoppedBy, 'none')
  assert.deepEqual(composed.bundle.workIndex, [{ workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' }])
  assert.equal(composed.bundle.declaredCoverage.workEvidence, 'complete')
  assert.equal(composed.bundle.source.kind, 'authorized_read')
  assert.equal(composed.bundle.source.descriptor, request.sourceDescriptor)

  const analysis = analyzeUsageInsights(composed.bundle)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count')?.value, 1)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')?.value, 1)
  const view = toInsightConsumerView(analysis.summary)
  assert.equal(consumerAdmission(view).admitted, true)
})

test('nested records are charged before the analyzer sees them', async () => {
  const outcomes = [makeOutcome({ seed: 'nest-1', acceptance: 'unknown' }), makeOutcome({ seed: 'nest-2', acceptance: 'unknown' })]
  const evidence = makeWorkEvidence(CONTRACT_ATLAS.workId, [], { outcomes })
  const composed = await composeUsageInsightsInput({
    port: port({ evidence: { [CONTRACT_ATLAS.workId]: evidence } }),
    request: { ...request, limits: { maxRecords: 1 } },
  })
  assert.equal(composed.stats.stoppedBy, 'records')
  assert.equal(composed.stats.worksRead, 0)
  assert.equal(composed.bundle.workEvidence.length, 0, 'the container is not admitted at all')
  assert.equal(composed.bundle.declaredCoverage.workEvidence, 'caller_limit')
  const analysis = analyzeUsageInsights(composed.bundle)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count'), undefined)
})

test('a contradictory work list reaches the analyzer tombstone unchanged', async () => {
  const evidence = makeWorkEvidence(CONTRACT_ATLAS.workId, [{ kind: 'question.opened', sourceRef: 'q-1' }])
  const composed = await composeUsageInsightsInput({
    port: port({
      works: [
        { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
        { workId: CONTRACT_ATLAS.workId, projectId: 'project-orbit' },
      ],
      evidence: { [CONTRACT_ATLAS.workId]: evidence },
    }),
    request: { ...request, projectIds: ['project-atlas', 'project-orbit'] },
  })
  assert.equal(composed.bundle.workIndex?.length, 2, 'both pairs are preserved for one decision')
  const analysis = analyzeUsageInsights(composed.bundle)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'identity_conflict')?.records, 1)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')?.value, null)
})

test('an invalid DTO is reported and does not stop the other works', async () => {
  const good = makeWorkEvidence('work-good', [{ kind: 'question.opened', sourceRef: 'q-good' }])
  const composed = await composeUsageInsightsInput({
    port: port({
      works: [
        { workId: 'work-bad', projectId: 'project-atlas' },
        { workId: 'work-good', projectId: 'project-atlas' },
      ],
      evidence: { 'work-bad': { protocol: 'work-evidence/1', workId: 'work-other' }, 'work-good': good },
    }),
    request,
  })
  assert.ok(composed.issues.some(issue => issue.code === 'invalid_dto'))
  assert.equal(composed.stats.worksRead, 1)
  assert.equal(composed.bundle.declaredCoverage.workEvidence, 'caller_limit')
  const analysis = analyzeUsageInsights(composed.bundle)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')?.value, 1)
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')?.unknownCount, 1)
})

test('a reader failure is a source loss, not an empty complete set', async () => {
  const composed = await composeUsageInsightsInput({
    port: port({ failWorks: [CONTRACT_ATLAS.workId] }),
    request,
  })
  assert.ok(composed.issues.some(issue => issue.code === 'port_error'))
  assert.equal(composed.stats.worksRead, 0)
  assert.notEqual(composed.bundle.declaredCoverage.workEvidence, 'complete')
  const analysis = analyzeUsageInsights(composed.bundle)
  const questions = analysis.summary.metrics.find(row => row.metricId === 'interventions.questions')
  assert.equal(questions?.value, null)
  assert.notEqual(questions?.value, 0)
})

test('the deadline and work bounds stop the composition deterministically', async () => {
  const slow = await composeUsageInsightsInput({
    port: port({ delayMs: 60 }),
    request: { ...request, limits: { deadlineMs: 10 } },
  })
  assert.equal(slow.stats.stoppedBy, 'deadline')
  assert.notEqual(slow.bundle.declaredCoverage.workEvidence, 'complete')

  const many = Array.from({ length: 5 }, (_, index) => ({ workId: `work-${index}`, projectId: 'project-atlas' }))
  const bounded = await composeUsageInsightsInput({
    port: port({
      works: many,
      evidence: Object.fromEntries(many.map(work => [work.workId, makeWorkEvidence(work.workId, [])])),
    }),
    request: { ...request, limits: { maxWorks: 2 } },
  })
  assert.equal(bounded.stats.worksListed, 2)
  assert.equal(bounded.stats.stoppedBy, 'works')
  assert.equal(bounded.bundle.workEvidence.length, 2)
})

test('requesting attention without a reader is refused instead of reported empty', async () => {
  const { attention: _attention, ...withoutAttention } = port()
  await assert.rejects(
    composeUsageInsightsInput({ port: withoutAttention, request: { ...request, includeAttention: true } }),
    (error: unknown) => error instanceof CompositionFault && error.code === 'unsupported',
  )
  const notRequested = await composeUsageInsightsInput({ port: withoutAttention, request })
  assert.equal(notRequested.bundle.declaredCoverage.attention, 'not_collected')
})

test('an invalid request is refused before any read', async () => {
  let read = false
  const spy = { ...port(), async listWorks() { read = true; return { works: [], hasMore: false } } }
  await assert.rejects(composeUsageInsightsInput({ port: spy, request: { ...request, projectIds: [] } }),
    (error: unknown) => error instanceof CompositionFault && error.code === 'invalid_request')
  await assert.rejects(composeUsageInsightsInput({ port: spy, request: { ...request, window: { from: window.to, to: window.from } } }),
    (error: unknown) => error instanceof CompositionFault && error.code === 'invalid_request')
  assert.equal(read, false, 'no authorized read happens for an invalid request')
})
