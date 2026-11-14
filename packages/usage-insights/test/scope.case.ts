/**
 * G1/G2 acceptance: every record class obeys the declared project and window, unmapped work is
 * isolated, and a rejected or foreign source never turns into a clean measured zero.
 *
 * Each negative changes exactly one thing from `scopedPositive()` so a failure points at one rule.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import type { MetricRow, UsageInsightsInput } from '../src/protocol.ts'
import {
  CONTRACT_ATLAS, CONTRACT_ORBIT, makeAttentionPage, makeOutcome, makeWorkEvidence,
} from './fixtures.ts'

const window = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }
const source = {
  kind: 'operator_file' as const,
  descriptor: 'scope acceptance bundle',
  digest: null,
  layerAssertion: 'operator_declared' as const,
  capturedAt: '2026-11-13T12:00:00.000Z',
}

function bundle(overrides: Partial<UsageInsightsInput> = {}): UsageInsightsInput {
  return {
    protocol: 'usage-insights-input/1',
    inputId: 'scope-bundle',
    capturedAt: '2026-11-13T12:00:00.000Z',
    timezone: 'UTC',
    window,
    projects: [{ projectId: 'project-atlas' }, { projectId: 'project-orbit' }],
    source,
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete' },
    outcomes: [],
    attentionPages: [],
    workEvidence: [],
    ...overrides,
  } as UsageInsightsInput
}

const metric = (analysis: ReturnType<typeof analyzeUsageInsights>, metricId: string): MetricRow | undefined =>
  analysis.summary.metrics.find(row => row.metricId === metricId)

/** Two projects, one mapped work each, one question each — both inside the window. */
function scopedPositive(): UsageInsightsInput {
  const atlasOutcome = makeOutcome({ seed: 'pos-atlas', projectId: 'project-atlas', acceptance: 'unknown' })
  const orbitOutcome = makeOutcome({ seed: 'pos-orbit', projectId: 'project-orbit', contract: CONTRACT_ORBIT, acceptance: 'unknown' })
  return bundle({
    outcomes: [atlasOutcome, orbitOutcome],
    workIndex: [
      { workId: CONTRACT_ATLAS.workId, projectId: 'project-atlas' },
      { workId: CONTRACT_ORBIT.workId, projectId: 'project-orbit' },
    ],
    workEvidence: [
      makeWorkEvidence(CONTRACT_ATLAS.workId, [
        { kind: 'question.opened', sourceRef: 'question-atlas', at: '2026-11-13T09:00:00.000Z' },
      ], { outcomes: [atlasOutcome] }),
      makeWorkEvidence(CONTRACT_ORBIT.workId, [
        { kind: 'question.opened', sourceRef: 'question-orbit', at: '2026-11-13T09:30:00.000Z' },
      ], { outcomes: [orbitOutcome] }),
    ],
  })
}

test('positive: two scoped projects count both questions and both outcomes', () => {
  const analysis = analyzeUsageInsights(scopedPositive())
  assert.equal(metric(analysis, 'interventions.questions')?.value, 2)
  assert.equal(metric(analysis, 'interventions.questions')?.unknownCount, 0)
  assert.equal(metric(analysis, 'outcomes.count')?.value, 2)
  assert.equal(analysis.summary.coverage.workEvidence, 'complete')
  assert.equal(analysis.summary.quarantine.total, 0)
  assert.deepEqual(analysis.summary.projects.map(project => [project.projectId, project.outcomes]).sort(),
    [['project-atlas', 1], ['project-orbit', 1]])
})

test('negative 1: narrowing the project set counts one question, not two', () => {
  const narrow = { ...scopedPositive(), projects: [{ projectId: 'project-atlas' }] } as UsageInsightsInput
  const analysis = analyzeUsageInsights(narrow)
  assert.equal(metric(analysis, 'interventions.questions')?.value, 1)
  assert.equal(metric(analysis, 'outcomes.count')?.value, 1)
  assert.equal(analysis.summary.losses.workEvidence.outOfScope, 1)
  assert.equal(analysis.summary.losses.outcomes.outOfScope, 1)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'out_of_scope_project')?.records, 2)
})

test('negative 2: a question opened before the window is not counted', () => {
  const early = scopedPositive()
  const work = early.workEvidence[0] as { entries: { at: string; kind: string; sourceRef: string; detail: unknown }[] }
  const patched = {
    ...early,
    window: { from: '2026-11-13T10:00:00.000Z', to: '2026-11-14T00:00:00.000Z' },
    workEvidence: [
      { ...work, entries: [
        ...work.entries,
        { at: '2026-11-13T09:15:00.000Z', kind: 'question.opened', sourceRef: 'question-early', detail: {} },
      ] },
      early.workEvidence[1]!,
    ],
  } as UsageInsightsInput
  const analysis = analyzeUsageInsights(patched)
  // The 09:00 and 09:15 atlas questions are outside the 10:00 window; only the 09:30 orbit one is not
  // — and it is outside too, so the measured total is a known zero for two observed works.
  assert.equal(analysis.summary.losses.workEvidence.outsideWindow, 3)
  assert.equal(analysis.notes.some(note => note.includes('observation window')), true)
  const questions = metric(analysis, 'interventions.questions')
  assert.equal(questions?.value, 0, 'both works stayed observed, so the zero is real')
  assert.equal(questions?.sampleCount, 2)
  assert.equal(analysis.summary.limitations.some(text => text.includes('outside the requested window')), true)
})

test('negative 3: a work with no verifiable project mapping is isolated, not counted', () => {
  const unmapped = bundle({
    workEvidence: [
      makeWorkEvidence('work-atlas-1', [
        { kind: 'question.opened', sourceRef: 'question-unmapped', at: '2026-11-13T09:00:00.000Z' },
      ]),
    ],
  })
  const analysis = analyzeUsageInsights(unmapped)
  const questions = metric(analysis, 'interventions.questions')
  assert.equal(questions?.value, null)
  assert.equal(questions?.nullReason, 'unmapped_work')
  assert.equal(questions?.unknownCount, 1)
  assert.equal(analysis.summary.losses.workEvidence.unmapped, 1)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'project_unknown')?.records, 1)
  assert.equal(analysis.summary.coverage.workEvidence, 'partial', 'an unmapped work cannot report complete')
})

test('negative 4: foreign attention items never enter the current pending total', () => {
  const withForeign = bundle({
    attentionPages: [makeAttentionPage({
      observedAt: '2026-11-13T11:00:00.000Z',
      items: [
        {
          id: 'attention-atlas', projectId: 'project-atlas', conversationId: 'conversation-a', contract: CONTRACT_ATLAS,
          workTitle: 'Work', summary: 'Waiting', sinceAt: '2026-11-13T10:00:00.000Z', deadlineAt: null, expiresAt: null,
          blockedWorkIds: [], kind: 'question', questionId: 'question-1', questionVersion: 1, questionKind: 'clarification',
        },
        {
          id: 'attention-foreign', projectId: 'project-foreign', conversationId: 'conversation-f', contract: CONTRACT_ORBIT,
          workTitle: 'Work', summary: 'Waiting', sinceAt: '2026-11-13T10:00:00.000Z', deadlineAt: null, expiresAt: null,
          blockedWorkIds: [], kind: 'question', questionId: 'question-2', questionVersion: 1, questionKind: 'clarification',
        },
      ] as never,
    })],
  })
  const analysis = analyzeUsageInsights(withForeign)
  assert.equal(analysis.summary.attention.items, 1, 'only the declared project is counted')
  assert.equal(analysis.summary.attention.projectCounts.length, 1)
  assert.equal(analysis.summary.losses.attention.outOfScope, 1)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'out_of_scope_project')?.records, 1)
})

test('negative 5: an attention page observed after the capture time is refused', () => {
  const future = bundle({
    attentionPages: [makeAttentionPage({ observedAt: '2026-11-13T18:00:00.000Z', items: [] })],
  })
  const analysis = analyzeUsageInsights(future)
  assert.equal(analysis.summary.attention.items, 0)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'time_inconsistent')?.records, 1)
  assert.notEqual(analysis.summary.attention.coverage, 'complete')
})

test('negative 6: a stale attention snapshot is never reported complete', () => {
  const stale = bundle({
    attentionPages: [makeAttentionPage({ observedAt: '2026-11-13T06:00:00.000Z', items: [] })],
  })
  const analysis = analyzeUsageInsights(stale)
  assert.equal(analysis.summary.attention.stale, true)
  assert.equal(analysis.summary.attention.coverage, 'partial')
  assert.equal(analysis.summary.coverage.overall, 'partial')
  assert.ok(analysis.summary.limitations.some(text => text.includes('bounded or stale')))
})

test('negative 7: a work index and its own outcome naming different projects is a conflict', () => {
  const contradictory = scopedPositive()
  const patched = {
    ...contradictory,
    workIndex: [{ workId: CONTRACT_ATLAS.workId, projectId: 'project-orbit' }],
  } as UsageInsightsInput
  const analysis = analyzeUsageInsights(patched)
  assert.equal(analysis.summary.losses.workEvidence.conflicted, 1)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'subject_mismatch')?.records, 1)
  const questions = metric(analysis, 'interventions.questions')
  assert.notEqual(questions?.value, 2, 'a contradictory work is never counted as if it were clean')
})

test('bad work source cannot become a complete zero', () => {
  const broken = bundle({ workEvidence: [{}] })
  const analysis = analyzeUsageInsights(broken)
  const total = metric(analysis, 'interventions.total')
  assert.equal(total?.value, null, 'no zero may be reported for a rejected source')
  assert.equal(total?.coverage, 'partial')
  assert.ok((total?.unknownCount ?? 0) >= 1)
  assert.equal(analysis.summary.losses.workEvidence.invalid, 1)
  assert.equal(analysis.summary.coverage.workEvidence, 'partial')
  assert.equal(analysis.summary.coverage.overall, 'partial')
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'invalid_record')?.records, 1)
})

test('mixed valid and bad work keeps the known count and reports the unknown part', () => {
  const mixed = scopedPositive()
  const patched = { ...mixed, workEvidence: [...mixed.workEvidence, {}] } as UsageInsightsInput
  const analysis = analyzeUsageInsights(patched)
  const questions = metric(analysis, 'interventions.questions')
  assert.equal(questions?.value, 2, 'the two attributable works are still counted')
  assert.equal(questions?.unknownCount, 1, 'the rejected record is unknown, not absent')
  assert.equal(questions?.coverage, 'partial')
  assert.equal(analysis.summary.losses.workEvidence.invalid, 1)
})

test('a genuinely empty complete window is the only measured zero', () => {
  const empty = bundle({ projects: [{ projectId: 'project-atlas' }] })
  const analysis = analyzeUsageInsights(empty)
  const questions = metric(analysis, 'interventions.questions')
  assert.equal(questions?.value, 0)
  assert.equal(questions?.sampleCount, 0)
  assert.equal(questions?.unknownCount, 0)
  assert.equal(questions?.coverage, 'complete')
  assert.equal(analysis.summary.coverage.workEvidence, 'complete')
})

test('an uncollected work source stays unavailable rather than zero', () => {
  const notCollected = bundle({
    declaredCoverage: { outcomes: 'complete', workEvidence: 'not_collected', attention: 'complete' },
    projects: [{ projectId: 'project-atlas' }],
  })
  const analysis = analyzeUsageInsights(notCollected)
  const questions = metric(analysis, 'interventions.questions')
  assert.equal(questions?.value, null)
  assert.equal(questions?.nullReason, 'not_collected')
  assert.equal(analysis.summary.coverage.workEvidence, 'not_collected')
  assert.equal(analysis.summary.coverage.overall, 'not_collected')
})
