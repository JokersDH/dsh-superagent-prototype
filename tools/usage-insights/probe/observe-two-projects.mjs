#!/usr/bin/env node
/**
 * Two-project, real-loopback observation probe over the *controlled product runtime*.
 *
 * It boots the real product composition (store, application, execution consumer, completion, review
 * timing, attention, evidence history) against a private temporary state root and a temporary git
 * scratch project, then drives two works in two different projects through the real command surface:
 *
 *   create work → native question → explicit answer → verification → UI review activity → acceptance
 *
 * That produces real product records: `question.opened`, `runtime.answer.observed`,
 * `verification.recorded`, `acceptance.recorded`, an `execution.outcome` with `ReviewTiming`, and
 * attention items. The operator CLI then collects them over the real HTTP read surface.
 *
 * What is real: every command, fact, verification, acceptance and read.
 * What is controlled: the executing agent is the fixed fixture driver, so the evidence layer is
 * `controlled`. No vendor model, no native execution, no user instance.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { ProductUsageObservation } from '../../../apps/coordinator/product/usage-observation.ts'
import { trialInsightsAdmission } from '../../../apps/console/src/trial/insights.ts'
import { composeUsageInsightsInput } from '../../../packages/usage-insights/src/node-composition.ts'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../apps/coordinator/http/server.ts'
import { analyzeUsageInsights } from '../../../packages/usage-insights/src/analyze.ts'
import { consumerAdmission, toInsightConsumerView } from '../../../packages/usage-insights/src/facing.ts'
import { buildDisplayExport, displayExportDigest } from '../../../packages/usage-insights/src/display-export.ts'
import { crossCheckAnalysisWithDisplay } from '../../../packages/usage-insights/src/crosscheck.ts'
import { describeDisplayDocument } from '../../../packages/usage-insights/src/support.ts'
import { UsageObservationDownloadSchema } from '../../../packages/contracts/dist/index.js'

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url))
const principal = { userId: 'local-insights-probe', authorityRef: 'local-insights-authority' }
const commandActor = { ...principal, source: 'local_cli' }
const uiActor = { ...principal, source: 'local_ui' }
const API_TOKEN = 'a1'.repeat(32)
// The collector stamps its own capture time after reading, so the attention snapshot is always
// observed at or before the observation it belongs to.
const PROJECT_A = 'project-arcade'
const PROJECT_B = 'project-beacon'
const PROJECTS = [PROJECT_A, PROJECT_B]
const PROJECT_SCOPE = projectId => ({ projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
// The observation window surrounds the probe run: one hour before to two hours after it started.
const WINDOW_START = new Date(Date.now() - 3_600_000).toISOString()
const WINDOW_END = new Date(Date.now() + 7_200_000).toISOString()
const WINDOW = ['--from', WINDOW_START, '--to', WINDOW_END]

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

async function until(read, predicate, timeout = 25_000) {
  const deadline = Date.now() + timeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`condition timed out: ${JSON.stringify(latest).slice(0, 400)}`)
}

const cleanups = []

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'usage-insights-product-'))
  const stateRoot = join(root, 'state')
  const scratchProject = join(root, 'project')
  mkdirSync(stateRoot)
  mkdirSync(join(scratchProject, 'src'), { recursive: true })
  writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
  const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/.gitkeep'])
  git(['-c', 'user.name=Usage Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'probe base'])

  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  cleanups.push(() => store.close())
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))

  const product = createControlledProduct({
    store,
    principal,
    projects: PROJECTS.map(id => ({ id, scope: PROJECT_SCOPE(id) })),
    actionSecret: Buffer.alloc(32, 3),
    stateRoot,
    scratchProject,
  })
  cleanups.push(() => product.close())
  product.start()

  let sequence = 0
  // The conversation is explicit: commands such as answer_question carry no projectId, and the
  // product correctly refuses a work whose conversation does not match.
  const command = (value, conversationId) => product.application.dispatch({
    commandId: `probe-command-${++sequence}`,
    conversationId,
    ...value,
  }, commandActor)

  const created = []
  for (const [index, projectId] of PROJECTS.entries()) {
    const conversationId = `conversation-${projectId}`
    // Identical goal text in both projects: identity, never similarity, decides attribution.
    const receipt = await command({
      kind: 'create_work',
      projectId,
      goal: 'Produce the same reported goal in both projects',
      profileId: 'profile-fixture-question',
      scope: PROJECT_SCOPE(projectId),
      criteria: [
        { id: 'criterion-output', kind: 'machine', required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
        { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' },
      ],
    }, conversationId)
    assert.equal(receipt.status, 'recorded', JSON.stringify(receipt))
    const workId = receipt.workId ?? receipt.result?.workId
    assert.ok(workId, `create_work receipt carries the work identity: ${JSON.stringify(receipt)}`)

    const snapshot = await until(async () => product.application.inspect({ workId }), value => value.questions.length === 1)
    const question = snapshot.questions[0]
    const answer = await command({
      kind: 'answer_question',
      questionId: question.id,
      expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] },
    }, conversationId)
    assert.equal(answer.status, 'recorded', JSON.stringify(answer))

    const ready = await until(async () => (await product.application.inspect({ workId })).works[0],
      view => view?.actions.available.includes('accept_candidate'))
    const candidate = ready.actions.currentCandidate
    assert.ok(candidate, 'the reviewed candidate exists before acceptance')

    // A real UI visibility span: the same call the workbench makes. It must fall inside the
    // ready→accepted interval, which on a fixture run is short, so the review is held briefly open.
    await new Promise(resolve => setTimeout(resolve, 700))
    const endedAt = new Date()
    const startedAt = new Date(endedAt.getTime() - 700)
    const activity = await product.operations.reviewActivity({
      protocol: 'review-activity/1',
      commandId: `probe-review-${index + 1}`,
      sessionId: `probe-session-${index + 1}`,
      candidate,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      source: 'ui_visibility_proxy',
    }, uiActor)
    assert.equal(activity.status, 'recorded', JSON.stringify(activity))

    const accepted = await command({ kind: 'accept_candidate', candidate }, conversationId)
    assert.equal(accepted.status, 'recorded', JSON.stringify(accepted))
    created.push({ projectId, workId, questionId: question.id })
  }

  // ---- read surface --------------------------------------------------------------------------
  const http = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API_TOKEN,
    bootstrapToken: 'b2'.repeat(32),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'product',
    read: product.read,
    operations: product.operations,
  })
  const server = listenLocalHttp(http, 0)
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }))

  const directory = mkdtempSync(join(tmpdir(), 'usage-insights-probe-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const tokenFile = join(directory, 'token')
  writeFileSync(tokenFile, `${API_TOKEN}\n`, { mode: 0o600 })
  const bundlePath = join(directory, 'bundle.json')
  const bundlePath2 = join(directory, 'bundle-2.json')
  const collectArgs = ['--base-url', `http://127.0.0.1:${port}`, '--token-file', tokenFile, ...WINDOW,
    '--project', PROJECT_A, '--project', PROJECT_B,
    '--include-attention', '--snapshot-limit', '20', '--history-pages', '5', '--history-limit', '100']

  const eventsBefore = store.events.cursor()
  const startedCollect = Date.now()
  const collected = await run(['collect', ...collectArgs, '--input-id', 'probe-two-projects', '--out', bundlePath])
  const collectMs = Date.now() - startedCollect
  assert.equal(collected.status, 0, `collect failed: ${collected.stderr}`)
  assert.equal(store.events.cursor(), eventsBefore, 'read-only collection must not create product events')

  const collectedAgain = await run(['collect', ...collectArgs, '--input-id', 'probe-two-projects', '--out', bundlePath2])
  assert.equal(collectedAgain.status, 0, `second collect failed: ${collectedAgain.stderr}`)
  const firstBundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  const secondBundle = JSON.parse(readFileSync(bundlePath2, 'utf8'))
  // Outcome and work evidence are historical facts: collecting the same window twice must reproduce
  // them exactly. The attention snapshot is a *live* observation, so only its observation time may
  // differ; its items must still be identical.
  // `observedAt` is the reader's own read time, not a historical fact: it is excluded from the
  // repetition check while every entry, contract and identity must match exactly.
  const withoutReadTime = pages => (pages ?? []).map(({ observedAt, ...rest }) => rest)
  for (const field of ['outcomes', 'workEvidence', 'workIndex', 'projects'])
    assert.equal(JSON.stringify(firstBundle[field] ?? null), JSON.stringify(secondBundle[field] ?? null),
      `repeated collection changed ${field}`)
  assert.deepEqual(withoutReadTime(firstBundle.workHistories), withoutReadTime(secondBundle.workHistories),
    'repeated collection changed the historical work entries')
  const itemIds = bundleOf => (bundleOf.attentionPages ?? []).flatMap(page => page.items.map(item => item.id)).sort()
  assert.deepEqual(itemIds(firstBundle), itemIds(secondBundle), 'the pending set is stable across two reads')
  assert.equal(firstBundle.attentionPages.every(page => page.hasMore === false), true)
  for (const page of firstBundle.attentionPages)
    assert.ok(Date.parse(page.observedAt) <= Date.parse(firstBundle.capturedAt),
      'a snapshot can never be observed after the capture it belongs to')

  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  assert.equal(bundle.protocol, 'usage-insights-input/1')
  assert.equal(bundle.source.kind, 'http_read')
  assert.deepEqual(bundle.projects.map(project => project.projectId).sort(), [...PROJECTS].sort())
  assert.equal(bundle.workIndex?.length, 2, 'both works carry a product-sourced project identity')
  assert.deepEqual(bundle.workIndex.map(entry => entry.projectId).sort(), [...PROJECTS].sort())

  const reportPath = join(directory, 'report.md')
  const startedAnalyze = Date.now()
  const reported = await run(['report', '--input', bundlePath, '--out', reportPath])
  const analyzeMs = Date.now() - startedAnalyze
  assert.equal(reported.status, 0, `report failed: ${reported.stderr}`)
  const markdown = readFileSync(reportPath, 'utf8')
  assert.equal(markdown.includes(API_TOKEN), false)
  assert.equal(markdown.includes(directory), false)

  const analysis = JSON.parse((await run(['analyze', '--input', bundlePath])).stdout)
  const summary = analysis.summary
  const metric = id => summary.metrics.find(row => row.metricId === id)
  assert.equal(summary.coverage.overall, 'complete', JSON.stringify(summary.losses))
  assert.equal(summary.losses.workEvidence.unmapped, 0)
  assert.equal(summary.losses.workEvidence.outOfScope, 0)
  assert.equal(summary.quarantine.total, 0)

  // Real interaction facts from the Broker: one question and one explicit answer per project.
  assert.equal(metric('interventions.questions')?.value, 2)
  assert.equal(metric('interventions.answers')?.value, 2)
  assert.equal(metric('interventions.acceptances')?.value, 2)
  assert.equal(metric('interventions.total')?.value, 6)
  assert.equal(metric('interventions.total')?.sampleCount, 2)

  // Accepted outcomes are real, with the product's own ReviewTiming.
  assert.equal(metric('outcomes.count')?.value, 2)
  assert.equal(metric('outcomes.accepted')?.value, 2)
  const ready = metric('review.readyToAcceptanceMs')
  assert.equal(ready?.sampleCount, 2, 'both accepted outcomes carry ready-to-acceptance timing')
  assert.ok((ready?.value ?? -1) >= 0)
  const active = metric('review.activeMs')
  assert.equal(active?.sampleCount, 2, 'the recorded UI span is observed, not fabricated')
  // The proxy is clipped by the real ready→accepted interval, so it is small but non-zero.
  assert.ok((active?.value ?? 0) > 0, `observed review proxy should be recorded, got ${active?.value}`)
  assert.equal(active?.coverage, 'partial', 'a visibility proxy is always partial')

  // The fixture driver reports no token or cost usage: that is unknown, never zero.
  assert.equal(metric('usage.inputTokens')?.value, null)
  assert.equal(summary.usageCompleteness.recordsWithUnknownUsage, 2)
  assert.equal(summary.usageCompleteness.tokensCompleteness, 'source_missing')
  assert.equal(metric('usage.cost'), undefined, 'no cost row is invented without a recorded currency')
  assert.equal(metric('queue.waitMs')?.value, null, 'the product exposes no queued/dispatched pair')

  assert.equal(summary.attention.stale, false)
  assert.equal(summary.attention.coverage, 'complete')

  // ---- the coordinator's real authorized reader over the same two-project data (G5-G8) --------
  // This is the reader the product actually serves; it imposes its own 50 works / 10000 records /
  // 2 MiB / 2 s bounds and its own 7/30 day window. G only supplies the analyzer behind it.
  const coordinatorReaders = {
    projectIds: () => PROJECTS,
    cursor: () => store.events.cursor(),
    listWorks: (projectIds, limit) => {
      const works = created
        .filter(entry => projectIds.includes(entry.projectId))
        .slice(0, limit)
        .map(entry => ({ id: entry.workId, projectId: entry.projectId }))
      return { works, hasMore: false }
    },
    workEvidence: (workId) => product.read.workEvidence(workId),
  }
  const observation7 = await new ProductUsageObservation(coordinatorReaders).read({ days: 7, timezone: 'UTC' })
  // The same observation through the real HTTP route the App calls.
  const coordinatorApp = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API_TOKEN,
    bootstrapToken: 'b2'.repeat(32),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'product',
    read: {
      usageObservation: query => new ProductUsageObservation(coordinatorReaders).read(query),
      workEvidence: workId => product.read.workEvidence(workId),
    },
  })
  const insightsResponse = await coordinatorApp.request('http://127.0.0.1/v1/insights?days=7&timezone=UTC',
    { headers: { authorization: `Bearer ${API_TOKEN}` } })
  assert.equal(insightsResponse.status, 200, 'the real /v1/insights route serves the observation')
  const served = await insightsResponse.json()
  assert.equal(served.protocol, 'usage-observation/1')
  assert.deepEqual(served.metrics, observation7.metrics, 'the HTTP route and the direct reader agree')
  assert.equal(served.sampleCount, observation7.sampleCount)
  const unauthenticated = await coordinatorApp.request('http://127.0.0.1/v1/insights?days=7')
  assert.equal(unauthenticated.status, 401)
  const observation30 = await new ProductUsageObservation(coordinatorReaders).read({ days: 30, timezone: 'UTC' })
  const observationRow = (dto, id) => dto.metrics.find(metric => metric.id.startsWith(`${id}@`))
  for (const [label, dto] of [['7d', observation7], ['30d', observation30]]) {
    assert.equal(dto.status, 'ready', `${label}: ${JSON.stringify(dto.limitations)}`)
    assert.equal(dto.authorization, 'none')
    assert.match(dto.summaryId, /^[a-f0-9]{64}$/)
    assert.equal(Date.parse(dto.window.to) - Date.parse(dto.window.from), dto.days * 86_400_000)
    assert.deepEqual(new Set(dto.scope.projectIds), new Set(PROJECTS))
    assert.equal(dto.scope.aggregation, 'declared_multi_project')
    assert.equal(dto.sampleCount, 2, `${label}: the header counts the enumerated works`)
    assert.equal(observationRow(dto, 'interventions.questions')?.value, '2')
    assert.equal(observationRow(dto, 'interventions.answers')?.value, '2')
    assert.equal(observationRow(dto, 'interventions.acceptances')?.value, '2')
    assert.equal(observationRow(dto, 'outcomes.count')?.value, '2')
    assert.equal(observationRow(dto, 'outcomes.accepted')?.value, '2')
    assert.equal(observationRow(dto, 'review.readyToAcceptanceMs')?.layer, 'controlled')
    assert.match(observationRow(dto, 'review.activeMs')?.detail ?? '', /部分或缺失/)
    assert.equal(observationRow(dto, 'usage.inputTokens')?.value, null, `${label}: unknown usage stays null`)
    assert.equal(observationRow(dto, 'usage.cost'), undefined, `${label}: no cost row without a currency`)
    assert.equal(trialInsightsAdmission(dto).admitted, true)
    const serialized = JSON.stringify(dto)
    for (const entry of created) {
      assert.equal(serialized.includes(entry.workId), false, 'the DTO carries no work identity')
      assert.equal(serialized.includes(entry.questionId), false, 'the DTO carries no question identity')
    }
    assert.equal(serialized.includes('Produce the same reported goal'), false, 'the DTO carries no work title')
    assert.equal(serialized.includes('/private/'), false)
    assert.equal(serialized.includes(API_TOKEN), false)
  }
  // The two windows cover the same facts here, so the numbers must agree; only the window differs.
  assert.deepEqual(observation7.metrics, observation30.metrics, '7-day and 30-day reads agree when the facts are inside both')

  // The readable report and the coordinator DTO describe the same facts: compare the numbers the
  // report printed with the values the product serves.
  const dtoNumber = text => (text === null ? null : Number(String(text).replace(/,/g, '')))
  for (const metricId of ['outcomes.count', 'outcomes.accepted', 'interventions.questions',
    'interventions.answers', 'interventions.acceptances', 'interventions.total',
    'review.readyToAcceptanceMs', 'review.activeMs']) {
    const fromSummary = summary.metrics.find(row => row.metricId === metricId)?.value ?? null
    const fromDto = dtoNumber(observationRow(observation7, metricId)?.value ?? null)
    if (fromSummary === null || fromDto === null) {
      assert.equal(fromSummary, fromDto, `${metricId}: both entries must agree on availability`)
      continue
    }
    assert.ok(Math.abs(fromSummary - fromDto) <= 0.05,
      `${metricId}: report ${fromSummary} disagrees with the served value ${fromDto}`)
  }

  // ---- authorized Node composition over the same product reads (G5-G8) ------------------------
  // The port is exactly what main would hand over after authorizing a principal: a work list with its
  // project identity plus the existing readers. No HTTP, no SQL, no credential is created here.
  const authorizedPort = {
    async listWorks({ projectIds, limit }) {
      const snapshot = await product.application.inspect({ limit: Math.min(limit, 2) })
      const works = snapshot.works
        .map(view => ({ workId: view.work.id, projectId: view.work.projectId }))
        .filter(work => projectIds.includes(work.projectId))
      return { works, hasMore: false }
    },
    async workEvidence(workId) { return product.read.workEvidence(workId) },
    async workHistory(workId, query) { return product.read.workEvidenceHistory(workId, query) },
    async attention(query) { return product.read.attention(query) },
  }
  const composed = await composeUsageInsightsInput({
    port: authorizedPort,
    request: {
      principalRef: 'probe-principal',
      projectIds: PROJECTS,
      window: { from: WINDOW_START, to: WINDOW_END },
      timezone: 'UTC',
      inputId: 'probe-authorized-composition',
      includeAttention: true,
      limits: { maxRecords: 50_000, maxWorks: 20, maxPages: 50 },
    },
  })
  assert.equal(composed.issues.length, 0, JSON.stringify(composed.issues))
  assert.equal(composed.bundle.source.kind, 'authorized_read')
  assert.equal(composed.stats.worksRead, 2)
  assert.equal(composed.bundle.workIndex?.length, 2)
  const composedAnalysis = analyzeUsageInsights(composed.bundle)
  const composedSummary = composedAnalysis.summary
  // Same subject, window and projects through a different entry point must produce the same numbers.
  assert.deepEqual(composedSummary.metrics, summary.metrics, `composition metrics differ; declared=${JSON.stringify(composed.bundle.declaredCoverage)} coverage=${JSON.stringify(composedSummary.coverage)} losses=${JSON.stringify(composedSummary.losses)} stopped=${composed.stats.stoppedBy} issues=${JSON.stringify(composed.issues)}`)
  assert.equal(composedSummary.coverage.overall, summary.coverage.overall)
  const composedView = toInsightConsumerView(composedSummary)
  assert.equal(consumerAdmission(composedView).admitted, true)
  assert.equal(composedView.scope?.aggregation, 'declared_multi_project')

  // ---- W30: one observation across the page, the report and the export (G1/G2) ----------------
  // The analysis of the served window, from the same authorized reads, so every structural fact
  // (window, scope, days, timezone) is identical and the rows can be compared one by one.
  const alignedSummary = analyzeUsageInsights({
    ...composed.bundle, window: served.window, capturedAt: served.observedAt,
  }).summary

  // The served document exports as display-only: the strings are preserved verbatim and there is no
  // numeric field anywhere, so nothing can be reverse-parsed into a measurement.
  const display = buildDisplayExport(served)
  assert.equal(display.document.protocol, 'usage-insights-display-export/1')
  assert.equal(display.document.rows.length, served.metrics.length)
  assert.equal(display.document.sourceIdentity.numericValues, false)
  assert.equal(JSON.stringify(display.document.rows).includes('"value"'), false)
  for (const [index, metric] of served.metrics.entries()) {
    assert.equal(display.document.rows[index].rowId, metric.id, 'the served identity is kept verbatim')
    assert.equal(display.document.rows[index].formatted, metric.value, 'the served string is kept verbatim')
  }
  assert.equal(display.document.snapshot.snapshotId, served.summaryId)
  assert.match(displayExportDigest(display.document), /^[a-f0-9]{64}$/)

  // The served page and the authorized analysis describe the same observation.
  const pageCheck = crossCheckAnalysisWithDisplay({ dto: served, summary: alignedSummary })
  assert.equal(pageCheck.comparable, true)
  assert.deepEqual(pageCheck.disagreements, [], JSON.stringify(pageCheck.disagreements))
  assert.equal(pageCheck.agreements, pageCheck.checked)
  assert.equal(pageCheck.snapshot.display, served.summaryId)

  // The CLI reads the same window over HTTP and writes the report and the export of that one read.
  const loopBundle = join(directory, 'wave30-bundle.json')
  const loopReport = join(directory, 'wave30-report.md')
  const loopExport = join(directory, 'wave30-export.json')
  const loop = await run(['collect', '--base-url', `http://127.0.0.1:${port}`, '--token-file', tokenFile,
    '--from', served.window.from, '--to', served.window.to,
    '--project', PROJECT_A, '--project', PROJECT_B, '--include-attention',
    '--snapshot-limit', '20', '--history-pages', '5', '--history-limit', '100',
    '--input-id', 'probe-served-window', '--out', loopBundle, '--report', loopReport, '--export', loopExport])
  assert.equal(loop.status, 0, loop.stderr)
  const loopDocument = JSON.parse(readFileSync(loopExport, 'utf8'))
  const loopMarkdown = readFileSync(loopReport, 'utf8')
  assert.deepEqual(loopDocument.window, served.window, 'the export is bound to the served window')
  assert.equal(loopDocument.snapshot.continuity, 'first_observation')
  assert.ok(loopMarkdown.includes(`Summary id | ${loopDocument.snapshot.snapshotId}`),
    'the report and the export name the same snapshot')
  const loopSummary = JSON.parse((await run(['analyze', '--input', loopBundle])).stdout).summary
  assert.equal(loopSummary.summaryId, loopDocument.snapshot.snapshotId,
    'a later analysis of the written bundle is the same snapshot')
  // The page (main's readers) and the CLI's HTTP read agree on every number for that window.
  const httpCheck = crossCheckAnalysisWithDisplay({ dto: served, summary: loopSummary })
  assert.equal(httpCheck.comparable, true)
  assert.deepEqual(httpCheck.disagreements, [], JSON.stringify(httpCheck.disagreements))
  assert.equal(httpCheck.agreements, httpCheck.checked)

  // A second read of the same window is a new snapshot; the earlier export's values are not reused.
  // The capture time is stamped after the reads, so waiting guarantees a later observation.
  await new Promise(resolveDelay => setTimeout(resolveDelay, 25))
  const secondExport = join(directory, 'wave30-export-2.json')
  const second = await run(['collect', '--base-url', `http://127.0.0.1:${port}`, '--token-file', tokenFile,
    '--from', served.window.from, '--to', served.window.to,
    '--project', PROJECT_A, '--project', PROJECT_B, '--include-attention',
    '--snapshot-limit', '20', '--history-pages', '5', '--history-limit', '100',
    '--input-id', 'probe-served-window-2', '--out', join(directory, 'wave30-bundle-2.json'),
    '--export', secondExport, '--previous-export', loopExport])
  assert.equal(second.status, 0, second.stderr)
  const secondDocument = JSON.parse(readFileSync(secondExport, 'utf8'))
  assert.equal(secondDocument.snapshot.continuity, 'new_snapshot')
  assert.deepEqual(secondDocument.snapshot.previous,
    { snapshotId: loopDocument.snapshot.snapshotId, capturedAt: loopDocument.snapshot.capturedAt })
  assert.ok(second.stderr.includes('new_snapshot'), second.stderr)
  assert.match(secondDocument.snapshot.note, /not reused/)

  // The display export of the same served document is stable: an identical document serializes identically.
  assert.equal(buildDisplayExport(served).text, display.text)

  // ---- W31 R2: main's default download route, end to end (G5-G8) --------------------------------
  // The real route calls the real `download`, which builds the display document through G's library.
  const exportApp = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API_TOKEN,
    bootstrapToken: 'b3'.repeat(32),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'product',
    read: { usageObservationDownload: query => new ProductUsageObservation(coordinatorReaders).download(query) },
  })
  const eventsBeforeExport = store.events.cursor()
  const exportResponse = await exportApp.request('http://127.0.0.1/v1/insights/export?days=7&timezone=UTC',
    { headers: { authorization: `Bearer ${API_TOKEN}` } })
  assert.equal(exportResponse.status, 200, 'the default export route serves the observation')
  assert.equal(exportResponse.headers.get('cache-control'), 'no-store')
  const download = UsageObservationDownloadSchema.parse(await exportResponse.json())
  assert.equal(download.sha256, createHash('sha256').update(download.text).digest('hex'),
    'the advertised digest is of the delivered text')
  assert.equal(download.fileName, `observation-7d-${download.observation.summaryId.slice(0, 12)}.json`)
  const file = JSON.parse(download.text)
  assert.equal(file.protocol, 'usage-insights-display-export/1')
  assert.equal(file.sourceIdentity.numericValues, false)
  assert.equal(file.snapshot.snapshotId, download.observation.summaryId, 'the file names its own observation')
  assert.equal(file.snapshot.capturedAt, download.observation.observedAt)
  assert.equal(file.truncation.bytes, Buffer.byteLength(download.text))
  assert.equal(JSON.stringify(file.rows).includes('"value"'), false, 'no numeric field reaches the user file')
  assert.equal(file.rows.length, download.observation.metrics.length)
  // The downloaded observation and the analysis of its own window are the same facts.
  const exportAligned = analyzeUsageInsights({
    ...composed.bundle, window: download.observation.window, capturedAt: download.observation.observedAt,
  }).summary
  const fileCheck = crossCheckAnalysisWithDisplay({ dto: download.observation, summary: exportAligned })
  assert.equal(fileCheck.comparable, true)
  assert.deepEqual(fileCheck.disagreements, [], JSON.stringify(fileCheck.disagreements))
  assert.equal(fileCheck.agreements, fileCheck.checked)
  // The original work is still readable after the export, and nothing was written.
  const afterExport = await product.application.inspect({ limit: 5 })
  assert.ok(afterExport.works.length >= 2, 'the original works are still there')
  assert.equal(store.events.cursor(), eventsBeforeExport, 'export and the following work read create no product events')
  // An app without the optional download port reports the feature as absent, not an empty file.
  const noPort = createLocalHttpApp({ application: product.application, principal, apiToken: API_TOKEN,
    bootstrapToken: 'b4'.repeat(32), allowedOrigins: ['http://127.0.0.1:5173'], mode: 'product', read: {} })
  assert.equal((await noPort.request('http://127.0.0.1/v1/insights/export?days=7',
    { headers: { authorization: `Bearer ${API_TOKEN}` } })).status, 422)
  assert.equal((await exportApp.request('http://127.0.0.1/v1/insights/export?days=7')).status, 401)

  // ---- W31 R3: a re-read is a new snapshot and never backfills the previous one (G9) ------------
  await new Promise(resolveDelay => setTimeout(resolveDelay, 25))
  const repeatFile = UsageObservationDownloadSchema.parse(await (await exportApp.request(
    'http://127.0.0.1/v1/insights/export?days=7&timezone=UTC',
    { headers: { authorization: `Bearer ${API_TOKEN}` } })).json())
  assert.notEqual(repeatFile.observation.summaryId, download.observation.summaryId,
    'a later read is its own observation')
  const repeatDocument = JSON.parse(repeatFile.text)
  assert.equal(repeatDocument.snapshot.snapshotId, repeatFile.observation.summaryId)
  assert.notEqual(repeatDocument.snapshot.snapshotId, file.snapshot.snapshotId)
  // Same facts, same row identities; an unknown row stays unknown instead of inheriting a value.
  assert.deepEqual(repeatDocument.rows.map(row => row.rowId), file.rows.map(row => row.rowId))
  for (const [index, row] of repeatDocument.rows.entries()) {
    if (row.formatted === null) assert.equal(file.rows[index].formatted, null, `${row.rowId} stays unknown`)
  }
  assert.ok(repeatDocument.rows.every((row, index) => row.formatted === file.rows[index].formatted),
    'a repeated observation of unchanged facts reports the same values')

  // ---- single-project isolation from the same product (G9) ------------------------------------
  const singleBundlePath = join(directory, 'bundle-single.json')
  const single = await run(['collect', '--base-url', `http://127.0.0.1:${port}`, '--token-file', tokenFile,
    ...WINDOW, '--project', PROJECT_A, '--snapshot-limit', '20', '--history-pages', '5', '--history-limit', '100',
    '--input-id', 'probe-single-project', '--out', singleBundlePath])
  assert.equal(single.status, 0, single.stderr)
  const singleSummary = JSON.parse((await run(['analyze', '--input', singleBundlePath])).stdout).summary
  const singleMetric = id => singleSummary.metrics.find(row => row.metricId === id)
  assert.equal(singleMetric('interventions.questions')?.value, 1, 'only the selected project is counted')
  assert.equal(singleMetric('interventions.answers')?.value, 1)
  assert.equal(singleMetric('outcomes.count')?.value, 1)
  assert.deepEqual(singleSummary.projects.map(project => project.projectId), [PROJECT_A])
  const singleAnalysis = JSON.parse((await run(['analyze', '--input', singleBundlePath])).stdout)
  assert.equal(singleAnalysis.subjects.every(subject => subject.projectId === PROJECT_A), true,
    'no subject from the other project leaks into a single-project observation')
  const singleView = toInsightConsumerView(singleSummary)
  assert.equal(singleView.scope?.aggregation, 'single_project')
  assert.deepEqual(singleView.scope?.projectIds, [PROJECT_A])

  // ---- daily workflow: repeat observation without double counting (G13) -----------------------
  // A second observation of the same window must not accumulate the first round's facts.
  const secondAnalysis = JSON.parse((await run(['analyze', '--input', bundlePath2])).stdout)
  assert.deepEqual(secondAnalysis.summary.metrics, summary.metrics,
    'repeating the observation must not double-count questions, answers or usage')
  assert.equal(secondAnalysis.summary.attention.items, summary.attention.items)

  // An earlier window that ends before the run: the same works are presented, but every fact is
  // outside it. That is a known zero for the observed works, not an unknown and not a repeat.
  const earlyStart = new Date(Date.now() - 7_200_000).toISOString()
  const earlyEnd = new Date(Date.now() - 3_600_000).toISOString()
  const earlyBundle = join(directory, 'bundle-early.json')
  const early = await run(['collect', '--base-url', `http://127.0.0.1:${port}`, '--token-file', tokenFile,
    '--from', earlyStart, '--to', earlyEnd, '--project', PROJECT_A, '--project', PROJECT_B,
    '--snapshot-limit', '20', '--history-pages', '5', '--history-limit', '100',
    '--input-id', 'probe-two-projects-early', '--out', earlyBundle])
  assert.equal(early.status, 0, early.stderr)
  const earlyAnalysis = JSON.parse((await run(['analyze', '--input', earlyBundle])).stdout).summary
  const earlyMetric = id => earlyAnalysis.metrics.find(row => row.metricId === id)
  assert.equal(earlyMetric('outcomes.count'), undefined, 'no outcome is observed inside the earlier window')
  assert.equal(earlyMetric('interventions.total')?.value, 0, 'the facts exist but none fall inside the window')
  assert.ok(earlyAnalysis.losses.workEvidence.outsideWindow >= 6, 'the excluded facts are accounted for')

  // The first report is untouched by later runs (exclusive create, no overwrite).
  assert.ok(readFileSync(reportPath, 'utf8').includes(`Summary id | ${summary.summaryId}`))

  // ---- verified-file reproduction (G7) --------------------------------------------------------
  const verified = JSON.parse((await run(['verify', '--input', bundlePath])).stdout)
  assert.equal(verified.status, 'complete')
  assert.match(verified.digest, /^[a-f0-9]{64}$/)
  const pinned = await run(['verify', '--input', bundlePath, '--expect-digest', verified.digest])
  assert.equal(pinned.status, 0, pinned.stderr)

  // The same bytes analysed twice must yield the same summary identity.
  const repeat = JSON.parse((await run(['analyze', '--input', bundlePath])).stdout)
  assert.equal(repeat.summary.summaryId, summary.summaryId)

  // A changed byte is refused against the pinned digest: the provenance is bound to exact bytes.
  const tampered = join(directory, 'tampered.json')
  const tamperedBody = JSON.parse(readFileSync(bundlePath, 'utf8'))
  tamperedBody.workIndex = []
  writeFileSync(tampered, JSON.stringify(tamperedBody))
  const tamperCheck = await run(['verify', '--input', tampered, '--expect-digest', verified.digest])
  assert.equal(tamperCheck.status, 5, tamperCheck.stderr)
  assert.ok(tamperCheck.stderr.includes('does not match the pinned digest'), tamperCheck.stderr)

  const keep = process.argv.includes('--keep')
  let published
  if (keep) {
    const directoryOut = fileURLToPath(new URL('../../../reports/usage-insights/probe/', import.meta.url))
    mkdirSync(directoryOut, { recursive: true })
    const stamp = bundle.capturedAt.replace(/[-:]/g, '').replace(/\..*$/, '')
    published = {
      bundle: join(directoryOut, `two-project-${stamp}.bundle.json`),
      report: join(directoryOut, `two-project-${stamp}.report.md`),
      export: join(directoryOut, `two-project-${stamp}.export.json`),
      displayExport: join(directoryOut, `two-project-${stamp}.display-export.json`),
      download: join(directoryOut, `two-project-${stamp}.download.json`),
      support: join(directoryOut, `two-project-${stamp}.support.json`),
      crossCheck: join(directoryOut, `two-project-${stamp}.crosscheck.json`),
    }
    for (const [source, target] of [[bundlePath, published.bundle], [reportPath, published.report],
      [loopExport, published.export]])
      writeFileSync(target, readFileSync(source), { flag: 'wx', mode: 0o600 })
    // The display export, the delivered download, the support summary and the cross-check are
    // generated in this run, not copied from a bundle.
    writeFileSync(published.displayExport, display.text, { flag: 'wx', mode: 0o600 })
    writeFileSync(published.download, download.text, { flag: 'wx', mode: 0o600 })
    writeFileSync(published.support, `${JSON.stringify(describeDisplayDocument(download.observation), null, 2)}\n`,
      { flag: 'wx', mode: 0o600 })
    writeFileSync(published.crossCheck, `${JSON.stringify({
      protocol: 'usage-insights-cross-check-evidence/1',
      servedSummaryId: served.summaryId,
      page: pageCheck,
      http: httpCheck,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }

  process.stdout.write(`${JSON.stringify({
    httpSurface: 'real controlled product runtime behind the real HTTP app on 127.0.0.1',
    projects: PROJECTS,
    works: created.map(entry => entry.projectId),
    recordedFacts: { questions: 2, answers: 2, acceptances: 2, reviewSpans: 2 },
    layers: ['controlled'],
    nativeExecution: 'NOT_TESTED',
    usage: 'unknown (the fixture driver records no tokens or cost)',
    queueWaiting: 'not exposed by the product read surface',
    coverage: summary.coverage,
    losses: summary.losses,
    metrics: summary.metrics.map(row => ({ metricId: row.metricId, layer: row.layer, currency: row.currency,
      value: row.value, sampleCount: row.sampleCount, unknownCount: row.unknownCount, nullReason: row.nullReason })),
    summaryId: summary.summaryId,
    composedSummaryId: composedSummary.summaryId,
    coordinatorObservation: { status: observation7.status, days: observation7.days,
      scope: observation7.scope, headerSampleCount: observation7.sampleCount,
      summaryId: observation7.summaryId,
      metricIds: observation7.metrics.map(metric => metric.id) },
    // What the product surface actually made available for this observation.
    availability: Object.fromEntries(summary.metrics.map(row => [row.metricId, row.value === null
      ? { state: 'unknown', reason: row.nullReason }
      : { state: row.coverage === 'partial' ? 'partial' : 'known', samples: row.sampleCount,
          ...(row.currency ? { currency: row.currency } : {}), layer: row.layer }])),
    compositionAgreesWithCli: true,
    // One observation across the page, the report and the export.
    snapshotCoherence: {
      servedSummaryId: served.summaryId,
      pageCheck: { comparable: pageCheck.comparable, checked: pageCheck.checked, agreements: pageCheck.agreements,
        disagreements: pageCheck.disagreements.length },
      httpCheck: { comparable: httpCheck.comparable, checked: httpCheck.checked, agreements: httpCheck.agreements,
        disagreements: httpCheck.disagreements.length },
      displayExport: { protocol: display.document.protocol, rows: display.document.rows.length,
        numericFields: false, digest: displayExportDigest(display.document) },
      cliExport: { snapshotId: loopDocument.snapshot.snapshotId, continuity: loopDocument.snapshot.continuity,
        rows: loopDocument.truncation.includedRows },
      secondRead: { continuity: secondDocument.snapshot.continuity, previous: secondDocument.snapshot.previous },
    },
    downloadSurface: {
      route: 'GET /v1/insights/export',
      status: exportResponse.status,
      fileName: download.fileName,
      sha256: download.sha256,
      bytes: Buffer.byteLength(download.text),
      rows: file.rows.length,
      snapshotId: file.snapshot.snapshotId,
      continuity: file.snapshot.continuity,
      numericFields: false,
      absentPortStatus: 422,
      repeatIsNewSnapshot: repeatDocument.snapshot.snapshotId !== file.snapshot.snapshotId,
      pageAgreesWithFile: fileCheck.agreements === fileCheck.checked && fileCheck.disagreements.length === 0,
      eventsDuringExportAndWorkRead: store.events.cursor() - eventsBeforeExport,
    },
    digest: verified.digest,
    repeatedCollectionIdentical: true,
    readOnlyCollection: true,
    collectMs,
    analyzeMs,
    ...(published ? { published } : {}),
  }, null, 2)}\n`)
}

try {
  await main()
} finally {
  for (const cleanupFn of cleanups.reverse()) {
    try { await cleanupFn() } catch { /* fixture cleanup is best effort */ }
  }
}
