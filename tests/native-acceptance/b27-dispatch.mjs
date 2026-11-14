#!/usr/bin/env node
/** Wave-27: one generation-scoped dispatch for the three original callbacks. */
import { CaseLog, writeReport } from './harness.mjs'
import { createBusinessDispatch } from '../../apps/runner/src/business-dispatch.ts'
const log = new CaseLog()
const attempt = { ticketId: 't-d', assignmentId: 'a-d', attemptId: 'at-d', fenceEpoch: 3, contract: { workId: 'w-d', revision: 1, digest: 'd'.repeat(64) } }
const producer = { attempt, runnerIdentityRef: 'runner-d', source: 'codex-native' }
const calls = { facts: 0, payloads: 0, writes: 0 }
let releaseWrite
const dispatch = createBusinessDispatch({ producer, backends: {
  recordFact: async fact => { calls.facts += 1; return { v: 1, type: 'receipt', id: fact.factId, factId: fact.factId, receipt: { factId: fact.factId, persisted: true, seq: 1 } } },
  readPayload: async reference => { calls.payloads += 1; return { v: 1, type: 'payload', id: 'req-1', requestId: 'req-1', value: { reference } } },
  admitWrite: request => { calls.writes += 1; return new Promise(resolve => { releaseWrite = () => resolve({ v: 1, type: 'write-admission', id: request.id, allowed: true }) }) },
} })
try {
  log.begin('B27-DISPATCH-GENERATION-CAS', 'generation starts 0 then CAS binds 1', 'controlled_process')
  const before = dispatch.generation
  const first = dispatch.bind(producer)
  const again = dispatch.bind(producer)
  log.evidence({ before, first, again })
  if (before === 0 && first.generation === 1 && again.generation === 1) log.pass('generation started at 0, first bind returned 1, rebinding the same lease kept 1')
  else log.fail(`generation CAS wrong: ${JSON.stringify({ before, first, again })}`)

  log.begin('B27-FACT-ORIGINAL-ID-ACK', 'a fact is acknowledged by its original id', 'controlled_process')
  const fact = { factId: 'fact-d-1', source: 'runner', ticketId: attempt.ticketId, assignmentId: attempt.assignmentId, attemptId: attempt.attemptId, fenceEpoch: 3, contract: attempt.contract, kind: 'writer.observed', payloadRef: 'p-d-1' }
  const receipt = await dispatch.request(producer, { v: 1, type: 'fact', id: 'fact-d-1', fact: fact })
  log.evidence({ receipt })
  if (receipt.type === 'receipt' && receipt.factId === 'fact-d-1') log.pass('the fact was acknowledged against its original id')
  else log.fail(`fact ACK did not reuse the original id: ${JSON.stringify(receipt)}`)

  log.begin('B27-PAYLOAD-ORIGINAL-REF-REREAD', 'a payload is reread by its original reference', 'controlled_process')
  const payload = await dispatch.request(producer, { v: 1, type: 'payload-read', id: 'req-1', requestId: 'req-1', reference: 'p-d-1' })
  log.evidence({ payload })
  if (payload.type === 'payload' && payload.value?.reference === 'p-d-1') log.pass('the payload was reread by its original reference')
  else log.fail(`payload reread failed: ${JSON.stringify(payload)}`)

  log.begin('B27-PENDING-WRITE-INDETERMINATE-ON-DETACH', 'a pending native write is indeterminate after detach', 'controlled_process')
  const writeCommand = { id: 'cmd-d-1', kind: 'answer', ticketId: attempt.ticketId, assignmentId: attempt.assignmentId, attemptId: attempt.attemptId, fenceEpoch: 3, contract: attempt.contract, nativeBindingRef: 'binding-d-1', answerRef: 'answer-d-1' }
  const pendingWrite = dispatch.request(producer, { v: 1, type: 'native-write-intent', id: 'write-d-1', command: writeCommand }).catch(error => error)
  await new Promise(resolve => setTimeout(resolve, 20))
  const pendingBefore = dispatch.pending()
  dispatch.detach()
  const outcome = await pendingWrite
  log.evidence({ pendingBefore, code: outcome?.code ?? null })
  if (pendingBefore.writes === 1 && outcome?.code === 'indeterminate') log.pass('the pending native write was rejected as indeterminate on detach, granting nothing')
  else log.fail(`detach did not make the pending write indeterminate: ${JSON.stringify({ pendingBefore, code: outcome?.code ?? null })}`)
  void releaseWrite

  log.begin('B27-STALE-LEASE-NOT-SERVED', 'an unbound dispatch serves nobody', 'controlled_process')
  let refused = null
  try { await dispatch.request(producer, { v: 1, type: 'fact', id: 'fact-d-2', fact: { ...fact, factId: 'fact-d-2' } }) } catch (error) { refused = error?.code ?? null }
  log.evidence({ refused })
  if (refused === 'not_bound') log.pass('after detach no lease is served (not_bound)')
  else log.fail(`a detached dispatch still served a request: ${JSON.stringify({ refused })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'local fixtures only', 'controlled_process')
  log.notTested('no installed agent executed, no gateway contacted')
} catch (error) { log.fail(`harness aborted: ${String(error?.message ?? error).slice(0, 140)}`) }
const report = writeReport({ cases: log.cases, environment: { note: 'wave-27 dispatch', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled in-process dispatch; native NOT_TESTED' } }, undefined)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(44)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-dispatch totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
