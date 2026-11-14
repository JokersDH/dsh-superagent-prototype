/**
 * I16 — fourth result: bounded fault, capacity, late-reply and close matrix.
 *
 * Every case drives the public interface only (plus the adapter's connection routing). Time is
 * injected, so there is no sleep and no polling; each assertion is a finite, deterministic outcome.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import type { CoordinatorChannelRequest } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'
import { CoordinatorChannelError } from '../../src/attach-channel/errors.ts'
import { factOf, LIMITS, makeHarness, payloadReply, PRODUCER, receiptReply } from './fixtures.ts'

function channel(overrides: Partial<typeof LIMITS> = {}, sendBehaviour?: (request: CoordinatorChannelRequest) => void | Promise<void>) {
  const clock = new (class {
    time = 0
    armed = 0
    now = () => this.time
  })()
  const timers = new Map<number, { at: number; callback: () => void }>()
  let seq = 0
  const schedule = (delayMs: number, callback: () => void) => {
    const id = ++seq
    timers.set(id, { at: clock.time + delayMs, callback })
    clock.armed = timers.size
    return () => {
      timers.delete(id)
      clock.armed = timers.size
    }
  }
  const advance = (ms: number) => {
    clock.time += ms
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock.time).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!due) return
      timers.delete(due[0])
      clock.armed = timers.size
      due[1].callback()
    }
  }
  const frames: CoordinatorChannelRequest[] = []
  const instance = new CoordinatorChannelModule({ producer: PRODUCER, limits: { ...LIMITS, ...overrides }, now: clock.now, schedule })
  const lease = instance.bind({
    producer: PRODUCER,
    connectionId: 'conn-1',
    expectedGeneration: 0,
    send: request => {
      frames.push(request)
      return sendBehaviour?.(request)
    },
  })
  return { instance, lease, frames, advance, clock }
}

test('timeout settles exactly once, releases the timer and does not claim success', async () => {
  const h = channel()
  const pending = h.instance.recordFact(factOf({ factId: 'fact-timeout' }))
  assert.equal(h.clock.armed, 1)
  h.advance(1001)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'timeout')
    return true
  })
  assert.equal(h.clock.armed, 0)
  assert.deepEqual(h.instance.inspect(), {
    state: 'bound', generation: 1, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
  // A receipt that arrives after the timeout cannot revive the settled promise.
  assert.equal(h.lease.receive(receiptReply('fact-timeout')), false)
})

test('a synchronous send failure rejects without leaking a pending operation or timer', async () => {
  const h = channel({}, () => {
    throw new Error('transport closed')
  })
  await assert.rejects(h.instance.readPayload('payload-sync'), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'stale_connection')
    assert.equal(error.reason, 'send_failed')
    return true
  })
  assert.equal(h.clock.armed, 0)
  assert.equal(h.instance.inspect().pendingPayloads, 0)
})

test('an asynchronously rejected send is stale for data requests but indeterminate for a native intent', async () => {
  const h = channel({}, () => Promise.reject(new Error('socket broke')))
  const fact = h.instance.recordFact(factOf({ factId: 'fact-async' }))
  const write = h.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-async' }))
  await assert.rejects(fact, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'stale_connection')
    return true
  })
  await assert.rejects(write, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    assert.equal(error.reason, 'write_intent_send_failed')
    return true
  })
  assert.equal(h.clock.armed, 0)
})

test('a synchronous reply inside send settles once and a later duplicate is refused', async () => {
  let leaseRef: { receive: (reply: unknown) => boolean } | undefined
  const h = channel({}, request => {
    if (request.type === 'fact') leaseRef?.receive(receiptReply(request.id))
  })
  leaseRef = h.lease
  const receipt = await h.instance.recordFact(factOf({ factId: 'fact-sync' }))
  assert.deepEqual(receipt, { factId: 'fact-sync', persisted: true, seq: 1 })
  assert.equal(h.instance.inspect().pendingFacts, 0)
  assert.equal(h.lease.receive(receiptReply('fact-sync')), false)
})

test('reply and timeout race: whichever settles first wins and the other has no effect', async () => {
  const h = channel()
  const resolved = h.instance.recordFact(factOf({ factId: 'fact-race' }))
  assert.equal(h.lease.receive(receiptReply('fact-race')), true)
  assert.deepEqual(await resolved, { factId: 'fact-race', persisted: true, seq: 1 })
  h.advance(5000)
  assert.equal(h.instance.inspect().pendingFacts, 0)
  assert.equal(h.clock.armed, 0)
})

test('close before reply wins: late receipts and late timers have no side effect', async () => {
  const h = channel()
  const pending = h.instance.recordFact(factOf({ factId: 'fact-close' }))
  h.instance.close('attempt closed')
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'closed')
    return true
  })
  assert.equal(h.instance.inspect().state, 'closed')
  assert.equal(h.clock.armed, 0)
  assert.equal(h.lease.receive(receiptReply('fact-close')), false)
  h.advance(5000)
  assert.equal(h.instance.inspect().pendingFacts, 0)
})

test('closing a pending native write while the lease drops reports indeterminate, not closed or denied', async () => {
  const h = channel()
  const pending = h.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-drop' }))
  h.lease.close('socket gone')
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    return true
  })
  assert.equal(h.instance.inspect().state, 'unbound')
  // A stale allowed reply cannot be delivered afterwards.
  assert.equal(h.lease.receive({ v: 1, type: 'write-admission', id: 'cmd-drop', allowed: true }), false)
})

test('module close reports indeterminate for a pending write because native may already be in flight', async () => {
  const h = channel()
  const pending = h.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-close' }))
  h.instance.close()
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    assert.equal(error.reason, 'module_closed_during_write')
    return true
  })
})

test('capacity refuses before send and recovers after settlement', async () => {
  const h = channel({ maxPendingFacts: 1 })
  const first = h.instance.recordFact(factOf({ factId: 'fact-cap-1' }))
  assert.equal(h.frames.length, 1)
  await assert.rejects(h.instance.recordFact(factOf({ factId: 'fact-cap-2' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'capacity')
    assert.equal(error.reason, 'pending_facts')
    return true
  })
  assert.equal(h.frames.length, 1, 'a refused request must not reach the transport')

  assert.equal(h.lease.receive(receiptReply('fact-cap-1')), true)
  await first
  const third = h.instance.recordFact(factOf({ factId: 'fact-cap-3' }))
  assert.equal(h.frames.length, 2)
  assert.equal(h.lease.receive(receiptReply('fact-cap-3')), true)
  await third
})

test('payload, write and total byte bounds each refuse on their own account', async () => {
  const payloads = channel({ maxPendingPayloads: 1 })
  payloads.instance.readPayload('payload-a')
  await assert.rejects(payloads.instance.readPayload('payload-b'), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'pending_payloads')
    return true
  })

  const writes = channel({ maxPendingWrites: 1 })
  writes.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-a' }))
  await assert.rejects(writes.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-b' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'pending_writes')
    return true
  })

  // A single original fact frame is already larger than this total byte ceiling.
  const bytes = channel({ maxPendingBytes: 200 })
  await assert.rejects(bytes.instance.recordFact(factOf({ factId: 'fact-bytes' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'capacity')
    assert.equal(error.reason, 'pending_bytes')
    return true
  })
  assert.equal(bytes.frames.length, 0)
})

test('a duplicate concurrent correlation id is refused rather than silently coalesced', async () => {
  const h = channel()
  h.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-dup' }))
  await assert.rejects(h.instance.beforeNativeWrite(makeCommand('answer', { id: 'cmd-dup' })), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'write_already_pending')
    return true
  })
  const fact = factOf({ factId: 'fact-dup' })
  h.instance.recordFact(fact)
  await assert.rejects(h.instance.recordFact(fact), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'fact_already_pending')
    return true
  })
})

test('an unlimited tenant cannot be created through an invalid limits object', () => {
  assert.throws(() => new CoordinatorChannelModule({
    producer: PRODUCER,
    limits: { ...LIMITS, requestTimeoutMs: Number.POSITIVE_INFINITY },
  }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'limits_invalid')
    return true
  })
})

test('error text never carries payload values, absolute paths or private material', async () => {
  const h = makeHarness()
  const sentinel = '/Users/private/secret-value-42'
  const pending = h.channel.recordFact(factOf({ factId: 'fact-secret', payloadRef: 'payload-secret' }))
  h.lease.receive({ v: 1, type: 'ack-failed', id: 'fact-secret', factId: 'fact-secret', reason: 'conflict' })
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.ok(!error.message.includes(sentinel))
    assert.ok(!error.message.includes('payload-secret'))
    assert.ok(error.message.length < 200)
    assert.ok(!error.stack?.includes(sentinel))
    return true
  })
  const oversized = h.channel.readPayload('payload-big')
  const request = h.frames.at(-1)
  assert.ok(request && request.type === 'payload-read')
  h.lease.receive(payloadReply(request.requestId, { secret: sentinel, blob: 'y'.repeat(64 * 1024) }))
  await assert.rejects(oversized, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.ok(!error.message.includes(sentinel))
    return true
  })
})

test('a rejected request is never half-registered: inspect stays consistent across every refusal', async () => {
  const h = makeHarness({ maxPendingFacts: 2 })
  await assert.rejects(h.channel.recordFact(factOf({ source: 'foreign' })))
  await assert.rejects(h.channel.beforeNativeWrite(makeCommand('begin', { id: 'cmd-x' })))
  assert.deepEqual(h.channel.inspect(), {
    state: 'bound', generation: 1, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
  assert.equal(h.clock.armed, 0)
})
