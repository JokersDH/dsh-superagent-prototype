/**
 * W34 acceptance: the exact symbols main imports stay importable and produce something main's own
 * contract accepts.
 *
 * main imports `buildSupportReport`, `buildSupportFile`, `readSupportDocument`, `readSupportFile` and
 * `supportLabels` from the package root and validates the result with `UsageSupportDownloadSchema`.
 * A rename, a shape drift or a changed filename scheme would break here before it breaks the product.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageSupportDownloadSchema } from '@personal-agent/contracts'
import {
  buildSupportFile, buildSupportReport, readSupportDocument, readSupportFile, supportLabels,
} from '../src/index.ts'

const observation = {
  protocol: 'usage-observation/1',
  observedAt: '2026-11-15T06:00:00.000Z',
  status: 'ready',
  summaryId: 'a'.repeat(64),
  days: 7,
  timezone: 'UTC',
  window: { from: '2026-11-08T06:00:00.000Z', to: '2026-11-15T06:00:00.000Z' },
  windowLabel: '近 7 天 · +00:00',
  coverage: '部分覆盖',
  coverageState: 'partial',
  scope: { projectIds: ['one'], aggregation: 'single_project', label: '当前项目' },
  sampleCount: 1,
  unknownCount: null,
  metrics: [
    { id: 'outcomes.count@controlled@', label: '已观察执行次数', value: '1', detail: '未知 0 · 部分或缺失', unit: 'count', layer: 'controlled', sampleCount: 1 },
    { id: 'queue.waitMs@controlled@', label: '平均记录排队耗时', value: null, detail: '未知 1 · 部分或缺失', unit: 'ms', layer: 'controlled', sampleCount: null },
  ],
  limitations: ['部分指标没有可核对值。'],
  authorization: 'none',
}

test('the imported surface produces a report main\'s contract accepts', () => {
  const report = buildSupportReport({ observation })
  const file = buildSupportFile(report)
  const envelope = UsageSupportDownloadSchema.parse({
    protocol: 'usage-support-download/1', report, fileName: file.fileName, mediaType: file.mediaType,
    text: file.text, bytes: file.bytes, sha256: file.sha256,
  })
  assert.equal(envelope.report.summaryId, observation.summaryId)
  assert.equal(envelope.report.origin, null)
  assert.equal(envelope.report.exportCapability, 'unverified')
  assert.equal(file.fileName.endsWith('-unknown-build.json'), true, 'no identity means no invented build label')

  const read = readSupportDocument(envelope)
  assert.equal(read.documentKind, 'support')
  assert.equal(read.digest.state, 'verified')
  const back = readSupportFile(JSON.parse(file.text))
  assert.equal(back.schema, 'current')
  assert.equal(back.report.counts.unknown, 1)
  assert.equal(supportLabels(report).packageLabel, undefined)
})

test('the report main builds without an origin keeps that origin absent', () => {
  const report = buildSupportReport({ observation: { ...observation, limitations: ['当前观察不完整。'] } })
  assert.equal(report.origin, null)
  assert.equal(report.exportCapability, 'unverified')
  assert.equal(report.evidence.partial, true)
  assert.deepEqual(report.evidence.absentFacts, ['1 row(s) have no observed value', 'the observation is partial'])
})
