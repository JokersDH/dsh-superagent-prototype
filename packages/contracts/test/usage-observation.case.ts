import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageObservationQuerySchema, UsageObservationSchema } from '../src/index.ts'

const view = { protocol: 'usage-observation/1', observedAt: '2026-11-14T04:00:00.000Z',
  window: { from: '2026-11-07T04:00:00.000Z', to: '2026-11-14T04:00:00.000Z' }, days: 7, timezone: 'Asia/Shanghai',
  windowLabel: '最近7天', status: 'ready', summaryId: 'a'.repeat(64), coverage: '部分覆盖', coverageState: 'partial',
  scope: { projectIds: ['one'], aggregation: 'single_project', label: '当前项目' }, sampleCount: 1, unknownCount: null,
  metrics: [{ id: 'usage', label: '输入', value: null, detail: '未知1', unit: 'tokens', layer: 'controlled', sampleCount: 0 }],
  limitations: [], authorization: 'none' }
test('usage display protocol preserves scoped unknown observations and rejects authority or mismatched windows', () => {
  assert.deepEqual(UsageObservationSchema.parse(view), view)
  for (const update of [{ authorization: 'granted' }, { principal: 'secret' }, { apiToken: 'secret' }, { days: 30 },
    { metrics: [...view.metrics, ...view.metrics] }, { scope: { ...view.scope, projectIds: [] } },
    { window: { ...view.window, to: '2026-11-14T05:00:00.000Z' } }, { status: 'unavailable' }])
    assert.equal(UsageObservationSchema.safeParse({ ...view, ...update }).success, false)
})
test('usage query permits only fixed windows, known timezones and a project reference', () => {
  assert.deepEqual(UsageObservationQuerySchema.parse({ projectId: 'one', days: 30, timezone: 'Asia/Shanghai' }),
    { projectId: 'one', days: 30, timezone: 'Asia/Shanghai' })
  for (const value of [{ days: 365 }, { timezone: 'invalid-zone' }, { projects: ['one', 'foreign'] }, { path: '/private' }, { authorization: 'none' }])
    assert.equal(UsageObservationQuerySchema.safeParse(value).success, false)
})
