#!/usr/bin/env node
/**
 * B7-recipe: drive the REAL Codex transport for every non-billing step (wave-06 B).
 *
 * This is the runnable proof E can execute today. It talks to the installed `codex app-server`,
 * not to a stub, and it stops exactly at the first step that would bill.
 *
 * What it does, in order:
 *   1. reconcile the grant and report whether a real send is permitted
 *   2. check whether a billable turn can be bounded on this runtime
 *   3. launch the real transport and initialize
 *   4. create the fresh-reviewer thread (ephemeral) and the author-side thread
 *   5. inspect/read them and confirm no turn/start ever reached the wire
 *   6. report the measured checkpoint boundary and the exact reason the author turn is blocked
 *
 * Usage: node tests/native-acceptance/pilot-real-recipe.mjs [--json]
 */
import { auditGrant, maySendReal } from './ledger-audit.mjs'
import { currentRuntimePreflight } from './cost-preflight.mjs'
import { PilotTransport } from './pilot-transport.mjs'

const repo = new URL('../../', import.meta.url).pathname
const asJson = process.argv.includes('--json')
const steps = []
const step = (name, outcome, detail) => steps.push({ step: name, outcome, detail })

// 1. Ledger gate.
const audit = auditGrant(`${repo}tests/native-acceptance/reports/model-budget.json`, 'wave03-b-native', 4, {
  used: null,
  source: 'reconstructed ledger',
})
const gate = maySendReal(audit)
step('ledger.gate', audit.verdict, { maySendReal: gate.allowed, reason: gate.reason })

// 2. Cost gate.
const preflight = currentRuntimePreflight()
step('cost.preflight', preflight.verdict, { blockers: preflight.blockers.length, first: preflight.blockers[0] })

// 3. Real transport.
let transport = null
let real = { initialized: false, freshThread: null, authorThread: null, wireDuringInspect: [], checkpoint: null }
try {
  transport = await PilotTransport.launch({ cwd: '/tmp' })
  await transport.initialize()
  real.initialized = true

  const fresh = await transport.startThread({ ephemeral: true })
  real.freshThread = { id: fresh.id, model: fresh.model, provider: fresh.modelProvider, ephemeral: true }
  const author = await transport.startThread({ ephemeral: false })
  real.authorThread = { id: author.id, ephemeral: false }

  // Read both; a read is investigative, never a send.
  await transport.readThread(fresh.id).catch(() => undefined)
  await transport.readThread(author.id).catch(() => undefined)
  real.wireDuringInspect = transport.sentMethods()

  // Measure the checkpoint boundary rather than assume it.
  const resumed = await transport.resumeThread(author.id).catch(error => ({ error }))
  const forked = await transport.forkThread(author.id).catch(error => ({ error }))
  real.checkpoint = {
    resume: resumed.error ? `refused:${String(resumed.error.detail?.rpc?.message ?? resumed.error.reason).slice(0, 60)}` : `ok same=${resumed.id === author.id}`,
    fork: forked.error ? `refused:${String(forked.error.detail?.rpc?.message ?? forked.error.reason).slice(0, 60)}` : `ok new=${forked.id !== author.id}`,
  }
  step('transport.initialize', 'OK', { platform: 'codex app-server' })
  step('transport.freshThread', fresh.id ? 'CREATED' : 'FAILED', real.freshThread)
  step('transport.authorThread', author.id ? 'CREATED' : 'FAILED', real.authorThread)
  step('transport.wireDuringInspect', real.wireDuringInspect.includes('turn/start') ? 'BILLED' : 'NO_BILL', { methods: real.wireDuringInspect })
  step('transport.checkpointBoundary', 'MEASURED', real.checkpoint)

  // The author turn is the first step that would bill - so it is not taken.
  step('transport.authorTurn', 'NOT_STARTED', {
    why: 'the author turn is the first billing step and the ledger remainder is UNKNOWN',
    ledger: gate.reason,
    cost: preflight.blockers[0],
  })
} catch (error) {
  step('transport.launch', 'FAILED', { error: String(error.message ?? error) })
} finally {
  await transport?.close()
}

const summary = {
  modelCalls: 0,
  billed: Boolean(real.wireDuringInspect?.includes?.('turn/start')),
  canSendRealToday: gate.allowed && preflight.verdict === 'READY',
  blockingReasons: [gate.allowed ? null : gate.reason, preflight.verdict === 'READY' ? null : preflight.blockers[0]].filter(Boolean),
  realTransportUsed: real.initialized,
}

if (asJson) process.stdout.write(`${JSON.stringify({ steps, real, summary }, null, 2)}\n`)
else {
  for (const item of steps) process.stdout.write(`${item.outcome.padEnd(14)} ${item.step.padEnd(32)} ${JSON.stringify(item.detail)}\n`)
  process.stdout.write(`\nrealTransportUsed=${summary.realTransportUsed} billed=${summary.billed} modelCalls=0\n`)
  process.stdout.write(`canSendRealToday=${summary.canSendRealToday}\n`)
  for (const reason of summary.blockingReasons) process.stdout.write(`blocked: ${reason}\n`)
}
