#!/usr/bin/env node
/**
 * Two-project, real-loopback observation probe.
 *
 * This starts the *real* product HTTP application over a private temporary state root, with the real
 * store, real application service, real attention reader and real evidence/history readers. It then
 * runs the operator CLI's `collect → analyze → report` chain against `http://127.0.0.1:<port>`.
 *
 * What is real: the HTTP surface, authentication, scoping, pagination cursors, timeline projection
 * and attention snapshot all come from product code.
 * What is controlled: the execution records were written through the product's public routing
 * evidence port, so their layer is `controlled`. No native execution happened and none is claimed;
 * `actual_native` stays NOT_TESTED in this probe.
 *
 * The probe never touches a user instance, never reads a home-directory credential and never starts
 * a model. It prints a JSON summary and exits non-zero if any check fails.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixture, actor, createCommand, scope } from '../../../packages/application/test/helpers.ts'
import { ProductAttention } from '../../../apps/coordinator/product/attention.ts'
import { ProductEvidenceHistory } from '../../../apps/coordinator/product/evidence-history.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../apps/coordinator/http/server.ts'

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url))
const PROJECT_A = scope.projectId
const PROJECT_B = 'project-other'
const PROJECT_IDS = [PROJECT_A, PROJECT_B]
const API_TOKEN = 'a1'.repeat(32)
const CAPTURED_AT = '2026-11-08T12:00:00Z'
const WINDOW = { from: '2026-11-08T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' }
const FIXTURE_NOW = '2026-11-08T10:00:00.000Z'

const cleanups = []
const fakeTest = { after: (fn) => cleanups.push(fn) }

// Async on purpose: the observed HTTP server runs in this process, so a blocking spawn would starve
// the event loop and every request would time out.
async function run(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr, args }))
  })
}

async function startWork(h, id, projectId) {
  const created = await h.app.dispatch({
    ...createCommand(`create-${id}`),
    projectId,
    conversationId: `conversation-${id}`,
    scope: { ...scope, projectId },
    goal: 'Produce the same reported goal in both projects',
  }, actor)
  const active = await h.start(created.workId)
  return { workId: created.workId, active }
}

function openQuestion(h, id, projectId, started, openedAt) {
  h.app.questions.open({
    id,
    version: 1,
    kind: 'clarification',
    contract: started.active.ref.contract,
    scope: { ...scope, projectId },
    prompt: `Question ${id}`,
    nativePayloadRef: `raw-${id}`,
    targets: [{
      ...started.active.ref,
      attemptId: started.active.binding.attemptId,
      fenceEpoch: 1,
      id: `binding-${id}`,
      connectionEpoch: 1,
      nativeRequestId: { kind: 'string', value: id },
      nativeMethod: 'tool/input',
      provenanceRef: `provenance-${id}`,
    }],
    presentation: { kind: 'free_text' },
    validity: 'open',
    openedAt,
  })
}

function putOutcome(h, workId, contract, options) {
  const seed = options.seed
  const attempt = {
    ticketId: options.ticketId,
    assignmentId: options.assignmentId,
    contract: { workId: contract.workId, revision: contract.revision, digest: contract.digest },
    attemptId: `attempt-${seed}`,
    fenceEpoch: 1,
  }
  const evidenceRefs = [`evidence-${seed}`]
  h.store.workflows.routingEvidence.outcomes.put({
    protocol: 'execution-outcome/1',
    id: `outcome-${seed}`,
    projectId: options.projectId,
    attempt,
    profileRef: { profileId: 'profile-fixture-controlled', revision: 1, identityDigest: 'b'.repeat(64) },
    acceptance: 'unknown',
    evidenceRefs,
    layer: 'controlled',
    usage: {
      completeness: options.tokens === undefined ? 'unknown' : 'observed',
      evidenceRefs: [`usage-${seed}`],
      ...(options.tokens === undefined ? {} : { inputTokens: options.tokens.input, outputTokens: options.tokens.output }),
      ...(options.cost === undefined ? {} : { cost: options.cost }),
    },
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    observedAt: options.observedAt,
  })
}

async function main() {
  const h = fixture(fakeTest)
  const projects = PROJECT_IDS
  const atlas = await startWork(h, 'atlas-report', PROJECT_A)
  const orbit = await startWork(h, 'orbit-report', PROJECT_B)
  openQuestion(h, 'question-atlas-1', PROJECT_A, atlas, '2026-11-08T09:00:00.000Z')
  openQuestion(h, 'question-orbit-1', PROJECT_B, orbit, '2026-11-08T09:30:00.000Z')

  const atlasContract = (await h.app.inspect({ workId: atlas.workId })).works[0].contract
  const orbitContract = (await h.app.inspect({ workId: orbit.workId })).works[0].contract
  h.store.uow.atomic(() => {
    putOutcome(h, atlas.workId, atlasContract, {
      seed: 'atlas-1', projectId: PROJECT_A, ticketId: atlas.active.ref.ticketId, assignmentId: atlas.active.ref.assignmentId,
      durationMs: 184_000, tokens: { input: 12_500, output: 3_100 }, cost: { currency: 'USD', amount: 0.42 },
      observedAt: '2026-11-08T10:05:00.000Z',
    })
    putOutcome(h, atlas.workId, atlasContract, {
      seed: 'atlas-2', projectId: PROJECT_A, ticketId: atlas.active.ref.ticketId, assignmentId: atlas.active.ref.assignmentId,
      durationMs: 96_000, observedAt: '2026-11-08T10:06:00.000Z',
    })
    putOutcome(h, orbit.workId, orbitContract, {
      seed: 'orbit-1', projectId: PROJECT_B, ticketId: orbit.active.ref.ticketId, assignmentId: orbit.active.ref.assignmentId,
      observedAt: '2026-11-08T10:07:00.000Z',
    })
  })

  const completion = { metadata: () => undefined, current: () => undefined }
  const attention = new ProductAttention(h.store, h.app, completion, {
    projectIds: () => projects,
    verification: work => ({ protocol: 'work-verification/1', workId: work.work.id, state: 'not_ready', retryAvailable: false }),
    // The snapshot must be observed at capture time; a page older than the freshness window is
    // reported as stale rather than as the current inbox.
    now: () => CAPTURED_AT,
  })
  const history = new ProductEvidenceHistory(h.store, h.app, () => projects, Buffer.alloc(32, 7), () => FIXTURE_NOW)

  const readWorkEvidence = async (workId) => {
    const work = (await h.app.inspect({ workId })).works[0]
    if (!work) throw new Error('Work is outside the configured scope')
    const timeline = h.store.workflows.index.timeline({ workId, projectIds: projects, limit: 500 })
    if (!timeline) throw new Error('Work timeline is outside the configured scope')
    const outcomes = timeline.entries
      .filter(entry => entry.kind === 'execution.outcome')
      .map(entry => h.store.workflows.routingEvidence.outcomes.get(entry.sourceRef))
      .filter(Boolean)
    return {
      protocol: 'work-evidence/1',
      workId,
      entries: timeline.entries,
      outcomes,
      truncated: timeline.truncated,
      projection: 'recorded',
    }
  }

  const http = createLocalHttpApp({
    application: h.app,
    principal: actor,
    apiToken: API_TOKEN,
    bootstrapToken: 'b2'.repeat(32),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'fixture',
    read: {
      attention: query => attention.read(query),
      workEvidence: readWorkEvidence,
      workEvidenceHistory: (workId, query) => history.read(workId, query),
    },
  })
  const server = listenLocalHttp(http, 0)
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port
  assert.ok(port > 0, 'the loopback listener must bind a port')

  const directory = mkdtempSync(join(tmpdir(), 'usage-insights-probe-'))
  cleanups.push(() => new Promise(resolve => server.close(resolve)))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const tokenFile = join(directory, 'token')
  writeFileSync(tokenFile, `${API_TOKEN}\n`, { mode: 0o600 })
  const bundlePath = join(directory, 'bundle.json')
  const bundlePath2 = join(directory, 'bundle-2.json')

  const base = `http://127.0.0.1:${port}`
  const common = [
    '--base-url', base, '--token-file', tokenFile,
    '--from', WINDOW.from, '--to', WINDOW.to, '--captured-at', CAPTURED_AT,
    '--project', PROJECT_A, '--project', PROJECT_B,
    '--include-attention', '--snapshot-limit', '20', '--history-pages', '3', '--history-limit', '50',
  ]
  const cursorBefore = h.store.events.cursor()
  const collectStarted = Date.now()
  const collected = await run(['collect', ...common, '--input-id', 'probe-two-projects', '--out', bundlePath])
  const collectMs = Date.now() - collectStarted
  assert.equal(collected.status, 0, `collect failed: ${collected.stderr}`)
  const collectedAgain = await run(['collect', ...common, '--input-id', 'probe-two-projects', '--out', bundlePath2])
  assert.equal(collectedAgain.status, 0, `second collect failed: ${collectedAgain.stderr}`)

  const bundle = JSON.parse(readFileSyncUtf8(bundlePath))
  assert.equal(bundle.protocol, 'usage-insights-input/1')
  assert.equal(bundle.source.kind, 'http_read')
  assert.deepEqual(bundle.projects.map(project => project.projectId).sort(), [...PROJECT_IDS].sort())
  assert.ok(bundle.workEvidence.length >= 2, 'both works must be collected through HTTP')
  assert.ok(bundle.attentionPages.length >= 1, 'the attention snapshot must be collected through HTTP')
  assert.equal(bundle.declaredCoverage.workEvidence, 'complete')
  assert.ok(Array.isArray(bundle.workIndex) && bundle.workIndex.length === 2,
    'every collected work carries its project identity from the product')
  assert.deepEqual(bundle.workIndex.map(entry => entry.projectId).sort(), [...PROJECT_IDS].sort())

  // Replaying the same window and capture time must produce identical bytes: no new counts.
  const first = readFileSyncUtf8(bundlePath)
  const second = readFileSyncUtf8(bundlePath2)
  assert.equal(first, second, 'a repeated collection of the same window must be byte-identical')

  const reportPath = join(directory, 'report.md')
  const reported = await run(['report', '--input', bundlePath, '--out', reportPath])
  assert.equal(reported.status, 0, `report failed: ${reported.stderr}`)
  const markdown = readFileSyncUtf8(reportPath)
  assert.ok(markdown.includes('Read-only observation'))
  assert.equal(markdown.includes(directory), false, 'the report must not embed a user path')
  assert.equal(markdown.includes(API_TOKEN), false, 'the report must never contain the credential')

  const analyzeStarted = Date.now()
  const analysis = JSON.parse((await run(['analyze', '--input', bundlePath])).stdout)
  const analyzeMs = Date.now() - analyzeStarted
  const summary = analysis.summary
  assert.equal(summary.coverage.overall, 'complete')
  assert.equal(summary.quarantine.total, 0)
  const metric = (id, layer, currency) => summary.metrics.find(row =>
    row.metricId === id && (layer === undefined || row.layer === layer) && (currency === undefined || row.currency === currency))
  assert.equal(metric('outcomes.count', 'controlled').value, 3)
  assert.equal(metric('execution.durationMs', 'controlled').value, 140_000)
  assert.equal(metric('execution.durationMs', 'controlled').sampleCount, 2)
  assert.equal(metric('execution.durationMs', 'controlled').unknownCount, 1)
  assert.equal(metric('usage.inputTokens', 'controlled').value, 12_500)
  assert.equal(metric('usage.cost', 'controlled', 'USD').value, 0.42)
  assert.equal(metric('queue.waitMs', 'controlled').value, null)
  assert.equal(metric('review.readyToAcceptanceMs', 'controlled').value, null)
  assert.equal(metric('interventions.questions').value, 2, 'both opened questions were counted once')
  assert.equal(metric('interventions.total').value, 2)
  assert.equal(summary.attention.items, 2)
  assert.equal(summary.attention.stale, false, 'the snapshot was observed at capture time')
  assert.equal(summary.losses.workEvidence.unmapped, 0)
  assert.equal(summary.losses.workEvidence.outOfScope, 0)
  assert.ok(summary.attention.waitingAgeMs > 0)
  assert.equal(summary.limits.stoppedBy, 'none')
  assert.equal(h.store.events.cursor(), cursorBefore, 'read-only collection and analysis must not create product events')

  // Two works share the same human goal text, and they still stay separate: identity, not similarity.
  const titles = bundle.workEvidence.flatMap(work => work.entries.filter(entry => entry.kind === 'work.created').map(entry => entry.detail?.title))
  assert.equal(new Set(titles).size, 1, 'both works carry the same reported title')
  assert.deepEqual(summary.projects.map(project => [project.projectId, project.outcomes]).sort(),
    [[PROJECT_A, 2], [PROJECT_B, 1]])
  const subjectKeys = new Set(analysis.subjects.map(subject => subject.subjectKey))
  assert.equal(subjectKeys.size, analysis.subjects.length, 'every subject keeps its own identity')

  // Same bytes as a "verified file": the summary id must be identical, and the digest must bind it.
  const verified = JSON.parse((await run(['verify', '--input', bundlePath])).stdout)
  assert.equal(verified.status, 'complete')
  assert.match(verified.digest, /^[a-f0-9]{64}$/)
  const again = JSON.parse((await run(['analyze', '--input', bundlePath])).stdout)
  assert.equal(again.summary.summaryId, summary.summaryId)

  const authoritative = fileURLToPath(new URL('../../../reports/usage-insights/', import.meta.url))
  const keep = process.argv.includes('--keep')
  let published
  if (keep) {
    mkdirSync(join(authoritative, 'probe'), { recursive: true })
    const stamp = CAPTURED_AT.replace(/[-:]/g, '').replace(/\..*$/, '')
    published = { bundle: join(authoritative, 'probe', `two-project-${stamp}.bundle.json`),
      report: join(authoritative, 'probe', `two-project-${stamp}.report.md`) }
    writeExclusiveCopy(bundlePath, published.bundle)
    writeExclusiveCopy(reportPath, published.report)
  }

  const checks = {
    httpSurface: 'real product HTTP app on 127.0.0.1 with bearer authentication',
    projects: PROJECT_IDS,
    works: bundle.workEvidence.length,
    attentionPages: bundle.attentionPages.length,
    repeatedCollectionIdentical: true,
    outcomes: 3,
    layers: ['controlled'],
    nativeExecution: 'NOT_TESTED',
    summaryId: summary.summaryId,
    readOnlyNoProductEvents: true,
    sameTitleWorksStayedSeparate: true,
    collectMs,
    analyzeMs,
    digest: verified.digest,
    metrics: summary.metrics.map(row => ({ metricId: row.metricId, layer: row.layer, currency: row.currency, value: row.value, sampleCount: row.sampleCount, unknownCount: row.unknownCount })),
    unpublishedPaths: !keep,
    ...(published ? { published } : {}),
  }
  process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`)
}

function writeExclusiveCopy(source, target) {
  const bytes = readFileSyncUtf8(source)
  try {
    writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Refusing to overwrite ${target}`)
    throw error
  }
}

function readFileSyncUtf8(path) {
  return readFileSync(path, 'utf8')
}

try {
  await main()
} finally {
  for (const cleanup of cleanups) {
    try { cleanup() } catch { /* fixture cleanup is best effort */ }
  }
}
