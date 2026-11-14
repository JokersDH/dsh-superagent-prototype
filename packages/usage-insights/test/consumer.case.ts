import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import { consumerAdmission, consumerLayer, consumerScope, metricRowKey, observedOutcomeCount, toInsightConsumerView } from '../src/facing.ts'
import { USAGE_INSIGHTS_COMPATIBILITY, type UsageInsightsInput } from '../src/protocol.ts'
import { renderMarkdown } from '../src/report.ts'
import { CONTRACT_ATLAS, CONTRACT_ORBIT, completeBundle, makeOutcome, makeWorkEvidence, unknownBundle } from './fixtures.ts'

/**
 * Local copy of the trial workspace consumer contract (`apps/console/src/trial/insights.ts` at
 * main 967dc0c). Keeping a copy here turns any drift on either side into a compile error instead of a
 * runtime guess.
 */
type TrialInsightsLayer = 'observed' | 'controlled' | 'native' | 'operator' | 'unknown'
interface TrialInsightsMetric {
  readonly id: string
  readonly label: string
  readonly value: string | null
  readonly detail?: string
  readonly unit?: string
  readonly layer?: TrialInsightsLayer
  readonly sampleCount?: number | null
}
interface TrialInsightsScope {
  readonly projectIds: readonly string[]
  readonly aggregation: 'single_project' | 'declared_multi_project' | 'cross_project'
  readonly label?: string
}
interface TrialInsightsView {
  readonly status: 'ready' | 'insufficient_data' | 'unavailable'
  readonly windowLabel?: string
  readonly coverage?: string
  readonly coverageState?: 'complete' | 'partial' | 'unknown'
  readonly scope?: TrialInsightsScope
  readonly sampleCount: number | null
  readonly unknownCount?: number | null
  readonly metrics: readonly TrialInsightsMetric[]
  readonly limitations: readonly string[]
  readonly partial: boolean
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
    assert.equal(typeof metric.unit, 'string')
  }
  assert.match(view.windowLabel ?? '', /UTC/)
  assert.deepEqual(view.scope, { projectIds: ['project-atlas'], aggregation: 'single_project', label: 'project-atlas' })
  assert.equal(view.coverageState, 'complete')
  assert.equal(view.unknownCount, null, 'row unknowns count different things and are never summed')
})

test('the declared scope distinguishes one project from a cross-project aggregate', () => {
  const single = toInsightConsumerView(analyzeUsageInsights(completeBundle()).summary)
  assert.equal(single.scope?.aggregation, 'single_project')

  const bundle = completeBundle()
  const cross = analyzeUsageInsights({
    ...bundle,
    projects: [{ projectId: 'project-atlas' }, { projectId: 'project-orbit' }],
  } as UsageInsightsInput).summary
  const view = toInsightConsumerView(cross)
  assert.equal(view.scope?.aggregation, 'cross_project')
  assert.deepEqual(view.scope?.projectIds, ['project-atlas', 'project-orbit'])
  assert.match(view.scope?.label ?? '', /跨项目/)
  assert.ok(view.limitations.some(text => text.includes('aggregate 2 projects')))
})

test('metric rows carry their unit, evidence layer and a truthful sample count', () => {
  const analysis = analyzeUsageInsights(completeBundle())
  const view = toInsightConsumerView(analysis.summary)
  const duration = view.metrics.find(metric => metric.id.startsWith('execution.durationMs'))
  assert.equal(duration?.unit, 'ms')
  assert.equal(duration?.layer, 'controlled')
  assert.equal(duration?.sampleCount, 2)
  const interventions = view.metrics.find(metric => metric.id.startsWith('interventions.total'))
  assert.equal(interventions?.layer, 'observed', 'product interaction records are observed, not an evidence layer')
  const queue = view.metrics.find(metric => metric.id.startsWith('queue.waitMs'))
  assert.equal(queue?.value, null)
  assert.equal(queue?.sampleCount, null, 'an unavailable row has no sample count, not zero')
  assert.equal(consumerLayer('actual_native'), 'native')
  assert.equal(consumerLayer('operator_note'), 'operator')
  assert.equal(consumerLayer('schema'), 'unknown')
})

test('the Node admission mirror refuses the same views the workspace would hide', () => {
  const ready = toInsightConsumerView(analyzeUsageInsights(completeBundle()).summary)
  assert.deepEqual(consumerAdmission(ready), { admitted: true })
  assert.deepEqual(consumerAdmission(ready, 'project-atlas'), { admitted: true })
  assert.deepEqual(consumerAdmission(ready, 'project-orbit'), { admitted: false, reason: 'active_project_out_of_scope' })

  const empty = toInsightConsumerView(analyzeUsageInsights({
    ...completeBundle(), outcomes: [], workEvidence: [],
  } as UsageInsightsInput).summary)
  assert.deepEqual(consumerAdmission(empty), { admitted: false, reason: 'insufficient_data' })

  const unavailable = toInsightConsumerView(analyzeUsageInsights({
    ...completeBundle(), outcomes: [], workEvidence: [],
    declaredCoverage: { outcomes: 'source_missing', workEvidence: 'source_missing', attention: 'source_missing' },
  } as UsageInsightsInput).summary)
  assert.deepEqual(consumerAdmission(unavailable), { admitted: false, reason: 'unavailable' })

  const noScope = toInsightConsumerView(analyzeUsageInsights(completeBundle()).summary)
  const { scope: _scope, ...withoutScope } = noScope
  assert.deepEqual(consumerAdmission(withoutScope), { admitted: false, reason: 'scope_missing' })
  assert.deepEqual(consumerAdmission({ ...noScope, windowLabel: '' }), { admitted: false, reason: 'window_missing' })
  assert.deepEqual(consumerAdmission({ ...noScope, coverage: '' }), { admitted: false, reason: 'coverage_missing' })
  assert.deepEqual(consumerAdmission({ ...noScope, metrics: [] }), { admitted: false, reason: 'no_metrics' })
  assert.deepEqual(consumerScope(analyzeUsageInsights(completeBundle()).summary).projectIds, ['project-atlas'])
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
  assert.equal(emptyView.status, 'insufficient_data', 'nothing was observed, so nothing is presented as ready')
  assert.equal(emptyView.partial, false, 'the observation itself is complete, only empty')
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
  assert.deepEqual(unavailableView.metrics, [], 'an unavailable source exposes no metric rows')
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

test('quarantined records are never presented as a ready complete summary', () => {
  const bundle = completeBundle()
  const dirty = { ...bundle, outcomes: [...bundle.outcomes, { protocol: 'execution-outcome/1', id: 'broken' }] } as UsageInsightsInput
  const view = toInsightConsumerView(analyzeUsageInsights(dirty).summary)
  assert.equal(view.status, 'insufficient_data', 'a rejected record means the source is partly unknown')
  assert.equal(view.partial, true)
  assert.match(view.coverage ?? '', /被隔离/)
  assert.ok(view.limitations.some(text => text.includes('Rejected, conflicting or unparsed')))
})

test('a bounded but legal observation is partial, and keeps its numbers visible for inspection', () => {
  const analysis = analyzeUsageInsights({
    ...completeBundle(),
    declaredCoverage: { outcomes: 'caller_limit', workEvidence: 'complete', attention: 'complete' },
  } as UsageInsightsInput)
  const view = toInsightConsumerView(analysis.summary)
  assert.equal(view.status, 'ready', 'bounded but not rejected: the numbers are usable with a partial marker')
  assert.equal(view.partial, true)
  assert.equal(view.coverage, '部分')
  assert.ok(view.metrics.length > 0)
})

test('a stale attention snapshot makes the consumer partial without hiding outcome metrics', () => {
  const bundle = completeBundle()
  const stale = {
    ...bundle,
    attentionPages: [{
      protocol: 'attention-inbox/1', observedAt: '2026-11-13T06:00:00.000Z', items: [], ranks: [],
      ranking: 'waiting_order', scannedWorks: 0, questionCoverage: 'complete', hasMore: false,
    }],
  } as UsageInsightsInput
  const view = toInsightConsumerView(analyzeUsageInsights(stale).summary)
  assert.equal(view.partial, true)
  assert.equal(view.coverage, '部分')
  assert.ok(view.metrics.some(metric => metric.id.startsWith('outcomes.count')))
})
