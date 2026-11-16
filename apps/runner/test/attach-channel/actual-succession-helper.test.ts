/**
 * wave-35 outcome I4 — temporary detach vs terminal, across a real takeover.
 *
 * Two real `attachRunnerAttempt` consumers serve the same run. A detach is a *replaced lease*: the
 * pending native intent becomes indeterminate, fact/payload work stays pending and is requeued for the
 * successor with its original id/reference. A terminal closes every lease: no successor can bind and
 * the previous consumer cannot take the channel back with its old generation.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt, type AttachedAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks, ATTEMPT } from './native-callbacks-harness.ts'
import { until } from './actual-harness.ts'

const VALUE_ONE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-one', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['e1'] } } as Json
const VALUE_TWO = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-two', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['e2'] } } as Json

function commandFor(id: string) {
  return makeCommand('answer', { ...ATTEMPT, id, nativeBindingRef: 'binding-succ', answerRef: 'answer-succ' })
}

test('I4: replaced lease keeps data, makes the pending write indeterminate and lets the successor continue', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  const seen: string[] = []
  let releaseNative!: () => void
  const nativeGate = new Promise<void>(resolve => {
    releaseNative = resolve
  })
  let releaseFresh!: () => void
  const freshGate = new Promise<void>(resolve => {
    releaseFresh = resolve
  })

  const h = await startNativeCallbacks(t, ingress, async ({ hooks, io }) => {
    const localOne = await io.payloads.store(VALUE_ONE, 'critical')
    seen.push(`fact-one:${(await io.record(h.h.fact({ factId: 'factone', kind: 'turn.ended', payloadRef: localOne }))).seq}`)
    await nativeGate
    seen.push('native-start')
    try {
      await hooks.beforeNativeWrite(commandFor('cmd-detach'))
      seen.push('native-allowed')
    } catch (error) {
      seen.push(`native:${(error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused')}`)
    }
    const localTwo = await io.payloads.store(VALUE_TWO, 'critical')
    seen.push(`fact-two:${(await io.record(h.h.fact({ factId: 'facttwo', kind: 'turn.ended', payloadRef: localTwo }))).seq}`)
    // A fresh intent after the takeover must be decided by the current guard, not by the old decision.
    await freshGate
    try {
      await hooks.beforeNativeWrite(commandFor('cmd-fresh'))
      seen.push('fresh-allowed')
    } catch (error) {
      seen.push(`fresh:${(error as { code?: string }).code ?? (error instanceof NativeWriteDenied ? 'native_write_denied' : 'refused')}`)
    }
    return { reason: 'terminal', evidenceRefs: ['succession'] }
  })

  h.putLocalPayload(VALUE_ONE)
  h.putLocalPayload(VALUE_TWO)
  h.indexCommand(commandFor('cmd-detach'))
  h.indexCommand(commandFor('cmd-fresh'))

  const first = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leasesuccessiona',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
    },
    timeoutMs: 3000,
  })
  // Bind before business starts, exactly as main does after launch, then serve continuously.
  const firstLoop = first.run({ pollMs: 5, deadlineMs: 60_000 }).catch(() => undefined)
  await first.pollOnce()
  h.activate()
  h.h.command(h.h.begin('prepared-policy-succ'))
  await until(() => ingress.store.facts.get('factone') !== undefined, 15000, 'first fact persisted')

  // Detach A without stopping the run: A stops polling, then the driver raises a native intent that
  // only the successor can see.
  first.stop()
  await firstLoop
  releaseNative()
  await until(() => seen.includes('native-start'), 10000, 'native intent started')
  const second = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leasesuccessionb',
    callbacks: {
      fact: fact => h.callbacks.recordFact(fact),
      payload: request => h.callbacks.readPayload(request.reference),
      nativeWrite: intent => h.callbacks.nativeWrite(intent.command),
    },
    timeoutMs: 3000,
  })
  const secondLoop = second.run({ pollMs: 5, deadlineMs: 60_000 }).catch(() => undefined)
  await second.pollOnce()
  await until(() => seen.some(entry => entry.startsWith('native:')), 10000, 'pending write settled')

  // The successor serves the second fact (requeued with its original id) through the same Store.
  await until(() => ingress.store.facts.get('facttwo') !== undefined, 15000, 'second fact persisted')

  // The old connection cannot take the channel back by replaying its stale generation.
  const staleClient = connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  const current = await staleClient.channelState()
  assert.equal(current.generation, 3, 'the successor owns generation 3')
  await assert.rejects(async () => staleClient.channelNext!('leasesuccessiona' as never, 2 as never), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(code === 'stale_connection' || code === 'refused', `old-generation poll is refused (got ${String(code)})`)
    return true
  })
  assert.equal((await staleClient.channelState()).generation, 3, 'the refused poll did not change the owner')

  h.permit('cmd-fresh')
  releaseFresh()
  await until(() => seen.includes('fresh-allowed'), 15000, 'fresh intent allowed')
  await h.h.done
  second.stop()
  await secondLoop

  const factReceipts = seen.filter(entry => entry.startsWith('fact-')).map(entry => Number(entry.split(':')[1]))
  assert.equal(factReceipts.length, 2, 'each fact produced exactly one receipt')
  assert.ok(factReceipts.every(seq => Number.isSafeInteger(seq) && seq > 0), 'receipts are original Store row sequences')
  assert.ok(factReceipts[1]! > factReceipts[0]!, 'the successor continued the same Store sequence')
  assert.deepEqual(seen.filter(entry => entry.startsWith('native')), ['native-start', 'native:indeterminate'], 'the pending write is unknown, not allowed or denied')
  assert.deepEqual(seen.filter(entry => entry.startsWith('fresh')), ['fresh-allowed'], 'the successor decides the fresh intent with the current guard')
  assert.ok(ingress.store.facts.get('factone'), 'the first fact is in the original Store')
  assert.ok(ingress.store.facts.get('facttwo'), 'the successor persisted the second fact once')
})

test('I4: terminal closes every lease and no consumer revives it', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const h = await startNativeCallbacks(t, ingress, async () => {
    await gate
    return { reason: 'terminal', evidenceRefs: ['terminal'] }
  })
  h.activate()
  h.h.command(h.h.begin('prepared-policy-term'))

  const consumer: AttachedAttempt = attachRunnerAttempt({
    endpoint: h.endpoint,
    producer: h.h.producer,
    leaseId: 'leaseterminal',
    callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
    timeoutMs: 3000,
  })
  await consumer.pollOnce()
  h.h.send({ type: 'shutdown', id: 'shutdownterminal' })
  await assert.rejects(async () => consumer.pollOnce(), (error: unknown) => {
    const code = (error as { code?: string }).code
    assert.ok(code === 'closed' || code === 'refused' || code === 'stale_connection', `terminal poll refuses (got ${String(code)})`)
    return true
  })
  release()
})
