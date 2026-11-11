#!/usr/bin/env node
/**
 * Independent-review pilot harness.
 *
 *   node harness.mjs --freeze       # (re)write the case manifest before any model call
 *   node harness.mjs --preflight    # verify frozen inputs, model/usage preconditions and pricing
 *   node harness.mjs --dry-run      # exercise scoring with synthetic reports; no model call
 *   node harness.mjs --execute --confirm-grant
 *
 * The execute path is intentionally guarded: it refuses unless preflight PASSed and a pricing
 * schedule exists, because the protocol forbids treating subscription access as zero cost.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { scorePilot, PILOT_CAPS, ARMS } from './score.mjs'
import {
  annotateLedger,
  costOf,
  readLedger,
  readPricing,
  readRuntimeInterface,
  reserveTurn,
  runCodexTurn,
  settleTurn,
} from './runner.mjs'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const reports = join(here, 'reports')
const manifestPath = join(here, 'cases.manifest.json')
const oraclePath = join(here, 'oracle.json')
const ledgerPath = join(here, 'ledger.json')
const pricingPath = join(here, 'pricing.json')
const grantId = 'wave05-independent-review-pilot-01'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const args = new Set(process.argv.slice(2))

/** Runs the runner's accounting selftest in a separate process on a disposable ledger. */
function runRunnerSelftest() {
  const script = join(here, 'runner-selftest.mjs')
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60_000 })
  try {
    return JSON.parse(result.stdout)
  } catch {
    return {
      protocol: 'review-pilot-runner-selftest/1',
      passes: 0,
      failures: [{ id: 'selftest_crash', ok: false, detail: (result.stderr || result.stdout || '').slice(-400) }],
      assertions: [],
    }
  }
}

function ensureReports() {
  mkdirSync(reports, { recursive: true })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function verifyFrozen() {
  if (!existsSync(manifestPath)) return { ok: false, code: 'manifest_missing' }
  const manifest = readJson(manifestPath)
  const mismatches = []
  for (const file of manifest.files) {
    const path = join(here, file.path)
    if (!existsSync(path)) mismatches.push(`${file.path}:missing`)
    else if (sha256(readFileSync(path)) !== file.sha256) mismatches.push(`${file.path}:digest`)
  }
  const protocolPath = join(root, manifest.protocolPath)
  if (!existsSync(protocolPath) || sha256(readFileSync(protocolPath)) !== manifest.protocolDigest)
    mismatches.push('protocol:digest')
  const scoringDigest = sha256(readFileSync(join(here, 'score.mjs')))
  if (scoringDigest !== manifest.scoringRuleDigest) mismatches.push('score.mjs:digest')
  return { ok: mismatches.length === 0, manifest, mismatches }
}

function codexInfo() {
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 20_000 })
  const doctor = spawnSync('codex', ['doctor'], { encoding: 'utf8', timeout: 60_000 })
  const text = `${doctor.stdout ?? ''}${doctor.stderr ?? ''}`
  const model = /(?:^|\n)\s*model\s+(\S+)/.exec(text)?.[1] ?? null
  const authMode = /stored auth mode\s+(\S+)/.exec(text)?.[1] ?? null
  return {
    version: (version.stdout ?? '').trim() || null,
    available: version.status === 0,
    authMode,
    model,
    doctorStatus: doctor.status,
  }
}

function runtimeInterface() {
  const path = join(root, 'tools/experiments/review-pilot-01/runtime-interface.json')
  if (!existsSync(path)) return { ok: false, reason: 'b_runtime_interface_missing', path }
  try {
    const value = readJson(path)
    const valid =
      typeof value.protocol === 'string' &&
      typeof value.entry === 'string' &&
      typeof value.sessionResume === 'string' &&
      typeof value.usage === 'string'
    return valid ? { ok: true, value, path } : { ok: false, reason: 'b_runtime_interface_invalid', path }
  } catch {
    return { ok: false, reason: 'b_runtime_interface_invalid', path }
  }
}

function ledgerState() {
  if (!existsSync(ledgerPath)) return { ok: true, turns: 0, tokens: 0, unknown: 0 }
  try {
    const value = readJson(ledgerPath)
    const turns = Number(value.actual?.turns ?? 0)
    const tokens = Number(value.actual?.tokens ?? 0)
    const unknown = Number(value.actual?.unknownTurns ?? 0)
    return { ok: turns === 0 && tokens === 0 && unknown === 0, turns, tokens, unknown, status: value.status }
  } catch {
    return { ok: false, turns: null, tokens: null, unknown: null }
  }
}

/**
 * Second freeze point required by WP-16/0023: after the real author turn and before any review, the
 * actual candidate/session material is digested. The initial cases/oracle stay frozen from stage one.
 */
export function freezeCandidate(caseId, capsulePath) {
  const capsule = sealDirectory(capsulePath, mkdtempSync(join(tmpdir(), 'pa-candidate-freeze-')))
  const record = {
    schema: 'review-pilot-candidate/1',
    caseId,
    digest: capsule.manifest.digest,
    files: capsule.manifest.files,
    frozenAt: new Date().toISOString(),
  }
  mkdirSync(join(here, 'reports', 'candidates'), { recursive: true })
  writeFileSync(join(here, 'reports', 'candidates', `${caseId}.json`), JSON.stringify(record, null, 2) + '\n')
  return record
}

export function verifyCandidateFreeze(caseId, capsulePath) {
  const path = join(here, 'reports', 'candidates', `${caseId}.json`)
  if (!existsSync(path)) return { ok: false, reason: 'candidate_not_frozen' }
  const record = readJson(path)
  const capsule = sealDirectory(capsulePath, mkdtempSync(join(tmpdir(), 'pa-candidate-check-')))
  return {
    ok: capsule.manifest.digest === record.digest,
    expected: record.digest,
    actual: capsule.manifest.digest,
  }
}

function pricingSchedule() {
  if (!existsSync(pricingPath)) return { ok: false, reason: 'pricing_unavailable' }
  try {
    const value = readJson(pricingPath)
    const valid =
      typeof value.model === 'string' &&
      value.model.length > 0 &&
      typeof value.inputPerMillion === 'number' &&
      value.inputPerMillion >= 0 &&
      typeof value.outputPerMillion === 'number' &&
      value.outputPerMillion >= 0 &&
      value.currency === 'USD' &&
      typeof value.source === 'string' &&
      typeof value.observedAt === 'string'
    return valid ? { ok: true, value } : { ok: false, reason: 'pricing_invalid' }
  } catch {
    return { ok: false, reason: 'pricing_invalid' }
  }
}

/**
 * Copies a frozen tree into a disposable capsule. `.git`, dependency and build directories are
 * excluded; symlinks are refused rather than followed, and no hard link is created.
 */
export function sealDirectory(source, destination) {
  mkdirSync(destination, { recursive: true })
  const files = []
  const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.cache'])
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (excluded.has(name)) continue
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error(`Refusing to seal a symbolic link: ${path}`)
      if (stat.isDirectory()) walk(path)
      else if (stat.isFile()) {
        const target = join(destination, relative(source, path))
        cpSync(path, target, { dereference: false })
        files.push({ path: relative(destination, target), sha256: sha256(readFileSync(target)), bytes: stat.size })
      }
    }
  }
  walk(source)
  const manifest = { schema: 'review-capsule/1', source: relative(here, source), files }
  manifest.digest = sha256(Buffer.from(JSON.stringify(manifest.files)))
  return { capsulePath: destination, manifest }
}

export function sealCase(caseId, destination) {
  const source = join(here, 'cases', caseId)
  if (!existsSync(source)) throw new Error(`Unknown case ${caseId}`)
  return sealDirectory(source, destination)
}

function preflight() {
  ensureReports()
  const frozen = verifyFrozen()
  const codex = codexInfo()
  const pricing = readPricing()
  const runtime = readRuntimeInterface()
  const ledger = readLedger()
  const runner = runRunnerSelftest()
  const reasons = []
  if (runner.failures.length > 0)
    reasons.push({ code: 'runner_selftest_failed', detail: runner.failures.map((item) => item.id) })
  if (!frozen.ok) reasons.push({ code: 'frozen_inputs_invalid', detail: frozen.code ?? frozen.mismatches })
  if (!codex.available) reasons.push({ code: 'codex_unavailable', detail: codex })
  if (!pricing)
    reasons.push({
      code: 'pricing_unavailable',
      detail: 'No operator-provided USD schedule for the configured model; key/subscription access is not zero cost.',
    })
  if ((ledger.reservations ?? []).some((item) => item.status === 'in_flight'))
    reasons.push({ code: 'turn_in_flight', detail: 'An earlier reservation is still open; reconcile it before sending.' })
  let seal
  try {
    const target = mkdtempSync(join(tmpdir(), 'pa-pilot-seal-'))
    seal = sealCase('case-01', target)
    rmSync(target, { recursive: true, force: true })
  } catch (error) {
    reasons.push({ code: 'seal_failed', detail: String(error?.message ?? error) })
  }
  const status = reasons.length === 0 ? 'PASS' : 'BLOCKED'
  const adapter = runtime ? 'b-runtime-interface' : 'codex-cli-adapter'
  const result = {
    schema: 'review-pilot-preflight/1',
    protocol: 'independent-review-pilot/1',
    grantId,
    status,
    reasons,
    codex,
    adapter,
    runtimeInterface: runtime ?? null,
    pricing,
    frozen: frozen.ok
      ? {
          manifestDigest: frozen.manifest.caseManifestDigest,
          protocolDigest: frozen.manifest.protocolDigest,
          oracleDigest: frozen.manifest.oracleDigest,
          files: frozen.manifest.files.length,
        }
      : { ok: false, mismatches: frozen.mismatches },
    sealSelfTest: seal ? { caseId: 'case-01', digest: seal.manifest.digest } : null,
    runnerSelfTest: { protocol: runner.protocol, passes: runner.passes, failures: runner.failures }, 
    protocolSemantics: {
      stage1: 'Cases, oracle, scoring, order seed, model and budgets are frozen before any author call.',
      stage2: 'freezeCandidate() digests the real author capsule before any review; verifyCandidateFreeze() rechecks it.',
      alignedWith: 'WP-16/0023 two freeze points',
    },
    ledger: {
      status: ledger.status,
      turns: Number(ledger.actual?.turns ?? 0),
      tokens: Number(ledger.actual?.tokens ?? 0),
      unknownTurns: Number(ledger.actual?.unknownTurns ?? 0),
      reservations: (ledger.reservations ?? []).length,
    },
    modelTurnsUsed: Number(ledger.actual?.turns ?? 0),
    caps: PILOT_CAPS,
    checkedAt: new Date().toISOString(),
    note:
      status === 'PASS'
        ? 'Preflight passed; execution is allowed under the existing grant.'
        : 'Preflight blocked; no model turn may be sent. Existing ledger reservations/usage were preserved.',
  }
  writeFileSync(join(reports, 'preflight.json'), JSON.stringify(result, null, 2) + '\n')
  annotateLedger({
    status: status === 'PASS' ? (Number(ledger.actual?.turns ?? 0) > 0 ? 'READY_RESUME' : 'READY_NOT_EXECUTED') : 'BLOCKED_PREFLIGHT',
    reason: reasons.map((item) => item.code),
    adapter,
    lastPreflightAt: result.checkedAt,
  })
  process.stdout.write(`preflight ${status}: ${reasons.map((item) => item.code).join(', ') || 'ready'}\n`)
  return result
}

function syntheticReports(oracle) {
  const defective = oracle.cases.filter((item) => item.defective)
  const clean = oracle.cases.filter((item) => !item.defective)
  const self = {}
  const fresh = {}
  defective.forEach((item, index) => {
    const finding = {
      path: item.oracle.path,
      line: item.oracle.line,
      severity: 'high',
      claim: `${item.oracle.keywords[0]} issue in the frozen candidate`,
    }
    // Self review misses the last defective case; fresh review detects all four.
    self[item.id] = index === defective.length - 1 ? { subjectDigest: 'x', disposition: 'no_findings', findings: [] } : { disposition: 'findings', findings: [finding] }
    fresh[item.id] = { disposition: 'findings', findings: [finding] }
  })
  clean.forEach((item, index) => {
    self[item.id] = index === 0 ? { disposition: 'findings', findings: [{ path: 'src/index.js', line: 1, severity: 'low', claim: 'style only' }] } : { disposition: 'no_findings', findings: [] }
    fresh[item.id] = index === 1 ? { disposition: 'findings', findings: [{ path: 'src/index.js', line: 1, severity: 'low', claim: 'style only' }] } : { disposition: 'no_findings', findings: [] }
  })
  return { self, fresh }
}

function dryRun() {
  const frozen = verifyFrozen()
  if (!frozen.ok) throw new Error('Frozen inputs are invalid; run --freeze and --check first')
  const oracle = readJson(oraclePath)
  const { self, fresh } = syntheticReports(oracle)
  const budgets = Object.fromEntries(
    ARMS.map((arm) => [
      arm,
      { model: 'preregistered-model', version: 'preregistered', tools: 'read-only', timeoutMs: 120000, maxTokens: 20000, maxUSD: 0.5 },
    ]),
  )
  const usage = {
    no_review: {},
    same_session_self_review: { completeness: 'observed', tokens: 40000, usd: 0.8, unknownTurns: 0 },
    fresh_session_review: { completeness: 'observed', tokens: 45000, usd: 0.9, unknownTurns: 0 },
  }
  const arms = {
    no_review: { turnStarts: 0, reports: {} },
    same_session_self_review: { turnStarts: 8, reports: self },
    fresh_session_review: { turnStarts: 8, reports: fresh },
  }
  // Oracle tests must actually discriminate: defective cases fail, clean cases pass.
  const oracleChecks = oracle.cases.map((entry) => {
    const run = spawnSync(process.execPath, ['--test', join(here, 'hidden', entry.hiddenTest)], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    return { id: entry.id, expectedFailure: entry.defective, failed: run.status !== 0 }
  })
  const oracleDiscriminates = oracleChecks.every((item) => item.failed === item.expectedFailure)

  const result = scorePilot({ manifest: frozen.manifest, oracle, arms, budgets, usage })

  const negatives = []
  const pushNegative = (code, input, expected) => {
    const value = scorePilot(input)
    negatives.push({ code, ok: value.refusals.some((item) => item.code === expected), expected, actual: value.refusals.map((item) => item.code) })
  }
  pushNegative('missing_usage', {
    manifest: frozen.manifest,
    oracle,
    arms,
    budgets,
    usage: { ...usage, fresh_session_review: {} },
  }, 'unbounded_usage')
  pushNegative('budget_mismatch', {
    manifest: frozen.manifest,
    oracle,
    arms,
    budgets: { ...budgets, fresh_session_review: { ...budgets.fresh_session_review, maxTokens: 30000 } },
    usage,
  }, 'budget_mismatch')
  pushNegative('selective_cases', {
    manifest: frozen.manifest,
    oracle,
    arms: { ...arms, fresh_session_review: { turnStarts: 8, reports: { [Object.keys(fresh)[0]]: fresh[Object.keys(fresh)[0]] } } },
    budgets,
    usage,
  }, 'selective_cases')
  const changedOracle = structuredClone(oracle)
  changedOracle.cases[0].defective = !changedOracle.cases[0].defective
  pushNegative('oracle_changed', { manifest: frozen.manifest, oracle: changedOracle, arms, budgets, usage }, 'oracle_changed')
  pushNegative('review_claims_authority', {
    manifest: frozen.manifest,
    oracle,
    arms: {
      ...arms,
      fresh_session_review: {
        turnStarts: 8,
        reports: { ...fresh, [Object.keys(fresh)[0]]: { ...fresh[Object.keys(fresh)[0]], verdict: 'PASS' } },
      },
    },
    budgets,
    usage,
  }, 'review_claims_authority')

  const report = {
    schema: 'review-pilot-dry-run/1',
    status:
      result.decision === 'promising' && negatives.every((item) => item.ok) && oracleDiscriminates
        ? 'PASS_HARNESS_DRY_RUN'
        : 'FAIL_HARNESS_DRY_RUN',
    oracleChecks,
    oracleDiscriminates,
    decision: result.decision,
    rationale: result.rationale,
    scored: result.scored,
    totals: result.totals,
    negatives,
    noModelCalls: true,
    checkedAt: new Date().toISOString(),
    scope: 'Synthetic reports validate the scoring/budget/refusal machinery; they are not pilot results.',
  }
  ensureReports()
  writeFileSync(join(reports, 'dry-run.json'), JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(`${report.status}: ${result.decision}; negatives ${negatives.map((item) => `${item.code}:${item.ok}`).join(', ')}\n`)
  return report
}

function abortExecution(code, detail) {
  annotateLedger({ status: 'BLOCKED', reason: [code], stoppedAt: new Date().toISOString() })
  const result = { schema: 'review-pilot-result/1', status: 'BLOCKED', code, detail, checkedAt: new Date().toISOString() }
  writeFileSync(join(reports, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  process.stdout.write(`pilot BLOCKED: ${code} ${detail ?? ''}\n`)
  return result
}

function parseReport(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!['findings', 'no_findings', 'inconclusive'].includes(value.disposition)) return undefined
    if (!Array.isArray(value.findings) || !Array.isArray(value.limitations)) return undefined
    for (const finding of value.findings) {
      if (typeof finding.path !== 'string' || typeof finding.claim !== 'string') return undefined
      if (!['high', 'medium', 'low'].includes(finding.severity)) return undefined
    }
    if (value.disposition === 'findings' && value.findings.length === 0) return undefined
    if (value.disposition === 'no_findings' && value.findings.length > 0) return undefined
    return value
  } catch {
    return undefined
  }
}

/**
 * Real bounded pilot execution. Author and both review arms reserve before every send; usage is
 * settled from the runner's token_count events, and any missing usage or session identity stops the
 * pilot without silently resending or refunding. This path is inactive while preflight is BLOCKED.
 */
async function execute() {
  if (!args.has('--confirm-grant')) throw new Error('Refusing to start model turns without --confirm-grant')
  const pre = preflight()
  if (pre.status !== 'PASS') throw new Error(`Preflight is ${pre.status}: ${pre.reasons.map((item) => item.code).join(', ')}`)
  const pricing = readPricing()
  if (!pricing) throw new Error('Pricing disappeared after preflight')
  const oracle = readJson(oraclePath)
  const schemaPath = join(here, 'report-schema.json')
  const workRoot = mkdtempSync(join(tmpdir(), 'pa-pilot-run-'))
  const reportPaths = { no_review: {}, same_session_self_review: {}, fresh_session_review: {} }
  const usageTotals = {
    no_review: { tokens: 0, usd: 0, turns: 0 },
    same_session_self_review: { tokens: 0, usd: 0, turns: 0 },
    fresh_session_review: { tokens: 0, usd: 0, turns: 0 },
  }
  const model = pricing.model

  const turn = async ({ caseId, arm, prompt, cwd, sandbox, resumeSessionId, reportPath }) => {
    const reservation = reserveTurn({ caseId, arm, prompt, pricing })
    if (!reservation.ok) throw Object.assign(new Error(reservation.reason), { blocked: reservation.reason })
    const result = await runCodexTurn({
      prompt,
      cwd,
      sandbox,
      resumeSessionId,
      model,
      ...(reportPath ? { outputSchemaPath: schemaPath, lastMessagePath: reportPath } : {}),
      timeoutMs: 180000,
    })
    const cost = costOf(result.usage, pricing)
    settleTurn({
      turnId: reservation.reservation.turnId,
      usage: result.usage,
      costUSD: cost,
      sessionId: result.sessionId,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      exit: result.exit,
    })
    if (!result.usage) throw Object.assign(new Error('usage_unavailable'), { blocked: 'usage_unavailable' })
    if (!result.sessionId) throw Object.assign(new Error('session_identity_missing'), { blocked: 'session_identity_missing' })
    if (arm !== 'author') {
      usageTotals[arm].tokens += result.usage.totalTokens
      usageTotals[arm].usd += cost ?? 0
      usageTotals[arm].turns += 1
    }
    if (result.exit?.code !== 0) throw Object.assign(new Error(`turn exited ${result.exit.code}`), { blocked: 'turn_failed' })
    return result
  }

  try {
    for (const entry of oracle.cases) {
      const task = readFileSync(join(here, 'cases', entry.id, 'task.md'), 'utf8')
      const authorDir = join(workRoot, `${entry.id}-author`)
      sealCase(entry.id, authorDir)
      const authorPrompt = [
        `You are the author for a synthetic coding task. Work only inside this directory.`,
        task,
        `Implement the requested addition in src/feature.js, keep the visible tests passing, and do not inspect anything outside this directory.`,
      ].join('\n\n')
      const author = await turn({
        caseId: entry.id,
        arm: 'author',
        prompt: authorPrompt,
        cwd: authorDir,
        sandbox: 'workspace-write',
      })
      const frozenCandidate = freezeCandidate(entry.id, authorDir)
      if (!frozenCandidate?.digest) throw Object.assign(new Error('candidate_freeze_failed'), { blocked: 'candidate_freeze_failed' })
      const reviewPrompt = [
        `Review the frozen candidate in this directory against task.md.`,
        `Do not modify files, do not run anything outside this directory, and report only defensible findings with path/line/severity/claim.`,
        `Return JSON matching the provided schema.`,
      ].join('\n\n')
      const selfPath = join(workRoot, `${entry.id}-self.json`)
      await turn({
        caseId: entry.id,
        arm: 'same_session_self_review',
        prompt: reviewPrompt,
        cwd: authorDir,
        sandbox: 'read-only',
        resumeSessionId: author.sessionId,
        reportPath: selfPath,
      })
      const freshDir = join(workRoot, `${entry.id}-fresh`)
      sealDirectory(authorDir, freshDir)
      const freshPath = join(workRoot, `${entry.id}-fresh.json`)
      await turn({
        caseId: entry.id,
        arm: 'fresh_session_review',
        prompt: reviewPrompt,
        cwd: freshDir,
        sandbox: 'read-only',
        reportPath: freshPath,
      })
      const candidateCheck = verifyCandidateFreeze(entry.id, authorDir)
      if (!candidateCheck.ok)
        throw Object.assign(new Error(`candidate_mutated ${candidateCheck.expected} != ${candidateCheck.actual}`), {
          blocked: 'candidate_mutated',
        })
      const selfReport = parseReport(selfPath)
      const freshReport = parseReport(freshPath)
      if (!selfReport || !freshReport) throw Object.assign(new Error('invalid_report'), { blocked: 'invalid_report' })
      reportPaths.same_session_self_review[entry.id] = selfReport
      reportPaths.fresh_session_review[entry.id] = freshReport
    }

    const budgets = Object.fromEntries(
      ARMS.map((arm) => [
        arm,
        { model, version: 'codex-cli', tools: 'read-only', timeoutMs: 180000, maxTokens: 20000, maxUSD: 1 },
      ]),
    )
    const usage = Object.fromEntries(
      ARMS.map((arm) => [
        arm,
        arm === 'no_review'
          ? {}
          : {
              completeness: 'observed',
              tokens: usageTotals[arm].tokens,
              usd: usageTotals[arm].usd,
              unknownTurns: 0,
            },
      ]),
    )
    const score = scorePilot({
      manifest: readJson(manifestPath),
      oracle,
      arms: {
        no_review: { turnStarts: 0, reports: {} },
        same_session_self_review: { turnStarts: 8, reports: reportPaths.same_session_self_review },
        fresh_session_review: { turnStarts: 8, reports: reportPaths.fresh_session_review },
      },
      budgets,
      usage,
    })
    const result = {
      schema: 'review-pilot-result/1',
      status: 'EXECUTED',
      decision: score.decision,
      rationale: score.rationale,
      refusals: score.refusals,
      totals: score.totals,
      scored: score.scored,
      usageTotals,
      arms: ARMS.map((arm) => ({
        id: arm,
        turnStarts: arm === 'no_review' ? 0 : 8,
        tokens: usageTotals[arm].tokens,
        usd: usageTotals[arm].usd,
      })),
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      oracleDigest: readJson(manifestPath).oracleDigest,
      checkedAt: new Date().toISOString(),
    }
    writeFileSync(join(reports, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    annotateLedger({ status: 'COMPLETED', decision: score.decision, completedAt: result.checkedAt })
    process.stdout.write(`pilot ${score.decision}: ${score.rationale}\n`)
    return result
  } catch (error) {
    if (error?.blocked) return abortExecution(error.blocked, String(error.message))
    throw error
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (!isMain) {
  // Imported for sealDirectory/sealCase; do not run the CLI or set an exit code.
} else if (args.has('--freeze')) {
  const result = spawnSync(process.execPath, [join(here, 'freeze.mjs')], { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} else if (args.has('--preflight')) {
  const result = preflight()
  process.exitCode = result.status === 'PASS' ? 0 : 3
} else if (args.has('--dry-run')) {
  const result = dryRun()
  process.exitCode = result.status === 'PASS_HARNESS_DRY_RUN' ? 0 : 1
} else if (args.has('--selftest')) {
  const result = runRunnerSelftest()
  ensureReports()
  writeFileSync(join(reports, 'runner-selftest.json'), JSON.stringify(result, null, 2) + '\n')
  process.stdout.write(`runner-selftest ${result.failures.length === 0 ? 'PASS' : 'FAIL'}: ${result.passes} checks\n`)
  process.exit(result.failures.length === 0 ? 0 : 1)
} else if (args.has('--execute')) {
  execute()
} else {
  process.stdout.write('Use --freeze, --preflight, --selftest, --dry-run or --execute --confirm-grant\n')
  process.exitCode = 2
}
