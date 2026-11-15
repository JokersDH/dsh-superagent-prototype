/**
 * G1-G3, G7, G17 acceptance: verify the *actual* coordinator reader and the *actual* trial-workspace
 * admission against G's analysis.
 *
 * These tests import `ProductUsageObservation` (main's authorized public reader) and
 * `trialInsightsAdmission` (F's real admission function) rather than a local mirror, so a drift in
 * either consumer breaks this suite instead of being hidden behind a copied interface.
 *
 * The reader loads `@personal-agent/usage-insights` from its built entry, so `dist/` must be built.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import { trialInsightsAdmission, trialInsightsCount } from '../../../apps/console/src/trial/insights.ts'
import type { TrialInsightsView } from '../../../apps/console/src/trial/insights.ts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const hasDist = existsSync(resolve(here, '../dist/index.js'))
const skip = hasDist ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T04:00:00.000Z'
const DAY = 86_400_000

interface EvidenceOptions {
  entries?: { at?: string; sourceRef?: string }[]
  outcomes?: unknown[]
  projection?: 'recorded' | 'source_missing' | 'not_in_window' | 'not_accepted'
  truncated?: boolean
}

const evidence = (workId: string, options: EvidenceOptions = {}) => ({
  protocol: 'work-evidence/1',
  workId,
  projection: options.projection ?? 'recorded',
  entries: (options.entries ?? []).map(entry => ({
    at: entry.at ?? '2026-11-15T03:00:00.000Z',
    kind: 'question.opened',
    sourceRef: entry.sourceRef ?? `${workId}-question`,
    detail: {},
  })),
  outcomes: options.outcomes ?? [],
  truncated: options.truncated ?? false,
})

/** A reader set exactly like main's: a scoped work list plus per-work evidence. */
function readers(works: { id: string; projectId: string }[], evidenceFor: (workId: string) => unknown, options: {
  hasMore?: boolean
  projectIds?: string[]
  cursor?: () => number
} = {}) {
  return {
    projectIds: () => options.projectIds ?? ['one', 'two'],
    cursor: options.cursor ?? (() => 0),
    listWorks: (projectIds: readonly string[], limit: number) => ({
      works: works.filter(work => projectIds.includes(work.projectId)).slice(0, limit),
      hasMore: options.hasMore ?? false,
    }),
    workEvidence: async (workId: string) => evidenceFor(workId) as WorkEvidence,
  }
}

const read = (readerOptions: Parameters<typeof readers>, query: Record<string, unknown> = {}) =>
  new ProductUsageObservation(readers(...readerOptions), () => AT).read(query)

const row = (dto: UsageObservation, metricId: string) =>
  dto.metrics.find(metric => metric.id.startsWith(`${metricId}@`) || metric.id === metricId)

test('positive: the real reader produces a DTO the real workspace admits', { skip }, async () => {
  const dto = await read([
    [{ id: 'work-one', projectId: 'one' }, { id: 'work-two', projectId: 'two' }],
    workId => evidence(workId, { entries: [{}] }),
  ])
  // The DTO is structurally the workspace's view type: compile-time, not a copied interface.
  // A compile-time proof that the coordinator DTO is the workspace's view type.
  const view: TrialInsightsView = dto
  assert.equal(view.status, 'ready')
  assert.deepEqual(new Set(view.scope?.projectIds), new Set(['one', 'two']))
  assert.equal(view.scope?.aggregation, 'declared_multi_project')
  assert.equal(dto.authorization, 'none')
  assert.equal(dto.days, 7)
  assert.equal(typeof dto.summaryId, 'string')
  assert.equal(dto.window.to, dto.observedAt, 'the window ends exactly at the observation time')
  assert.equal(Date.parse(dto.window.to) - Date.parse(dto.window.from), 7 * DAY)

  const all = trialInsightsAdmission(view)
  assert.equal(all.admitted, true, all.message)
  assert.equal(trialInsightsAdmission(view, 'one').admitted, true)
  assert.equal(trialInsightsAdmission(view, 'foreign').admitted, false, 'a project outside the scope hides the rows')
  assert.match(trialInsightsCount(view), /2/)
})

test('header samples are enumerated works while each row keeps its own sample count', { skip }, async () => {
  const outcome = makeOutcome({
    seed: 'header-1', acceptance: 'unknown', durationMs: 5_000, projectId: 'one',
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
    observedAt: '2026-11-15T03:10:00.000Z',
  })
  const dto = await read([
    [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'one' }, { id: 'work-c', projectId: 'one' }],
    workId => evidence(workId, workId === 'work-a'
      ? { entries: [{}], outcomes: [outcome] }
      : { entries: [] }),
  ])
  assert.equal(dto.sampleCount, 3, 'the header counts the works the reader enumerated')
  assert.equal(row(dto, 'outcomes.count')?.sampleCount, 1, 'the outcome row counts its own records')
  assert.equal(row(dto, 'interventions.questions')?.sampleCount, 3, 'the interaction row counts the observed works')
  assert.equal(row(dto, 'interventions.questions')?.value, '1')
  assert.equal(dto.unknownCount, null, 'unknown counts of different things are not summed')
})

test('7 and 30 day windows select different facts from the same records', { skip }, async () => {
  const tenDaysAgo = new Date(Date.parse(AT) - 10 * DAY).toISOString()
  const oldOutcome = makeOutcome({
    seed: 'window-old', acceptance: 'unknown', projectId: 'one',
    contract: { workId: 'work-old', revision: 1, digest: 'b'.repeat(64) },
    observedAt: tenDaysAgo,
  })
  const readerOptions: Parameters<typeof readers> = [
    [{ id: 'work-old', projectId: 'one' }],
    workId => evidence(workId, {
      entries: [{ at: tenDaysAgo }],
      outcomes: [oldOutcome],
      // The reader narrows evidence itself; this fixture is pre-narrowed for the 30-day case.
    }),
  ]
  const seven = await read(readerOptions, { days: 7 })
  assert.equal(seven.days, 7)
  assert.equal(Date.parse(seven.window.to) - Date.parse(seven.window.from), 7 * DAY)
  assert.equal(row(seven, 'interventions.questions')?.value, '0', 'a 10-day-old question is outside 7 days')
  assert.equal(seven.status, 'ready', 'the work was still observed, so the zero is known')

  const thirty = await read(readerOptions, { days: 30 })
  assert.equal(thirty.days, 30)
  assert.equal(Date.parse(thirty.window.to) - Date.parse(thirty.window.from), 30 * DAY)
  assert.equal(row(thirty, 'interventions.questions')?.value, '1', 'the same fact is inside a 30-day window')
  assert.equal(row(thirty, 'outcomes.count')?.value, '1')
  await assert.rejects(read(readerOptions, { days: 14 }), (error: unknown) =>
    (error as { name?: string }).name === 'ZodError' || (error as { code?: string }).code === 'invalid_request')
})

test('layers and currencies stay independent rows in the real DTO', { skip }, async () => {
  const controlled = makeOutcome({
    seed: 'layer-c', acceptance: 'unknown', projectId: 'one', layer: 'controlled', inputTokens: 10,
    cost: { currency: 'USD', amount: 1.5 },
    contract: { workId: 'work-l', revision: 1, digest: 'c'.repeat(64) },
    observedAt: '2026-11-15T03:10:00.000Z',
  })
  const native = makeOutcome({
    seed: 'layer-n', acceptance: 'unknown', projectId: 'one', layer: 'actual_native', inputTokens: 20,
    cost: { currency: 'EUR', amount: 2.5 },
    contract: { workId: 'work-l', revision: 1, digest: 'c'.repeat(64) },
    observedAt: '2026-11-15T03:11:00.000Z',
  })
  const dto = await read([
    [{ id: 'work-l', projectId: 'one' }],
    workId => evidence(workId, { entries: [], outcomes: [controlled, native] }),
  ])
  const tokens = dto.metrics.filter(metric => metric.id.startsWith('usage.inputTokens@'))
  assert.equal(tokens.length, 2, 'one row per evidence layer')
  assert.equal(tokens.some(metric => metric.layer === 'controlled'), true)
  assert.equal(tokens.some(metric => metric.layer === 'native'), true, 'a recorded actual_native label maps to native')
  const usd = dto.metrics.find(metric => metric.id.includes('usage.cost') && metric.unit === 'USD')
  const eur = dto.metrics.find(metric => metric.id.includes('usage.cost') && metric.unit === 'EUR')
  assert.ok(usd && eur, 'one cost row per currency')
  assert.notEqual(usd.id, eur.id)
  assert.equal(dto.metrics.filter(metric => metric.id.startsWith('usage.cost@')).length, 2, 'currencies are never combined')
})

test('unknown usage and a partial review proxy stay visible per row', { skip }, async () => {
  const unknown = makeOutcome({
    seed: 'usage-unknown', acceptance: 'accepted', accepted: true, projectId: 'one', readyToAcceptanceMs: 4_000, activeReviewMs: 1_200,
    contract: { workId: 'work-u', revision: 1, digest: 'd'.repeat(64) },
    observedAt: '2026-11-15T03:12:00.000Z',
  })
  const dto = await read([[{ id: 'work-u', projectId: 'one' }], workId => evidence(workId, { entries: [], outcomes: [unknown] })])
  assert.equal(row(dto, 'usage.inputTokens')?.value, null, 'a controlled execution records no tokens: unknown, never zero')
  assert.equal(row(dto, 'usage.cost'), undefined, 'no cost row is invented without a currency')
  const proxy = row(dto, 'review.activeMs')
  assert.ok(proxy)
  assert.match(proxy.detail, /部分或缺失/, 'the UI-visibility proxy row is partial')
  // Finding for main: the coordinator currently folds a partial *row* into the header
  // `coverageState`, so an otherwise completely enumerated source is reported as partial whenever a
  // proxy row exists. G's own projection keeps source coverage and row coverage separate; this test
  // records the consumer's actual behaviour rather than assuming G's semantics.
  assert.equal(dto.coverageState, 'partial', 'the coordinator marks the header partial when any row is partial')
})

test('a bounded or missing source never returns a complete header sample', { skip }, async () => {
  const bounded = await read([[{ id: 'work-a', projectId: 'one' }], workId => evidence(workId, { entries: [{}] })], {})
  assert.equal(bounded.sampleCount, 1)

  const paged = await new ProductUsageObservation(readers(
    [{ id: 'work-a', projectId: 'one' }], workId => evidence(workId, { entries: [{}] }), { hasMore: true },
  ), () => AT).read({})
  assert.equal(paged.coverageState, 'partial')
  assert.equal(paged.sampleCount, null, 'a bounded enumeration has no complete header sample')

  let calls = 0
  const missing = await new ProductUsageObservation(readers(
    [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'one' }],
    () => { if (++calls === 1) throw new Error('/private/home/secret'); return evidence('work-b', { entries: [{}] }) },
  ), () => AT).read({})
  assert.equal(missing.coverageState, 'partial')
  assert.equal(missing.sampleCount, null)
  assert.equal(JSON.stringify(missing).includes('private/home'), false, 'a reader error text never reaches the DTO')
})

test('the real reader refuses a foreign project and a conflicting work identity', { skip }, async () => {
  await assert.rejects(read([[{ id: 'work-a', projectId: 'one' }], () => evidence('work-a')], { projectId: 'foreign' }),
    (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'forbidden')
  const duplicate = {
    projectIds: () => ['one', 'two'],
    cursor: () => 0,
    listWorks: () => ({ works: [{ id: 'w', projectId: 'one' }, { id: 'w', projectId: 'one' }], hasMore: false }),
    workEvidence: async () => evidence('w') as WorkEvidence,
  }
  await assert.rejects(new ProductUsageObservation(duplicate, () => AT).read({}),
    (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'storage_unavailable')
})

test('the reader deadline bounds a slow source instead of waiting', { skip }, async () => {
  const started = Date.now()
  const dto = await new ProductUsageObservation(readers(
    [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'one' }],
    workId => new Promise<WorkEvidence>(resolve => setTimeout(() => resolve(evidence(workId, { entries: [{}] }) as WorkEvidence), 2_200)),
  ), () => AT).read({})
  const elapsed = Date.now() - started
  assert.ok(elapsed < 5_000, `the observation must stay bounded, took ${elapsed}ms`)
  assert.equal(dto.coverageState, 'partial', 'a timed-out source is partial, never complete')
  assert.equal(dto.sampleCount, null)
})

test('the window is half-open: the start edge counts, the end edge does not', { skip }, async () => {
  const from = new Date(Date.parse(AT) - 7 * DAY).toISOString()
  const dto = await read([
    [{ id: 'work-edge', projectId: 'one' }],
    workId => evidence(workId, { entries: [{ at: from, sourceRef: 'at-start' }, { at: AT, sourceRef: 'at-end' }] }),
  ])
  assert.equal(row(dto, 'interventions.questions')?.value, '1', 'only the fact at the inclusive start edge counts')
  assert.equal(dto.window.from, from)
  assert.equal(dto.window.to, AT)
})

test('repeating the same observation does not accumulate facts', { skip }, async () => {
  const readerOptions: Parameters<typeof readers> = [
    [{ id: 'work-a', projectId: 'one' }, { id: 'work-b', projectId: 'two' }],
    workId => evidence(workId, { entries: [{}] }),
  ]
  const first = await read(readerOptions)
  const second = await read(readerOptions)
  assert.deepEqual(second.metrics, first.metrics, 'a second read of the same window reports the same numbers')
  assert.equal(second.sampleCount, first.sampleCount)
  assert.equal(second.scope.aggregation, 'declared_multi_project')
})

test('the DTO carries no pending-attention or raw-source section', { skip }, async () => {
  const dto = await read([[{ id: 'work-a', projectId: 'one' }], workId => evidence(workId, { entries: [{}] })])
  const keys = Object.keys(dto).sort()
  assert.deepEqual(keys, [
    'authorization', 'coverage', 'coverageState', 'days', 'limitations', 'metrics', 'observedAt', 'protocol',
    'sampleCount', 'scope', 'status', 'summaryId', 'timezone', 'unknownCount', 'window', 'windowLabel',
  ])
  assert.equal('attention' in dto, false, 'current attention is a separate snapshot in the product, not part of this DTO')
})

test('the workspace admission refuses a view that loses its declaration', { skip }, async () => {
  const dto = await read([[{ id: 'work-a', projectId: 'one' }], workId => evidence(workId, { entries: [{}] })])
  // These mutations model a consumer passing an incomplete view; the workspace must hide the rows.
  assert.equal(trialInsightsAdmission({ ...dto, windowLabel: '' }).admitted, false)
  assert.equal(trialInsightsAdmission({ ...dto, coverage: '' }).admitted, false)
  assert.equal(trialInsightsAdmission({ ...dto, metrics: [] }).admitted, false)
  assert.equal(trialInsightsAdmission({ ...dto, scope: { ...dto.scope, projectIds: [] } }).admitted, false)
  assert.equal(trialInsightsAdmission({ ...dto, status: 'unavailable' }).admitted, false)
  assert.equal(trialInsightsAdmission({ ...dto, status: 'insufficient_data' }).admitted, false)
  // The untampered view stays admissible for its own declared projects only.
  assert.equal(trialInsightsAdmission(dto, 'one').admitted, true)
  assert.equal(trialInsightsAdmission(dto, 'two').admitted, true, 'both projects are declared by this observation')
  const single = await read([[{ id: 'work-a', projectId: 'one' }], workId => evidence(workId, { entries: [{}] })], { projectId: 'one' })
  assert.deepEqual(single.scope.projectIds, ['one'])
  assert.equal(single.scope.aggregation, 'single_project')
  assert.equal(trialInsightsAdmission(single, 'one').admitted, true)
  assert.equal(trialInsightsAdmission(single, 'two').admitted, false, 'a project outside the declared scope hides the rows')
})
