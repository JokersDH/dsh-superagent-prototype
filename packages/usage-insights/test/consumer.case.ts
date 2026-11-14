import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import { toInsightConsumerView, observedOutcomeCount, metricRowKey } from '../src/facing.ts'
import { USAGE_INSIGHTS_COMPATIBILITY, type UsageInsightsInput } from '../src/protocol.ts'
import { renderMarkdown } from '../src/report.ts'
import { CONTRACT_ATLAS, CONTRACT_ORBIT, completeBundle, makeOutcome, makeWorkEvidence, unknownBundle } from './fixtures.ts'

/**
 * Local copy of the trial workspace consumer type (`apps/console/src/trial/insights.ts`).
 * Keeping a copy here turns any drift on either side into a compile error instead of a runtime guess.
 */
interface TrialInsightsMetric {
  readonly id: string
  readonly label: string
  readonly value: string | null
  readonly detail?: string
}
interface TrialInsightsView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  readonly windowLabel?: string
  readonly sampleCount: number | null
  readonly coverage?: string
  readonly metrics: readonly TrialInsightsMetric[]
  readonly limitations: readonly string[]
}

test('the consumer view is structurally assignable to the trial workspace type', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const view: TrialInsightsView = toInsightConsumerView(analysis.summary)
  assert.equal(view.status, 'ready')
  assert.equal(view.sampleCount, 2)
  assert.ok(view.metrics.length > 0)
  for (const metric of view.metrics) {
    assert.equal(typeof metric.id, 'string')
    assert.equal(typeof metric.label, 'string')
    assert.ok(metric.value === null || typeof metric.value === 'string')
  }
  assert.match(view.windowLabel ?? '', /UTC/)
})

test('a null value reaches the consumer as null, never as zero or an empty string', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const view = toInsightConsumerView(analysis.summary)
  const queue = view.metrics.find(metric => metric.id.startsWith('queue.waitMs'))
  assert.ok(queue, 'the queue metric is present even when unavailable')
  assert.equal(queue.value, null)
  assert.match(queue.detail ?? '', /未知 2/)
})

test('status separates ready, insufficient data and unavailable sources', () => {
  const ready = toInsightConsumerView(analyzeUsageInsights(completeBundle()).summary)
  assert.equal(ready.status, 'ready')

  const bundle = completeBundle()
  const empty = { ...bundle, outcomes: [], workEvidence: [] } as UsageInsightsInput
  const emptyAnalysis = analyzeUsageInsights(empty)
  const emptyView = toInsightConsumerView(emptyAnalysis.summary)
  assert.equal(emptyView.status, 'insufficient_data')
  assert.deepEqual(emptyView.metrics, [])
  assert.equal(emptyView.sampleCount, 0, 'a complete empty window is a measured zero sample count')

  const unavailable = analyzeUsageInsights({
    ...bundle,
    declaredCoverage: { outcomes: 'source_missing', workEvidence: 'source_missing', attention: 'source_missing' },
    outcomes: [],
    workEvidence: [],
  } as UsageInsightsInput)
  const unavailableView = toInsightConsumerView(unavailable.summary)
  assert.equal(unavailableView.status, 'unavailable')
  assert.equal(unavailableView.sampleCount, null, 'an unavailable source is an unknown count, not zero')
})

test('unknown metrics stay visible with an explicit detail instead of disappearing', () => {
  const view = toInsightConsumerView(analyzeUsageInsights(unknownBundle()).summary)
  const duration = view.metrics.find(metric => metric.id.startsWith('execution.durationMs'))
  assert.ok(duration)
  assert.equal(duration.value, null)
  assert.match(duration.detail ?? '', /覆盖/)
})

test('metric ids are unique per metric, layer and currency', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const ids = analysis.summary.metrics.map(metricRowKey)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(observedOutcomeCount(analysis.summary), 2)
})

test('a configuration snapshot is recorded but changes no metric', () => {
  const base = completeBundle()
  const withConfig = { ...base, configSnapshot: { kind: 'readiness', value: { status: 'ready' } } } as UsageInsightsInput
  const withoutConfig = analyzeUsageInsights(base)
  const withConfiguration = analyzeUsageInsights(withConfig)
  assert.deepEqual(withConfiguration.summary.metrics, withoutConfig.summary.metrics, 'configuration contributes no metric')
  assert.equal(withConfiguration.summary.configuration.observed, true)
  assert.equal(withConfiguration.summary.configuration.kind, 'readiness')
  assert.equal(withConfiguration.summary.configuration.authority, 'none')
  assert.equal(withoutConfig.summary.configuration.observed, false)
  assert.ok(withConfiguration.summary.limitations.some(text => text.includes('configuration/readiness')))
})

test('the compatibility policy is explicit and additive', () => {
  assert.equal(USAGE_INSIGHTS_COMPATIBILITY.protocol, 'usage-insights/1')
  assert.equal(USAGE_INSIGHTS_COMPATIBILITY.changePolicy, 'additive-only')
  assert.equal(USAGE_INSIGHTS_COMPATIBILITY.nullPolicy, 'null-means-unknown-never-zero')
  assert.equal(USAGE_INSIGHTS_COMPATIBILITY.authority, 'none')
})

test('the report explains each metric, cites identifiers and separates layers', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const markdown = renderMarkdown(analysis)
  assert.ok(markdown.includes('How each metric is computed'))
  assert.ok(markdown.includes('review.activeMs'), 'the UI-visibility proxy metric is documented')
  assert.ok(markdown.includes('Partial visibility proxy only'))
  assert.ok(markdown.includes('Record-level provenance'))
  assert.ok(markdown.includes(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count')?.provenanceRefs[0] ?? 'missing-ref'))
  assert.ok(markdown.includes('Observed subjects'))
  assert.ok(markdown.includes('| controlled |'))
  assert.equal(markdown.includes('we used to spend'), false)
})

test('two works with the same title stay separate, and a cross-work outcome is refused', () => {
  const atlasOutcome = makeOutcome({ seed: 'iso-a', projectId: 'project-atlas', acceptance: 'unknown' })
  const orbitOutcome = makeOutcome({ seed: 'iso-b', projectId: 'project-orbit', contract: CONTRACT_ORBIT, acceptance: 'unknown' })
  const title = 'Produce the same reported goal'
  const bundle = {
    ...completeBundle(),
    projects: [{ projectId: 'project-atlas' }, { projectId: 'project-orbit' }],
    outcomes: [atlasOutcome, orbitOutcome],
    workEvidence: [
      makeWorkEvidence(CONTRACT_ATLAS.workId, [{ kind: 'work.created', sourceRef: CONTRACT_ATLAS.workId, detail: { title } }], { outcomes: [atlasOutcome] }),
      makeWorkEvidence(CONTRACT_ORBIT.workId, [{ kind: 'work.created', sourceRef: CONTRACT_ORBIT.workId, detail: { title } }], { outcomes: [orbitOutcome] }),
    ],
  } as UsageInsightsInput
  const analysis = analyzeUsageInsights(bundle)
  assert.deepEqual(analysis.summary.projects.map(project => [project.projectId, project.outcomes]).sort(),
    [['project-atlas', 1], ['project-orbit', 1]])
  assert.equal(analysis.summary.quarantine.total, 0, 'identical titles never create a conflict or a join')
  assert.equal(new Set(analysis.subjects.map(subject => subject.subjectKey)).size, 2)

  // The real WorkEvidence schema refuses an outcome that belongs to another work.
  const crossed = {
    ...bundle,
    workEvidence: [makeWorkEvidence(CONTRACT_ATLAS.workId, [], { outcomes: [orbitOutcome] })],
    outcomes: [],
  } as UsageInsightsInput
  const rejected = analyzeUsageInsights(crossed)
  assert.equal(rejected.summary.quarantine.byCode.find(entry => entry.code === 'invalid_record')?.records, 1)
  assert.equal(rejected.summary.metrics.find(row => row.metricId === 'outcomes.count'), undefined)
})

test('an unrequested attention source does not downgrade a complete outcome window', () => {
  const bundle = completeBundle()
  const withoutAttention = {
    ...bundle,
    attentionPages: [],
    declaredCoverage: { ...bundle.declaredCoverage, attention: 'not_collected' },
  } as UsageInsightsInput
  const analysis = analyzeUsageInsights(withoutAttention)
  assert.equal(analysis.summary.coverage.attention, 'not_collected')
  assert.equal(analysis.summary.coverage.overall, 'complete', 'a scope choice is not data loss')
  assert.ok(analysis.summary.limitations.some(text => text.includes('Attention was not collected')))
  const view = toInsightConsumerView(analysis.summary)
  assert.equal(view.status, 'ready')
  assert.equal(analysis.summary.metrics.find(row => row.metricId === 'outcomes.count')?.value, 2)
})
