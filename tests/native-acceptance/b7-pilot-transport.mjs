#!/usr/bin/env node
/**
 * B7: real pilot transport and full control-flow acceptance (wave-06, zero model calls).
 *
 * Two evidence tracks, kept separate and labelled:
 *
 *   actual_native     - the installed `codex` binary. Proves the transport really speaks the
 *                       protocol and measures where the non-billing boundary actually is.
 *   protocol_fixture  - a look-alike server. Proves the control flow of the billing chain
 *                       (reservation before send, usage, cancel, reconcile) without spending.
 *
 * The central invariant every billing case asserts: a `turn/start` reaches the wire ONLY after a
 * reservation hook admitted it. If the hook is missing, refuses or throws, the wire must stay
 * silent - including for the author arm, which is billable too.
 */
import { readFileSync, rmSync } from 'node:fs'
import { CaseLog, writeReport } from './harness.mjs'
import { NON_BILLING_METHODS, PilotTransport, PilotTransportError } from './pilot-transport.mjs'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const fixturePath = `${repo}tests/native-acceptance/pilot-fixture-server.mjs`

const admittingHook = (sink = []) => ({
  reserve: intent => {
    sink.push(intent)
    return { admitted: true, reservationId: `res-${sink.length}` }
  },
})
const refusingHook = () => ({ reserve: () => ({ admitted: false, reason: 'grant has no remainder' }) })
const throwingHook = () => ({ reserve: () => { throw new Error('ledger unavailable') } })

const identity = (arm = 'author_continue') => ({ caseId: 'case-01', arm, turn: 1, materialDigest: 'a'.repeat(64) })

/** Did any billing method reach the wire? */
const billedOnWire = transport => transport.sentMethods().includes('turn/start')

// ===============================================================================================
// Track A: the real binary.
// ===============================================================================================
let real = null
try {
  real = await PilotTransport.launch({ cwd: '/tmp' })

  log.begin('B7-REAL-INIT', 'the real codex app-server answers initialize', 'actual_native')
  try {
    const init = await real.initialize()
    const plausible = typeof init?.codexHome === 'string' && typeof init?.userAgent === 'string'
    if (plausible) log.pass(`initialize answered; userAgent=${String(init.userAgent).slice(0, 48)}`)
    else log.fail(`initialize returned an unexpected shape: ${JSON.stringify(init).slice(0, 200)}`)
  } catch (error) {
    log.fail(`initialize failed against the real binary: ${error.message}`)
  }

  log.begin('B7-REAL-FRESH-THREAD', 'the real binary creates an ephemeral thread without billing', 'actual_native')
  let freshThread = null
  try {
    freshThread = await real.startThread({ ephemeral: true, cwd: '/tmp' })
    const hasId = typeof freshThread.id === 'string' && freshThread.id.length > 0
    if (hasId) log.pass(`thread/start returned ${freshThread.id}; model=${freshThread.model} provider=${freshThread.modelProvider}`)
    else log.fail(`thread/start returned no id: ${JSON.stringify(freshThread.raw).slice(0, 200)}`)
  } catch (error) {
    log.fail(`thread/start failed against the real binary: ${error.message}`)
  }

  log.begin('B7-REAL-INSPECT-NO-BILL', 'constructing and inspecting never sends a model turn', 'actual_native')
  if (freshThread?.id) {
    try {
      await real.readThread(freshThread.id)
    } catch {
      // A read may refuse; what matters is that it did not bill.
    }
  }
  const methods = real.sentMethods()
  const billed = methods.includes('turn/start')
  log.evidence({ methodsSent: methods })
  if (!billed) log.pass(`sent only ${methods.join(', ')} - no turn/start, so no model turn was started`)
  else log.fail('a turn/start reached the wire during construct/inspect')

  log.begin('B7-REAL-CHECKPOINT-BOUNDARY', 'a resumable checkpoint needs a real turn (measured)', 'actual_native')
  // This is the honest boundary: with zero turns there is no rollout, so resume/fork cannot work.
  let checkpoint = null
  if (freshThread?.id) {
    const readBack = await real.readThread(freshThread.id).catch(error => ({ error }))
    const resumed = await real.resumeThread(freshThread.id).catch(error => ({ error }))
    const forked = await real.forkThread(freshThread.id).catch(error => ({ error }))
    checkpoint = {
      readSameProcess: readBack.error ? `refused:${readBack.error.reason}` : `ok turns=${readBack.turns?.length ?? 0}`,
      resume: resumed.error ? `refused:${String(resumed.error.detail?.rpc?.message ?? resumed.error.reason).slice(0, 52)}` : `ok same=${resumed.id === freshThread.id}`,
      fork: forked.error ? `refused:${String(forked.error.detail?.rpc?.message ?? forked.error.reason).slice(0, 52)}` : `ok new=${forked.id !== freshThread.id}`,
    }
    log.evidence(checkpoint)
    // The case PASSes when the boundary is measured and consistent; it does not pretend resume works
    // on a thread that has never run.
    if (checkpoint.resume.startsWith('refused') && checkpoint.fork.startsWith('refused')) {
      log.pass('measured: a 0-turn thread has no rollout, so resume/fork refuse - a real checkpoint requires a real author turn')
    } else if (checkpoint.resume.startsWith('ok') && checkpoint.fork.startsWith('ok')) {
      log.pass('measured: this build allows resume/fork on a 0-turn thread; checkpoint does not require a turn here')
    } else {
      log.fail(`inconsistent checkpoint behaviour: ${JSON.stringify(checkpoint)}`)
    }
  } else {
    log.notTested('no thread was created, so the checkpoint boundary could not be measured')
  }
} finally {
  await real?.close()
}

// ===============================================================================================
// Track B: the control flow, against the look-alike server.
// ===============================================================================================
/**
 * Launch the fixture with a server-side wire journal. Asserting on what the SERVER received is
 * stronger than trusting the client's own bookkeeping: a client-side bug that silently dropped the
 * record would still be caught here.
 */
let journalSeq = 0
const journalPath = () => `${repo}tests/native-acceptance/reports/.b7-wire-${process.pid}-${journalSeq++}.log`
const makeLaunch = path => async () =>
  PilotTransport.launch({ binary: process.execPath, args: [fixturePath, path], cwd: '/tmp' })
const serverSaw = path => {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}
const serverSawBilling = path => serverSaw(path).includes('turn/start')
const fixturePass = []

const fixtureJournal = journalPath()
const launchFixture = makeLaunch(fixtureJournal)
let fixture = await launchFixture()
try {
  await fixture.initialize()

  log.begin('B7-CHAIN-AUTHOR', 'the author turn runs through a reservation and yields usage', 'protocol_fixture')
  const authorThread = await fixture.startThread({ ephemeral: false })
  const authorReservations = []
  const authorTurn = await fixture.startTurn({
    threadId: authorThread.id,
    input: { text: 'author task' },
    hook: admittingHook(authorReservations),
    identity: identity('no_review'),
  })
  // Wait for the fixture's post-turn notifications.
  await new Promise(resolve => setTimeout(resolve, 250))
  const usage = fixture.usageFromNotifications()
  const completed = fixture.completedTurns()
  const authorOk =
    authorTurn.ok === true &&
    authorReservations.length === 1 &&
    billedOnWire(fixture) &&
    completed.length === 1 &&
    usage?.tokenUsage?.last?.reasoningOutputTokens === 5
  log.evidence({
    reservations: authorReservations.length,
    turnsStarted: 1,
    completedTurns: completed.length,
    usageLast: usage?.tokenUsage?.last ?? null,
  })
  if (authorOk) {
    log.pass('the author turn reserved first, sent exactly one turn/start, and reported usage including reasoning tokens')
  } else {
    log.fail(`author chain incomplete: turn=${authorTurn.ok} reservations=${authorReservations.length} completed=${completed.length} usage=${Boolean(usage)}`)
  }
  fixturePass.push(authorThread.id)

  log.begin('B7-CHAIN-CONTINUE', 'a real checkpoint can be resumed and forked once a turn exists', 'protocol_fixture')
  const resumed = await fixture.resumeThread(authorThread.id).catch(error => ({ error }))
  const forked = await fixture.forkThread(authorThread.id).catch(error => ({ error }))
  const continueOk = !resumed.error && !forked.error && forked.id !== authorThread.id
  log.evidence({
    resume: resumed.error ? `refused:${resumed.error.reason}` : `ok same=${resumed.id === authorThread.id}`,
    fork: forked.error ? `refused:${forked.error.reason}` : `ok new=${forked.id !== authorThread.id}`,
  })
  if (continueOk) log.pass('resume reopened the author thread and fork produced a distinct thread')
  else log.fail('the checkpoint could not be resumed or forked after a turn existed')

  log.begin('B7-CHAIN-FRESH', 'a fresh reviewer runs in its own ephemeral thread', 'protocol_fixture')
  const beforeFresh = fixture.sentMethods().filter(method => method === 'turn/start').length
  const freshReviewerThread = await fixture.startThread({ ephemeral: true })
  const freshReservations = []
  await fixture.startTurn({
    threadId: freshReviewerThread.id,
    input: { text: 'review the frozen subject' },
    hook: admittingHook(freshReservations),
    identity: identity('fresh_session'),
  })
  await new Promise(resolve => setTimeout(resolve, 200))
  const afterFresh = fixture.sentMethods().filter(method => method === 'turn/start').length
  const freshOk = freshReviewerThread.id !== authorThread.id && afterFresh === beforeFresh + 1 && freshReservations.length === 1
  log.evidence({ freshThread: freshReviewerThread.id, authorThread: authorThread.id, turnsBefore: beforeFresh, turnsAfter: afterFresh })
  if (freshOk) log.pass('the fresh arm ran in a thread distinct from the author thread, with its own reservation')
  else log.fail('the fresh arm did not run in an independent thread or did not reserve')

  log.begin('B7-CANCEL', 'cancel interrupts without starting another turn', 'protocol_fixture')
  const beforeCancel = fixture.sentMethods().filter(method => method === 'turn/start').length
  const interrupt = await fixture.interruptTurn({ threadId: authorThread.id }).catch(error => ({ error }))
  const afterCancel = fixture.sentMethods().filter(method => method === 'turn/start').length
  const cancelOk = !interrupt.error && afterCancel === beforeCancel
  log.evidence({ interrupt, turnsBefore: beforeCancel, turnsAfter: afterCancel })
  if (cancelOk) log.pass('turn/interrupt was accepted and no additional turn/start was sent')
  else log.fail('cancel either failed or started another turn')

  log.begin('B7-RECONCILE', 'reconciliation reads the original thread and never re-sends', 'protocol_fixture')
  const beforeReconcile = fixture.sentMethods().filter(method => method === 'turn/start').length
  const reconciled = await fixture.reconcile({ threadId: authorThread.id })
  const afterReconcile = fixture.sentMethods().filter(method => method === 'turn/start').length
  const reconcileOk = reconciled.sendObserved === true && afterReconcile === beforeReconcile
  log.evidence({ sendObserved: reconciled.sendObserved, observedTurnCount: reconciled.observedTurnCount, turnsBefore: beforeReconcile, turnsAfter: afterReconcile })
  if (reconcileOk) log.pass(`reconcile observed the existing turn (${reconciled.observedTurnCount} on thread) and sent no new turn`)
  else log.fail('reconcile did not observe the send, or it re-sent')
} finally {
  await fixture.close()
}

// ===============================================================================================
// Track C: structural guards that must hold on any server.
// ===============================================================================================
const guardJournal = journalPath()
const guardFixture = await makeLaunch(guardJournal)()
try {
  await guardFixture.initialize()
  const guardThread = await guardFixture.startThread({ ephemeral: true })

  log.begin('B7-NO-HOOK', 'a turn with no reservation hook sends zero bytes', 'package-local')
  let noHookRefused = false
  try {
    await guardFixture.startTurn({ threadId: guardThread.id, input: { text: 'x' }, hook: undefined, identity: identity() })
  } catch (error) {
    noHookRefused = error instanceof PilotTransportError && error.reason === 'no_reservation_hook'
  }
  const silentAfterNoHook = !billedOnWire(guardFixture) && !serverSawBilling(guardJournal)
  log.evidence({ serverSaw: serverSaw(guardJournal), journal: guardJournal.split('/').pop() })
  if (noHookRefused && silentAfterNoHook) log.pass('refused as no_reservation_hook and the server saw no turn/start')
  else log.fail(`refused=${noHookRefused} silent=${silentAfterNoHook}`)

  log.begin('B7-HOOK-REFUSES', 'a refusing hook sends zero bytes', 'package-local')
  let refusedByHook = false
  try {
    await guardFixture.startTurn({ threadId: guardThread.id, input: { text: 'x' }, hook: refusingHook(), identity: identity() })
  } catch (error) {
    refusedByHook = error instanceof PilotTransportError && error.reason === 'reservation_refused'
  }
  const silentAfterRefusal = !billedOnWire(guardFixture) && !serverSawBilling(guardJournal)
  if (refusedByHook && silentAfterRefusal) log.pass('the refusing hook stopped the send before the wire (server saw no turn/start)')
  else log.fail(`refused=${refusedByHook} silent=${silentAfterRefusal}`)

  log.begin('B7-AUTHOR-ALSO-RESERVES', 'the author arm is not free just because it is not a review', 'package-local')
  let authorWithoutHookRefused = false
  try {
    await guardFixture.startTurn({ threadId: guardThread.id, input: { text: 'author work' }, hook: undefined, identity: identity('no_review') })
  } catch (error) {
    authorWithoutHookRefused = error instanceof PilotTransportError && error.reason === 'no_reservation_hook'
  }
  const authorSilent = !billedOnWire(guardFixture) && !serverSawBilling(guardJournal)
  if (authorWithoutHookRefused && authorSilent) {
    log.pass('an arm labelled no_review still cannot send without a reservation')
  } else {
    log.fail('the no_review label let an unreserved turn through')
  }

  log.begin('B7-THROWING-HOOK', 'a throwing hook refuses rather than falling through to a send', 'package-local')
  let thrownRefused = false
  try {
    await guardFixture.startTurn({ threadId: guardThread.id, input: { text: 'x' }, hook: throwingHook(), identity: identity() })
  } catch (error) {
    thrownRefused = error instanceof PilotTransportError && error.reason === 'reservation_failed'
  }
  const thrownSilent = !billedOnWire(guardFixture) && !serverSawBilling(guardJournal)
  if (thrownRefused && thrownSilent) log.pass('a ledger failure refused the send instead of proceeding (server saw no turn/start)')
  else log.fail(`refused=${thrownRefused} silent=${thrownSilent}`)

  log.begin('B7-METHOD-SPLIT', 'the billing method is exactly one and is not in the non-billing set', 'package-local')
  const splitOk = !NON_BILLING_METHODS.includes('turn/start') && NON_BILLING_METHODS.includes('thread/start')
  if (splitOk) log.pass('turn/start is excluded from the non-billing set; thread/start is included')
  else log.fail('the billing/non-billing split is inconsistent')
} finally {
  await guardFixture.close()
}

for (const path of [fixtureJournal, guardJournal]) {
  try { rmSync(path, { force: true }) } catch {}
}

const report = writeReport(
  {
    cases: log.cases,
    environment: {
      note: 'wave-06 B7 real transport: actual_native + protocol_fixture + package-local',
      modelCalls: 0,
      realBinary: 'codex 0.164.0',
    },
  },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b7-pilot-transport.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(28)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB7 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
