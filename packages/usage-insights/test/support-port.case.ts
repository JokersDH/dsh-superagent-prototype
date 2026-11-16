/**
 * W33 acceptance: the support port main composes and the file a colleague receives.
 *
 * Two different checks are kept apart on purpose: the Zod shape check says the document looks right,
 * and the SHA256 check says the bytes are the bytes. A shape-valid envelope with a wrong digest is a
 * mismatch, never a pass.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { UsageObservationDownloadSchema } from '@personal-agent/contracts'
import type { UsageObservation, WorkEvidence } from '@personal-agent/contracts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import {
  SupportPortFault, buildSupportFile, createSupportHandler, originFromManifest, readSupportDocument, readSupportFile, supportLabels,
} from '../src/support-port.ts'
import { makeOutcome } from './fixtures.ts'

const here = dirname(fileURLToPath(import.meta.url))
const skip = existsSync(resolve(here, '../dist/index.js')) ? false : 'the package must be built for the coordinator reader to load it'

const AT = '2026-11-15T06:00:00.000Z'
const TOKEN = 'a'.repeat(64)
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

const outcome = makeOutcome({
  seed: 'port-1', acceptance: 'accepted', projectId: 'one', durationMs: 3_000,
  contract: { workId: 'work-a', revision: 1, digest: 'a'.repeat(64) }, observedAt: '2026-11-15T05:30:00.000Z',
})
const evidence = (workId: string, outcomes: unknown[] = []): WorkEvidence => ({
  protocol: 'work-evidence/1', workId, projection: 'recorded',
  entries: [{ at: '2026-11-15T05:00:00.000Z', kind: 'question.opened', sourceRef: `${workId}-q`, detail: {} }],
  outcomes: outcomes as WorkEvidence['outcomes'], truncated: false,
})

/** The real download envelope, taken from the real route. */
async function download(): Promise<ReturnType<typeof UsageObservationDownloadSchema.parse>> {
  const observation = new ProductUsageObservation({
    projectIds: () => ['one', 'two'], cursor: () => 1,
    listWorks: (ids, limit) => ({ works: [{ id: 'work-a', projectId: 'one' }].filter(w => ids.includes(w.projectId)).slice(0, limit), hasMore: false }),
    workEvidence: async workId => evidence(workId, workId === 'work-a' ? [outcome] : []),
  }, () => AT)
  const app = createLocalHttpApp({
    application: {} as never, principal: { userId: 'r', authorityRef: 'r' }, apiToken: TOKEN,
    bootstrapToken: 'b'.repeat(64), allowedOrigins: ['http://127.0.0.1:4700'], mode: 'personal',
    read: { usageObservationDownload: (query: Parameters<typeof observation.download>[0]) => observation.download(query) },
  } as never)
  const response = await app.request('http://127.0.0.1/v1/insights/export?days=7&timezone=UTC', { headers: { authorization: `Bearer ${TOKEN}` } })
  assert.equal(response.status, 200)
  return UsageObservationDownloadSchema.parse(await (response.json() as Promise<unknown>))
}

test('a downloaded envelope is verified by digest and by field conservation', { skip }, async () => {
  const envelope = await download()
  const read = readSupportDocument(envelope)
  assert.equal(read.documentKind, 'download')
  assert.equal(read.digest.state, 'verified')
  assert.equal(read.digest.declared, envelope.sha256)
  assert.equal(read.digest.actual, sha(envelope.text))
  assert.equal(read.contractValid, true)
  assert.deepEqual(read.conservation, { rowsMatch: true, scopeMatches: true, windowMatches: true, headerMatches: true, notCompared: [] })
  assert.equal(read.report.summaryId, envelope.observation.summaryId)
})

test('a shape-valid envelope with a wrong digest is a mismatch, not a pass', { skip }, async () => {
  const envelope = structuredClone(await download())
  const tampered = { ...envelope, sha256: 'b'.repeat(64) }
  assert.equal(UsageObservationDownloadSchema.safeParse(tampered).success, true,
    'the shape alone accepts it — which is exactly why the crypto check is separate')
  const read = readSupportDocument(tampered)
  assert.equal(read.digest.state, 'mismatch')
  assert.equal(read.digest.verified, false)
  assert.equal(read.digest.actual, sha(envelope.text))
})

test('a file whose rows drifted from its observation fails conservation', { skip }, async () => {
  const envelope = structuredClone(await download())
  const document = JSON.parse(envelope.text)
  document.rows = document.rows.slice(0, -1)
  const text = `${JSON.stringify(document, null, 2)}\n`
  const drifted = { ...envelope, text, sha256: sha(text) }
  // The product contract refuses the drift outright; the support reader still diagnoses it, and
  // reports the envelope as not contract-valid instead of pretending it is a product artifact.
  assert.equal(UsageObservationDownloadSchema.safeParse(drifted).success, false)
  const read = readSupportDocument(drifted)
  assert.equal(read.contractValid, false)
  assert.equal(read.digest.state, 'verified', 'the bytes do match the digest they declare')
  assert.equal(read.conservation.rowsMatch, false, 'the file no longer carries the observation\'s rows')
  // Only the rows drifted: scope, window and header still agree, which is why a row check has to exist.
  assert.equal(read.conservation.scopeMatches, true)
  assert.equal(read.conservation.windowMatches, true)
  assert.equal(read.conservation.headerMatches, true)
})

test('a bare document has no digest to verify and says so', { skip }, async () => {
  const envelope = await download()
  const bare = readSupportDocument(JSON.parse(envelope.text))
  assert.equal(bare.documentKind, 'export')
  assert.equal(bare.digest.state, 'absent')
  assert.equal(bare.digest.verified, false, 'absent is not verified')
  assert.ok(bare.conservation.notCompared.length > 0)
  const observation = readSupportDocument(envelope.observation as UsageObservation)
  assert.equal(observation.documentKind, 'observation')
})

test('the support file round-trips through its own reader', { skip }, async () => {
  const read = readSupportDocument(await download())
  const file = buildSupportFile(read.report)
  assert.equal(file.protocol, 'usage-insights-support-file/1')
  assert.match(file.fileName, /^support-7d-[a-f0-9]{12}-/)
  assert.equal(file.sha256, sha(file.text))
  assert.equal(file.bytes, Buffer.byteLength(file.text))
  const back = readSupportFile(JSON.parse(file.text))
  assert.equal(back.report.summaryId, read.report.summaryId)
  assert.deepEqual(back.report.counts, read.report.counts)
  assert.equal(JSON.stringify(JSON.parse(file.text)).includes('"formatted"'), false, 'no formatted value is copied')
})

test('the support file refuses an incomplete or oversized envelope', { skip }, async () => {
  const read = readSupportDocument(await download())
  assert.throws(() => buildSupportFile(read.report, { maxBytes: 200 }), (error: unknown) =>
    error instanceof SupportPortFault && error.code === 'too_large')
  assert.throws(() => readSupportFile({ protocol: 'usage-insights-support/1', report: { protocol: 'other' } }),
    (error: unknown) => error instanceof SupportPortFault && error.code === 'invalid_document')
  assert.throws(() => readSupportFile(null), (error: unknown) => error instanceof SupportPortFault)
  assert.throws(() => readSupportDocument({ hello: 'world' }), (error: unknown) =>
    error instanceof SupportPortFault && error.code === 'invalid_document')
})

test('identity comes from a manifest only, and missing fields stay unknown', () => {
  const complete = originFromManifest({ buildId: '4dcd28f758bbb265', source: { commit: 'c'.repeat(40), branch: 'main' } },
    { pageObservation: true, numericExport: true, displayDownload: true }, { browserTrigger: 'present', archiveSha256: 'd'.repeat(64) })
  assert.equal(complete?.identitySource, 'install-manifest')
  assert.equal(complete?.buildId, '4dcd28f758bbb265')
  assert.equal(complete?.sourceCommit, 'c'.repeat(40))
  assert.deepEqual(complete?.missing, [])

  const partial = originFromManifest({ buildId: '4dcd28f758bbb265', source: { branch: 'main' } })
  assert.equal(partial?.identitySource, 'incomplete-manifest')
  assert.equal(partial?.sourceCommit, null, 'a branch name is never turned into a commit hash')
  assert.equal(partial?.capabilities, null)

  // Nothing declared: no identity at all rather than a guess.
  assert.equal(originFromManifest({ source: { branch: 'main' } }), null)
  assert.equal(originFromManifest(null), null)
  assert.equal(originFromManifest({ buildId: '../../etc/passwd' }), null, 'a path is not a build id')
  assert.equal(originFromManifest({ source: { commit: 'main' } })?.sourceCommit ?? null, null)
})

test('labels for the workspace name the build and the missing capability', { skip }, async () => {
  const envelope = await download()
  const origin = originFromManifest({ buildId: '4dcd28f758bbb265', source: { commit: 'c'.repeat(40) } },
    { pageObservation: true, numericExport: false, displayDownload: false }, { browserTrigger: 'absent', missing: ['numericExport', 'displayDownload'] })
  const read = readSupportDocument(envelope, { origin })
  const labels = supportLabels(read.report)
  assert.equal(labels.packageLabel?.includes('4dcd28f758bbb265'), true)
  assert.equal(labels.sourceLabel?.includes('c'.repeat(12)), true)
  assert.match(labels.note ?? '', /numericExport, displayDownload/)
  const unverified = supportLabels(readSupportDocument(envelope).report)
  assert.equal(unverified.packageLabel, undefined, 'no package means no label rather than a placeholder hash')
})

test('the handler returns a DTO and refuses without leaking', { skip }, async () => {
  const envelope = await download()
  const handler = createSupportHandler({ resolveOrigin: () => originFromManifest({ buildId: 'abc1234567890abc', source: { commit: 'e'.repeat(40) } }) })
  const ok = handler(envelope)
  assert.equal(ok.status, 200)
  const body = ok.body as { protocol: string; report: { summaryId: string }; digest: { state: string }; conservation: { rowsMatch: boolean } }
  assert.equal(body.protocol, 'usage-insights-support/1')
  assert.equal(body.report.summaryId, envelope.observation.summaryId)
  assert.equal(body.digest.state, 'verified')
  assert.equal(body.conservation.rowsMatch, true)
  const refused = handler({ nope: true })
  assert.equal(refused.status, 422)
  assert.equal(JSON.stringify(refused.body).includes('nope'), false, 'the refusal echoes nothing from the input')
})

test('the verification marker says exactly what was proven', { skip }, async () => {
  const envelope = await download()
  const strict = readSupportDocument(envelope)
  assert.equal(strict.verification, 'contract-digest')

  // An unknown field is not silently dropped and reported as clean: the document fails its contract
  // and is refused, so no report can be read as "every field was inspected and cleared".
  const withSecret = structuredClone(envelope)
  ;(withSecret.observation as unknown as Record<string, unknown>).prompt = 'CANARY-SECRET-PROMPT'
  assert.throws(() => readSupportDocument(withSecret), (error: unknown) =>
    error instanceof SupportPortFault && error.code === 'invalid_document')
  const bareSecret = { ...envelope.observation, prompt: 'CANARY-SECRET-PROMPT' }
  assert.throws(() => readSupportDocument(bareSecret), (error: unknown) => error instanceof SupportPortFault)
})

test('a legacy support file is re-projected, not trusted or refused', () => {
  // The shape written before `origin`/`evidence`/`exportCapability` existed.
  const legacy = {
    protocol: 'usage-insights-support/1',
    report: {
      protocol: 'usage-insights-support-summary/1',
      observationProtocol: 'usage-observation/1',
      status: 'ready',
      summaryId: 'b'.repeat(64),
      observedAt: '2026-11-15T06:00:00.000Z',
      days: 7,
      timezone: 'UTC',
      window: { from: '2026-11-08T06:00:00.000Z', to: '2026-11-15T06:00:00.000Z' },
      scope: { projectIds: ['one'], aggregation: 'single_project', label: '当前项目' },
      coverage: '部分覆盖',
      coverageState: 'partial',
      counts: { rows: 2, withValue: 1, unknown: 1, sampleCount: 2 },
      rows: [
        { rowId: 'outcomes.count@controlled@', layer: 'controlled', unit: 'count', hasValue: true, sampleCount: 1 },
        { rowId: 'queue.waitMs@controlled@', layer: 'controlled', unit: 'ms', hasValue: false, sampleCount: 0 },
      ],
      limitations: ['旧版摘要'],
      numericValues: false,
      note: 'Display document: the served values are formatted strings.',
      authorization: 'none',
    },
  }
  const read = readSupportFile(legacy)
  assert.equal(read.schema, 'legacy')
  assert.deepEqual(read.missingFields, ['origin', 'evidence', 'exportCapability', 'documentKind'])
  assert.equal(read.report.origin, null)
  assert.equal(read.report.exportCapability, 'unverified')
  assert.equal(read.report.documentKind, 'observation')
  assert.equal(read.report.evidence.rowsWithValue, 1)
  assert.equal(read.report.evidence.rowsWithoutValue, 1)
  assert.equal(read.report.evidence.partial, true)
  assert.equal(read.report.counts.unknown, 1, 'counts are recomputed from the rows, not copied on trust')

  // A file that is not a support file at all is still refused.
  assert.throws(() => readSupportFile({ protocol: 'usage-insights-support/1', report: { protocol: 'other' } }),
    (error: unknown) => error instanceof SupportPortFault)
})

test('a fixed older support file from the repository degrades explicitly', { skip }, async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const path = resolve(here, '../../../reports/usage-insights/probe/two-project-20261115T152615.support.json')
  if (!existsSync(path)) return
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { protocol?: string }
  const read = readSupportFile({ protocol: 'usage-insights-support/1', report: parsed })
  assert.ok(read.schema === 'legacy' || read.schema === 'current')
  if (read.schema === 'legacy') {
    assert.equal(read.report.origin, null)
    assert.equal(read.report.exportCapability, 'unverified')
    assert.ok(read.missingFields.length > 0)
  }
})
