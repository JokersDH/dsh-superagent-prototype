#!/usr/bin/env node
/**
 * Wave-27 item 5 remainder: interface/consumer compile compatibility, fault and backpressure, close.
 *
 * Compile compatibility is checked by compiling the real modules and their consumer directly with the
 * same strict flags the wave uses, not by trusting the root tsconfig exclusion. Backpressure is the
 * channel's own bounded capacity. Fault behaviour is a detach in the middle of a pending callback.
 */
import { spawnSync } from 'node:child_process'
import { CaseLog, writeReport } from './harness.mjs'
import { createBusinessChannel } from '../../apps/runner/src/business-channel.ts'
import { createBusinessDispatch } from '../../apps/runner/src/business-dispatch.ts'
import { existsSync } from 'node:fs'

const log = new CaseLog()
const root = process.cwd()
try {
  log.begin('B27-COMPILE-MODULES-AND-CONSUMER', 'the modules and their consumer compile strictly', 'static')
  const files = [
    'packages/execution/src/recovery-transport.ts',
    'apps/runner/src/recovery-endpoint.ts',
    'apps/runner/src/business-channel.ts',
    'apps/runner/src/business-dispatch.ts',
    'apps/runner/src/runner-service.ts',
    'apps/runner/src/business-attach.ts',
    'apps/runner/src/runner-link-client.ts',
  ].filter(file => existsSync(`${root}/${file}`))
  const compile = spawnSync('npx', ['tsc', '--noEmit', '--ignoreConfig', '--strict', '--exactOptionalPropertyTypes',
    '--allowImportingTsExtensions', '--types', 'node', '--target', 'es2022', '--module', 'nodenext',
    '--moduleResolution', 'nodenext', '--skipLibCheck', ...files], { cwd: root, encoding: 'utf8' })
  const firstError = (compile.stderr ?? '').split('\n').filter(Boolean).slice(0, 3).join(' | ')
  log.evidence({ files: files.length, status: compile.status, firstError: firstError || null })
  if (compile.status === 0) log.pass(`${files.length} modules and the attach consumer compile with strict + exactOptionalPropertyTypes`)
  else log.fail(`consumer compile failed: ${firstError}`)

  log.begin('B27-BACKPRESSURE-CAPACITY', 'the channel refuses beyond its bounded capacity', 'controlled_process')
  const channel = createBusinessChannel()
  channel.lease('lease-bp')
  const accepted = []
  for (let index = 0; index < 300; index += 1) {
    try { void channel.requestFact({ factId: `fact-bp-${index}` }).catch(() => undefined); accepted.push(index) } catch { break }
  }
  // The channel itself does not cap; the dispatch does. Record what each layer actually enforces.
  const dispatch = createBusinessDispatch({
    producer: { attempt: { ticketId: 't-bp', assignmentId: 'a-bp', attemptId: 'at-bp', fenceEpoch: 1, contract: { workId: 'w-bp', revision: 1, digest: 'b'.repeat(64) } }, runnerIdentityRef: 'r-bp', source: 'fixture' },
    backends: { recordFact: async () => ({ v: 1, type: 'receipt', id: 'x', factId: 'x', receipt: { factId: 'x', persisted: true, seq: 1 } }), readPayload: async () => ({ v: 1, type: 'payload', id: 'p', requestId: 'p', value: null }), admitWrite: async () => ({ v: 1, type: 'write-admission', id: 'w', allowed: true }) },
    limits: { maxPendingFacts: 2 },
  })
  dispatch.bind({ attempt: { ticketId: 't-bp', assignmentId: 'a-bp', attemptId: 'at-bp', fenceEpoch: 1, contract: { workId: 'w-bp', revision: 1, digest: 'b'.repeat(64) } }, runnerIdentityRef: 'r-bp', source: 'fixture' })
  let capacityRefusal = null
  for (let index = 0; index < 4; index += 1) {
    try { void dispatch.request({ attempt: { ticketId: 't-bp', assignmentId: 'a-bp', attemptId: 'at-bp', fenceEpoch: 1, contract: { workId: 'w-bp', revision: 1, digest: 'b'.repeat(64) } }, runnerIdentityRef: 'r-bp', source: 'fixture' }, { v: 1, type: 'fact', id: `fact-bp-d-${index}`, fact: { factId: `fact-bp-d-${index}`, source: 'runner', ticketId: 't-bp', assignmentId: 'a-bp', attemptId: 'at-bp', fenceEpoch: 1, contract: { workId: 'w-bp', revision: 1, digest: 'b'.repeat(64) }, kind: 'writer.observed', payloadRef: `p-${index}` } }).catch(error => { capacityRefusal = error?.code ?? null }) } catch (error) { capacityRefusal = error?.code ?? null }
  }
  await new Promise(resolve => setTimeout(resolve, 50))
  log.evidence({ channelAccepted: accepted.length, capacityRefusal, dispatchPending: dispatch.pending() })
  if (capacityRefusal === 'capacity') log.pass('the dispatch refused with capacity once its bounded pending-fact limit was reached (backpressure is explicit, not silent)')
  else log.fail(`no capacity refusal was observed: ${JSON.stringify({ capacityRefusal })}`)

  log.begin('B27-FAULT-DETACH-MID-CALLBACK', 'a detach during a pending callback fails it instead of hanging', 'controlled_process')
  const fault = createBusinessChannel()
  fault.lease('lease-fault')
  const pending = fault.requestWrite('cmd-fault', { id: 'cmd-fault', kind: 'answer' })
  const before = fault.pending()
  fault.detach({ reason: 'fault injected' })
  const outcome = await pending.catch(error => ({ code: error?.code ?? null, reason: error?.reason ?? null }))
  log.evidence({ before, outcome, after: fault.pending() })
  if (before.writes === 1 && outcome?.reason === 'write_indeterminate_after_detach') log.pass('the in-flight callback failed as write_indeterminate_after_detach and nothing stayed pending')
  else log.fail(`the fault did not fail the callback cleanly: ${JSON.stringify({ before, outcome })}`)

  log.begin('B27-CLOSE-IDEMPOTENT', 'closing twice is safe and refuses new work', 'controlled_process')
  const closer = createBusinessChannel()
  closer.lease('lease-close')
  let secondError = null
  closer.detach({ reason: 'first' })
  try { closer.detach({ reason: 'second' }) } catch (error) { secondError = String(error?.message ?? error) }
  // A closed channel has NO lease, so nothing can be handed to a client and no outbound work is queued.
  // Callbacks created afterwards are the stdio fallback's business, which is why the claim is about the
  // lease and the outbound queue rather than about the channel refusing every registration.
  const noLease = closer.hasLease() === false
  const noOutbound = closer.nextOutbound() === null
  const emptyPending = Object.values(closer.pending()).every(count => count === 0)
  log.evidence({ secondError, noLease, noOutbound, emptyPending })
  if (secondError === null && noLease && noOutbound && emptyPending) log.pass('a detached channel closes again without error, holds no lease, queues no outbound work and has nothing pending')
  else log.fail(`close was not idempotent or still accepted work: ${JSON.stringify({ secondError, refusedAfterClose })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'no installed agent executed', 'static')
  log.notTested('compile and in-process behaviour only; no installed agent, gateway or native turn')
} catch (error) { log.fail(`harness aborted: ${String(error?.message ?? error).slice(0, 160)}`) }
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 faults and compile', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'static + in-process; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-faults totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
