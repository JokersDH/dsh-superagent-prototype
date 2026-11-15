/**
 * wave-31 I6 — ACK window and reply correlation on the real endpoint.
 *
 * Only the first reply for an exact correlation settles anything; duplicates, wrong kinds, wrong
 * fact ids and replies after the channel is closed are refused by the module and reported by the
 * authenticated transport. The caller — not the channel — decides whether an unknown native write may
 * be retried.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'

async function firstFact(service: Awaited<ReturnType<typeof startService>>, client: { channelNext: (leaseId: string, generation?: number) => Promise<unknown> }, leaseId: string): Promise<any> {
  for (let index = 0; index < 200; index += 1) {
    const page: any = await client.channelNext(leaseId)
    if (page?.request) return page
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('no pending request')
}

test('I6: a duplicate acknowledgement is refused after the first one settles the fact', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-ack', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-ack', kind: 'turn.ended', payloadRef: ref }))
      return { reason: 'terminal', evidenceRefs: ['ack'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-ack', 1)
  h.command(h.begin('prepared-policy-i31-ack'))
  const page = await firstFact(h, a.client, 'lease-ack')
  const factId = page.request.fact?.factId as string
  const receipt = { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } }
  assert.equal((await a.client.channelReply!('lease-ack', receipt)).accepted, true)
  await assert.rejects(async () => a.client.channelReply!('lease-ack', receipt), 'a duplicate ACK must not settle twice')
  await h.done
})

test('I6: a reply of the wrong kind, or for another fact id, is refused', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-kind', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-kind', kind: 'turn.ended', payloadRef: ref }))
      return { reason: 'terminal', evidenceRefs: ['kind'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-kind', 1)
  h.command(h.begin('prepared-policy-i31-kind'))
  await firstFact(h, a.client, 'lease-kind')

  await assert.rejects(async () =>
    a.client.channelReply!('lease-kind', { v: 1, type: 'payload', id: 'payload-x', requestId: 'payload-x', value: { wrong: true } })
  )
  await assert.rejects(async () =>
    a.client.channelReply!('lease-kind', { v: 1, type: 'receipt', id: 'other-fact', factId: 'other-fact', receipt: { factId: 'other-fact', persisted: true, seq: 1 } })
  )
  // The original pending fact is still unsettled and settles with its own id.
  assert.equal((await a.client.channelReply!('lease-kind', { v: 1, type: 'receipt', id: 'fact-kind', factId: 'fact-kind', receipt: { factId: 'fact-kind', persisted: true, seq: 2 } })).accepted, true)
  await h.done
})

test('I6: a reply after the attempt closed does not revive a retired pending', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async () => ({ reason: 'terminal', evidenceRefs: ['late'] }),
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-late', 1)
  h.command(h.begin('prepared-policy-i31-late'))
  await h.done
  await assert.rejects(async () =>
    a.client.channelReply!('lease-late', { v: 1, type: 'receipt', id: 'fact-late', factId: 'fact-late', receipt: { factId: 'fact-late', persisted: true, seq: 1 } })
  )
})
