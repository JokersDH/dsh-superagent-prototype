#!/usr/bin/env node
/**
 * Wave-28 B21: bounded failure of the SELECTED module, exercised through its public surface.
 *
 * These are module-level bounds (capacity, request timeout, close, rebind indeterminate, late reply),
 * not a claim that a live Runner is under load. The live adapter paths are b28-cas/b27-dual-live.
 */
import { CaseLog, writeReport } from './harness.mjs'
import { CoordinatorChannelModule, DEFAULT_LIMITS } from '../../apps/runner/src/attach-channel/index.ts'
import { criticalFact } from '../../packages/driver-kit/src/attempt-io.ts'
import { makeAttemptSpec } from '../../packages/testing/src/index.ts'

const log = new CaseLog()
// A real AttemptSpec and the real criticalFact builder: a hand-written fact is not a valid v1 frame.
const spec = makeAttemptSpec()
const attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
const producer = { attempt, runnerIdentityRef: 'b28-faults', source: 'codex-native' }
const fact = (id, kind = 'dispatch.observed') => criticalFact(spec, { factId: id, source: producer.source, kind, payloadRef: `payload-${id}` })
const limits = { ...DEFAULT_LIMITS, maxPendingFacts: 2, requestTimeoutMs: 120, maxPendingBytes: 4096 }
const make = (overrides = {}) => {
  const sent = []
  // A ref'd timer: the module's own default timer may be unref'd, and a top-level await alone does not
  // keep the loop alive, which would make a "timeout" test silently never run.
  const schedule = (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer) }
  const module = new CoordinatorChannelModule({ producer, limits: { ...limits, ...overrides }, schedule })
  const lease = module.bind({ producer, connectionId: 'lease-f', expectedGeneration: 0, send: request => { sent.push(request) } })
  return { module, lease, sent }
}

try {
  log.begin('B28-FAULTS-CAPACITY-BOUNDED', 'the pending fact bound refuses instead of growing', 'in_process')
  const capped = make()
  const first = capped.module.recordFact(fact('fact-f-1')).catch(error => ({ error: error.code, reason: error.reason }))
  const second = capped.module.recordFact(fact('fact-f-2')).catch(error => ({ error: error.code, reason: error.reason }))
  const third = await capped.module.recordFact(fact('fact-f-3')).then(() => ({ accepted: true })).catch(error => ({ error: error.code, reason: error.reason }))
  log.evidence({ pending: capped.module.inspect().pendingFacts, third, sent: capped.sent.length })
  if (third.error === 'capacity' && capped.module.inspect().pendingFacts === 2) log.pass(`a third pending fact was refused with capacity while two stayed pending (${capped.sent.length} request(s) sent)`)
  else log.fail(`capacity was not bounded: ${JSON.stringify({ third, pending: capped.module.inspect().pendingFacts })}`)
  void first; void second

  log.begin('B28-FAULTS-TIMEOUT-BOUNDED', 'a request without a reply fails as timeout, not as success', 'in_process')
  const timed = make({ requestTimeoutMs: 80 })
  const timedResult = await timed.module.recordFact(fact('fact-f-timeout')).then(() => ({ accepted: true })).catch(error => ({ error: error.code, reason: error.reason }))
  log.evidence({ timedResult })
  if (timedResult.error === 'timeout') log.pass('an unanswered fact failed as timeout after its bounded deadline')
  else log.fail(`the timeout was not bounded: ${JSON.stringify(timedResult)}`)

  log.begin('B28-FAULTS-REBIND-INDETERMINATE', 'a pending native write becomes indeterminate on rebind', 'in_process')
  const rebinding = make()
  const writePromise = rebinding.module.beforeNativeWrite({ id: 'cmd-f-write', ticketId: attempt.ticketId, assignmentId: attempt.assignmentId, attemptId: attempt.attemptId, fenceEpoch: 1, contract: attempt.contract, kind: 'answer', nativeBindingRef: 'binding-f', answerRef: 'answer-f' })
  const writeOutcome = writePromise.then(() => ({ allowed: true })).catch(error => ({ error: error.code, reason: error.reason }))
  rebinding.module.bind({ producer, connectionId: 'lease-f2', expectedGeneration: 1, send: () => {} })
  const settled = await writeOutcome
  log.evidence({ settled, generation: rebinding.module.inspect().generation })
  if (settled.error === 'indeterminate') log.pass('the pending native write settled indeterminate when the connection was replaced, so it was never reported as allowed')
  else log.fail(`a pending write survived the rebind: ${JSON.stringify(settled)}`)

  log.begin('B28-FAULTS-LATE-REPLY-IGNORED', 'a late reply from an old lease does not settle the new one', 'in_process')
  const late = make()
  const pending = late.module.recordFact(fact('fact-f-late')).catch(error => ({ error: error.code }))
  for (let index = 0; index < 100 && late.sent.length === 0; index += 1) await new Promise(resolve => setTimeout(resolve, 5))
  const request = late.sent[0]
  late.module.bind({ producer, connectionId: 'lease-f3', expectedGeneration: 1, send: () => {} })
  const acceptedFromOld = late.lease.receive({ v: 1, type: 'receipt', id: request.id, factId: request.id, receipt: { factId: request.id, persisted: true, seq: 1 } })
  const pendingOutcome = await pending
  log.evidence({ acceptedFromOld, pendingOutcome })
  if (acceptedFromOld === false && pendingOutcome.error === 'indeterminate') log.pass('the old lease could not settle the pending fact and it became indeterminate instead of a fake receipt')
  else if (acceptedFromOld === false && pendingOutcome.error) log.pass(`the old lease reply was refused and the pending fact ended as ${pendingOutcome.error}`)
  else log.fail(`a late reply was accepted: ${JSON.stringify({ acceptedFromOld, pendingOutcome })}`)

  log.begin('B28-FAULTS-CLOSE-BOUNDED', 'close refuses new work and keeps its recorded failure', 'in_process')
  const closing = make()
  const pendingClose = closing.module.recordFact(fact('fact-f-close')).catch(error => ({ error: error.code }))
  closing.module.close('test close')
  const afterClose = await closing.module.recordFact(fact('fact-f-after')).then(() => ({ accepted: true })).catch(error => ({ error: error.code }))
  const closeOutcome = await pendingClose
  log.evidence({ state: closing.module.inspect().state, afterClose, closeOutcome })
  if (closing.module.inspect().state === 'closed' && afterClose.error === 'closed') log.pass(`after close the module reported ${closing.module.inspect().state} and refused new work with closed (pending fact ended ${closeOutcome.error ?? 'unknown'})`)
  else log.fail(`close was not bounded: ${JSON.stringify({ state: closing.module.inspect().state, afterClose })}`)

  log.begin('B28-SCOPE-NOT-LIVE', 'module bounds only; no live Runner under load', 'in_process')
  log.notTested('the live adapter bounds are measured by b28-cas and b27-dual-live; this file does not claim a loaded Runner or integrated module/consumer delivery')
} finally {}
const report = writeReport({ cases: log.cases, environment: { note: 'wave-28 selected module bounds', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'module-level; live load NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(40)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB28-faults totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
