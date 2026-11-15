/**
 * I4 — the concrete three-callback module on one controller and one connection.
 *
 * These cases use the ordinary v1 fact / payload-read / native-write-intent frames and a valid
 * original producer. Malformed-schema cases exist, but every negative here is a real stale/source/
 * correlation refusal rather than a substitute for one.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { factOf, LIMITS, makeHarness, payloadReply, PRODUCER, receiptReply } from './fixtures.ts'

test('recordFact sends the original v1 fact frame, resolves its durable receipt and settles once', async () => {
  const h = makeHarness()
  const fact = factOf({ factId: 'fact-1' })
  const pending = h.channel.recordFact(fact)

  assert.deepEqual(h.frames, [{ v: 1, type: 'fact', id: 'fact-1', fact }])
  assert.equal(h.channel.inspect().pendingFacts, 1)

  assert.equal(h.lease.receive(receiptReply('fact-1', 3)), true)
  assert.deepEqual(await pending, { factId: 'fact-1', persisted: true, seq: 3 })
  const settled = h.channel.inspect()
  assert.equal(settled.pendingFacts, 0)
  assert.equal(settled.pendingBytes, 0)
  assert.equal(h.clock.armed, 0)

  // A duplicate receipt for an already settled fact is recognised, not replayed into a new promise.
  assert.equal(h.lease.receive(receiptReply('fact-1', 4)), false)
})

test('a fact the coordinator refuses rejects with a bounded ack-failed reason', async () => {
  const h = makeHarness()
  const pending = h.channel.recordFact(factOf({ factId: 'fact-ack' }))
  assert.equal(h.lease.receive({ v: 1, type: 'ack-failed', id: 'fact-ack', factId: 'fact-ack', reason: 'ingress_unavailable' }), true)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'protocol_error')
    assert.equal(error.reason, 'fact_ack_failed')
    return true
  })
  assert.equal(h.channel.inspect().pendingFacts, 0)
})

test('a fact outside the registered producer is refused before anything is sent', async () => {
  const h = makeHarness()
  await assert.rejects(h.channel.recordFact(factOf({ source: 'foreign-source' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'identity_mismatch')
    return true
  })
  await assert.rejects(h.channel.recordFact(factOf({ fenceEpoch: 2 })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'identity_mismatch')
    return true
  })
  assert.deepEqual(h.frames, [])
})

test('readPayload correlates the original request id and returns the immutable value', async () => {
  const h = makeHarness()
  const pending = h.channel.readPayload('payload-1')
  const request = h.frames[0]
  assert.ok(request && request.type === 'payload-read')
  assert.equal(request.reference, 'payload-1')
  assert.equal(request.id, request.requestId)
  assert.equal(h.channel.inspect().pendingPayloads, 1)

  // A reply to a different request cannot resolve this read.
  assert.equal(h.lease.receive(payloadReply('payload-999', { value: 'wrong' })), false)
  assert.equal(h.channel.inspect().pendingPayloads, 1)

  assert.deepEqual(await (h.lease.receive(payloadReply(request.requestId, { value: 'right', nested: [1, 2] })) && pending), {
    value: 'right',
    nested: [1, 2],
  })
  assert.equal(h.channel.inspect().pendingPayloads, 0)
})

test('readPayload refuses an invalid reference and an oversized reply without keeping the pending', async () => {
  const h = makeHarness({ maxPayloadBytes: 64 })
  await assert.rejects(h.channel.readPayload('not a valid reference'), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'protocol_error')
    return true
  })

  const pending = h.channel.readPayload('payload-big')
  const request = h.frames.at(-1)
  assert.ok(request && request.type === 'payload-read')
  assert.equal(h.lease.receive(payloadReply(request.requestId, { blob: 'x'.repeat(256) })), true)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'capacity')
    assert.equal(error.reason, 'payload_bytes')
    return true
  })
  assert.equal(h.channel.inspect().pendingPayloads, 0)
})

test('beforeNativeWrite asks for a fresh decision on every intent and never caches an allowed one', async () => {
  const h = makeHarness()
  const first = h.channel.beforeNativeWrite(makeCommand('answer', { id: 'cmd-1' }))
  assert.deepEqual(h.frames.at(-1), { v: 1, type: 'native-write-intent', id: 'cmd-1', command: makeCommand('answer', { id: 'cmd-1' }) })
  assert.equal(h.lease.receive({ v: 1, type: 'write-admission', id: 'cmd-1', allowed: true }), true)
  await first

  const second = h.channel.beforeNativeWrite(makeCommand('answer', { id: 'cmd-2' }))
  assert.equal(h.lease.receive({ v: 1, type: 'write-admission', id: 'cmd-2', allowed: true }), true)
  await second

  // Same command id, same text: a new intent still has to reach the current guard.
  const third = h.channel.beforeNativeWrite(makeCommand('answer', { id: 'cmd-1' }))
  assert.equal(h.frames.filter(frame => frame.type === 'native-write-intent').length, 3)
  assert.equal(h.lease.receive({ v: 1, type: 'write-admission', id: 'cmd-1', allowed: true }), true)
  await third
})

test('a refused admission is an authoritative denial, not a timeout or a silent success', async () => {
  const h = makeHarness()
  const pending = h.channel.beforeNativeWrite(makeCommand('answer', { id: 'cmd-deny' }))
  assert.equal(h.lease.receive({ v: 1, type: 'write-admission', id: 'cmd-deny', allowed: false }), true)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof NativeWriteDenied)
    assert.equal(error.commandId, 'cmd-deny')
    return true
  })
  assert.equal(h.channel.inspect().pendingWrites, 0)
})

test('native intent for a non-answer command or a foreign attempt never reaches the send path', async () => {
  const h = makeHarness()
  await assert.rejects(h.channel.beforeNativeWrite(makeCommand('begin', { id: 'cmd-begin' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'protocol_error')
    return true
  })
  await assert.rejects(h.channel.beforeNativeWrite(makeCommand('answer', { id: 'cmd-foreign', attemptId: 'other' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'identity_mismatch')
    return true
  })
  assert.deepEqual(h.frames, [])
})

test('unsupported frames, request frames and unknown correlation ids never settle a pending operation', async () => {
  const h = makeHarness()
  const pending = h.channel.readPayload('payload-2')
  const request = h.frames.at(-1)
  assert.ok(request && request.type === 'payload-read')

  assert.equal(h.lease.receive(request), false)
  assert.equal(h.lease.receive({ v: 2, type: 'payload', id: request.requestId, requestId: request.requestId, value: 1 }), false)
  assert.equal(h.lease.receive({ v: 1, type: 'payload', id: request.requestId, requestId: 'other', value: 1 }), false)
  assert.equal(h.lease.receive({ v: 1, type: 'progress', id: 'p', text: 'x', observedAt: '2026-11-14T00:00:00Z' }), false)
  assert.equal(h.channel.inspect().pendingPayloads, 1)

  assert.equal(h.lease.receive(payloadReply(request.requestId, null)), true)
  assert.equal(await pending, null)
})

test('an unbound controller refuses work instead of buffering it forever', async () => {
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits: LIMITS })
  assert.equal(channel.inspect().state, 'unbound')
  await assert.rejects(channel.recordFact(factOf()), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'stale_connection')
    assert.equal(error.reason, 'not_bound')
    return true
  })
  assert.equal(channel.inspect().pendingFacts, 0)
})

test('the concrete module satisfies the shared CoordinatorChannel interface', () => {
  const h = makeHarness()
  const asInterface: import('../../../../packages/contracts/src/coordinator-channel.ts').CoordinatorChannel = h.channel
  assert.equal(asInterface.inspect().state, 'bound')
  asInterface.close()
  assert.equal(asInterface.inspect().state, 'closed')
})
