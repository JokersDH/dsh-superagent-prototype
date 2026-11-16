/**
 * W32 acceptance: the support report a colleague attaches to a trial report.
 *
 * It answers "what did I observe, which build produced it, and which capability is missing" without
 * carrying a value, a label, a detail string or a path. Both the served observation and the file the
 * user downloaded are accepted, because the file is what a colleague actually has.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { buildDisplayExport } from '../src/display-export.ts'
import { SupportFault, buildSupportReport, describeDisplayDocument, renderSupportReport } from '../src/support.ts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'
const evidence = (workId: string, outcomes: unknown[] = []): WorkEvidence => ({
  protocol: 'work-evidence/1', workId, projection: 'recorded',
  entries: [{ at: '2026-11-15T05:00:00.000Z', kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'], truncated: false,
})

async function served(): Promise<UsageObservation> {
  const outcome = makeOutcome({
    seed: 'support-1', acceptance: 'accepted', projectId: 'one', durationMs: 3_000,
    contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) },
    observedAt: '2026-11-15T05:30:00.000Z',
  })
  return new ProductUsageObservation({
    projectIds: () => ['one', 'two'], cursor: () => 1,
    listWorks: (ids, limit) => ({ works: [{ id: 'work-a', projectId: 'one' }].filter(w => ids.includes(w.projectId)).slice(0, limit), hasMore: false }),
    workEvidence: async workId => evidence(workId, workId === 'work-a' ? [outcome] : []),
  }, () => AT).read({ days: 7, timezone: 'UTC' })
}

const origin = (overrides: Record<string, unknown> = {}) => ({
  kind: 'package', buildId: '4dcd28f758bbb265', sourceCommit: 'c'.repeat(40), archiveSha256: 'd'.repeat(64),
  capabilities: { pageObservation: true, numericExport: true, displayDownload: true },
  browserTrigger: 'present', missing: [], ...overrides,
})

test('an observation alone is reported as unverified, with its absences listed', { skip }, async () => {
  const report = buildSupportReport({ observation: await served() })
  assert.equal(report.documentKind, 'observation')
  assert.equal(report.origin, null)
  assert.equal(report.exportCapability, 'unverified')
  assert.equal(report.evidence.coverageState, report.coverageState)
  assert.equal(report.evidence.rowsWithValue, report.counts.withValue)
  assert.equal(report.evidence.rowsWithoutValue, report.counts.unknown)
  // Unknown rows are stated as missing, never as zero.
  if (report.counts.unknown > 0) assert.ok(report.evidence.absentFacts.some(fact => /no observed value/.test(fact)))
})

test('a package origin names the build and whether the export capability is packaged', { skip }, async () => {
  const present = buildSupportReport({ observation: await served(), origin: origin() })
  assert.equal(present.exportCapability, 'present')
  assert.deepEqual(present.origin?.missing, [])
  const markdown = renderSupportReport(present)
  assert.ok(markdown.includes('Build: 4dcd28f758bbb265'), markdown)
  assert.ok(markdown.includes('Export capability: present'))

  const absent = buildSupportReport({
    observation: await served(),
    origin: origin({ capabilities: { pageObservation: true, numericExport: false, displayDownload: false }, missing: ['numericExport', 'displayDownload'] }),
  })
  assert.equal(absent.exportCapability, 'absent')
  assert.deepEqual(absent.origin?.missing, ['numericExport', 'displayDownload'])
  assert.ok(renderSupportReport(absent).includes('missing numericExport, displayDownload'))
})

test('a malformed origin degrades to unverified instead of claiming absence', { skip }, async () => {
  for (const bad of [null, 42, { capabilities: { displayDownload: 'yes' } }, { capabilities: { displayDownload: true } }])
    assert.equal(buildSupportReport({ observation: await served(), origin: bad }).exportCapability, 'unverified', JSON.stringify(bad))
})

test('the downloaded file is an accepted support input', { skip }, async () => {
  const dto = await served()
  const { document } = buildDisplayExport(dto)
  const fromFile = describeDisplayDocument(JSON.parse(JSON.stringify(document)))
  const fromDto = describeDisplayDocument(dto)
  assert.equal(fromFile.documentKind, 'display_export')
  assert.equal(fromDto.documentKind, 'observation')
  // Same observation, same identity, same counts — only the document kind differs.
  assert.equal(fromFile.summaryId, fromDto.summaryId)
  assert.equal(fromFile.observedAt, fromDto.observedAt)
  assert.deepEqual(fromFile.scope, fromDto.scope)
  assert.deepEqual(fromFile.window, fromDto.window)
  assert.equal(fromFile.counts.rows, fromDto.counts.rows)
  assert.deepEqual(fromFile.rows.map(row => row.rowId), fromDto.rows.map(row => row.rowId))
})

test('a support report carries no value, label, detail or path', { skip }, async () => {
  const dto = await served()
  const hostile: UsageObservation = {
    ...dto,
    metrics: dto.metrics.map((metric, index) => index === 0
      ? { ...metric, label: 'CANARY-LABEL', detail: 'CANARY-DETAIL /Users/private/secret' } : metric),
  }
  const report = buildSupportReport({ observation: hostile, origin: origin() })
  const json = JSON.stringify(report)
  const markdown = renderSupportReport(report)
  for (const secret of ['CANARY-LABEL', 'CANARY-DETAIL', '/Users/private']) {
    assert.equal(json.includes(secret), false, `${secret} must not be in the JSON report`)
    assert.equal(markdown.includes(secret), false, `${secret} must not be in the Markdown report`)
  }
  for (const metric of dto.metrics) {
    if (metric.value !== null) assert.equal(json.includes(`"${metric.value}"`), false, 'no formatted value is copied')
  }
})

test('an unknown document is refused with a typed fault', { skip }, async () => {
  for (const bad of [{ protocol: 'usage-observation/1' }, { protocol: 'usage-insights-export/2' }, null, 'text'])
    assert.throws(() => describeDisplayDocument(bad), (error: unknown) => error instanceof SupportFault)
})
