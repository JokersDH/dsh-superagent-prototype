/**
 * I2 — immutable producer and compare-and-swap binding.
 *
 * Generation 0 is the first binding and returns generation 1. Every later bind compares the full
 * producer tuple and the current generation; a failure changes nothing, and replacement atomically
 * invalidates the previous lease instead of leaving two live receivers.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'
import { CoordinatorChannelError } from '../../src/attach-channel/errors.ts'
import { factOf, LIMITS, makeHarness, PRODUCER, receiptReply } from './fixtures.ts'

function channelWith(producer: typeof PRODUCER = structuredClone(PRODUCER)) {
  return new CoordinatorChannelModule({ producer, limits: LIMITS })
}

test('the first bind consumes generation 0 and returns the generation-1 lease', () => {
  const channel = channelWith()
  assert.deepEqual(channel.inspect(), { state: 'unbound', generation: 0, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0 })
  const lease = channel.bind({ producer: structuredClone(PRODUCER), connectionId: 'conn-1', expectedGeneration: 0, send: () => undefined })
  assert.equal(lease.generation, 1)
  assert.equal(lease.connectionId, 'conn-1')
  assert.equal(channel.inspect().state, 'bound')
  assert.equal(channel.inspect().generation, 1)
})

test('a failed CAS leaves the current lease, pendings and timers untouched', async () => {
  const h = makeHarness()
  const pending = h.channel.recordFact(factOf({ factId: 'fact-cas' }))

  assert.throws(() => h.channel.bind({ producer: PRODUCER, connectionId: 'conn-x', expectedGeneration: 0, send: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'stale_connection')
    assert.equal(error.reason, 'generation_mismatch')
    return true
  })
  assert.equal(h.lease.generation, 1)
  assert.equal(h.channel.inspect().pendingFacts, 1)
  assert.equal(h.clock.armed, 1)

  // The original lease still owns its pending fact.
  assert.equal(h.lease.receive(receiptReply('fact-cas')), true)
  assert.deepEqual(await pending, { factId: 'fact-cas', persisted: true, seq: 1 })
})

test('replacement invalidates the old lease; its receive and close cannot touch the new one', async () => {
  const h = makeHarness()
  const pending = h.channel.recordFact(factOf({ factId: 'fact-move' }))

  const replacementFrames: unknown[] = []
  const replacement = h.channel.bind({
    producer: PRODUCER,
    connectionId: 'conn-2',
    expectedGeneration: 1,
    send: request => {
      replacementFrames.push(request)
    },
  })
  assert.equal(replacement.generation, 2)
  assert.equal(h.channel.inspect().generation, 2)

  // The old socket's reply is fenced out and cannot settle the pending fact on the new lease.
  assert.equal(h.lease.receive(receiptReply('fact-move')), false)
  assert.equal(h.channel.inspect().pendingFacts, 1)

  // Closing the old lease is a no-op for the replacement.
  h.lease.close('socket gone')
  assert.equal(h.channel.inspect().state, 'bound')
  assert.equal(replacement.receive(receiptReply('fact-move')), true)
  assert.deepEqual(await pending, { factId: 'fact-move', persisted: true, seq: 1 })
})

test('producer, connection id and generation inputs are validated before any state changes', () => {
  const h = makeHarness()
  const mismatches: Array<[unknown, string]> = [
    [{ producer: { ...PRODUCER, source: 'foreign' }, connectionId: 'c', expectedGeneration: 1, send: () => undefined }, 'identity_mismatch'],
    [{ producer: { ...PRODUCER, attempt: { ...PRODUCER.attempt, fenceEpoch: 2 } }, connectionId: 'c', expectedGeneration: 1, send: () => undefined }, 'identity_mismatch'],
    [{ producer: { ...PRODUCER, credential: 'private' }, connectionId: 'c', expectedGeneration: 1, send: () => undefined }, 'identity_mismatch'],
    [{ producer: PRODUCER, connectionId: 'bad id with spaces', expectedGeneration: 1, send: () => undefined }, 'protocol_error'],
    [{ producer: PRODUCER, connectionId: 'c', expectedGeneration: -1, send: () => undefined }, 'protocol_error'],
    [{ producer: PRODUCER, connectionId: 'c', expectedGeneration: 1.5, send: () => undefined }, 'protocol_error'],
    [{ producer: PRODUCER, connectionId: 'c', expectedGeneration: Number.MAX_SAFE_INTEGER, send: () => undefined }, 'stale_connection'],
  ]
  for (const [input, code] of mismatches) {
    assert.throws(() => h.channel.bind(input as Parameters<typeof h.channel.bind>[0]), (error: unknown) => {
      assert.ok(error instanceof CoordinatorChannelError)
      assert.equal(error.code, code)
      return true
    })
  }
  assert.equal(h.channel.inspect().generation, 1)
  assert.equal(h.channel.inspect().state, 'bound')
})

test('the constructor copies and freezes the registered producer; later caller mutation has no effect', () => {
  const mutable = structuredClone(PRODUCER)
  const channel = channelWith(mutable)
  mutable.source = 'mutated-after-construction'
  mutable.attempt.attemptId = 'mutated-attempt'

  assert.equal(channel.producer.source, PRODUCER.source)
  assert.equal(channel.producer.attempt.attemptId, PRODUCER.attempt.attemptId)
  assert.ok(Object.isFrozen(channel.producer))
  assert.ok(Object.isFrozen(channel.producer.attempt))
  assert.ok(Object.isFrozen(channel.producer.attempt.contract))

  // Binding with the mutated object is refused because it no longer matches the registration.
  assert.throws(() => channel.bind({ producer: mutable, connectionId: 'conn', expectedGeneration: 0, send: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'identity_mismatch')
    return true
  })
  assert.equal(channel.inspect().state, 'unbound')
})

test('generations are monotonic, never reused, and stop accepting binds after close', () => {
  const channel = channelWith()
  channel.bind({ producer: PRODUCER, connectionId: 'a', expectedGeneration: 0, send: () => undefined })
  channel.bind({ producer: PRODUCER, connectionId: 'b', expectedGeneration: 1, send: () => undefined })
  const third = channel.bind({ producer: PRODUCER, connectionId: 'c', expectedGeneration: 2, send: () => undefined })
  assert.equal(third.generation, 3)

  assert.throws(() => channel.bind({ producer: PRODUCER, connectionId: 'd', expectedGeneration: 1, send: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'generation_mismatch')
    return true
  })

  channel.close()
  assert.equal(channel.inspect().state, 'closed')
  assert.throws(() => channel.bind({ producer: PRODUCER, connectionId: 'e', expectedGeneration: 3, send: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'closed')
    return true
  })
})
