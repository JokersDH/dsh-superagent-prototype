/**
 * wave-35 outcome I6 — bounded capacity, control availability and honest diagnostics.
 *
 * The channel refuses before send when a kind is saturated, other kinds stay usable, and settlement
 * restores capacity. Everything here runs through the real service, the original Store and main's
 * attach caller; nothing widens the production limits.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'
import { until } from './actual-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-limits', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['e-limits'] } } as Json

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-limits', answerRef: 'answer-limits' })
}

test('I6: a 65-fact flow stays bounded and a payload read is served between facts', { timeout: 60000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const storedRef = ingress.putPayload({ stored: 'during-flow' } as Json)
  const seen: string[] = []

  const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
    const localRef = await io.payloads.store(VALUE, 'critical')
    for (let index = 1; index <= 65; index += 1) {
      const receipt = await io.record(h.h.fact({ factId: `burst${index}`, kind: 'turn.ended', payloadRef: localRef }))
      seen.push(`ok:${index}:${receipt.seq}`)
      if (index === 10) {
        // Control work interleaves with the fact flow and is served by the same consumer.
        const body = await io.payloads.read(storedRef)
        seen.push(`payload-mid-flow:${JSON.stringify(body)}`)
      }
    }
    return { reason: 'terminal', evidenceRefs: ['flow'] }
  })
  h.putLocalPayload(VALUE)

  const consumer = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leaseflow',
    callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
    timeoutMs: 3000,
  })
  const loop = consumer.run({ pollMs: 2, deadlineMs: 50_000 }).catch(() => undefined)
  await consumer.pollOnce()
  h.activate()
  h.h.command(h.h.begin('prepared-policy-limits'))
  await h.h.done
  consumer.stop()
  await loop

  const facts = seen.filter(entry => entry.startsWith('ok:'))
  assert.equal(facts.length, 65, 'every fact settled once')
  const seqs = facts.map(entry => Number(entry.split(':')[2]))
  assert.ok(seqs.every(seq => Number.isSafeInteger(seq) && seq > 0), 'each fact carries an original Store receipt')
  assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, 'the Store sequence is monotonic for the single writer')
  assert.equal(new Set(seqs).size, 65, 'no duplicate receipt for the same fact')
  assert.ok(seen.includes('payload-mid-flow:{"stored":"during-flow"}'), 'the payload read was served while facts continued')
  for (let index = 1; index <= 65; index += 1) assert.ok(ingress.store.facts.get(`burst${index}`), `fact burst${index} is in the Store`)
  // The product fact path records one fact at a time (the Runner awaits each receipt), so a 65-fact
  // flow never reaches the 64-pending module budget; the refusal-before-send bound for facts is proven
  // at the module boundary in concurrency.test.ts, and for writes below at this product boundary.
})

test('I6: native intents have their own bounded capacity, refusals are typed and capacity returns', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const outcomes: string[] = []

  const h = await startNativeCallbacks(t, ingress, async ({ hooks }) => {
    // Nine concurrent intents against maxPendingWrites=8: one is refused before send.
    const results = await Promise.allSettled(
      Array.from({ length: 9 }, (_, index) => hooks.beforeNativeWrite(commandFor(`cmdlimit${index}`))),
    )
    for (const result of results) {
      if (result.status === 'fulfilled') outcomes.push('allowed')
      else outcomes.push((result.reason as { code?: string }).code ?? (result.reason instanceof NativeWriteDenied ? 'native_write_denied' : 'refused'))
    }
    // Capacity is per intent and recovers: a later intent is decided normally.
    try {
      await hooks.beforeNativeWrite(commandFor('cmdafterlimit'))
      outcomes.push('after:allowed')
    } catch (error) {
      const code = (error as { code?: string }).code
      outcomes.push(`after:${code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : String((error as Error).message).slice(0, 60))}`)
    }
    return { reason: 'terminal', evidenceRefs: ['write-capacity'] }
  })

  const consumer = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leasewritecap',
    callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
    timeoutMs: 3000,
  })
  const loop = consumer.run({ pollMs: 5, deadlineMs: 40_000 }).catch(() => undefined)
  await consumer.pollOnce()
  h.activate()
  h.h.command(h.h.begin('prepared-policy-writecap'))
  await h.h.done
  consumer.stop()
  await loop

  const capacity = outcomes.filter(entry => entry === 'capacity').length
  assert.equal(capacity, 1, 'exactly one intent hit the write capacity')
  assert.equal(outcomes.filter(entry => entry === 'native_write_denied').length, 8, 'the admitted intents were denied by the guard')
  assert.equal(outcomes.at(-1), 'after:native_write_denied', 'after the burst, capacity is back and the guard decides again')
})
