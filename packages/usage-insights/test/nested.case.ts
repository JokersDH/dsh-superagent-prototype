/**
 * G1/G2 acceptance for wave-27: the record bound charges nested records, and a contradictory work
 * mapping is permanently isolated for the whole input.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights, recordUnits } from '../src/analyze.ts'
import type { MetricRow, UsageInsightsInput } from '../src/protocol.ts'
import { CONTRACT_ATLAS, makeAttentionPage, makeOutcome, makeWorkEvidence } from './fixtures.ts'

const window = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }

function bundle(overrides: Partial<UsageInsightsInput> = {}): UsageInsightsInput {
  return {
    protocol: 'usage-insights-input/1',
    inputId: 'nested-bundle',
    capturedAt: '2026-11-13T12:00:00.000Z',
    timezone: 'UTC',
    window,
    projects: [{ projectId: 'project-atlas' }],
    source: { kind: 'operator_file', descriptor: 'nested bundle', digest: null, layerAssertion: 'operator_declared', capturedAt: '2026-11-13T12:00:00.000Z' },
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete' },
    outcomes: [],
    attentionPages: [],
    workEvidence: [],
    ...overrides,
  } as UsageInsightsInput
}

const metric = (analysis: ReturnType<typeof analyzeUsageInsights>, metricId: string): MetricRow | undefined =>
  analysis.summary.metrics.find(row => row.metricId === metricId)

/** One work container carrying two outcomes and no explicit top-level outcomes. */
function workOnly(options: { limits?: UsageInsightsInput['limits']; outcomes?: number } = {}): UsageInsightsInput {
  const count = options.outcomes ?? 2
  const outcomes = Array.from({ length: count }, (_, index) =>
    makeOutcome({ seed: `nested-${index}`, acceptance: 'unknown', durationMs: 1_000 + index }))
  return bundle({
    workEvidence: [makeWorkEvidence(CONTRACT_ATLAS.workId, [
      { kind: 'question.opened', sourceRef: 'question-nested', at: '2026-11-13T09:00:00.000Z' },
    ], { outcomes })],
    workIndex: [{ workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' }],
    ...(options.limits ? { limits: options.limits } : {}),
  })
}

test('a container is charged for its own records, so units are not just top-level wrappers', () => {
  const container = { entries: [{}, {}], outcomes: [{}, {}, {}] }
  assert.equal(recordUnits(container), 6, 'container + two entries + three outcomes')
  assert.equal(recordUnits({}), 1)
  assert.equal(recordUnits(undefined), 1)
  assert.equal(recordUnits({ items: [{}] }), 2)
})

test('positive: an exact nested bound admits the container and both derived outcomes', () => {
  const analysis = analyzeUsageInsights(workOnly({ limits: { maxRecords: 4 } }))
  // One container + one entry + two embedded outcomes = four units.
  assert.equal(analysis.summary.limits.recordsSeen, 4)
  assert.equal(analysis.summary.limits.recordsAdmitted, 4)
  assert.equal(analysis.summary.limits.recordsNotParsed, 0)
  assert.equal(analysis.summary.limits.stoppedBy, 'none')
  assert.equal(metric(analysis, 'outcomes.count')?.value, 2)
  assert.equal(metric(analysis, 'outcomes.count')?.coverage, 'complete')
})

test('negative: maxRecords 1 cannot admit a work container hiding two outcomes', () => {
  const analysis = analyzeUsageInsights(workOnly({ limits: { maxRecords: 1 } }))
  assert.equal(metric(analysis, 'outcomes.count'), undefined, 'two outcomes must never be accepted under a bound of one')
  assert.equal(analysis.summary.limits.recordsAccepted, 0)
  assert.equal(analysis.summary.limits.recordsAdmitted, 0)
  assert.equal(analysis.summary.limits.recordsNotParsed, 4)
  assert.equal(analysis.summary.limits.stoppedBy, 'records')
  assert.equal(analysis.summary.coverage.outcomes, 'partial')
  assert.ok(analysis.notes.some(note => note.includes('not parsed')))
})

test('negative: a container just over the bound is skipped whole, not partially counted', () => {
  const analysis = analyzeUsageInsights(workOnly({ limits: { maxRecords: 3 } }))
  // Three units cannot fit a four-unit container; nothing from it may be counted.
  assert.equal(analysis.summary.limits.recordsAdmitted, 0)
  assert.equal(analysis.summary.limits.recordsNotParsed, 4)
  assert.equal(metric(analysis, 'outcomes.count'), undefined)
  assert.equal(metric(analysis, 'interventions.questions')?.value, null, 'no entry from the rejected container is counted')
  assert.equal(metric(analysis, 'interventions.questions')?.unknownCount, 1)
})

test('a small container after a rejected one is still admitted', () => {
  const big = makeWorkEvidence('work-big', [{ kind: 'question.opened', sourceRef: 'q-big' }], {
    outcomes: [makeOutcome({ seed: 'big-1', acceptance: 'unknown' }), makeOutcome({ seed: 'big-2', acceptance: 'unknown' })],
  })
  const small = makeWorkEvidence('work-small', [{ kind: 'question.opened', sourceRef: 'q-small' }])
  const analysis = analyzeUsageInsights(bundle({
    workEvidence: [big, small],
    workIndex: [
      { workId: 'work-big', projectId: 'project-atlas' },
      { workId: 'work-small', projectId: 'project-atlas' },
    ],
    limits: { maxRecords: 2 },
  }))
  // The big container costs 4 and is skipped; the small one costs 2 and fits.
  assert.equal(analysis.summary.limits.recordsAdmitted, 2)
  assert.equal(analysis.summary.limits.recordsNotParsed, 4)
  assert.equal(metric(analysis, 'interventions.questions')?.value, 1)
  assert.equal(analysis.summary.limits.worksSeen, 1, 'only the admitted work is parsed')
})

test('an attention page is charged with its items against the record bound', () => {
  const page = makeAttentionPage({
    observedAt: '2026-11-13T11:00:00.000Z',
    items: [{
      id: 'attention-a', projectId: 'project-atlas', conversationId: 'conversation-a', contract: CONTRACT_ATLAS,
      workTitle: 'Work', summary: 'Waiting', sinceAt: '2026-11-13T10:00:00.000Z', deadlineAt: null, expiresAt: null,
      blockedWorkIds: [], kind: 'question', questionId: 'question-a', questionVersion: 1, questionKind: 'clarification',
    } as never],
  })
  // A page with one item costs two record units (page + item); `maxPages` only counts the document.
  const tight = analyzeUsageInsights(bundle({ attentionPages: [page], limits: { maxRecords: 1, maxPages: 5 } }))
  assert.equal(tight.summary.limits.pagesNotParsed, 1)
  assert.equal(tight.summary.attention.items, 0, 'a two-unit page cannot fit a one-unit record budget')
  assert.equal(tight.summary.limits.stoppedBy, 'records')
  const exact = analyzeUsageInsights(bundle({ attentionPages: [page], limits: { maxRecords: 2, maxPages: 1 } }))
  assert.equal(exact.summary.limits.pagesNotParsed, 0)
  assert.equal(exact.summary.attention.items, 1)
})

test('negative: workIndex A→B→A never revives a trusted mapping', () => {
  const base = workOnly()
  const withTriple = { ...base, workIndex: [
    { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
    { workId: CONTRACT_ATLAS.workId, projectId: 'project-orbit' },
    { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
  ] } as UsageInsightsInput
  const analysis = analyzeUsageInsights(withTriple)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'identity_conflict')?.records, 1)
  assert.equal(analysis.summary.losses.workEvidence.conflicted, 1)
  assert.equal(metric(analysis, 'outcomes.count'), undefined, 'the conflicted work contributes no outcome')
  assert.equal(metric(analysis, 'interventions.questions')?.value, null)
  const questions = metric(analysis, 'interventions.total')
  assert.equal(questions?.value, null, 'the interaction total is unknown, never a known one or a complete zero')
  assert.equal(analysis.summary.coverage.workEvidence, 'partial')
})

test('the tombstone is order-independent', () => {
  const base = workOnly()
  const forward = [
    { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
    { workId: CONTRACT_ATLAS.workId, projectId: 'project-orbit' },
    { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
  ]
  const reversed = [...forward].reverse()
  const a = analyzeUsageInsights({ ...base, workIndex: forward } as UsageInsightsInput)
  const b = analyzeUsageInsights({ ...base, workIndex: reversed } as UsageInsightsInput)
  assert.equal(a.summary.quarantine.total, b.summary.quarantine.total)
  assert.equal(a.summary.losses.workEvidence.conflicted, b.summary.losses.workEvidence.conflicted)
  assert.deepEqual(a.summary.metrics, b.summary.metrics, 'the analysis does not depend on index order')
})

test('a unique mapping and a contradictory one coexist without leaking into each other', () => {
  const good = makeWorkEvidence('work-good', [{ kind: 'question.opened', sourceRef: 'q-good' }])
  const badContract = { workId: 'work-bad', revision: 1, digest: 'd'.repeat(64) }
  const badOutcome = makeOutcome({ seed: 'bad-work', acceptance: 'unknown', contract: badContract })
  const bad = makeWorkEvidence('work-bad', [{ kind: 'question.opened', sourceRef: 'q-bad' }], { outcomes: [badOutcome] })
  const analysis = analyzeUsageInsights(bundle({
    workEvidence: [good, bad],
    workIndex: [
      { workId: 'work-good', projectId: 'project-atlas' },
      { workId: 'work-bad', projectId: 'project-atlas' },
      { workId: 'work-bad', projectId: 'project-orbit' },
    ],
    outcomes: [badOutcome],
  }))
  assert.equal(metric(analysis, 'interventions.questions')?.value, 1, 'the clean work is still counted')
  assert.equal(metric(analysis, 'interventions.questions')?.unknownCount, 1, 'the tombstoned work stays unknown')
  assert.equal(metric(analysis, 'outcomes.count'), undefined, 'the tombstoned work outcome is excluded')
  assert.equal(analysis.summary.losses.workEvidence.conflicted, 1, 'the tombstoned work is counted once')
  assert.equal(analysis.summary.losses.outcomes.conflicted, 1, 'its explicit outcome is excluded as well')
})
