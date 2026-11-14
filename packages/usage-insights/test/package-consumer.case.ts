/**
 * G18 acceptance: the built package is consumable exactly as shipped.
 *
 * A consumer must be able to import the Node entry for analysis and the browser entry for the
 * projection, without inheriting the analysis dependency (node:crypto) in the browser graph or being
 * forced to reimplement scope/limit/unknown logic.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
  files: string[]
}
const distRoot = resolve(packageRoot, 'dist')
const hasDist = existsSync(resolve(distRoot, 'index.js'))

test('the package declares a Node entry and a separate browser entry', () => {
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './browser', './package.json', './protocol'].sort())
  assert.equal(manifest.files.includes('dist'), true)
})

test('the built Node entry analyses and projects exactly like the sources', { skip: !hasDist }, async () => {
  const built = await import(pathToFileURL(resolve(distRoot, 'index.js')).href) as typeof import('../src/index.ts')
  const sources = await import('../src/index.ts')
  const bundle = {
    protocol: 'usage-insights-input/1',
    inputId: 'package-consumer',
    capturedAt: '2026-11-13T12:00:00.000Z',
    timezone: 'UTC',
    window: { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' },
    projects: [{ projectId: 'project-atlas' }],
    source: { kind: 'synthetic_fixture', descriptor: 'package consumer', digest: null, layerAssertion: 'recorded_by_producer', capturedAt: '2026-11-13T12:00:00.000Z' },
    declaredCoverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete' },
    outcomes: [], attentionPages: [], workEvidence: [],
  }
  const fromBuilt = built.analyzeUsageInsights(bundle)
  const fromSource = sources.analyzeUsageInsights(bundle)
  assert.equal(fromBuilt.summary.summaryId, fromSource.summary.summaryId, 'the build and the sources agree')
  const view = built.toInsightConsumerView(fromBuilt.summary)
  assert.equal(built.consumerAdmission(view).admitted, false, 'an empty window is not admitted as measurements')
})

test('the built browser entry loads without the Node analysis module', { skip: !hasDist }, async () => {
  const browser = await import(pathToFileURL(resolve(distRoot, 'browser.js')).href) as typeof import('../src/browser.ts')
  assert.equal(typeof browser.toInsightConsumerView, 'function')
  assert.equal(typeof browser.consumerAdmission, 'function')
  assert.equal(typeof browser.UsageInsightsSummarySchema?.safeParse, 'function')
  // The browser entry has no analysis: this is a projection of an already-produced summary.
  assert.equal('analyzeUsageInsights' in browser, false)
  assert.equal('composeUsageInsightsInput' in browser, false)

  const summary = {
    protocol: 'usage-insights/1', summaryId: 'a'.repeat(64), inputId: 'b', inputDigest: null,
    capturedAt: '2026-11-13T12:00:00.000Z', asOf: '2026-11-13T12:00:00.000Z', timezone: 'UTC',
    window: { from: '2026-11-13T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z' },
    sourceKind: 'authorized_read', sourceDescriptor: 'consumer test',
    projects: [{ projectId: 'project-atlas', works: 1, outcomes: 1, accepted: 1, layers: ['controlled'] }],
    metrics: [{
      metricId: 'outcomes.count', unit: 'count', aggregation: 'sum', layer: 'controlled', currency: null,
      value: 1, sampleCount: 1, unknownCount: 0, excludedCount: 0, coverage: 'complete', nullReason: null, provenanceRefs: ['o1'],
    }],
    attention: { observedAt: null, items: 0, itemsWithSince: 0, waitingAgeMs: null, hasMore: false, questionCoverage: null, stale: false, coverage: 'complete', projectCounts: [], byKind: [], byReason: [] },
    usageCompleteness: { outcomeRecords: 1, recordsWithKnownTokens: 0, recordsWithUnknownUsage: 1, recordsWithKnownCost: 0, recordsWithoutCost: 1, tokensCompleteness: 'source_missing', costCompleteness: 'source_missing' },
    coverage: { outcomes: 'complete', workEvidence: 'complete', attention: 'complete', overall: 'complete' },
    limits: { maxRecords: 10, maxWorks: 10, maxPages: 10, recordUnit: 'outcome+container+entry+page+item', recordsSeen: 1, recordsAdmitted: 1, recordsAccepted: 1, recordsNotParsed: 0, worksSeen: 1, worksNotProcessed: 0, pagesSeen: 0, pagesNotParsed: 0, bytesSeen: 0, bytesLimit: null, limitsAppliedBeforeParsing: true, stoppedBy: 'none' },
    losses: {
      outcomes: { seen: 1, accepted: 1, notParsed: 0, invalid: 0, conflicted: 0, outOfScope: 0, outsideWindow: 0, unmapped: 0 },
      workEvidence: { seen: 1, accepted: 1, notParsed: 0, invalid: 0, conflicted: 0, outOfScope: 0, outsideWindow: 0, unmapped: 0 },
      attention: { seen: 0, accepted: 0, notParsed: 0, invalid: 0, conflicted: 0, outOfScope: 0, outsideWindow: 0, unmapped: 0 },
    },
    quarantine: { total: 0, byCode: [], samples: [] },
    configuration: { observed: false, kind: 'none', authority: 'none' },
    baseline: { status: 'not_requested', observation: 'observational_only', baselineId: null, metricId: null, baselineValue: null, measuredValue: null, delta: null, ratio: null, baselineSampleCount: null, measuredSampleCount: null, reasons: [], operatorNote: null },
    limitations: ['Read-only observation of recorded facts.'],
  } as const
  const view = browser.toInsightConsumerView(summary as never)
  assert.equal(view.status, 'ready')
  assert.deepEqual(view.scope, { projectIds: ['project-atlas'], aggregation: 'single_project', label: 'project-atlas' })
  assert.equal(browser.consumerAdmission(view).admitted, true)
})
