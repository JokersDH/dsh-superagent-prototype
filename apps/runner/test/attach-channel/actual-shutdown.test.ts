/**
 * wave-32 I2 — terminal close vs temporary detach, through the real service.
 *
 * main's `finish()` now calls `attach.close(...)`, so a TERMINAL service closes every lease and
 * pending callback: a pending fact fails `closed`, a pending native intent is `indeterminate`, and a
 * late `next`/`reply` has zero effect. A malformed `shutdown` (no frame id) is refused as a protocol
 * error instead of being executed — a distinction my wave-31 probe got wrong and this test pins.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'
import { answerCommand } from './fixtures.ts'

test('I2: terminal shutdown closes a pending fact and refuses late replies', { timeout: 30000 }, async t => {
  let factOutcome = 'pending'
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-terminal', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      try {
        await io.record(h.fact({ factId: 'fact-terminal', kind: 'turn.ended', payloadRef: ref }))
        factOutcome = 'ok'
      } catch (error) {
        factOutcome = (error as { code?: string }).code ?? 'rejected'
      }
      return { reason: 'cancelled', evidenceRefs: ['terminal'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-terminal', 1)
  h.command(h.begin('prepared-policy-terminal'))
  for (let index = 0; index < 200; index += 1) {
    const page: any = await a.client.channelNext!('lease-terminal')
    if (page?.request) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  h.send({ type: 'shutdown', id: 'shutdown-frame' })
  await h.done
  assert.equal(factOutcome, 'closed', 'a terminal close fails the pending fact closed')

  // Late poll/reply have zero effect on the closed channel.
  await assert.rejects(async () => a.client.channelNext!('lease-terminal'))
  await assert.rejects(async () =>
    a.client.channelReply!('lease-terminal', { v: 1, type: 'receipt', id: 'fact-terminal', factId: 'fact-terminal', receipt: { factId: 'fact-terminal', persisted: true, seq: 1 } })
  )
  // The read-only state probe remains readable but grants nothing; no approval can be inferred from it.
  const state = await a.client.channelState!()
  assert.ok(state.generation >= 1)
})

test('I2: terminal shutdown makes a pending native intent indeterminate', { timeout: 30000 }, async t => {
  let intentOutcome = 'pending'
  const h = await startService(t, {
    recovery: true,
    run: async ({ hooks }) => {
      try {
        await hooks.beforeNativeWrite(answerCommand('cmd-terminal'))
        intentOutcome = 'ok'
      } catch (error) {
        intentOutcome = (error as { code?: string }).code ?? 'rejected'
      }
      return { reason: 'cancelled', evidenceRefs: ['terminal-intent'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-intent', 1)
  h.command(h.begin('prepared-policy-terminal-intent'))
  let intentId: string | undefined
  for (let index = 0; index < 200; index += 1) {
    const page: any = await a.client.channelNext!('lease-intent')
    if (page?.request?.type === 'native-write-intent') {
      intentId = page.request.id
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(intentId)
  h.send({ type: 'shutdown', id: 'shutdown-intent' })
  await h.done
  assert.equal(intentOutcome, 'indeterminate', 'an unknown native write is not "not sent"')
  // Replaying the old correlation after terminal does nothing.
  await assert.rejects(async () => a.client.channelReply!('lease-intent', { v: 1, type: 'write-admission', id: intentId, allowed: true }))
})

test('I2: a shutdown frame without an id is refused, not executed', { timeout: 30000 }, async t => {
  let outcome = 'pending'
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-bad-shutdown', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      try {
        await io.record(h.fact({ factId: 'fact-bad-shutdown', kind: 'turn.ended', payloadRef: ref }))
        outcome = 'ok'
      } catch (error) {
        outcome = (error as { code?: string }).code ?? 'rejected'
      }
      return { reason: 'terminal', evidenceRefs: ['bad-shutdown'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-bad', 1)
  h.command(h.begin('prepared-policy-bad'))
  for (let index = 0; index < 200; index += 1) {
    const page: any = await a.client.channelNext!('lease-bad')
    if (page?.request) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  h.send({ type: 'shutdown' }) // no id: protocol error, never a terminal action
  await h.waitFrame(frame => frame.type === 'error', 'protocol error')
  const error = h.framesOf('error')[0] as { code?: string }
  assert.equal(error.code, 'protocol_error')
  // Still running: the pending fact can be served normally afterwards.
  for (let index = 0; index < 200; index += 1) {
    const page: any = await a.client.channelNext!('lease-bad')
    if (page?.request?.type === 'fact') {
      const factId = page.request.fact.factId
      await a.client.channelReply!('lease-bad', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } })
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await h.done
  assert.equal(outcome, 'ok')
})
