/**
 * G1-G4, G13 acceptance: the *actual* `/v1/insights` route, its real reader and the DTO it serves.
 *
 * The route mounts main's `ProductUsageObservation` over controlled readers. These assertions check the
 * served semantics G is responsible for — header sample vs row samples, row identity stability, layer
 * and currency rows, unknown values — plus the route's own authentication and query validation, all
 * from G's harness so a change in either side fails here.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { UsageObservationSchema } from '@personal-agent/contracts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'
const TOKEN = 'c'.repeat(64)
const BEARER = { authorization: `Bearer ${TOKEN}` }

const evidence = (workId: string, outcomes: unknown[] = [], at = '2026-11-15T05:00:00.000Z'): WorkEvidence => ({
  protocol: 'work-evidence/1',
  workId,
  projection: 'recorded',
  entries: [{ at, kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'],
  truncated: false,
})

function reader(options: {
  works?: { id: string; projectId: string }[]
  evidenceFor?: (workId: string) => WorkEvidence
  projectIds?: string[]
  hasMore?: boolean
} = {}) {
  const works = options.works ?? [
    { id: 'work-a', projectId: 'one' },
    { id: 'work-b', projectId: 'two' },
  ]
  return new ProductUsageObservation({
    projectIds: () => options.projectIds ?? ['one', 'two'],
    cursor: () => 1,
    listWorks: (projectIds, limit) => ({ works: works.filter(work => projectIds.includes(work.projectId)).slice(0, limit), hasMore: options.hasMore ?? false }),
    workEvidence: async workId => options.evidenceFor?.(workId) ?? evidence(workId),
  }, () => AT)
}

function app(observation = reader(), overrides: Record<string, unknown> = {}) {
  return createLocalHttpApp({
    application: {} as never,
    principal: { userId: 'insights-reader', authorityRef: 'insights-reader-authority' },
    apiToken: TOKEN,
    bootstrapToken: 'd'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4700'],
    mode: 'personal',
    read: { usageObservation: (query: never) => observation.read(query) },
    ...overrides,
  } as never)
}

const get = (value: ReturnType<typeof app>, suffix = '', headers: Record<string, string> = BEARER) =>
  value.request(`http://127.0.0.1/v1/insights${suffix}`, { headers })

const row = (dto: UsageObservation, metricId: string) => dto.metrics.find(metric => metric.id.startsWith(`${metricId}@`))

test('positive: GET /v1/insights serves the analyzed two-project observation', { skip }, async () => {
  const outcome = makeOutcome({
    seed: 'route-1', acceptance: 'unknown', projectId: 'one', durationMs: 3_000, inputTokens: 42,
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
    observedAt: '2026-11-15T05:30:00.000Z',
  })
  const value = app(reader({ evidenceFor: workId => evidence(workId, workId === 'work-a' ? [outcome] : []) }))
  const response = await get(value, '?days=7&timezone=UTC')
  assert.equal(response.status, 200)
  const dto = UsageObservationSchema.parse(await response.json())
  assert.equal(dto.authorization, 'none')
  assert.equal(dto.status, 'ready')
  assert.equal(dto.days, 7)
  assert.deepEqual(new Set(dto.scope.projectIds), new Set(['one', 'two']))
  assert.equal(dto.scope.aggregation, 'declared_multi_project')
  assert.equal(dto.sampleCount, 2, 'the header counts the enumerated works')
  assert.equal(row(dto, 'outcomes.count')?.value, '1', 'the outcome row counts its own records')
  assert.equal(row(dto, 'interventions.questions')?.value, '2')
  assert.equal(row(dto, 'usage.inputTokens')?.value, '42')
  assert.equal(dto.summaryId?.length, 64)
  assert.equal(JSON.stringify(dto).includes('work-a'), false, 'no work identity is served')

  const thirty = await get(value, '?days=30&timezone=UTC')
  const dtoThirty = UsageObservationSchema.parse(await thirty.json())
  assert.equal(dtoThirty.days, 30)
  assert.equal(Date.parse(dtoThirty.window.to) - Date.parse(dtoThirty.window.from), 30 * 86_400_000)
  assert.deepEqual(dtoThirty.metrics, dto.metrics, 'the facts are inside both windows')
})

test('row identity is unique and stable across repeated reads', { skip }, async () => {
  const dto = async () => UsageObservationSchema.parse(await (await get(app(), '?days=7')).json())
  const first = await dto()
  const second = await dto()
  const ids = first.metrics.map(metric => metric.id)
  assert.equal(new Set(ids).size, ids.length, 'one identity per metric, layer and currency')
  assert.deepEqual(second.metrics.map(metric => metric.id), ids, 'the order and identities are stable')
  assert.deepEqual(second.metrics.map(metric => metric.value), first.metrics.map(metric => metric.value))
  for (const metric of first.metrics) {
    assert.match(metric.id, /^[a-z][A-Za-z.]*@/)
    assert.equal(metric.unit === '' || typeof metric.unit === 'string', true)
  }
})

test('the route refuses a missing credential, a foreign project and an invalid query', { skip }, async () => {
  assert.equal((await get(app(), '', {})).status, 401)
  assert.equal((await get(app(), '?projectId=foreign')).status, 403)
  for (const query of ['?days=14', '?days=abc', '?timezone=Mars%2FOlympus', '?projectId=one&projectId=two', '?grant=true'])
    assert.equal((await get(app(), query)).status, 400, query)
})

test('a response whose scope contradicts the request is refused, not served', { skip }, async () => {
  const mismatched = app({
    read: async (query: { projectId?: string }) => {
      const value = await reader().read({ ...query, projectId: 'two' })
      return { ...value, scope: { ...value.scope, projectIds: ['two'], aggregation: 'single_project' } }
    },
  } as never)
  assert.equal((await get(mismatched, '?projectId=one')).status, 503)
})

test('a readonly startup still serves the observation', { skip }, async () => {
  const response = await get(app(reader(), { startupMode: 'recovery_readonly' }), '?days=7')
  assert.equal(response.status, 200)
  assert.equal(UsageObservationSchema.parse(await response.json()).authorization, 'none')
})

test('an unavailable reader is a clear refusal rather than an empty result', { skip }, async () => {
  const missing = createLocalHttpApp({
    application: {} as never,
    principal: { userId: 'insights-reader', authorityRef: 'insights-reader-authority' },
    apiToken: TOKEN, bootstrapToken: 'd'.repeat(64), allowedOrigins: ['http://127.0.0.1:4700'], mode: 'personal',
    read: {},
  } as never)
  const response = await get(missing, '?days=7')
  // The product maps unsupported_capability to 422 and storage_unavailable to 503.
  assert.equal(response.status, 422)
  const body = await response.json() as { error?: { code?: string } }
  assert.equal(body.error?.code, 'unsupported_capability')
})
