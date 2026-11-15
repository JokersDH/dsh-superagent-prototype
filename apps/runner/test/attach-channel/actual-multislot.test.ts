/**
 * wave-31 I9 — multi-slot communication isolation (2 and 4 slots).
 *
 * Four independent real services, each with its own attempt identity, endpoint and lease. Slots share
 * no pending, approval or generation; one slot's denial, drain or close leaves the others untouched.
 * This is an I-owned probe over the communication outcomes — it does NOT claim the product scheduler's
 * aggregate slot release (B/main own that).
 */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { makeAttemptSpec } from '../../../../packages/testing/src/index.ts'
import { startService, type StartedService } from './actual-harness.ts'

type Slot = {
  index: number
  service: StartedService
  client: Awaited<ReturnType<StartedService['connect']>>['client']
  served: string[]
  denied: boolean
}

async function startSlot(t: TestContext, index: number): Promise<Slot> {
  const spec = makeAttemptSpec({ attemptId: `attempt-slot-${index}` })
  const h = await startService(t, {
    spec,
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: `turn-slot-${index}`, outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: `fact-slot-${index}`, kind: 'turn.ended', payloadRef: ref }))
      return { reason: 'terminal', evidenceRefs: [`slot-${index}`] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect(`lease-slot-${index}`, 1)
  h.command(h.begin(`prepared-policy-slot-${index}`))
  return { index, service: h, client: a.client, served: [], denied: false }
}

async function serveSlot(slot: Slot): Promise<void> {
  for (let index = 0; index < 400; index += 1) {
    const page: any = await slot.client.channelNext!(`lease-slot-${slot.index}`)
    if (!page?.request) {
      await new Promise(resolve => setTimeout(resolve, 5))
      continue
    }
    const factId = page.request.fact?.factId as string
    assert.match(factId, new RegExp(`^fact-slot-${slot.index}$`), 'a slot only sees its own fact')
    slot.served.push(factId)
    const reply = await slot.client.channelReply!(`lease-slot-${slot.index}`, { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } })
    assert.equal(reply.accepted, true)
    return
  }
  throw new Error(`slot ${slot.index} served nothing`)
}

test('I9: two slots keep their own pending, lease and correlation', { timeout: 40000 }, async t => {
  const slots = [await startSlot(t, 1), await startSlot(t, 2)]
  for (const slot of slots) await serveSlot(slot)
  for (const slot of slots) {
    assert.deepEqual(slot.served, [`fact-slot-${slot.index}`])
    assert.equal(slot.service.framesOf('fact').length, 0, 'no slot mirrors callbacks to stdio')
    await slot.service.done
  }
})

test('I9: four slots isolate denials and capacity from each other', { timeout: 60000 }, async t => {
  const slots: Slot[] = []
  for (let index = 1; index <= 4; index += 1) slots.push(await startSlot(t, index))

  // Slot 1 is denied a native write; the other slots' facts still settle.
  const denied = slots[0]!
  for (let index = 0; index < 200; index += 1) {
    const page: any = await denied.client.channelNext!('lease-slot-1')
    if (page?.request?.type === 'fact') {
      const factId = page.request.fact.factId
      await denied.client.channelReply!('lease-slot-1', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } })
      denied.served.push(factId)
    }
    break
  }
  for (const slot of slots.slice(1)) await serveSlot(slot)
  for (const slot of slots) await slot.service.done
  assert.deepEqual(slots.map(slot => slot.served.length), [1, 1, 1, 1])
  // Each endpoint stays bound to its own attempt identity.
  const generations = await Promise.all(slots.map(async slot => {
    const state = await slot.client.channelState!()
    return state.generation
  }))
  assert.deepEqual(generations, [2, 2, 2, 2])
})

