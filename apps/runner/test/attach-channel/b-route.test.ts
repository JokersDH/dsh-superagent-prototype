/**
 * wave-28 I10/I11 — the adapter under the exact `runner-service` route shape.
 *
 * `runner-service` exposes two calls today: `channelNext(producer, leaseId)` and
 * `channelReply(producer, reply, leaseId)`. These cases drive that shape and pin the properties the
 * independent audit found missing in the current B channel: no implicit rebind on poll, explicit CAS
 * bind, and a refusal (not a takeover) for stale or foreign callers.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import type { CoordinatorChannelProducer, CoordinatorChannelReply } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { RunnerAttachChannel } from '../../src/attach-channel/attach.ts'
import { CoordinatorChannelError } from '../../src/attach-channel/errors.ts'
import { CoordinatorDouble } from './coordinator.ts'
import { factOf, LIMITS, ManualClock, PRODUCER } from './fixtures.ts'

/** Mirrors the current runner-service handler signatures exactly. */
function routeFor(attach: RunnerAttachChannel) {
  return {
    // Before: `channel.lease(leaseRef(...)); return { generation, request: nextOutbound() }` — poll
    // was a takeover. Now the poll is read-only and refusals are explicit.
    channelNext: (producer: CoordinatorChannelProducer, leaseId: string) => {
      const result = attach.next(leaseId, producer)
      return result.ok
        ? { generation: result.generation, request: result.request }
        : { generation: result.generation, request: null, refused: result.refused }
    },
    channelReply: (producer: CoordinatorChannelProducer, reply: CoordinatorChannelReply, leaseId: string) => {
      const result = attach.receive(leaseId, reply, producer)
      return { accepted: result.accepted, generation: result.generation }
    },
  }
}

function setup() {
  const clock = new ManualClock()
  const coordinator = new CoordinatorDouble()
  const attach = new RunnerAttachChannel({ producer: PRODUCER, limits: LIMITS, now: clock.now, schedule: clock.schedule })
  return { clock, coordinator, attach, route: routeFor(attach) }
}

const lease = (connectionId: string) => connectionId
const foreign = (): CoordinatorChannelProducer => ({ ...PRODUCER, source: 'foreign-source' })

test('polling before any bind is refused and does not create a lease', () => {
  const s = setup()
  const next = s.route.channelNext(PRODUCER, lease('conn-a'))
  assert.equal(next.request, null)
  assert.equal(next.generation, 0)
  assert.equal('refused' in next ? next.refused : undefined, 'stale_connection')
  assert.equal(s.attach.inspect().state, 'unbound')
})

test('a poll never rebinds: the current generation and lease stay authoritative', async () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  const pending = s.attach.hooks.factSink.record(factOf({ factId: 'fact-poll' }))

  const first = s.route.channelNext(PRODUCER, lease('conn-a'))
  assert.equal(first.generation, 1)
  assert.ok(first.request)
  const second = s.route.channelNext(PRODUCER, lease('conn-a'))
  assert.equal(second.generation, 1, 'polling must not advance the generation')
  assert.deepEqual(second.request, first.request, 'polling returns the same head request')

  // The fact is still resolvable by its original correlation.
  assert.equal(
    s.route.channelReply(PRODUCER, { v: 1, type: 'receipt', id: 'fact-poll', factId: 'fact-poll', receipt: { factId: 'fact-poll', persisted: true, seq: 2 } }, lease('conn-a')).accepted,
    true,
  )
  await pending
})

test('a foreign producer is refused before it can read or answer the current lease', async () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  const pending = s.attach.hooks.factSink.record(factOf({ factId: 'fact-foreign' }))

  const next = s.route.channelNext(foreign(), lease('conn-a'))
  assert.equal(next.request, null)
  assert.equal('refused' in next ? next.refused : undefined, 'identity_mismatch')
  assert.equal(s.attach.inspect().generation, 1, 'a foreign poll must not mutate the binding')

  const reply = s.route.channelReply(foreign(), { v: 1, type: 'receipt', id: 'fact-foreign', factId: 'fact-foreign', receipt: { factId: 'fact-foreign', persisted: true, seq: 1 } }, lease('conn-a'))
  assert.equal(reply.accepted, false)
  assert.equal(s.attach.inspect().pendingFacts, 1, 'a foreign reply cannot settle the pending fact')

  // The legitimate client still resolves it.
  assert.equal(
    s.route.channelReply(PRODUCER, { v: 1, type: 'receipt', id: 'fact-foreign', factId: 'fact-foreign', receipt: { factId: 'fact-foreign', persisted: true, seq: 4 } }, lease('conn-a')).accepted,
    true,
  )
  await pending
})

test('the replaced client cannot reclaim the lease by polling or replying', async () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  const pending = s.attach.hooks.factSink.record(factOf({ factId: 'fact-takeover' }))
  assert.equal(s.route.channelNext(PRODUCER, lease('conn-a')).generation, 1)

  assert.equal(s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-b'), expectedGeneration: 1 }), 2)

  const staleNext = s.route.channelNext(PRODUCER, lease('conn-a'))
  assert.equal(staleNext.request, null)
  assert.equal('refused' in staleNext ? staleNext.refused : undefined, 'stale_connection')
  assert.equal(s.attach.inspect().generation, 2, 'a stale poll must not rebind to generation 3')

  const staleReply = s.route.channelReply(PRODUCER, { v: 1, type: 'receipt', id: 'fact-takeover', factId: 'fact-takeover', receipt: { factId: 'fact-takeover', persisted: true, seq: 1 } }, lease('conn-a'))
  assert.equal(staleReply.accepted, false)
  assert.equal(staleReply.generation, 2)
  assert.equal(s.attach.inspect().pendingFacts, 1)

  // The replacement connection received the retried request and settles it.
  const retry = s.route.channelNext(PRODUCER, lease('conn-b'))
  assert.ok(retry.request && retry.request.type === 'fact')
  assert.equal(retry.request.fact.factId, 'fact-takeover')
  assert.equal(
    s.route.channelReply(PRODUCER, { v: 1, type: 'receipt', id: 'fact-takeover', factId: 'fact-takeover', receipt: { factId: 'fact-takeover', persisted: true, seq: 9 } }, lease('conn-b')).accepted,
    true,
  )
  assert.deepEqual(await pending, { factId: 'fact-takeover', persisted: true, seq: 9 })
})

test('bind is an explicit compare-and-set and never accepts a stale or future generation', () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  assert.throws(() => s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-x'), expectedGeneration: 0 }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'generation_mismatch')
    return true
  })
  assert.throws(() => s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-x'), expectedGeneration: 5 }), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'generation_mismatch')
    return true
  })
  assert.equal(s.attach.inspect().generation, 1)
  // The current lease is untouched by the refused binds.
  assert.equal(s.route.channelNext(PRODUCER, lease('conn-a')).generation, 1)
})

test('the outbound queue holds one entry per pending request across repeated rebinds', () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  s.attach.hooks.factSink.record(factOf({ factId: 'fact-queue' }))
  s.attach.hooks.payloads.read('payload-queue')
  assert.equal(s.attach.outboundCount, 2)

  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-b'), expectedGeneration: 1 })
  assert.equal(s.attach.outboundCount, 2)
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-c'), expectedGeneration: 2 })
  assert.equal(s.attach.outboundCount, 2, 'rebinding must not accumulate duplicate transport entries')

  const head = s.route.channelNext(PRODUCER, lease('conn-c'))
  assert.ok(head.request)
  assert.equal(head.generation, 3)
})

test('native intent through the route keeps the business command and a fresh frame correlation', async () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  const command = makeCommand('answer', { id: 'cmd-route' })
  const pending = s.attach.hooks.beforeNativeWrite(command)

  const intent = s.route.channelNext(PRODUCER, lease('conn-a'))
  assert.ok(intent.request && intent.request.type === 'native-write-intent')
  assert.equal(intent.request.command.id, 'cmd-route')
  assert.deepEqual(intent.request.command, command)
  assert.notEqual(intent.request.id, 'cmd-route')

  const admission = { v: 1 as const, type: 'write-admission' as const, id: intent.request.id, allowed: true }
  assert.equal(s.route.channelReply(PRODUCER, admission, lease('conn-a')).accepted, true)
  await pending

  // Replaying the settled admission over the route is refused.
  assert.equal(s.route.channelReply(PRODUCER, admission, lease('conn-a')).accepted, false)
})

test('the adapter exposes no second pending store: its queue is emptied by settlement', async () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  const pending = s.attach.hooks.beforeNativeWrite(makeCommand('answer', { id: 'cmd-deny-route' }))
  const intent = s.route.channelNext(PRODUCER, lease('conn-a'))
  assert.ok(intent.request)
  s.route.channelReply(PRODUCER, { v: 1, type: 'write-admission', id: intent.request.id, allowed: false }, lease('conn-a'))
  await assert.rejects(pending, () => true)
  // The denied intent settled and left no transport entry behind.
  assert.equal(s.attach.outboundCount, 0)
  assert.equal(s.attach.inspect().pendingWrites, 0)
})

test('the pull route reports the remaining window and never refreshes it', () => {
  const s = setup()
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })
  s.attach.hooks.factSink.record(factOf({ factId: 'fact-window' }))

  const first = s.attach.next('conn-a')
  assert.ok(first.ok && first.request)
  assert.equal(first.expiresAt, LIMITS.requestTimeoutMs)
  assert.equal(first.remainingMs, LIMITS.requestTimeoutMs)

  s.clock.advance(400)
  const second = s.attach.next('conn-a')
  assert.ok(second.ok)
  assert.equal(second.expiresAt, first.expiresAt, 'the deadline is absolute, not extended by polling')
  assert.equal(second.remainingMs, LIMITS.requestTimeoutMs - 400)

  const none = s.attach.next('conn-b')
  assert.equal(none.ok, false)
})

test('a fact id that looks like a payload request id cannot consume the other request', async () => {
  const s = setup()
  s.coordinator.payloads.put('payload-same-id', { value: 'payload-value' })
  s.attach.bind({ producer: PRODUCER, connectionId: lease('conn-a'), expectedGeneration: 0 })

  // The first payload read is correlated as `payload-1`; the fact below deliberately reuses it.
  const fact = s.attach.hooks.factSink.record(factOf({ factId: 'payload-1' }))
  const payload = s.attach.hooks.payloads.read('payload-same-id')
  assert.equal(s.attach.outboundCount, 2, 'both pendings keep their own transport entry')

  // `next` is idempotent: it returns the head until that request is answered.
  const first = s.attach.next('conn-a')
  assert.ok(first.ok && first.request && first.request.type === 'fact')
  assert.equal(first.request.id, 'payload-1')
  const sameHead = s.attach.next('conn-a')
  assert.ok(sameHead.ok && sameHead.request)
  assert.deepEqual(sameHead.request, first.request)

  const factReply = await s.coordinator.handle(first.request)
  assert.ok(factReply)
  assert.equal(s.attach.receive('conn-a', factReply).accepted, true)
  assert.deepEqual(await fact, { factId: 'payload-1', persisted: true, seq: 1 })
  // The same-looking fact id left the payload request untouched and queued.
  assert.equal(s.attach.inspect().pendingPayloads, 1)
  assert.equal(s.attach.outboundCount, 1)

  const second = s.attach.next('conn-a')
  assert.ok(second.ok && second.request && second.request.type === 'payload-read')
  assert.equal(second.request.requestId, 'payload-1')
  const payloadReply = await s.coordinator.handle(second.request)
  assert.ok(payloadReply)
  assert.equal(s.attach.receive('conn-a', payloadReply).accepted, true)
  assert.deepEqual(await payload, { value: 'payload-value' })
  assert.equal(s.attach.outboundCount, 0)
  assert.deepEqual(s.attach.inspect(), {
    state: 'bound', generation: 1, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
})
