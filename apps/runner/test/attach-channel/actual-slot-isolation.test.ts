/**
 * wave-35 outcome I8 — slot isolation and a clean channel reopen.
 *
 * Four independent Runner services each own their own authenticated endpoint, queue and lease. A lease
 * from one slot can never settle another slot's request, closing one slot leaves the others serving,
 * and a terminal channel cannot be revived while a fresh Runner starts with no ghost work.
 *
 * This is CHANNEL isolation. The original scheduler's 2/4-slot capacity, fifth-item waiting and
 * resource-driven release stay with the original core/queue/bindings and are NOT_TESTED here.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { attachRunnerAttempt, type AttachedAttempt } from '../../../../packages/execution/src/attached-attempt.ts'
import { connectRunnerRecovery } from '../../../../packages/execution/src/recovery-transport.ts'
import { openProductIngress } from './product-ingress-harness.ts'
import { startNativeCallbacks } from './native-callbacks-harness.ts'
import { until } from './actual-harness.ts'

const VALUE = { kind: 'turn.ended', value: { nativeTurnRef: 'turn-slot', outcome: 'completed', candidateAvailable: true, evidenceRefs: ['slot'] } } as Json

test('I8: four slots isolate their leases and survive one slot closing', { timeout: 60000 }, async t => {
  type Slot = Awaited<ReturnType<typeof startNativeCallbacks>> & {
    ingress: ReturnType<typeof openProductIngress>
    consumer: AttachedAttempt
    loop: Promise<void>
    release: () => void
  }
  const slots: Slot[] = []
  for (let index = 0; index < 4; index += 1) {
    const ingress = openProductIngress()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const h = await startNativeCallbacks(t, ingress, async ({ io }) => {
      const localRef = await io.payloads.store(VALUE, 'critical')
      await io.record(h.h.fact({ factId: `factslot${index}`, kind: 'turn.ended', payloadRef: localRef }))
      await gate
      return { reason: 'terminal', evidenceRefs: [`slot-${index}`] }
    })
    h.putLocalPayload(VALUE)
    const consumer = attachRunnerAttempt({
      endpoint: h.endpoint,
      producer: h.h.producer,
      leaseId: `leaseslot${index}`,
      callbacks: { fact: fact => h.callbacks.recordFact(fact), payload: request => h.callbacks.readPayload(request.reference), nativeWrite: intent => h.callbacks.nativeWrite(intent.command) },
      timeoutMs: 3000,
    })
    const loop = consumer.run({ pollMs: 5, deadlineMs: 50_000 }).catch(() => undefined)
    await consumer.pollOnce()
    h.activate()
    h.h.command(h.h.begin(`prepared-policy-slot-${index}`))
    slots.push({ ...h, ingress, consumer, loop, release })
  }

  try {
    for (const slot of slots) {
      await until(() => slot.ingress.store.facts.get(`factslot${slots.indexOf(slot)}`) !== undefined, 20_000, 'slot fact persisted')
    }
    for (let index = 0; index < 4; index += 1) {
      for (let other = 0; other < 4; other += 1) {
        const present = slots[index]!.ingress.store.facts.get(`factslot${other}`)
        if (other === index) assert.ok(present, `slot ${index} persisted its own fact`)
        else assert.equal(present, undefined, `slot ${index} never saw slot ${other}'s fact`)
      }
    }

    // A lease from another slot cannot settle this slot's channel.
    const client = connectRunnerRecovery(slots[0]!.endpoint, slots[0]!.h.producer, 3000)
    await assert.rejects(async () => client.channelReply!('leaseslot1' as never, {
      v: 1, type: 'receipt', id: 'factslot0', factId: 'factslot0',
      receipt: { factId: 'factslot0', persisted: true, seq: 1 },
    } as never), (error: unknown) => {
      const serverError = (error as { serverError?: string }).serverError
      assert.ok(serverError === 'stale_lease' || serverError === 'stale_connection' || serverError === 'identity_mismatch')
      return true
    })

    // Close slot 2; the others keep their lease and remain pollable.
    slots[2]!.h.send({ type: 'shutdown', id: 'shutdownslot2' })
    await assert.rejects(async () => slots[2]!.consumer.pollOnce(), () => true)
    for (const index of [0, 1, 3]) {
      const state = await connectRunnerRecovery(slots[index]!.endpoint, slots[index]!.h.producer, 3000).channelState()
      assert.ok(state.generation >= 2, `slot ${index} still owns its channel`)
    }
  } finally {
    for (const slot of slots) {
      try {
        slot.release()
      } catch {
        // already released
      }
    }
  }
})

test('I8: a terminal channel is refused and a fresh Runner starts with no ghost work', { timeout: 45000 }, async t => {
  const ingress = openProductIngress()
  t.after(() => ingress.close())
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  const h = await startNativeCallbacks(t, ingress, async () => {
    await firstGate
    return { reason: 'terminal', evidenceRefs: ['reopen'] }
  })
  h.activate()
  h.h.command(h.h.begin('prepared-policy-reopen'))
  const first = connectRunnerRecovery(h.endpoint, h.h.producer, 3000)
  const initial = await first.channelState()
  await first.channelNext!('leasereopenone' as never, initial.generation as never)
  h.h.send({ type: 'shutdown', id: 'shutdownreopen' })
  // `finish()` closes the channel synchronously, so no new lease can be taken even before exit.
  await assert.rejects(async () => first.channelNext!('leasereopenone' as never, (initial.generation + 1) as never), () => true)
  releaseFirst()

  // A fresh Runner (new endpoint, same spec identity) begins unbound with no surviving request.
  const second = openProductIngress()
  t.after(() => second.close())
  let releaseSecond!: () => void
  const secondGate = new Promise<void>(resolve => {
    releaseSecond = resolve
  })
  const h2 = await startNativeCallbacks(t, second, async () => {
    await secondGate
    return { reason: 'terminal', evidenceRefs: ['reopen-fresh'] }
  })
  h2.activate()
  h2.h.command(h2.h.begin('prepared-policy-reopen2'))
  const client = connectRunnerRecovery(h2.endpoint, h2.h.producer, 3000)
  const state = await client.channelState()
  assert.equal(state.generation, 1, 'the new Runner starts from its own bootstrap generation')
  const page = await client.channelNext!('leasereopentwo' as never, state.generation as never)
  assert.equal(page!.request, null, 'no settled or unknown request is resurrected')
  releaseSecond()
  await h2.h.done
})
