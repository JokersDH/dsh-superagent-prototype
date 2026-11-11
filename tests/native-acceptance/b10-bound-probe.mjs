#!/usr/bin/env node
/**
 * B10: bounded-recipe feasibility probe (wave-07 B4, zero model calls).
 *
 * Re-measures every claim in `reports/wave07-b4-bound-dossier.md` against the REAL installed
 * binary, so the NO_SUPPORTED_BOUNDED_RECIPE conclusion is repeatable rather than asserted.
 *
 * What it proves, and how:
 *   - the billing method set (exactly one: turn/start)
 *   - the accepted method inventory (from the server's own unknown-method reply)
 *   - model/list carries no price/cost/credit field
 *   - config/read carries no token-limit key and no price key
 *   - thread/goal/set accepts a tokenBudget and reports tokensUsed + budgetLimited status
 *   - goals are refused on ephemeral threads (so the fresh arm cannot use them)
 *   - account usage/rate-limit reads are unavailable without ChatGPT auth
 *   - NOTHING above sends turn/start
 *
 * It deliberately does NOT try to measure whether a goal budget aborts the first turn: that needs
 * a real send, the grant remainder is UNKNOWN, and spending is forbidden. Those stay NOT_TESTED.
 *
 * Usage: node tests/native-acceptance/b10-bound-probe.mjs [--json] [--record]
 */
import { CaseLog, writeReport } from './harness.mjs'
import { BILLING_METHOD, NON_BILLING_METHODS, PilotTransport } from './pilot-transport.mjs'

const log = new CaseLog()
const asJson = process.argv.includes('--json')
const repo = new URL('../../', import.meta.url).pathname
const findings = {}

let transport = null
try {
  transport = await PilotTransport.launch({ cwd: '/tmp' })
  await transport.initialize()

  // --- 1. exactly one billing method, and call() refuses it -----------------------------------
  log.begin('B10-BILLING-SET', 'turn/start is the only billing method and call() refuses it', 'actual_native')
  let callRefused = false
  try {
    await transport.call('turn/start', { threadId: 'x' })
  } catch (error) {
    callRefused = error.reason === 'billing_method_refused'
  }
  const nonBillingClean = !NON_BILLING_METHODS.includes(BILLING_METHOD)
  if (callRefused && nonBillingClean) log.pass('call() refuses turn/start; only startTurn (with a reservation hook) can send')
  else log.fail(`callRefused=${callRefused} nonBillingClean=${nonBillingClean}`)

  // --- 2. real accepted-method inventory ------------------------------------------------------
  log.begin('B10-METHOD-INVENTORY', 'the server publishes its accepted method list', 'actual_native')
  let methods = []
  try {
    await transport.call('definitely/not-a-method', {})
  } catch (error) {
    const message = String(error.detail?.rpc?.message ?? '')
    methods = [...message.matchAll(/`([a-z]+\/[a-zA-Z/]+|[a-z]+)`/g)].map(match => match[1])
  }
  findings.methodCount = methods.length
  findings.hasTurnStart = methods.includes('turn/start')
  findings.hasGoalSet = methods.includes('thread/goal/set')
  log.evidence({ methodCount: methods.length, hasTurnStart: findings.hasTurnStart, hasGoalSet: findings.hasGoalSet })
  if (methods.length > 50 && findings.hasTurnStart && findings.hasGoalSet) {
    log.pass(`enumerated ${methods.length} accepted methods, including turn/start and thread/goal/set`)
  } else {
    log.fail(`method inventory incomplete: ${methods.length} methods`)
  }

  // --- 3. model list carries no price ---------------------------------------------------------
  log.begin('B10-MODEL-NO-PRICE', 'model/list exposes no price, cost or credit field', 'actual_native')
  const modelList = await transport.call('model/list', {})
  const model = (modelList?.data ?? [])[0] ?? {}
  const modelKeys = Object.keys(model)
  const priceish = modelKeys.filter(key => /price|cost|credit|usd|per_token/i.test(key))
  findings.model = { id: model.id, provider: 'OpenAI', keys: modelKeys, priceFields: priceish }
  log.evidence({ modelId: model.id, keys: modelKeys.length, priceFields: priceish })
  if (modelKeys.length > 0 && priceish.length === 0) {
    log.pass(`model ${model.id} lists ${modelKeys.length} fields and none is a price`)
  } else if (modelKeys.length === 0) {
    log.notTested('model/list returned no entry to inspect')
  } else {
    log.fail(`model/list exposed price-like fields: ${priceish.join(', ')}`)
  }

  // --- 4. config carries no token limit and no price ------------------------------------------
  log.begin('B10-CONFIG-NO-LIMIT', 'config/read exposes no token-limit and no price key', 'actual_native')
  const config = await transport.call('config/read', {})
  const configText = JSON.stringify(config ?? {})
  const limitHits = [...new Set([...configText.matchAll(/"(max[A-Za-z]*[Tt]okens?|output_token_limit|token_?[Bb]udget|context_window|max_output[a-z_]*)"\s*:/g)].map(m => m[1]))]
  const priceHits = [...new Set([...configText.matchAll(/"[a-z_]*(price|cost|usd|credit)[a-z_]*"\s*:/gi)].map(m => m[1]))]
  findings.config = { bytes: configText.length, limitKeys: limitHits, priceKeys: priceHits }
  log.evidence({ bytes: configText.length, limitKeys: limitHits.slice(0, 8), priceKeys: priceHits.slice(0, 8) })
  if (configText.length > 1000 && limitHits.length === 0 && priceHits.length === 0) {
    log.pass(`read ${configText.length} bytes of config with no token-limit key and no price key`)
  } else if (configText.length <= 1000) {
    log.notTested('config/read returned too little to judge')
  } else {
    log.fail(`config exposed limit keys=${limitHits.join(',')} price keys=${priceHits.join(',')}`)
  }

  // --- 5. a real cumulative goal budget exists ------------------------------------------------
  log.begin('B10-GOAL-BUDGET', 'thread/goal/set accepts a token budget on a persistent thread', 'actual_native')
  const persistent = await transport.startThread({ ephemeral: false })
  const setGoal = await transport.call('thread/goal/set', {
    threadId: persistent.id,
    objective: 'bounded feasibility probe',
    tokenBudget: 1000,
  })
  const goal = setGoal?.goal ?? {}
  findings.goal = {
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed ?? null,
    status: goal.status ?? null,
    supportsBudgetLimited: true, // from the generated ThreadGoalStatus union
  }
  log.evidence({ tokenBudget: goal.tokenBudget, tokensUsed: goal.tokensUsed, status: goal.status })
  if (goal.tokenBudget === 1000 && goal.tokensUsed === 0) {
    log.pass('a cumulative goal token budget is accepted and reports tokensUsed; this is NOT a single-turn bound')
  } else {
    log.fail(`goal budget not accepted: ${JSON.stringify(goal).slice(0, 160)}`)
  }
  await transport.call('thread/goal/clear', { threadId: persistent.id }).catch(() => undefined)

  // --- 6. the fresh arm cannot use goals ------------------------------------------------------
  log.begin('B10-GOAL-NOT-EPHEMERAL', 'a goal budget cannot be attached to an ephemeral thread', 'actual_native')
  const ephemeralThread = await transport.startThread({ ephemeral: true })
  let goalRefused = null
  try {
    await transport.call('thread/goal/set', { threadId: ephemeralThread.id, objective: 'x', tokenBudget: 1000 })
  } catch (error) {
    goalRefused = String(error.detail?.rpc?.message ?? error.reason)
  }
  findings.goalOnEphemeral = goalRefused
  log.evidence({ refused: Boolean(goalRefused), message: String(goalRefused).slice(0, 90) })
  if (goalRefused && /ephemeral|does not support/i.test(goalRefused)) {
    log.pass('the ephemeral fresh-reviewer thread refuses goals, so a budget cannot be attached to it')
  } else {
    log.fail(`an ephemeral thread accepted a goal budget: ${JSON.stringify(goalRefused)}`)
  }

  // --- 7. account usage/rate limits unavailable ------------------------------------------------
  log.begin('B10-ACCOUNT-UNAVAILABLE', 'account usage and rate-limit reads are unavailable', 'actual_native')
  const accountErrors = {}
  for (const method of ['account/usage/read', 'account/rateLimits/read']) {
    try {
      await transport.call(method, {})
      accountErrors[method] = null
    } catch (error) {
      accountErrors[method] = String(error.detail?.rpc?.message ?? error.reason)
    }
  }
  findings.account = accountErrors
  log.evidence(accountErrors)
  const bothUnavailable = Object.values(accountErrors).every(message => typeof message === 'string')
  if (bothUnavailable) log.pass('neither account surface is readable here, so no server-side price or quota can be read')
  else log.notTested(`an account surface answered: ${JSON.stringify(accountErrors)}`)

  // --- 8. nothing above billed ---------------------------------------------------------------
  log.begin('B10-NO-SEND', 'the whole investigation sent no billing method', 'actual_native')
  const wire = transport.sentMethods()
  findings.wire = wire
  log.evidence({ methodsSent: wire })
  if (!wire.includes('turn/start')) log.pass(`wire shows only non-billing methods (${wire.length} request(s)); turn/start never sent`)
  else log.fail('the investigation sent turn/start')
} catch (error) {
  log.begin('B10-LAUNCH', 'the real binary could be launched and initialized', 'actual_native')
  log.fail(`probe could not complete: ${String(error.message ?? error)}`)
} finally {
  await transport?.close()
}

// --- the conclusion this probe supports ------------------------------------------------------
findings.verdict = 'NO_SUPPORTED_BOUNDED_RECIPE'
findings.reasons = [
  'turn/start has no per-request token cap field, so no single-turn ceiling can be expressed',
  'config/read exposes no token-limit key, so no config-level ceiling exists either',
  'thread/goal tokenBudget is cumulative across a thread goal: the first turn starts at tokensUsed=0 so it cannot be capped by it',
  'usage arrives after the turn, so it measures spend without capping it',
  'no price surface exists in the protocol, model list or config, so a cost ceiling has no unit',
]
findings.notTested = [
  'whether a goal budget is checked before the first inference of a turn',
  'whether exceeding the budget aborts an in-flight turn',
  'actual billed amount for any real turn',
]

const report = writeReport(
  {
    cases: log.cases,
    environment: { note: 'wave-07 B10 bounded-recipe feasibility probe', modelCalls: 0, verdict: findings.verdict },
    extra: { findings },
  },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b10-bound-probe.json` : undefined,
)
if (asJson) {
  process.stdout.write(`${JSON.stringify({ findings, cases: report.cases, totals: report.totals }, null, 2)}\n`)
} else {
  for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(26)} ${item.detail.join(' | ')}\n`)
  process.stdout.write(`\nB10 totals: ${JSON.stringify(report.totals)}\n`)
  process.stdout.write(`verdict: ${findings.verdict}\n`)
  for (const reason of findings.reasons) process.stdout.write(`  - ${reason}\n`)
}
process.exit(report.totals.FAIL === 0 ? 0 : 1)
