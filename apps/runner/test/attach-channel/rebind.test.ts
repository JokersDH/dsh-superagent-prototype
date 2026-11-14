/**
 * I8 — second result: one controller, two authenticated clients.
 *
 * The same `CoordinatorChannelModule` starts on client A and continues on client B. Facts re-send
 * their original id/body for A's durable ACK, payload reads re-read the same immutable reference,
 * and a pending native write becomes indeterminate rather than migrating its old permission.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { RunnerAttachChannel } from './adapter.ts'
import { CoordinatorDouble } from './coordinator.ts'
import { factOf, LIMITS, ManualClock, PRODUCER } from './fixtures.ts'

function setup() {
  const clock = new ManualClock()
  const coordinator = new CoordinatorDouble()
  let connection = 'conn-a'
  const attach = new RunnerAttachChannel({
    producer: PRODUCER,
    limits: LIMITS,
    now: clock.now,
    schedule: clock.schedule,
  })
  const generationA = attach.bind({ connectionId: connection, expectedGeneration: 0, transport: { send: coordinator.transport } })

  const deliver = async (connectionId: string, request = coordinator.received.at(-1)): Promise<boolean> => {
    assert.ok(request)
    const reply = await coordinator.handle(request)
    return reply ? attach.accept(connectionId, reply) : false
  }

  const rebind = (connectionId: string): number => {
    const generation = attach.bind({ connectionId, expectedGeneration: attach.inspect().generation, transport: { send: coordinator.transport } })
    connection = connectionId
    return generation
  }

  return { clock, coordinator, attach, deliver, rebind, generationA, get connection() { return connection } }
}

test('a pending fact survives the A→B move and settles from the replacement connection only', async () => {
  const s = setup()
  assert.equal(s.generationA, 1)
  const fact = factOf({ factId: 'fact-rebind' })
  const pending = s.attach.hooks.factSink.record(fact)
  assert.equal(s.coordinator.received.length, 1)

  const generationB = s.rebind('conn-b')
  assert.equal(generationB, 2)
  // The retry is the original frame: same fact id and same body, not a new fact.
  const retry = s.coordinator.received.at(-1)
  assert.ok(retry && retry.type === 'fact')
  assert.equal(retry.fact.factId, 'fact-rebind')
  assert.deepEqual(retry.fact, fact)

  // The old connection can no longer answer for this pending fact.
  assert.equal(await s.deliver('conn-a', retry), false)
  assert.equal(await s.deliver('conn-b', retry), true)
  assert.deepEqual(await pending, { factId: 'fact-rebind', persisted: true, seq: 1 })

  // A's idempotency is what makes the resend legal: the double replays the same receipt.
  assert.deepEqual(s.coordinator.sink.calls, ['fact-rebind', 'fact-rebind'])
  assert.equal(s.coordinator.sink.receipts.get('fact-rebind')?.seq, 1)
})

test('a conflicting body for an already acknowledged fact id is refused, not silently accepted', async () => {
  const s = setup()
  const first = s.attach.hooks.factSink.record(factOf({ factId: 'fact-conflict', payloadRef: 'payload-1' }))
  assert.equal(await s.deliver(s.connection), true)
  await first

  const second = s.attach.hooks.factSink.record(factOf({ factId: 'fact-conflict', payloadRef: 'payload-2' }))
  assert.equal(await s.deliver(s.connection), true)
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
  const first = s.coordinator.received.at(-1)
  assert.ok(first && first.type === 'payload-read')

  s.rebind('conn-b')
  const retry = s.coordinator.received.at(-1)
  assert.ok(retry && retry.type === 'payload-read')
  assert.equal(retry.reference, 'payload-ref')
  // Same correlation id: the caller's pending promise is not re-keyed by the rebind.
  assert.equal(retry.requestId, first.requestId)

  assert.equal(await s.deliver('conn-a', retry), false)
  assert.equal(await s.deliver('conn-b', retry), true)
  assert.deepEqual(await pending, { value: 'immutable', nested: { a: 1 } })
  // The same immutable reference was read again for the replacement connection.
  assert.deepEqual(s.coordinator.payloads.reads, ['payload-ref', 'payload-ref'])
})

test('a pending native write does not migrate: it becomes indeterminate and needs a fresh intent', async () => {
  const s = setup()
  const command = makeCommand('answer', { id: 'cmd-rebind' })
  const pending = s.attach.hooks.beforeNativeWrite(command)
  const intentA = s.coordinator.received.at(-1)
  assert.ok(intentA && intentA.type === 'native-write-intent')

  s.rebind('conn-b')
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    assert.equal(error.reason, 'connection_replaced_during_write')
    return true
  })
  // No guard decision was ever taken for the abandoned intent.
  assert.deepEqual(s.coordinator.guard.decisions, [])

  // Neither the old nor the new connection may now deliver that old permission. The reply is
  // constructed directly so the guard is not consulted for an abandoned intent.
  const stale = { v: 1 as const, type: 'write-admission' as const, id: 'cmd-rebind', allowed: true }
  assert.equal(s.attach.accept('conn-a', stale), false)
  assert.equal(s.attach.accept('conn-b', stale), false)

  // A fresh intent for the same original command reaches the current guard exactly once.
  const fresh = s.attach.hooks.beforeNativeWrite(command)
  assert.equal(await s.deliver('conn-b'), true)
  await fresh
  assert.deepEqual(s.coordinator.guard.decisions, [{ commandId: 'cmd-rebind', allowed: true }])
})

test('a denial from the current guard rejects the fresh intent and grants nothing reusable', async () => {
  const s = setup()
  s.coordinator.guard.decide = () => false
  const pending = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-deny' }))
  assert.equal(await s.deliver(s.connection), true)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof NativeWriteDenied)
    return true
  })

  s.coordinator.guard.decide = () => true
  const again = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-deny' }))
  assert.equal(await s.deliver(s.connection), true)
  await again
  assert.equal(s.coordinator.guard.decisions.length, 2)
})

test('a rebind keeps the original deadline instead of refreshing it', async () => {
  const s = setup()
  const pending = s.attach.hooks.factSink.record(factOf({ factId: 'fact-deadline' }))
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
})

test('second result: all three callbacks cross the same controller from client A to client B', async () => {
  const s = setup()
  s.coordinator.payloads.put('payload-shared', { ok: true })

  const fact = s.attach.hooks.factSink.record(factOf({ factId: 'fact-all' }))
  const payload = s.attach.hooks.payloads.read('payload-shared')
  const write = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-all' }))

  // Three pendings, one owner, one timer each — no per-callback maps outside the module.
  const before = s.attach.inspect()
  assert.deepEqual([before.pendingFacts, before.pendingPayloads, before.pendingWrites], [1, 1, 1])
  assert.equal(s.clock.armed, 3)

  s.rebind('conn-b')

  // The write is the only one that cannot continue; the data callbacks retried on B.
  await assert.rejects(write, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    return true
  })
  const afterRebind = s.attach.inspect()
  assert.deepEqual([afterRebind.pendingFacts, afterRebind.pendingPayloads, afterRebind.pendingWrites], [1, 1, 0])

  const requests = s.coordinator.received
  for (const request of requests.slice(-2)) assert.equal(await s.deliver('conn-b', request), true)
  assert.deepEqual(await fact, { factId: 'fact-all', persisted: true, seq: 1 })
  assert.deepEqual(await payload, { ok: true })
  assert.deepEqual(s.attach.inspect(), {
    state: 'bound', generation: 2, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
})
