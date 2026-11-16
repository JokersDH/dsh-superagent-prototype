/**
 * wave-32 I2 — temporary detach while the attempt is still running.
 *
 * A successor may legitimately take the lease over mid-attempt: data callbacks continue under their
 * original ids, while a native intent that was pending at detach becomes `indeterminate` and its old
 * `allowed` frame can never be replayed into the new connection. Unlike a terminal close, the service
 * keeps running and the successor can finish the work.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'
import { answerCommand } from './fixtures.ts'

type Page = { request: { type: string; id?: string; fact?: { factId?: string } } | null }

async function pollFact(client: { channelNext: (leaseId: string) => Promise<Page> }, leaseId: string): Promise<Page['request']> {
  for (let index = 0; index < 300; index += 1) {
    const page = await client.channelNext(leaseId)
    if (page?.request) return page.request
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return null
}

test('I2: reattach continues data, while a pending native intent becomes indeterminate', { timeout: 40000 }, async t => {
  let firstIntent = 'pending'
  let secondIntent = 'pending'
  const h = await startService(t, {
    recovery: true,
    run: async ({ hooks, io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-reattach', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-reattach', kind: 'turn.ended', payloadRef: ref }))
      try {
        await hooks.beforeNativeWrite(answerCommand('cmd-reattach'))
        firstIntent = 'ok'
      } catch (error) {
        firstIntent = (error as { code?: string }).code ?? 'rejected'
      }
      try {
        await hooks.beforeNativeWrite(answerCommand('cmd-reattach'))
        secondIntent = 'ok'
      } catch (error) {
        secondIntent = (error as { code?: string }).code ?? 'rejected'
      }
      return { reason: 'terminal', evidenceRefs: ['reattach'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-old', 1)
  h.command(h.begin('prepared-policy-reattach'))

  // A serves the fact, then observes the native intent but does not answer it.
  const fact = await pollFact(a.client as never, 'lease-old')
  assert.equal(fact?.type, 'fact')
  const factId = fact?.fact?.factId as string
  assert.equal((await a.client.channelReply!('lease-old', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } })).accepted, true)

  let firstIntentId: string | undefined
  for (let index = 0; index < 300; index += 1) {
    const page: any = await a.client.channelNext!('lease-old')
    if (page?.request?.type === 'native-write-intent') {
      firstIntentId = page.request.id
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(firstIntentId, 'the first intent reaches the original connection')

  // Successor takes over while the driver is still waiting on that intent.
  const state = await a.client.channelState!()
  const bound = await a.client.channelNext!('lease-new', state.generation)
  assert.equal(bound.generation, state.generation + 1)
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(firstIntent, 'indeterminate', 'the pending write is not migrated')

  // The old allowed frame has no effect on either connection.
  await assert.rejects(async () => a.client.channelReply!('lease-old', { v: 1, type: 'write-admission', id: firstIntentId, allowed: true }))
  await new Promise(resolve => setTimeout(resolve, 50))

  // The driver's next (fresh) intent is delivered to the successor and can be decided there.
  let secondIntentId: string | undefined
  for (let index = 0; index < 400; index += 1) {
    const page: any = await a.client.channelNext!('lease-new')
    if (page?.request?.type === 'native-write-intent') {
      secondIntentId = page.request.id
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(secondIntentId)
  assert.notEqual(secondIntentId, firstIntentId, 'a fresh intent needs its own correlation')
  assert.equal((await a.client.channelReply!('lease-new', { v: 1, type: 'write-admission', id: secondIntentId, allowed: true })).accepted, true)
  await h.done
  assert.equal(secondIntent, 'ok')
})

test('I2: the replaced connection cannot read or settle the successor work', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-fence', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-fence', kind: 'turn.ended', payloadRef: ref }))
      return { reason: 'terminal', evidenceRefs: ['fence'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-a', 1)
  h.command(h.begin('prepared-policy-fence'))
  const state = await a.client.channelState!()
  await a.client.channelNext!('lease-b', state.generation)
  await assert.rejects(async () => a.client.channelNext!('lease-a', 1))
  await assert.rejects(async () =>
    a.client.channelReply!('lease-a', { v: 1, type: 'receipt', id: 'fact-fence', factId: 'fact-fence', receipt: { factId: 'fact-fence', persisted: true, seq: 1 } })
  )
})
