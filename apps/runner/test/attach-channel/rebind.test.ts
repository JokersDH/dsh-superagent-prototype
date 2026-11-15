/**
 * wave-27 I8 / wave-28 I8 — second result: one controller, two authenticated clients.
 *
 * Exercises the production pull adapter exactly as `runner-service` would: the route asks for the
 * next outstanding request, the coordinator answers, and the reply is routed back to the lease of the
 * connection that produced it. Nothing outside the module owns a pending map, timer or generation.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import type { CoordinatorChannelRequest } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { RunnerAttachChannel } from '../../src/attach-channel/attach.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { CoordinatorDouble } from './coordinator.ts'
import { factOf, LIMITS, ManualClock, PRODUCER } from './fixtures.ts'

function setup() {
  const clock = new ManualClock()
  const coordinator = new CoordinatorDouble()
  const attach = new RunnerAttachChannel({
    producer: PRODUCER,
    limits: LIMITS,
    now: clock.now,
    schedule: clock.schedule,
  })
  const generationA = attach.bind({ producer: PRODUCER, connectionId: 'conn-a', expectedGeneration: 0 })

  const next = (connectionId: string): CoordinatorChannelRequest => {
    const result = attach.next(connectionId)
    assert.ok(result.ok, `next refused: ${result.ok ? '' : result.refused}`)
    assert.ok(result.request, `no outstanding request for ${connectionId}`)
    return result.request
  }

  const deliver = async (connectionId: string, request: CoordinatorChannelRequest): Promise<boolean> => {
    const reply = await coordinator.handle(request)
    return reply ? attach.receive(connectionId, reply).accepted : false
  }

  const rebind = (connectionId: string): number =>
    attach.bind({ producer: PRODUCER, connectionId, expectedGeneration: attach.inspect().generation })

  return { clock, coordinator, attach, next, deliver, rebind, generationA }
}

test('a pending fact survives the A→B move and settles from the replacement connection only', async () => {
  const s = setup()
  assert.equal(s.generationA, 1)
  const fact = factOf({ factId: 'fact-rebind' })
  const pending = s.attach.hooks.factSink.record(fact)
  const first = s.next('conn-a')
  assert.ok(first.type === 'fact')

  assert.equal(s.rebind('conn-b'), 2)
  const retry = s.next('conn-b')
  assert.ok(retry.type === 'fact')
  assert.equal(retry.fact.factId, 'fact-rebind')
  assert.deepEqual(retry.fact, fact)

  // The old connection can no longer answer for this pending fact.
  assert.equal(await s.deliver('conn-a', retry), false)
  assert.equal(await s.deliver('conn-b', retry), true)
  assert.deepEqual(await pending, { factId: 'fact-rebind', persisted: true, seq: 1 })

  // A's idempotency makes the resend legal: the double replays the same receipt.
  assert.deepEqual(s.coordinator.sink.calls, ['fact-rebind', 'fact-rebind'])
  assert.equal(s.coordinator.sink.receipts.get('fact-rebind')?.seq, 1)
})

test('a conflicting body for an already acknowledged fact id is refused, not silently accepted', async () => {
  const s = setup()
  const first = s.attach.hooks.factSink.record(factOf({ factId: 'fact-conflict', payloadRef: 'payload-1' }))
  assert.equal(await s.deliver('conn-a', s.next('conn-a')), true)
  await first

  const second = s.attach.hooks.factSink.record(factOf({ factId: 'fact-conflict', payloadRef: 'payload-2' }))
  assert.equal(await s.deliver('conn-a', s.next('conn-a')), true)
  await assert.rejects(second, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'protocol_error')
    assert.equal(error.reason, 'fact_ack_failed')
    return true
  })
})

test('a pending payload read re-reads the same immutable reference on the replacement connection', async () => {
  const s = setup()
  s.coordinator.payloads.put('payload-ref', { value: 'immutable', nested: { a: 1 } })
  const pending = s.attach.hooks.payloads.read('payload-ref')
  const first = s.next('conn-a')
  assert.ok(first.type === 'payload-read')

  s.rebind('conn-b')
  const retry = s.next('conn-b')
  assert.ok(retry.type === 'payload-read')
  assert.equal(retry.reference, 'payload-ref')
  assert.equal(retry.requestId, first.requestId)

  assert.equal(await s.deliver('conn-a', retry), false)
  assert.equal(await s.deliver('conn-b', retry), true)
  assert.deepEqual(await pending, { value: 'immutable', nested: { a: 1 } })
  assert.deepEqual(s.coordinator.payloads.reads, ['payload-ref', 'payload-ref'])
})

test('a pending native write does not migrate: it becomes indeterminate and needs a fresh intent', async () => {
  const s = setup()
  const command = makeCommand('answer', { id: 'cmd-rebind' })
  const pending = s.attach.hooks.beforeNativeWrite(command)
  const intentA = s.next('conn-a')
  assert.ok(intentA.type === 'native-write-intent')

  s.rebind('conn-b')
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    assert.equal(error.reason, 'connection_replaced_during_write')
    return true
  })
  assert.deepEqual(s.coordinator.guard.decisions, [])

  // Neither connection may replay that old decision, and the old intent is not requeued.
  const stale = { v: 1 as const, type: 'write-admission' as const, id: intentA.id, allowed: true }
  assert.equal(s.attach.receive('conn-a', stale).accepted, false)
  assert.equal(s.attach.receive('conn-b', stale).accepted, false)
  assert.equal(s.attach.outboundCount, 0)

  // A fresh intent for the same original command reaches the current guard exactly once.
  const fresh = s.attach.hooks.beforeNativeWrite(command)
  const intentB = s.next('conn-b')
  assert.ok(intentB.type === 'native-write-intent')
  assert.notEqual(intentB.id, intentA.id)
  assert.equal(intentB.command.id, 'cmd-rebind')
  assert.equal(await s.deliver('conn-b', intentB), true)
  await fresh
  assert.deepEqual(s.coordinator.guard.decisions, [{ commandId: 'cmd-rebind', allowed: true }])
})

test('a denial from the current guard rejects the fresh intent and grants nothing reusable', async () => {
  const s = setup()
  s.coordinator.guard.decide = () => false
  const pending = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-deny' }))
  assert.equal(await s.deliver('conn-a', s.next('conn-a')), true)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof NativeWriteDenied)
    return true
  })

  s.coordinator.guard.decide = () => true
  const again = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-deny' }))
  assert.equal(await s.deliver('conn-a', s.next('conn-a')), true)
  await again
  assert.equal(s.coordinator.guard.decisions.length, 2)
})

test('a rebind keeps the original deadline instead of refreshing it', async () => {
  const s = setup()
  const pending = s.attach.hooks.factSink.record(factOf({ factId: 'fact-deadline' }))
  s.next('conn-a')
  s.clock.advance(600)
  s.rebind('conn-b')
  assert.equal(s.clock.armed, 1)

  s.clock.advance(401)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'timeout')
    return true
  })
  assert.equal(s.clock.armed, 0)
  assert.equal(s.attach.inspect().pendingFacts, 0)
  assert.equal(s.attach.outboundCount, 0, 'a settled request leaves no queued transport entry')
})

test('second result: all three callbacks cross the same controller from client A to client B', async () => {
  const s = setup()
  s.coordinator.payloads.put('payload-shared', { ok: true })

  const fact = s.attach.hooks.factSink.record(factOf({ factId: 'fact-all' }))
  const payload = s.attach.hooks.payloads.read('payload-shared')
  const write = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-all' }))

  const before = s.attach.inspect()
  assert.deepEqual([before.pendingFacts, before.pendingPayloads, before.pendingWrites], [1, 1, 1])
  assert.equal(s.clock.armed, 3)
  assert.equal(s.attach.outboundCount, 3, 'one queued request per pending, no duplicate owner')

  s.rebind('conn-b')
  await assert.rejects(write, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    return true
  })
  // Only the two data callbacks were requeued for the new connection.
  assert.equal(s.attach.outboundCount, 2)
  assert.deepEqual([s.attach.inspect().pendingFacts, s.attach.inspect().pendingPayloads, s.attach.inspect().pendingWrites], [1, 1, 0])

  assert.equal(await s.deliver('conn-b', s.next('conn-b')), true)
  assert.equal(await s.deliver('conn-b', s.next('conn-b')), true)
  assert.deepEqual(await fact, { factId: 'fact-all', persisted: true, seq: 1 })
  assert.deepEqual(await payload, { ok: true })
  assert.deepEqual(s.attach.inspect(), {
    state: 'bound', generation: 2, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
  assert.equal(s.attach.outboundCount, 0)
})
