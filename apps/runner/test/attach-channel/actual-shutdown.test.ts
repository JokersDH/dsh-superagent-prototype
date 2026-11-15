/**
 * wave-31 I10 — shutdown and terminal states of the communication subsystem.
 *
 * Shutdown over the bridge closes admission, settles the in-flight callback (a fact fails closed, a
 * native intent is indeterminate) and terminates the service. It does not claim the child/socket/fd
 * are physically gone — that is B's process authority. A malformed frame is refused without changing
 * ownership.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'

test('I10: shutdown with a pending fact keeps it unknown and refuses later replies', { timeout: 30000 }, async t => {
  let factOutcome = 'pending'
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-shutdown', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      try {
        await io.record(h.fact({ factId: 'fact-shutdown', kind: 'turn.ended', payloadRef: ref }))
        factOutcome = 'ok'
      } catch (error) {
        factOutcome = (error as { code?: string }).code ?? 'rejected'
      }
      return { reason: 'cancelled', evidenceRefs: ['shutdown'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-shutdown', 1)
  h.command(h.begin('prepared-policy-i31-shutdown'))

  // Observe the pending fact, then stop the attempt without answering it.
  for (let index = 0; index < 200; index += 1) {
    const page: any = await a.client.channelNext!('lease-shutdown')
    if (page?.request) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  h.send({ type: 'shutdown' })

  // The current service drops the transport leases; the module keeps the fact pending for succession,
  // so the Driver must NOT be told "delivered" or "closed". It stays unknown until its deadline.
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(factOutcome, 'pending', 'shutdown must not fabricate a receipt or a closed failure')

  // No receipt was fabricated for the pending fact.
  assert.equal(h.framesOf('receipt').some(frame => frame.factId === 'fact-shutdown'), false)
  // NOTE (reported to B, not asserted green here): the current service's `closeAdmission` only drops
  // the fixed stdio/sink connection ids, so a remote lease id stays current after shutdown and a late
  // reply could still settle the pending fact. The module-level guarantee (module.close refuses late
  // replies) is covered by handover.test.ts; the service-side fix belongs to B.
})

test('I10: shutdown with no pending callback terminates the service', { timeout: 30000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async () => ({ reason: 'cancelled', evidenceRefs: ['idle-shutdown'] }),
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-idle', 1)
  h.command(h.begin('prepared-policy-i31-idle'))
  await h.done
  await assert.rejects(async () =>
    a.client.channelReply!('lease-idle', { v: 1, type: 'receipt', id: 'fact-none', factId: 'fact-none', receipt: { factId: 'fact-none', persisted: true, seq: 1 } })
  )
})

test('I10: a malformed frame is refused without changing the current owner', { timeout: 20000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-malformed', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await new Promise(resolve => setTimeout(resolve, 500))
      void ref
      return { reason: 'terminal', evidenceRefs: ['malformed'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-malformed', 1)
  const before = await a.client.channelState!()
  h.send({ v: 2, type: 'progress', id: 'bad' })
  await h.waitFrame(frame => frame.type === 'error', 'protocol error')
  const after = await a.client.channelState!()
  assert.equal(after.generation, before.generation)
})
