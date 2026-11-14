import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import type { BaselineComparison, MetricRow, OperatorBaseline, UsageInsightsInput } from '../src/protocol.ts'
import { renderMarkdown, renderTerminal, safeText } from '../src/report.ts'
import {
  CONTRACT_ATLAS, FIXTURE_WINDOW, completeBundle, conflictBundle, makeAttentionPage, makeOutcome,
  multiCurrencyBundle, multiProjectBundle, outsideWindowBundle, partialBundle, queueBundle, unknownBundle,
} from './fixtures.ts'

function metric(analysis: ReturnType<typeof analyzeUsageInsights>, metricId: string, layer?: string | null, currency?: string): MetricRow | undefined {
  return analysis.summary.metrics.find(row => row.metricId === metricId &&
    (layer === undefined || row.layer === layer) &&
    (currency === undefined || row.currency === currency))
}

function withBaseline(bundle: UsageInsightsInput, baseline: Partial<OperatorBaseline>): UsageInsightsInput {
  const value: OperatorBaseline = {
    protocol: 'operator-baseline/1',
    baselineId: 'baseline-1',
    source: 'operator spreadsheet',
    definition: 'Mean wall time for the same kind of work before the assistant existed',
    projectIds: ['project-atlas'],
    window: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' },
    timezone: 'UTC',
    metricId: 'execution.durationMs',
    unit: 'ms',
    aggregation: 'mean',
    currency: null,
    targetLayer: 'controlled',
    sampleCount: 4,
    value: 100_000,
    coverage: 'complete',
    operatorNote: null,
    ...baseline,
  }
  return { ...bundle, baseline: value } as UsageInsightsInput
}

test('analysis is deterministic and the same bundle yields one summary id', () => {
  const first = analyzeUsageInsights(completeBundle())
  const second = analyzeUsageInsights(completeBundle())
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.match(first.summary.summaryId, /^[a-f0-9]{64}$/)
})

test('a complete bundle derives per-layer metrics without double counting embedded outcomes', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const summary = analysis.summary
  assert.equal(summary.coverage.overall, 'complete')
  assert.equal(summary.quarantine.total, 0)

  assert.equal(metric(analysis, 'outcomes.count', 'controlled')?.value, 2)
  assert.equal(metric(analysis, 'outcomes.accepted', 'controlled')?.value, 2)
  assert.equal(metric(analysis, 'execution.durationMs', 'controlled')?.value, 90_000)
  assert.equal(metric(analysis, 'review.readyToAcceptanceMs', 'controlled')?.value, 90_000)
  assert.equal(metric(analysis, 'review.activeMs', 'controlled')?.value, 17_500)
  assert.equal(metric(analysis, 'usage.inputTokens', 'controlled')?.value, 3_000)
  assert.equal(metric(analysis, 'usage.outputTokens', 'controlled')?.value, 1_300)
  assert.equal(metric(analysis, 'usage.cost', 'controlled', 'USD')?.value, 1.25)
  assert.equal(metric(analysis, 'interventions.total')?.value, 3)
  assert.equal(metric(analysis, 'interventions.questions')?.value, 1)
  assert.equal(metric(analysis, 'interventions.answers')?.value, 1)
  assert.equal(metric(analysis, 'interventions.acceptances')?.value, 1)
  // Interaction metrics describe product records, not an evidence layer.
  assert.equal(metric(analysis, 'interventions.total')?.layer, null)
  assert.equal(summary.limits.recordsSeen, 3, 'the record budget governs the three top-level records presented')
  assert.equal(summary.losses.outcomes.seen, 4, 'every outcome presented, including embedded ones, is accounted for')
  assert.equal(summary.limits.recordsAccepted, 2, 'the embedded copies are replays of the same identities')
})

test('missing observations stay null with a reason instead of becoming zero', () => {
  const analysis = analyzeUsageInsights(unknownBundle())
  const duration = metric(analysis, 'execution.durationMs', 'controlled')
  assert.equal(duration?.value, null)
  assert.equal(duration?.nullReason, 'timing_missing')
  const ready = metric(analysis, 'review.readyToAcceptanceMs', 'controlled')
  assert.equal(ready?.value, null)
  assert.equal(ready?.nullReason, 'acceptance_unknown')
  assert.equal(metric(analysis, 'review.activeMs', 'controlled')?.nullReason, 'timing_missing')
  const tokens = metric(analysis, 'usage.inputTokens', 'controlled')
  assert.equal(tokens?.value, null)
  assert.equal(tokens?.nullReason, 'insufficient_data')
  assert.equal(tokens?.unknownCount, 1)
  assert.equal(metric(analysis, 'usage.cost'), undefined, 'no currency is invented when no cost was recorded')
  assert.equal(analysis.summary.usageCompleteness.recordsWithUnknownUsage, 1)
  assert.equal(analysis.summary.usageCompleteness.recordsWithoutCost, 1)
  // A complete work record with no interaction facts is a measured zero, not unknown.
  assert.equal(metric(analysis, 'interventions.total')?.value, 0)
  assert.equal(metric(analysis, 'interventions.total')?.sampleCount, 1)
})

test('layers are never merged and a truncated source cannot read as complete', () => {
  const analysis = analyzeUsageInsights(multiProjectBundle())
  assert.equal(metric(analysis, 'outcomes.count', 'controlled')?.value, 2)
  assert.equal(metric(analysis, 'outcomes.count', 'actual_native')?.value, 1)
  assert.equal(metric(analysis, 'execution.durationMs', 'controlled')?.value, 20_000)
  assert.equal(metric(analysis, 'execution.durationMs', 'actual_native')?.value, 20_000)
  assert.deepEqual(analysis.summary.projects.map(project => [project.projectId, project.outcomes]).sort(),
    [['project-atlas', 2], ['project-orbit', 1]])

  const truncated = analyzeUsageInsights(partialBundle())
  assert.equal(truncated.summary.coverage.overall, 'partial')
  assert.equal(truncated.summary.coverage.workEvidence, 'partial')
  assert.equal(truncated.summary.attention.coverage, 'partial')
  assert.notEqual(truncated.summary.limits.stoppedBy, 'none')
})

test('one identity with two bodies is quarantined and excluded, and a repeat is counted once', () => {
  const conflict = analyzeUsageInsights(conflictBundle())
  assert.equal(conflict.summary.quarantine.total, 1)
  assert.equal(conflict.summary.quarantine.byCode[0]?.code, 'identity_conflict')
  assert.equal(metric(conflict, 'outcomes.count'), undefined, 'a conflicted identity is not counted at all')
  assert.equal(conflict.summary.coverage.outcomes, 'partial')

  const bundle = completeBundle()
  const duplicated = { ...bundle, outcomes: [...bundle.outcomes, ...bundle.outcomes] } as UsageInsightsInput
  const replayed = analyzeUsageInsights(duplicated)
  assert.equal(metric(replayed, 'outcomes.count', 'controlled')?.value, 2)
  assert.equal(replayed.summary.quarantine.total, 0)
  assert.equal(metric(replayed, 'usage.inputTokens', 'controlled')?.value, 3_000)
})

test('records outside the window are kept as references and excluded from every metric', () => {
  const analysis = analyzeUsageInsights(outsideWindowBundle())
  assert.equal(metric(analysis, 'outcomes.count', 'controlled')?.value, 1)
  assert.equal(metric(analysis, 'outcomes.count', 'controlled')?.excludedCount, 1)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'outside_window')?.records, 1)
  assert.equal(analysis.subjects.filter(subject => subject.status === 'outside_window').length, 1)
  assert.ok(analysis.notes.some(note => note.includes('outside the observation window')))
})

test('an out-of-scope project is refused rather than mixed into the observation', () => {
  const bundle = multiProjectBundle()
  const scoped = { ...bundle, projects: [{ projectId: 'project-atlas' }] } as UsageInsightsInput
  const analysis = analyzeUsageInsights(scoped)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'out_of_scope_project')?.records, 2,
    'the foreign work and its outcome are both isolated')
  assert.equal(metric(analysis, 'outcomes.count', 'controlled')?.value, 1)
  assert.equal(metric(analysis, 'outcomes.count', 'actual_native')?.value, 1)
  assert.deepEqual(analysis.summary.projects.map(project => project.projectId), ['project-atlas'])
})

test('currencies stay separate and the token total never mixes with unknown usage', () => {
  const analysis = analyzeUsageInsights(multiCurrencyBundle())
  const costs = analysis.summary.metrics.filter(row => row.metricId === 'usage.cost')
  assert.deepEqual(costs.map(row => [row.currency, row.value]).sort(), [['EUR', 2.5], ['USD', 1.25]])
  assert.equal(metric(analysis, 'usage.inputTokens', 'controlled')?.value, 30)
  assert.equal(analysis.summary.usageCompleteness.recordsWithoutCost, 1)
})

test('queue waiting needs both endpoints bound to the same attempt', () => {
  assert.equal(metric(analyzeUsageInsights(queueBundle()), 'queue.waitMs', 'controlled')?.value, 150_000)
  const without = analyzeUsageInsights(completeBundle())
  const row = metric(without, 'queue.waitMs', 'controlled')
  assert.equal(row?.value, null)
  assert.equal(row?.nullReason, 'endpoint_missing')
  assert.ok(without.summary.limitations.some(text => text.includes('Queue waiting requires')))
})

test('baseline comparison is observational and refuses unusable inputs', () => {
  const comparable = analyzeUsageInsights(withBaseline(completeBundle(), {}))
  const status = comparable.summary.baseline
  assert.equal(status.status, 'comparable')
  assert.equal(status.observation, 'observational_only')
  assert.equal(status.delta, -10_000)
  assert.equal(status.ratio, 0.9)
  assert.equal(status.reasons.length, 0)

  const zero = analyzeUsageInsights(withBaseline(completeBundle(), { value: 0, sampleCount: 3 }))
  assert.equal(zero.summary.baseline.status, 'not_comparable')
  assert.equal(zero.summary.baseline.ratio, null)
  assert.ok(zero.summary.baseline.reasons.includes('zero_denominator'))

  const overlapping = analyzeUsageInsights(withBaseline(completeBundle(), {
    window: { from: FIXTURE_WINDOW.from, to: FIXTURE_WINDOW.to },
  }))
  assert.equal(overlapping.summary.baseline.status, 'insufficient_baseline')
  assert.ok(overlapping.summary.baseline.reasons.includes('window_overlap'))

  const otherLayer = analyzeUsageInsights(withBaseline(completeBundle(), { targetLayer: 'actual_native' }))
  assert.equal(otherLayer.summary.baseline.status, 'not_comparable')
  assert.equal(otherLayer.summary.baseline.measuredValue, null)
  assert.ok(otherLayer.summary.baseline.reasons.includes('measured_layer_or_currency_mismatch'))

  const partialBaseline = analyzeUsageInsights(withBaseline(completeBundle(), { coverage: 'caller_limit' }))
  assert.equal(partialBaseline.summary.baseline.status, 'insufficient_baseline')

  const none = analyzeUsageInsights(completeBundle())
  assert.equal(none.summary.baseline.status, 'not_requested')
  assert.equal(none.summary.baseline.measuredValue, null)
})

test('hand-entered operator notes never become measured facts', () => {
  const analysis = analyzeUsageInsights(withBaseline(completeBundle(), { operatorNote: 'we used to spend two days here' }))
  assert.equal(analysis.summary.baseline.operatorNote, 'we used to spend two days here')
  assert.equal(metric(analysis, 'execution.durationMs', 'controlled')?.value, 90_000)
  assert.ok(analysis.summary.limitations.some(text => text.includes('observational')))
})

test('attention is a bounded pending-age snapshot, not historical queue time', () => {
  const bundle = completeBundle()
  const withAttention = {
    ...bundle,
    attentionPages: [makeAttentionPage({
      items: [{
        id: 'attention-1', projectId: 'project-atlas', conversationId: 'conversation-1', contract: CONTRACT_ATLAS,
        workTitle: 'Work', summary: 'Waiting', sinceAt: '2026-11-13T11:00:00.000Z', deadlineAt: null, expiresAt: null,
        blockedWorkIds: [], kind: 'question', questionId: 'question-1', questionVersion: 1, questionKind: 'clarification',
      } as never],
      hasMore: true,
      nextCursor: 'cursor-2',
    })],
  } as UsageInsightsInput
  const analysis = analyzeUsageInsights(withAttention)
  assert.equal(analysis.summary.attention.items, 1)
  assert.equal(analysis.summary.attention.waitingAgeMs, 3_600_000)
  assert.equal(analysis.summary.attention.hasMore, true)
  assert.equal(analysis.summary.attention.coverage, 'partial')
  assert.ok(analysis.summary.limitations.some(text => text.includes('bounded')))
})

test('a malformed record is quarantined while valid records are still analysed', () => {
  const bundle = completeBundle()
  const broken = { ...bundle, outcomes: [...bundle.outcomes, { protocol: 'execution-outcome/1', id: 'broken' }] } as UsageInsightsInput
  const analysis = analyzeUsageInsights(broken)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'invalid_record')?.records, 1)
  assert.equal(metric(analysis, 'outcomes.count', 'controlled')?.value, 2)
  assert.equal(analysis.summary.coverage.outcomes, 'partial')
})

test('the envelope itself is strict: unknown fields and bad windows are refused', () => {
  const bundle = completeBundle() as unknown as Record<string, unknown>
  const isFault = (error: unknown) => (error as { name?: string }).name === 'UsageInsightsFault'
  assert.throws(() => analyzeUsageInsights({ ...bundle, extra: true }), isFault)
  assert.throws(() => analyzeUsageInsights({ ...bundle, window: { from: '2026-11-14T00:00:00.000Z', to: '2026-11-13T00:00:00.000Z' } }), isFault)
  assert.throws(() => analyzeUsageInsights({ ...bundle, timezone: 'Mars/Olympus' }),
    error => (error as Error).message.includes('time zone'))
})

test('reports escape untrusted text and state unknown explicitly', () => {
  const bundle = completeBundle()
  const hostile = {
    ...bundle,
    source: { ...bundle.source, descriptor: '<script>alert(1)</script> | `rm -rf /`' },
  } as UsageInsightsInput
  const markdown = renderMarkdown(analyzeUsageInsights(hostile))
  assert.equal(markdown.includes('<script>'), false)
  assert.ok(markdown.includes('Read-only observation'))
  assert.ok(markdown.includes('Missing reason') || markdown.includes('missing-reason'))
  const terminal = renderTerminal(analyzeUsageInsights(completeBundle()))
  assert.ok(terminal.includes('execution.durationMs'))
  assert.ok(terminal.includes('read-only observation'))
  assert.equal(safeText('a\nb\u0000c'), 'a b c')
})

test('a queue fact for an unobserved attempt is refused instead of matched loosely', () => {
  const bundle = queueBundle()
  const stranger = {
    projectId: 'project-atlas',
    attempt: { ticketId: 'f-other-ticket', assignmentId: 'f-other-assignment', contract: CONTRACT_ATLAS, attemptId: 'f-other-attempt', fenceEpoch: 1 },
    queuedAt: '2026-11-13T09:00:00.000Z',
    dispatchedAt: '2026-11-13T09:00:01.000Z',
    evidenceRef: 'queue-fact-2',
  }
  const analysis = analyzeUsageInsights({ ...bundle, queueFacts: [...(bundle.queueFacts ?? []), stranger] } as UsageInsightsInput)
  assert.equal(analysis.summary.quarantine.byCode.find(entry => entry.code === 'subject_mismatch')?.records, 1)
  assert.equal(metric(analysis, 'queue.waitMs', 'controlled')?.value, 150_000)
  assert.ok(analysis.summary.metrics.every(row => row.value === null || Number.isFinite(row.value)))
})

test('an empty but complete window is complete, not missing', () => {
  const bundle = completeBundle()
  const empty = { ...bundle, outcomes: [], workEvidence: [] } as UsageInsightsInput
  const analysis = analyzeUsageInsights(empty)
  assert.equal(analysis.summary.coverage.overall, 'complete')
  assert.equal(analysis.summary.quarantine.total, 0)
  assert.equal(metric(analysis, 'outcomes.count'), undefined, 'no layer appeared, so no layer metric exists')
  for (const intervention of analysis.summary.metrics) {
    assert.equal(intervention.value, 0, 'a complete empty window is a measured zero for interaction counts')
    assert.equal(intervention.nullReason, null)
    assert.equal(intervention.sampleCount, 0)
  }
  assert.equal(analysis.summary.usageCompleteness.tokensCompleteness, 'not_collected')
})
