/**
 * wave-30 I3 — coordinator handover and crash-reconciliation support inside the module.
 *
 * When the original coordinator leaves, a successor must be able to continue the SAME original work:
 * pending facts and payload reads keep their original ids/references and remaining window, while a
 * pending native intent becomes indeterminate and is never migrated or replayed. The module provides
 * only communication semantics; original A/Broker authority, product completion and any physical
 * lifecycle stay with their owners.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CoordinatorChannelRequest } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { answerCommand, factOf, LIMITS, ManualClock, PRODUCER, receiptReply } from './fixtures.ts'

function handover() {
  const clock = new ManualClock()
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits: LIMITS, now: clock.now, schedule: clock.schedule })
  const frames: CoordinatorChannelRequest[] = []
  const bind = (connectionId: string, expectedGeneration: number) => channel.bind({
    producer: PRODUCER,
    connectionId,
    expectedGeneration,
    send: request => {
      frames.push(request)
    },
  })
  const first = bind('coordinator-a', 0)
  return { clock, channel, frames, bind, first }
}

test('a successor continues the same fact and payload identities after the coordinator leaves', async () => {
  const h = handover()
  const fact = h.channel.recordFact(factOf({ factId: 'fact-handover' }))
  const payload = h.channel.readPayload('payload-handover')
  assert.equal(h.frames.length, 2)

  // The original coordinator disappears: facts and payloads stay pending for a successor.
  h.first.close('coordinator left')
  assert.equal(h.channel.inspect().state, 'unbound')
  assert.equal(h.channel.inspect().pendingFacts, 1)
  assert.equal(h.channel.inspect().pendingPayloads, 1)

  const successor = h.bind('coordinator-b', 1)
  assert.equal(h.channel.inspect().generation, 2)
  const retried = h.frames.slice(-2)
  const factFrame = retried.find(frame => frame.type === 'fact')
  const payloadFrame = retried.find(frame => frame.type === 'payload-read')
  assert.ok(factFrame && factFrame.type === 'fact')
  assert.ok(payloadFrame && payloadFrame.type === 'payload-read')
  assert.equal(factFrame.fact.factId, 'fact-handover')
  assert.deepEqual(factFrame.fact, factOf({ factId: 'fact-handover' }))
  assert.equal(payloadFrame.reference, 'payload-handover')

  // Only the successor may settle them; the old coordinator's reply is fenced out.
  assert.equal(h.first.receive(receiptReply('fact-handover')), false)
  assert.equal(successor.receive(receiptReply('fact-handover', 7)), true)
  assert.equal(successor.receive({ v: 1, type: 'payload', id: payloadFrame.requestId, requestId: payloadFrame.requestId, value: { handed: 'over' } }), true)
  assert.deepEqual(await fact, { factId: 'fact-handover', persisted: true, seq: 7 })
  assert.deepEqual(await payload, { handed: 'over' })
})

test('a pending native intent is indeterminate across handover and never replayed on the successor', async () => {
  const h = handover()
  const pending = h.channel.beforeNativeWrite(answerCommand('command-handover'))
  const intent = h.frames.at(-1)
  assert.ok(intent && intent.type === 'native-write-intent')

  h.first.close('coordinator left')
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    return true
  })
  const successor = h.bind('coordinator-b', 1)
  // The abandoned intent is not queued for the successor and no allowed frame can revive it.
  assert.equal(h.frames.filter(frame => frame.type === 'native-write-intent').length, 1)
  assert.equal(successor.receive({ v: 1, type: 'write-admission', id: intent.id, allowed: true }), false)
  assert.equal(h.channel.inspect().pendingWrites, 0)
})

test('the remaining window survives handover and is not refreshed', async () => {
  const h = handover()
  const pending = h.channel.recordFact(factOf({ factId: 'fact-window-handover' }))
  h.clock.advance(600)
  h.first.close('coordinator left')
  const successor = h.bind('coordinator-b', 1)
  assert.equal(h.clock.armed, 1)
  h.clock.advance(401)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'timeout')
    return true
  })
  assert.equal(h.clock.armed, 0)
  assert.equal(successor.receive(receiptReply('fact-window-handover')), false)
})

test('timeout, closed, stale and denial stay distinct so a caller never infers "not written"', async () => {
  // Denial is a decision.
  const denied = handover()
  const deniedIntent = denied.channel.beforeNativeWrite(answerCommand('command-denied-handover'))
  const deniedFrame = denied.frames.at(-1)
  assert.ok(deniedFrame && deniedFrame.type === 'native-write-intent')
  denied.first.receive({ v: 1, type: 'write-admission', id: deniedFrame.id, allowed: false })
  await assert.rejects(deniedIntent, (error: unknown) => error instanceof NativeWriteDenied)

  // Timeout is an unknown outcome, not a denial.
  const timed = handover()
  const timedIntent = timed.channel.beforeNativeWrite(answerCommand('command-timeout-handover'))
  timed.clock.advance(LIMITS.requestTimeoutMs + 1)
  await assert.rejects(timedIntent, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'timeout')
    return true
  })

  // Module close settles data as closed and native as indeterminate.
  const closed = handover()
  const closedFact = closed.channel.recordFact(factOf({ factId: 'fact-closed-handover' }))
  const closedIntent = closed.channel.beforeNativeWrite(answerCommand('command-closed-handover'))
  closed.channel.close('attempt closed')
  await assert.rejects(closedFact, (error: unknown) => (error as { code?: string }).code === 'closed')
  await assert.rejects(closedIntent, (error: unknown) => (error as { code?: string }).code === 'indeterminate')

  // Stale generation is refused without mutating the current lease.
  const stale = handover()
  assert.throws(() => stale.bind('coordinator-x', 0), (error: unknown) => (error as { code?: string }).code === 'stale_connection')
  assert.equal(stale.channel.inspect().generation, 1)
})

test('the channel never emits a business command: handover data is the three v1 frames only', async () => {
  const h = handover()
  h.channel.recordFact(factOf({ factId: 'fact-kinds' }))
  h.channel.readPayload('payload-kinds')
  const intent = h.channel.beforeNativeWrite(answerCommand('command-kinds'))
  h.first.close('coordinator left')
  await assert.rejects(intent, (error: unknown) => (error as { code?: string }).code === 'indeterminate')
  h.bind('coordinator-b', 1)

  const kinds = new Set(h.frames.map(frame => frame.type))
  assert.deepEqual([...kinds].sort(), ['fact', 'native-write-intent', 'payload-read'])
  for (const frame of h.frames) {
    assert.equal(frame.v, 1)
    // No begin/answer/cancel frame is ever produced by the channel; business commands stay with B.
    assert.notEqual((frame as { kind?: string }).kind, 'begin')
  }
})

test('a successor needs the current generation: channel generation is not a business epoch', () => {
  const h = handover()
  // A future/incorrect generation is refused rather than treated as authority.
  assert.throws(() => h.bind('coordinator-b', 5), (error: unknown) => (error as { reason?: string }).reason === 'generation_mismatch')
  assert.throws(() => h.bind('coordinator-b', 0), (error: unknown) => (error as { reason?: string }).reason === 'generation_mismatch')
  const successor = h.bind('coordinator-b', 1)
  assert.equal(successor.generation, 2)
  // The producer tuple is still required exactly; generation never substitutes for it.
  assert.throws(
    () => h.channel.bind({ producer: { ...PRODUCER, attempt: { ...PRODUCER.attempt, fenceEpoch: 2 } }, connectionId: 'coordinator-c', expectedGeneration: 2, send: () => undefined }),
    (error: unknown) => (error as { code?: string }).code === 'identity_mismatch',
  )
})
