/**
 * wave-30 I2 — concurrency, saturation and recovery on the active implementation.
 *
 * The service mixes kinds and re-asks the guard for the same business command. The module must keep
 * correlations separate, refuse concurrency it cannot represent, release capacity on settlement and
 * leave nothing dispatchable after timeout/drop/rebind.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CoordinatorChannelRequest } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'
import { CoordinatorChannelError } from '../../src/attach-channel/errors.ts'
import { RunnerAttachChannel } from '../../src/attach-channel/attach.ts'
import { answerCommand, factOf, LIMITS, ManualClock, PRODUCER, receiptReply } from './fixtures.ts'

function rig(overrides: Partial<typeof LIMITS> = {}) {
  const clock = new ManualClock()
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits: { ...LIMITS, ...overrides }, now: clock.now, schedule: clock.schedule })
  const frames: CoordinatorChannelRequest[] = []
  const lease = channel.bind({ producer: PRODUCER, connectionId: 'conn-1', expectedGeneration: 0, send: request => { frames.push(request) } })
  return { clock, channel, frames, lease }
}

test('concurrent facts settle independently and a duplicate reply settles only once', async () => {
  const r = rig()
  const a = r.channel.recordFact(factOf({ factId: 'fact-a' }))
  const b = r.channel.recordFact(factOf({ factId: 'fact-b' }))
  assert.deepEqual(r.frames.map(frame => frame.id), ['fact-a', 'fact-b'])

  assert.equal(r.lease.receive(receiptReply('fact-b', 2)), true)
  assert.deepEqual(await b, { factId: 'fact-b', persisted: true, seq: 2 })
  assert.equal(r.channel.inspect().pendingFacts, 1)

  assert.equal(r.lease.receive(receiptReply('fact-a', 1)), true)
  assert.deepEqual(await a, { factId: 'fact-a', persisted: true, seq: 1 })
  assert.equal(r.lease.receive(receiptReply('fact-a', 9)), false)
  assert.equal(r.channel.inspect().pendingFacts, 0)
  assert.equal(r.clock.armed, 0)
})

test('the same raw id in different kinds never crosses: each settles from its own reply', async () => {
  const r = rig()
  const fact = r.channel.recordFact(factOf({ factId: 'payload-1' }))
  const payload = r.channel.readPayload('payload-shared')
  const readFrame = r.frames.at(-1)
  assert.ok(readFrame && readFrame.type === 'payload-read')
  assert.equal(readFrame.requestId, 'payload-1')

  // A payload reply cannot settle the fact and vice versa.
  assert.equal(r.lease.receive({ v: 1, type: 'payload', id: 'payload-1', requestId: 'payload-1', value: { v: 1 } }), true)
  assert.deepEqual(await payload, { v: 1 })
  assert.equal(r.channel.inspect().pendingFacts, 1)
  assert.equal(r.channel.inspect().pendingPayloads, 0)

  assert.equal(r.lease.receive(receiptReply('payload-1', 3)), true)
  assert.deepEqual(await fact, { factId: 'payload-1', persisted: true, seq: 3 })
})

test('sequential fresh intents for one business command each need their own decision; concurrency is refused', async () => {
  const r = rig()
  const command = answerCommand('command-repeat')

  const first = r.channel.beforeNativeWrite(command)
  const firstIntent = r.frames.at(-1)
  assert.ok(firstIntent && firstIntent.type === 'native-write-intent')
  await assert.rejects(r.channel.beforeNativeWrite(command), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'write_already_pending')
    return true
  })
  assert.equal(r.lease.receive({ v: 1, type: 'write-admission', id: firstIntent.id, allowed: true }), true)
  await first

  const second = r.channel.beforeNativeWrite(command)
  const secondIntent = r.frames.at(-1)
  assert.ok(secondIntent && secondIntent.type === 'native-write-intent')
  assert.notEqual(secondIntent.id, firstIntent.id)
  assert.equal(secondIntent.command.id, command.id)
  assert.equal(r.lease.receive({ v: 1, type: 'write-admission', id: secondIntent.id, allowed: true }), true)
  await second
})

test('saturation refuses before send, and settlement, timeout and rebind all restore capacity', async () => {
  const r = rig({ maxPendingFacts: 1, maxPendingPayloads: 1, maxPendingWrites: 1 })
  const fact = r.channel.recordFact(factOf({ factId: 'fact-sat' }))
  const payload = r.channel.readPayload('payload-sat')
  const intent = r.channel.beforeNativeWrite(answerCommand('command-sat'))
  const frameCount = r.frames.length

  await assert.rejects(r.channel.recordFact(factOf({ factId: 'fact-sat-2' })), (error: unknown) => (error as { reason?: string }).reason === 'pending_facts')
  await assert.rejects(r.channel.readPayload('payload-sat-2'), (error: unknown) => (error as { reason?: string }).reason === 'pending_payloads')
  await assert.rejects(r.channel.beforeNativeWrite(answerCommand('command-sat-2')), (error: unknown) => (error as { reason?: string }).reason === 'pending_writes')
  assert.equal(r.frames.length, frameCount, 'refused requests never reach the transport')

  // Fact settles, write times out, payload rebinds: every kind recovers.
  r.lease.receive(receiptReply('fact-sat', 1))
  await fact
  r.clock.advance(LIMITS.requestTimeoutMs + 1)
  await assert.rejects(intent, (error: unknown) => (error as { code?: string }).code === 'timeout')
  await assert.rejects(payload, (error: unknown) => (error as { code?: string }).code === 'timeout')
  assert.equal(r.channel.inspect().pendingWrites, 0)
  assert.equal(r.channel.inspect().pendingPayloads, 0)

  // A fresh payload can be admitted after the window closed for the old one.
  const recovered = r.channel.readPayload('payload-sat-3')
  const recoveredFrame = r.frames.at(-1)
  assert.ok(recoveredFrame && recoveredFrame.type === 'payload-read')
  r.lease.receive({ v: 1, type: 'payload', id: recoveredFrame.requestId, requestId: recoveredFrame.requestId, value: { recovered: true } })
  assert.deepEqual(await recovered, { recovered: true })

  const again = r.channel.beforeNativeWrite(answerCommand('command-sat-3'))
  const thirdIntent = r.frames.at(-1)
  assert.ok(thirdIntent && thirdIntent.type === 'native-write-intent')
  r.lease.receive({ v: 1, type: 'write-admission', id: thirdIntent.id, allowed: true })
  await again
  assert.equal(r.channel.inspect().pendingWrites, 0)
})

test('rebinding while saturated keeps one queue entry per pending and drops stale generation entries', () => {
  const clock = new ManualClock()
  const attach = new RunnerAttachChannel({ producer: PRODUCER, limits: { ...LIMITS, maxPendingFacts: 4 }, now: clock.now, schedule: clock.schedule })
  attach.bind({ producer: PRODUCER, connectionId: 'a', expectedGeneration: 0 })
  const one = attach.hooks.factSink.record(factOf({ factId: 'fact-r1' }))
  const two = attach.hooks.factSink.record(factOf({ factId: 'fact-r2' }))
  assert.equal(attach.outboundCount, 2)

  for (const generation of [1, 2, 3]) attach.bind({ producer: PRODUCER, connectionId: `b${generation}`, expectedGeneration: generation })
  // Three rebinds must not accumulate duplicate transport entries.
  assert.equal(attach.outboundCount, 2)
  assert.equal(attach.inspect().pendingFacts, 2)

  // The current connection can drain both; each receipt settles exactly one promise.
  assert.equal(attach.receive('b3', receiptReply('fact-r1', 1)).accepted, true)
  assert.equal(attach.receive('b3', receiptReply('fact-r2', 2)).accepted, true)
  assert.equal(attach.outboundCount, 0)
  return Promise.all([one, two]).then(receipts => {
    assert.deepEqual(receipts.map(receipt => receipt.seq), [1, 2])
  })
})
