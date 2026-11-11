#!/usr/bin/env node
/**
 * B6: end-to-end zero-model recipe for main/E/D (wave-06).
 *
 * This is the runnable recipe the packet asks for - not just exported types. It walks the exact
 * chain E will use, with a *fake* budget hook standing in for E's real reservation ledger, and
 * prints what each step decided and why. Nothing here sends a native turn or spends a model call.
 *
 * Usage:
 *   node tests/native-acceptance/pilot-recipe.mjs            # run the recipe
 *   node tests/native-acceptance/pilot-recipe.mjs --json     # machine-readable summary
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { currentRuntimePreflight } from './cost-preflight.mjs'
import { auditGrant, maySendReal } from './ledger-audit.mjs'
import { classifyReport, planRun, subjectDigestOf } from './pilot-runner.mjs'

const repo = new URL('../../', import.meta.url).pathname
const asJson = process.argv.includes('--json')
const steps = []
const step = (name, outcome, detail) => steps.push({ step: name, outcome, detail })

// ---------------------------------------------------------------------------------------------
// Step 1: before anything runs, reconcile the grant E will bill against.
// ---------------------------------------------------------------------------------------------
const ledgerPath = join(repo, 'tests/native-acceptance/reports/model-budget.json')
const audit = auditGrant(ledgerPath, 'wave03-b-native', 4, {
  used: 0, source: 'tests/native-acceptance/reports/wave03-status.json',
})
const gate = maySendReal(audit)
step('ledger.reconcile', audit.verdict, { maySendReal: gate.allowed, reason: gate.reason })

// ---------------------------------------------------------------------------------------------
// Step 2: check whether a billable turn can be bounded at all on this runtime.
// ---------------------------------------------------------------------------------------------
const preflight = currentRuntimePreflight()
step('cost.preflight', preflight.verdict, { blockers: preflight.blockers.length, first: preflight.blockers[0] })

// ---------------------------------------------------------------------------------------------
// Step 3: E's reservation hook. THIS IS THE SEAM E IMPLEMENTS - shown here with an in-memory
// stand-in so the recipe is runnable. A real hook persists atomically before admitting.
// ---------------------------------------------------------------------------------------------
const reservations = []
const demoHook = {
  reserve(intent) {
    // Example policy: refuse when the preflight said the turn cannot be bounded.
    if (preflight.verdict !== 'READY') {
      return { admitted: false, reason: `cost preflight is ${preflight.verdict}: ${preflight.blockers[0]}` }
    }
    const record = { reservationId: `res-${reservations.length + 1}`, ...intent }
    reservations.push(record)
    return { admitted: true, reservationId: record.reservationId }
  },
}

// ---------------------------------------------------------------------------------------------
// Step 4: plan each arm. The fresh arm must be genuinely fresh, and billable arms must pass the hook.
// ---------------------------------------------------------------------------------------------
const subject = subjectDigestOf('a'.repeat(64), 'b'.repeat(64))
const common = {
  caseId: 'case-01', turn: 1, materialDigest: 'a'.repeat(64), subjectFrozen: true, budgetHook: demoHook,
  bound: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000, maxReasoningTokens: 4_000, maxToolRounds: 4,
    basis: { priceSource: null, usageSource: 'thread-token-usage' },
  },
}
const authorPlan = planRun({ ...common, arm: 'no_review' })
step('plan.no_review', authorPlan.ok ? 'PLANNED' : authorPlan.reason, authorPlan.ok ? { session: authorPlan.session, billable: authorPlan.billable } : authorPlan.detail)

const continuation = planRun({ ...common, arm: 'author_continue', authorThreadId: 'thread-author-abc', lastTurnId: 'turn-3' })
step('plan.author_continue', continuation.ok ? 'PLANNED' : continuation.reason, continuation.ok ? { session: continuation.session } : continuation.detail)

const fresh = planRun({ ...common, arm: 'fresh_session', authorThreadId: 'thread-author-abc' })
step('plan.fresh_session', fresh.ok ? 'PLANNED' : fresh.reason, fresh.ok ? { session: fresh.session, inheritedAuthorThread: 'sourceThreadId' in fresh.session } : fresh.detail)

// ---------------------------------------------------------------------------------------------
// Step 5: a billable arm with no price source must be refused (pricing_unavailable today).
// ---------------------------------------------------------------------------------------------
const unpriced = planRun({ ...common, arm: 'fresh_session' })
step('plan.billable_unpriced', unpriced.ok ? 'ADMITTED' : unpriced.reason, unpriced.ok ? 'unexpected' : unpriced.detail)

// ---------------------------------------------------------------------------------------------
// Step 6: what a returned report is allowed to become.
// ---------------------------------------------------------------------------------------------
const good = classifyReport({ protocol: 'review-report/1', subjectDigest: subject, disposition: 'no_findings', findings: [] }, { subjectDigest: subject })
const wrong = classifyReport({ protocol: 'review-report/1', subjectDigest: 'c'.repeat(64), disposition: 'no_findings', findings: [] }, { subjectDigest: subject })
step('report.well_formed', good.disposition, good)
step('report.wrong_subject', wrong.disposition, wrong)

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------
const summary = {
  modelCalls: 0,
  reservationsMade: reservations.length,
  verdicts: Object.fromEntries(steps.map(item => [item.step, item.outcome])),
  canRunPilotBillableToday: fresh.ok && preflight.verdict === 'READY',
  blockingReason: fresh.ok ? undefined : unpriced.ok ? preflight.blockers[0] : fresh.detail,
}

if (asJson) {
  process.stdout.write(`${JSON.stringify({ steps, summary }, null, 2)}\n`)
} else {
  for (const item of steps) {
    process.stdout.write(`${item.outcome.padEnd(16)} ${item.step}\n`)
    process.stdout.write(`                 ${JSON.stringify(item.detail)}\n`)
  }
  process.stdout.write(`\nmodelCalls=0 reservationsMade=${reservations.length}\n`)
  process.stdout.write(`canRunPilotBillableToday=${summary.canRunPilotBillableToday}\n`)
  if (summary.blockingReason) process.stdout.write(`blockingReason=${summary.blockingReason}\n`)
}
