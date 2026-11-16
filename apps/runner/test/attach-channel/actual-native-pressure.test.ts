/**
 * wave-34 outcome I5 — namespace, backpressure and bounded diagnostics with the ORIGINAL callbacks.
 *
 * Pressure is applied to main's original `recordFact`/`nativeWriteDecision` path through the real
 * service: a slow original sink, a refusing original sink, a missing caller-local payload and the
 * module's 64-fact bound. Every refusal is typed and no failure becomes a fake receipt or allow.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import type { CriticalFact } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-pressure', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json

function callerFor(h: Awaited<ReturnType<typeof startNativeCallbacks>>, leaseId: string) {
  return attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId,
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
    },
    timeoutMs: 3000,
  })
}

test('I5: a slow original sink drains a small burst inside its deadline', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    const ref = await io.payloads.store(VALUE, 'critical')
    for (let index = 1; index <= 3; index += 1) await io.record(h.h.fact({ factId: `fact-slow-orig-${index}`, kind: 'turn.ended', payloadRef: ref }))
    return { reason: 'terminal', evidenceRefs: ['slow'] }
  }, { localPayload: VALUE, sinkDelayMs: 120 })
  const caller = callerFor(h, 'lease-slow-orig')
  const started = Date.now()
  const running = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-slow-orig'))
  await h.h.done
  caller.stop()
  await running
  assert.equal(caller.served.facts, 3)
  assert.deepEqual(h.sinkCalls.sort(), ['fact-slow-orig-1', 'fact-slow-orig-2', 'fact-slow-orig-3'])
  assert.ok(Date.now() - started < 20_000)
})

test('I5: a refusing original sink and a missing local payload are typed failures, not ACKs', { timeout: 40000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const outcomes: string[] = []
  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    const ref = await io.payloads.store(VALUE, 'critical')
    try {
      await io.record(h.h.fact({ factId: 'fact-refused-orig', kind: 'turn.ended', payloadRef: ref }))
      outcomes.push('acked')
    } catch (error) {
      outcomes.push((error as { code?: string }).code ?? 'refused')
    }
    return { reason: 'terminal', evidenceRefs: ['refused'] }
  }, { localPayload: VALUE, failFactIds: ['fact-refused-orig'] })
  const caller = callerFor(h, 'lease-refused-orig')
  const running = caller.run({ pollMs: 5, deadlineMs: 20_000 }).catch(() => undefined)
  h.activate()
  h.h.command(h.h.begin('prepared-policy-refused-orig'))
  await h.h.done
  caller.stop()
  await running
  assert.deepEqual(outcomes, ['protocol_error'], 'a refused ingress surfaces as a typed ack-failure')
  assert.equal(ingress.store.facts.get('fact-refused-orig'), undefined)
  // The original fact method also refuses a payload the caller cannot resolve locally.
  await assert.rejects(async () => h.callbacks.recordFact({
    ...(h.h.fact({ factId: 'fact-no-local', kind: 'turn.ended', payloadRef: 'payload:missing-local' }) as CriticalFact),
    attemptId: ATTEMPT.attemptId,
  }))
})

test('I5: the 64-fact bound refuses the 65th before send and recovers after the caller attaches', { timeout: 50000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const outcomes: string[] = []
  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    const ref = await io.payloads.store(VALUE, 'critical')
    const batch = await Promise.allSettled(
      Array.from({ length: 65 }, (_, index) => io.record(h.h.fact({ factId: `fact-cap-orig-${index + 1}`, kind: 'turn.ended', payloadRef: ref }))),
    )
    for (const result of batch) outcomes.push(result.status === 'fulfilled' ? 'ok' : ((result.reason as { code?: string }).code ?? 'error'))
    return { reason: 'terminal', evidenceRefs: ['capacity'] }
  }, { localPayload: VALUE })
  h.activate()
  h.h.command(h.h.begin('prepared-policy-cap-orig'))
  // No consumer yet: the burst must hit the bound.
  await new Promise(resolve => setTimeout(resolve, 300))
  const caller = callerFor(h, 'lease-cap-orig')
  const running = caller.run({ pollMs: 5, deadlineMs: 30_000 }).catch(() => undefined)
  await h.h.done
  caller.stop()
  await running
  assert.equal(outcomes.filter(value => value === 'ok').length, 64)
  assert.equal(outcomes.filter(value => value === 'capacity').length, 1)
  assert.equal(caller.served.facts, 64)
  assert.equal(h.sinkCalls.length, 64)
})
