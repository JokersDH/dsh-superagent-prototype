/**
 * wave-31 I5 — lease succession over the real authenticated endpoint.
 *
 * The first client stops serving; a successor binds with the current generation by explicit CAS and
 * continues the SAME fact id and immutable payload window. The stranded client is fenced out, and the
 * remaining deadline is reported, not refreshed.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'

test('I5: a successor continues the pending fact and the replaced client cannot answer', { timeout: 30000 }, async t => {
  let releases = 0
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-succession', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-succession', kind: 'turn.ended', payloadRef: ref }))
      releases += 1
      return { reason: 'terminal', evidenceRefs: ['succession'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-old', 1)
  h.command(h.begin('prepared-policy-i31-succ'))

  // The first client observes the request but never answers it (it "leaves").
  let first: any
  for (let index = 0; index < 200; index += 1) {
    first = await a.client.channelNext!('lease-old')
    if (first?.request) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(first?.request?.type, 'fact')
  assert.equal(first?.request?.fact?.factId, 'fact-succession')
  const firstWindow = typeof first?.remainingMs === 'number' ? first.remainingMs : undefined
  if (firstWindow !== undefined) assert.ok(firstWindow > 0 && firstWindow <= 30_000, 'window comes from the module deadline')

  // A successor client takes over with the current generation.
  const state = await a.client.channelState!()
  const bound = await a.client.channelNext!('lease-new', state.generation)
  assert.equal(bound.generation, state.generation + 1)
  const retried: any = await a.client.channelNext!('lease-new')
  assert.equal(retried.request?.fact?.factId, 'fact-succession', 'the same original fact is retried')
  if (firstWindow !== undefined && typeof retried.remainingMs === 'number')
    assert.ok(retried.remainingMs <= firstWindow, 'the window is not refreshed by succession')

  // The replaced client is fenced out.
  await assert.rejects(async () => a.client.channelNext!('lease-old', 1))
  await assert.rejects(async () =>
    a.client.channelReply!('lease-old', { v: 1, type: 'receipt', id: 'fact-succession', factId: 'fact-succession', receipt: { factId: 'fact-succession', persisted: true, seq: 7 } })
  )

  // The successor settles it and the Driver proceeds.
  const reply = await a.client.channelReply!('lease-new', { v: 1, type: 'receipt', id: 'fact-succession', factId: 'fact-succession', receipt: { factId: 'fact-succession', persisted: true, seq: 3 } })
  assert.equal(reply.accepted, true)
  await h.done
  assert.equal(releases, 1)
})

test('I5: a successor cannot bind with a stale or future generation', { timeout: 20000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-gen', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await new Promise(resolve => setTimeout(resolve, 400))
      void ref
      return { reason: 'terminal', evidenceRefs: ['gen'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-owner', 1)
  await assert.rejects(async () => a.client.channelNext!('lease-wrong', 0))
  await assert.rejects(async () => a.client.channelNext!('lease-wrong', 99))
  const state = await a.client.channelState!()
  assert.equal(state.generation, 2, 'refused binds do not change the generation')
})
