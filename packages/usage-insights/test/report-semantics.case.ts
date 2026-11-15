/**
 * G9-G12 acceptance: the human-readable report keeps layers and currencies separate, keeps a partial
 * proxy row partial next to a complete source, and never turns unknown usage into zero.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeUsageInsights } from '../src/analyze.ts'
import type { UsageInsightsInput } from '../src/protocol.ts'
import { renderMarkdown } from '../src/report.ts'
import { completeBundle, makeOutcome } from './fixtures.ts'

const window = { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' }

function bundle(outcomes: unknown[]): UsageInsightsInput {
  return {
    ...completeBundle(),
    outcomes,
    workEvidence: [],
  } as UsageInsightsInput
}

const controlled = makeOutcome({
  seed: 'report-c', acceptance: 'unknown', layer: 'controlled', inputTokens: 12,
  cost: { currency: 'USD', amount: 1.25 }, durationMs: 2_000,
})
const native = makeOutcome({
  seed: 'report-n', acceptance: 'unknown', layer: 'actual_native', inputTokens: 30,
  cost: { currency: 'EUR', amount: 2.5 }, durationMs: 4_000,
})

test('the report keeps one row per layer and per currency and never prints a combined total', () => {
  const analysis = analyzeUsageInsights(bundle([controlled, native]))
  const markdown = renderMarkdown(analysis)
  const durationRows = markdown.split('\n').filter(line => line.startsWith('| execution.durationMs |'))
  assert.equal(durationRows.length, 2, 'one duration row per evidence layer')
  assert.ok(durationRows.some(line => line.includes('controlled')))
  assert.ok(durationRows.some(line => line.includes('actual_native')))
  assert.equal(durationRows.some(line => /3000|3,000/.test(line)), false, 'layers are never averaged together')

  const costRows = markdown.split('\n').filter(line => line.startsWith('| usage.cost |'))
  assert.equal(costRows.length, 2, 'one cost row per currency')
  assert.ok(costRows.some(line => line.includes('USD') && line.includes('1.25')))
  assert.ok(costRows.some(line => line.includes('EUR') && line.includes('2.5')))
  assert.equal(costRows.some(line => /3\.75|3,75/.test(line)), false, 'currencies are never added')
  assert.ok(markdown.includes('Currencies are grouped per recorded currency') || markdown.includes('per recorded currency'))
})

test('a partial proxy row stays partial while the source stays complete', () => {
  const accepted = makeOutcome({
    seed: 'report-proxy', acceptance: 'accepted', accepted: true, readyToAcceptanceMs: 3_000, activeReviewMs: 900,
    durationMs: 5_000,
  })
  const analysis = analyzeUsageInsights(bundle([accepted]))
  assert.equal(analysis.summary.coverage.overall, 'complete')
  const markdown = renderMarkdown(analysis)
  const proxyRow = markdown.split('\n').find(line => line.startsWith('| review.activeMs |'))
  assert.ok(proxyRow)
  assert.ok(proxyRow.includes('partial'), 'the proxy row carries its own partial coverage')
  const headerRow = markdown.split('\n').find(line => line.startsWith('| outcomes.count |'))
  assert.ok(headerRow?.includes('complete'))
  assert.ok(markdown.includes('partial UI-visibility proxy') || markdown.includes('UI-visibility proxy'))
})

test('unknown usage and cost are printed as unavailable, never as zero', () => {
  const unknown = makeOutcome({ seed: 'report-unknown', acceptance: 'unknown' })
  const analysis = analyzeUsageInsights(bundle([unknown]))
  const markdown = renderMarkdown(analysis)
  const tokenRow = markdown.split('\n').find(line => line.startsWith('| usage.inputTokens |'))
  assert.ok(tokenRow)
  assert.ok(tokenRow.includes('—'), 'a dash marks the missing value')
  assert.ok(tokenRow.includes('insufficient data'))
  assert.equal(/^\| usage\.cost \|/m.test(markdown), false, 'no cost row is invented without a recorded currency')
  assert.ok(markdown.includes('Records without cost: 1'))
})

test('the report states the window, projects and coverage it actually observed', () => {
  const analysis = analyzeUsageInsights({
    ...bundle([controlled]),
    projects: [{ projectId: 'project-atlas' }, { projectId: 'project-orbit' }],
  } as UsageInsightsInput)
  const markdown = renderMarkdown(analysis)
  assert.ok(markdown.includes(window.from))
  assert.ok(markdown.includes(window.to))
  assert.ok(markdown.includes('project-atlas'))
  assert.ok(markdown.includes('project-orbit'))
  assert.ok(markdown.includes('## Coverage'))
  assert.ok(markdown.includes('## Source losses'))
})

test('without a comparable baseline the report says so and prints no benefit figure', () => {
  const analysis = analyzeUsageInsights(bundle([controlled, native]))
  const markdown = renderMarkdown(analysis)
  assert.ok(markdown.includes('No operator baseline was supplied'))
  assert.equal(/\d+%|percent|saved hours|节省/i.test(markdown.split('## Baseline comparison')[1] ?? ''), false,
    'no percentage or saved-hours claim appears in the baseline section')
  assert.equal(markdown.includes('observational only'), false, 'nothing is compared when no baseline exists')
})
