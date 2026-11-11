#!/usr/bin/env node
/**
 * Independent product acceptance runner (Agent E).
 *
 * It collects cases from one or more suites, binds the report to the current source commit, applies a
 * fail-closed release gate and exits nonzero when the claim is not supported. It never mutates product
 * code, shared manifests or another agent's directory.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { STATUS } from './lib/status.mjs'
import { environmentIdentity, gitSource, branchName } from './lib/evidence.mjs'
import { evaluateRelease, REPORT_SCHEMA, applyReleaseVerdict } from './lib/release.mjs'
import { createRun, printSummary, summarize, writeJson } from './lib/report.mjs'
import { resolveFixtureDigest } from './lib/fixtures.mjs'
import { tier } from './lib/release-requirements.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const root = resolve(here, '../..')
const reportsRoot = resolve(here, 'reports')

const { values } = parseArgs({
  options: {
    suites: { type: 'string', default: 'selftest' },
    tier: { type: 'string' },
    record: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    cycles: { type: 'string' },
    only: { type: 'string' },
    label: { type: 'string' },
  },
})

const requested = values.suites.split(',').map((item) => item.trim()).filter(Boolean)
const KNOWN = new Set(['selftest', 'e2', 'e3', 'e4'])
for (const suite of requested)
  if (!KNOWN.has(suite)) throw new Error(`Unknown suite ${suite}. Known: ${[...KNOWN].join(', ')}`)

const only = values.only ? new Set(values.only.split(',').map((item) => item.trim())) : undefined
// Source identity is captured before any evidence is written, so the harness's own reports cannot
// make the product source look modified.
const source = gitSource(root, { ignoreUntrackedPrefixes: ['tests/product-acceptance/reports/'] })
const run = createRun({ reportsRoot, suites: requested, label: values.label })
const startedAt = new Date().toISOString()
const artifacts = { runDirectory: run.directory, screenshots: [] }
const cases = []

async function collect(suite, loader) {
  if (!requested.includes(suite)) return
  try {
    const produced = await loader()
    const list = Array.isArray(produced) ? produced : produced.cases
    if (!Array.isArray(list)) throw new Error(`Suite ${suite} returned no case list`)
    if (produced?.artifacts) {
      artifacts.screenshots.push(...(produced.artifacts.screenshots ?? []))
      Object.assign(artifacts, produced.artifacts, {
        runDirectory: run.directory,
        screenshots: artifacts.screenshots,
      })
    }
    for (const item of list) if (!only || only.has(item.id)) cases.push(item)
  } catch (error) {
    cases.push({
      id: `SUITE-${suite.toUpperCase()}-LOAD`,
      title: `Suite ${suite} failed to load`,
      layer: 'readonly',
      status: STATUS.BLOCKED,
      reason: String(error?.message ?? error).slice(0, 1200),
      assertions: [],
      evidence: {},
      limitations: [],
    })
  }
}

await collect('selftest', async () => {
  const [base, mutations] = await Promise.all([
    import('./selftest/gate.mjs'),
    import('./selftest/gate-mutations.mjs'),
  ])
  return [...(await base.gateSelftestCases()), ...(await mutations.gateMutationCases())]
})
await collect('e2', async () => {
  const [daily, wave04, wave05] = await Promise.all([
    import('./cases/e2-daily.mjs'),
    import('./cases/e2-wave04.mjs'),
    import('./cases/e2-wave05.mjs'),
  ])
  const first = await daily.runE2({ root, runDirectory: run.directory, keep: values.keep === true, cycles: 0 })
  const second = await wave04.runWave04({ root, runDirectory: run.directory, keep: values.keep === true })
  const third = await wave05.runWave05E2({ root, runDirectory: run.directory, keep: values.keep === true })
  return {
    cases: [...first.cases, ...second.cases, ...third.cases],
    artifacts: {
      screenshots: [
        ...(first.artifacts?.screenshots ?? []),
        ...(second.artifacts?.screenshots ?? []),
        ...(third.artifacts?.screenshots ?? []),
      ],
    },
  }
})
await collect('e3', async () => {
  const [browser, assistant, wave05, attention, decisions] = await Promise.all([
    import('./cases/e3-browser.mjs'),
    import('./cases/e3-assistant.mjs'),
    import('./cases/e3-wave05.mjs'),
    import('./cases/e3-attention.mjs'),
    import('./cases/e3-decisions.mjs'),
  ])
  const first = await browser.runE3({ root, runDirectory: run.directory, keep: values.keep === true })
  const second = await assistant.runAssistant({ root, runDirectory: run.directory, keep: values.keep === true })
  const third = await wave05.runWave05E3({ root, runDirectory: run.directory, keep: values.keep === true })
  const fourth = await attention.runAttention({ root, runDirectory: run.directory, keep: values.keep === true })
  const fifth = await decisions.runDecisions({ root, runDirectory: run.directory, keep: values.keep === true })
  return {
    cases: [...first.cases, ...second.cases, ...third.cases, ...fourth.cases, ...fifth.cases],
    artifacts: {
      screenshots: [
        ...(first.artifacts?.screenshots ?? []),
        ...(second.artifacts?.screenshots ?? []),
        ...(third.artifacts?.screenshots ?? []),
        ...(fourth.artifacts?.screenshots ?? []),
        ...(fifth.artifacts?.screenshots ?? []),
      ],
    },
  }
})
await collect('e4', async () => {
  const [stability, wave04, release, install] = await Promise.all([
    import('./cases/e4-stability.mjs'),
    import('./cases/e4-wave04.mjs'),
    import('./cases/e5-release.mjs'),
    import('./cases/e4-install.mjs'),
  ])
  const first = await stability.runE4({
    root,
    runDirectory: run.directory,
    keep: values.keep === true,
    cycles: values.cycles ? Number(values.cycles) : 30,
  })
  const second = await wave04.runWave04E4({ root, runDirectory: run.directory, keep: values.keep === true })
  const third = await release.runRelease({ root, runDirectory: run.directory, keep: values.keep === true })
  const fourth = await install.runInstall({ root, runDirectory: run.directory, keep: values.keep === true })
  return {
    cases: [...first.cases, ...second.cases, ...third.cases, ...fourth.cases],
    artifacts: {
      screenshots: [
        ...(first.artifacts?.screenshots ?? []),
        ...(second.artifacts?.screenshots ?? []),
        ...(third.artifacts?.screenshots ?? []),
        ...(fourth.artifacts?.screenshots ?? []),
      ],
    },
  }
})

// Bind every case to the commit it executed against. A case that arrives with another binding is left
// untouched so the gate can reject it rather than the runner silently rewriting evidence.
for (const item of cases) if (!item.source) item.source = { commit: source.commit }

const finishedAt = new Date().toISOString()
const report = {
  schema: REPORT_SCHEMA,
  suites: requested,
  branch: branchName(root),
  source,
  environment: environmentIdentity(),
  startedAt,
  finishedAt,
  checkedAt: finishedAt,
  counts: summarize(cases),
  artifacts,
  cases,
  declaredGaps: cases
    .filter((item) => item.status !== STATUS.PASS)
    .map((item) => ({ id: item.id, status: item.status, reason: item.reason ?? null })),
}

const requirementName =
  values.tier ??
  (requested.length === 1
    ? { selftest: 'harness-only', e2: 'e2-controlled-workflow', e3: 'e3-browser-ui', e4: 'e4-bounded-stability' }[requested[0]]
    : 'controlled-product-workflow')
const requirement = tier(requirementName)
const verdict = evaluateRelease({
  report,
  requirement,
  expectedSource: source.commit,
  resolveFixture: resolveFixtureDigest,
})
const finalReport = applyReleaseVerdict(report, verdict)
writeJson(run.directory, 'report.json', finalReport)
writeJson(run.directory, 'release.json', verdict)
writeJson(reportsRoot, 'latest.json', {
  runDirectory: run.directory,
  tier: verdict.tier,
  status: verdict.status,
  source,
  checkedAt: finalReport.checkedAt,
  counts: finalReport.counts,
  failureCodes: verdict.failures.map((item) => item.code),
})

printSummary({ report: finalReport, release: verdict })
process.stdout.write(`evidence: ${run.directory}\n`)
// The tier decides what must pass. FAIL/UNKNOWN always block; NOT_TESTED, SKIPPED and BLOCKED are
// declared gaps and are visible in the report without being able to turn a failed gate green.
const blocking = cases.filter((item) => item.status === STATUS.FAIL || item.status === STATUS.UNKNOWN)
process.exitCode = verdict.ok && blocking.length === 0 ? 0 : 1
