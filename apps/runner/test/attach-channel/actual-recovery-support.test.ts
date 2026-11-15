/**
 * wave-31 I8 — communication support for the normal original-work lane.
 *
 * This proves the normal chain is not disturbed by the channel: one fact, one fresh native intent,
 * one terminal exit, no duplicate business frame. The *recovered* chain (original A new process,
 * native_applied / ACK-unknown reconciliation, candidate/manualaccept/slot release) is NOT_REACHED
 * here — it needs B/main product wiring, not a channel test.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Json } from '../../../../packages/contracts/src/types.ts'
import { startService } from './actual-harness.ts'

test('I8: the normal lane emits exactly one fact and one fresh intent, then terminates', { timeout: 30000 }, async t => {
  let nativeWrites = 0
  const h = await startService(t, {
    recovery: true,
    run: async ({ hooks, io }) => {
      const ref = await io.payloads.store({ kind: 'turn.ended', value: { nativeTurnRef: 't-normal', outcome: 'completed', candidateAvailable: true, evidenceRefs: [] } } as Json, 'critical')
      await io.record(h.fact({ factId: 'fact-normal', kind: 'turn.ended', payloadRef: ref }))
      await hooks.beforeNativeWrite(h.answer('cmd-answer-normal'))
      nativeWrites += 1
      return { reason: 'terminal', evidenceRefs: ['normal'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-normal', 1)
  h.command(h.begin('prepared-policy-i31-normal'))

  // Fact first, then the fresh intent; both over the same authenticated lease.
  let factId: string | undefined
  let intentId: string | undefined
  for (let index = 0; index < 400 && !(factId && intentId); index += 1) {
    const page: any = await a.client.channelNext!('lease-normal')
    if (!page?.request) {
      await new Promise(resolve => setTimeout(resolve, 5))
      continue
    }
    if (page.request.type === 'fact' && !factId) {
      factId = page.request.fact?.factId as string
      await a.client.channelReply!('lease-normal', { v: 1, type: 'receipt', id: factId, factId, receipt: { factId, persisted: true, seq: 1 } })
    } else if (page.request.type === 'native-write-intent' && !intentId) {
      intentId = page.request.id as string
      assert.notEqual(intentId, page.request.command?.id, 'intent correlation is fresh')
      await a.client.channelReply!('lease-normal', { v: 1, type: 'write-admission', id: intentId, allowed: true })
    }
  }
  assert.equal(factId, 'fact-normal')
  assert.ok(intentId)
  await h.done
  assert.equal(nativeWrites, 1, 'the write happens only after the coordinator admits that intent')

  // No business command frame was produced by the channel, and no callback was mirrored to stdio.
  assert.equal(h.framesOf('fact').length, 0)
  const kinds = new Set(h.frames.map(frame => frame.type))
  for (const kind of kinds) assert.ok(['ready', 'receipt', 'exited', 'progress'].includes(String(kind)), `unexpected frame ${String(kind)}`)
  assert.equal(h.framesOf('native-write-intent').length, 0, 'stdio must not receive the remote intent')

  // A late admission cannot revive the retired intent.
  await assert.rejects(async () => a.client.channelReply!('lease-normal', { v: 1, type: 'write-admission', id: intentId, allowed: true }))
})

test('I8: a remote denial leaves the driver with zero writes for that intent', { timeout: 30000 }, async t => {
  let writes = 0
  const h = await startService(t, {
    recovery: true,
    run: async ({ hooks }) => {
      try {
        await hooks.beforeNativeWrite(h.answer('cmd-answer-denied'))
        writes += 1
      } catch {
        // denial keeps a real zero write
      }
      return { reason: 'terminal', evidenceRefs: ['denied'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  const a = await h.connect('lease-deny', 1)
  h.command(h.begin('prepared-policy-i31-deny'))
  for (let index = 0; index < 200; index += 1) {
    const page: any = await a.client.channelNext!('lease-deny')
    if (page?.request?.type === 'native-write-intent') {
      await a.client.channelReply!('lease-deny', { v: 1, type: 'write-admission', id: page.request.id, allowed: false })
      break
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await h.done
  assert.equal(writes, 0)
})

test('I8: the recovered product chain stays NOT_REACHED at module scope', () => {
  // Kept explicit so a green module run is never read as recovered Work/candidate/accept evidence.
  const scope = {
    normalCommunication: 'PASS (above)',
    recoveredOriginalAProcess: 'NOT_REACHED (B/main)',
    recoveredCandidateAndAcceptance: 'NOT_REACHED (B/main)',
    slotRelease: 'NOT_REACHED (B/main)',
  }
  assert.equal(scope.recoveredOriginalAProcess.startsWith('NOT_REACHED'), true)
})
