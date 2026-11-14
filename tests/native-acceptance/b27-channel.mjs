#!/usr/bin/env node
/**
 * Wave-27: the three waiter maps are gone; one generation-scoped channel owns them.
 *
 * These are the waiters the RUNNER creates while it waits for the coordinator's replies. The old design
 * had three independent maps, so a reply from an older coordinator could settle a waiter created by a
 * newer one. Here a stale reply must be ignored, and a detach must make a pending native write
 * indeterminate rather than allowed.
 */
import { CaseLog, writeReport } from './harness.mjs'
import { createBusinessChannel } from '../../apps/runner/src/business-channel.ts'

const log = new CaseLog()
try {
  log.begin('B27-CHANNEL-GENERATION-MONOTONIC', 'each lease gets a new monotonic generation', 'controlled_process')
  const channel = createBusinessChannel()
  const first = channel.bind('lease-a')
  const again = channel.bind('lease-a')
  const second = channel.bind('lease-b')
  log.evidence({ first, again, second })
  if (first === 1 && again === 1 && second === 2) log.pass(`generation 1 for lease-a (rebind kept 1), 2 for lease-b — monotonic and never reused`)
  else log.fail(`generation handling wrong: ${JSON.stringify({ first, again, second })}`)

  log.begin('B27-CHANNEL-RECEIPT-SETTLES-OWN-LEASE', 'a receipt settles the waiter of its own lease', 'controlled_process')
  const receipt = channel.awaitFact('fact-c-1')
  const settled = channel.resolveReceipt('fact-c-1', { factId: 'fact-c-1', persisted: true, seq: 1 })
  const value = await receipt
  log.evidence({ settled, value })
  if (settled && value.seq === 1) log.pass('the receipt settled the fact waiter created by the current lease')
  else log.fail(`receipt did not settle: ${JSON.stringify({ settled, value })}`)

  log.begin('B27-CHANNEL-STALE-REPLY-IGNORED', 'a reply from an older lease cannot settle a newer waiter', 'controlled_process')
  const stale = channel.awaitWrite('cmd-c-stale')
  channel.bind('lease-c')
  // The reply arrives naming the id, but the waiter belongs to the previous generation.
  const delivered = channel.resolveWrite('cmd-c-stale', true)
  let outcome = 'still-pending', staleError = null
  void stale.then(() => { outcome = 'resolved' }).catch(caught => { outcome = 'rejected'; staleError = caught?.reason ?? null })
  await new Promise(resolve => setTimeout(resolve, 30))
  log.evidence({ delivered, outcome, staleError })
  // The waiter must never be resolved by the stale reply; it is settled as a failure when the lease is
  // replaced, which is stronger than leaving it pending forever.
  if (delivered === false && outcome === 'rejected') log.pass(`the stale write reply was ignored and the older waiter was settled as ${staleError} rather than resolved across leases`)
  else log.fail(`a stale reply crossed leases: ${JSON.stringify({ delivered, outcome })}`)

  log.begin('B27-CHANNEL-DETACH-WRITE-INDETERMINATE', 'detach makes a pending native write indeterminate', 'controlled_process')
  const pending = channel.awaitWrite('cmd-c-live')
  const counts = channel.pending()
  channel.detach({ reason: 'client replaced' })
  const error = await pending.catch(caught => caught)
  log.evidence({ counts, code: error?.code ?? null, reason: error?.reason ?? null, after: channel.pending() })
  if (counts.writes === 1 && error?.code === 'state_indeterminate' && error?.reason === 'write_indeterminate_after_detach')
    log.pass('the pending native write was rejected as state_indeterminate / write_indeterminate_after_detach and nothing stayed pending')
  else log.fail(`detach did not make the write indeterminate: ${JSON.stringify({ counts, code: error?.code ?? null })}`)

  log.begin('B27-CHANNEL-FACT-REJECTS-AFTER-DETACH', 'a fact waiter is refused after detach instead of hanging', 'controlled_process')
  let factError = null
  const orphan = channel.awaitFact('fact-c-2')
  channel.detach({ reason: 'client replaced' })
  await orphan.catch(caught => { factError = { code: caught?.code ?? null, reason: caught?.reason ?? null } })
  log.evidence({ factError })
  if (factError?.reason === 'channel_detached') log.pass('a fact waiter is rejected with channel_detached instead of hanging forever')
  else log.fail(`a fact waiter was left hanging: ${JSON.stringify({ factError })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'in-process channel only', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} catch (error) { log.fail(`harness aborted: ${String(error?.message ?? error).slice(0, 160)}`) }
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 unified channel', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'in-process channel; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-channel totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
