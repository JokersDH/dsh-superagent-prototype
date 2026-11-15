/**
 * wave-31 I7 — bounded backpressure on the active implementation.
 *
 * The real service runs with the module's constructor limits (64 pending facts). 65 concurrent
 * records must produce exactly one capacity refusal at the 65th, the 64 queued facts stay individually
 * correlated, draining them releases capacity, and a later record succeeds. No second queue or timer
 * exists outside the module.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'

test('I7: the real service refuses the 65th pending fact and recovers after draining', { timeout: 40000 }, async t => {
  let releaseExtra!: () => void
  const extraGate = new Promise<void>(resolve => {
    releaseExtra = resolve
  })
  const outcomes: Array<'ok' | 'capacity' | 'other'> = []
  let extraIssued = false
  let extraOutcome = 'pending'

  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-load', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      const batch = await Promise.allSettled(
        Array.from({ length: 65 }, (_, index) => io.record(h.fact({ factId: `fact-load-${index + 1}`, kind: 'turn.ended', payloadRef: ref }))),
      )
      for (const result of batch) {
        if (result.status === 'fulfilled') outcomes.push('ok')
        else {
          const code = (result.reason as { code?: string }).code
          outcomes.push(code === 'capacity' ? 'capacity' : 'other')
        }
      }
      await extraGate
      // Announce the intent to record first: the receipt only arrives after the client serves it.
      extraIssued = true
      try {
        await io.record(h.fact({ factId: 'fact-load-extra', kind: 'turn.ended', payloadRef: ref }))
        extraOutcome = 'ok'
      } catch (error) {
        extraOutcome = `${(error as { code?: string }).code}:${(error as { reason?: string }).reason}`
      }
      return { reason: 'terminal', evidenceRefs: ['backpressure'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-load', 1)
  h.command(h.begin('prepared-policy-i31-load'))

  const served: string[] = []
  const deadline = Date.now() + 20_000
  while (served.length < 64) {
    if (Date.now() > deadline) throw new Error(`only ${served.length} facts were served`)
    const page: any = await a.client.channelNext!('lease-load')
    if (!page?.request) {
      await new Promise(resolve => setTimeout(resolve, 5))
      continue
    }
    const factId = page.request.fact?.factId as string
    served.push(factId)
    const reply = await a.client.channelReply!('lease-load', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: served.length } })
    assert.equal(reply.accepted, true)
  }

  // Exactly one refusal, and it is a capacity refusal rather than a silent hang or success.
  assert.equal(outcomes.filter(value => value === 'capacity').length, 1)
  assert.equal(outcomes.filter(value => value === 'other').length, 0)
  assert.equal(new Set(served).size, 64, 'each queued fact is distinct')

  // Capacity is released; a later record is admitted and served.
  releaseExtra()
  for (let index = 0; index < 400 && !extraIssued; index += 1) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(extraIssued, true, 'the extra record is attempted after draining')
  let extraServed = false
  for (let index = 0; index < 400 && !extraServed; index += 1) {
    const page: any = await a.client.channelNext!('lease-load')
    const factId = page?.request?.fact?.factId as string | undefined
    if (!factId) {
      await new Promise(resolve => setTimeout(resolve, 5))
      continue
    }
    const reply = await a.client.channelReply!('lease-load', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 99 } })
    assert.equal(reply.accepted, true)
    extraServed = factId === 'fact-load-extra'
  }
  assert.equal(extraServed, true)
  await h.done
  assert.equal(extraOutcome, 'ok', 'the extra record is admitted after capacity is released')
})
