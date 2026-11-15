/**
 * wave-30 I1 — one transport owner per callback.
 *
 * The audit found B's pump mirroring a remote lease's request onto the old stdio writer. The module's
 * contract is what makes the correct routing expressible: `next`/`receive` are addressed to one
 * connection, a replaced connection is refused without mutation, and a request is queued once. These
 * cases pin that contract on the shipped adapter so B's transport fix has a stable target.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CoordinatorChannelRequest } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { RunnerAttachChannel } from '../../src/attach-channel/attach.ts'
import { answerCommand, factOf, LIMITS, ManualClock, PRODUCER } from './fixtures.ts'

function harness() {
  const clock = new ManualClock()
  const attach = new RunnerAttachChannel({ producer: PRODUCER, limits: LIMITS, now: clock.now, schedule: clock.schedule })
  return { clock, attach }
}

test('after a remote takeover the old stdio connection can neither poll nor answer', async () => {
  const h = harness()
  const stdio = 'stdio-4242'
  h.attach.bind({ producer: PRODUCER, connectionId: stdio, expectedGeneration: 0 })
  const pending = h.attach.hooks.factSink.record(factOf({ factId: 'fact-owner' }))

  // Remote lease takes over with the current generation.
  const remote = 'remote-lease-1'
  assert.equal(h.attach.bind({ producer: PRODUCER, connectionId: remote, expectedGeneration: 1 }), 2)

  // The request is addressable only through the remote connection: the stdio lane is refused, so a
  // correct pump cannot write it to stdout.
  const stdioNext = h.attach.next(stdio)
  assert.equal(stdioNext.ok, false)
  assert.equal(stdioNext.ok ? '' : stdioNext.refused, 'stale_connection')
  const remoteNext = h.attach.next(remote)
  assert.ok(remoteNext.ok && remoteNext.request && remoteNext.request.type === 'fact')
  assert.equal(remoteNext.request.fact.factId, 'fact-owner')

  // Only the remote connection may settle it.
  const receipt = { v: 1 as const, type: 'receipt' as const, id: 'fact-owner', factId: 'fact-owner', receipt: { factId: 'fact-owner', persisted: true, seq: 4 } }
  assert.equal(h.attach.receive(stdio, receipt).accepted, false)
  assert.equal(h.attach.receive(remote, receipt).accepted, true)
  await pending
})

test('a request is exposed exactly once, on its own connection, and never duplicated by polling', async () => {
  const h = harness()
  const remote = 'remote-lease-2'
  h.attach.bind({ producer: PRODUCER, connectionId: remote, expectedGeneration: 0 })
  h.attach.hooks.factSink.record(factOf({ factId: 'fact-once' }))
  h.attach.hooks.beforeNativeWrite(answerCommand('command-once'))
  assert.equal(h.attach.outboundCount, 2)

  // Repeated polls return the same head: reading is not a delivery that can be double-written.
  const first = h.attach.next(remote)
  const second = h.attach.next(remote)
  assert.ok(first.ok && first.request)
  assert.ok(second.ok && second.request)
  assert.deepEqual(second.request, first.request)
  assert.equal(h.attach.outboundCount, 2)

  // Answering the head advances the queue by exactly one.
  const factReply = { v: 1 as const, type: 'receipt' as const, id: 'fact-once', factId: 'fact-once', receipt: { factId: 'fact-once', persisted: true, seq: 1 } }
  assert.equal(h.attach.receive(remote, factReply).accepted, true)
  assert.equal(h.attach.outboundCount, 1)
  const nextPage = h.attach.next(remote)
  assert.ok(nextPage.ok && nextPage.request && nextPage.request.type === 'native-write-intent')
})

test('the sink lane and a remote lane cannot both settle the same request', async () => {
  const h = harness()
  const sink = 'sink'
  h.attach.bind({ producer: PRODUCER, connectionId: sink, expectedGeneration: 0 })
  const pending = h.attach.hooks.beforeNativeWrite(answerCommand('command-cross-lane'))
  const sinkPage = h.attach.next(sink)
  assert.ok(sinkPage.ok && sinkPage.request && sinkPage.request.type === 'native-write-intent')
  const intentId = sinkPage.request.id

  const remote = 'remote-lease-3'
  h.attach.bind({ producer: PRODUCER, connectionId: remote, expectedGeneration: 1 })
  await assert.rejects(pending, (error: unknown) => (error as { code?: string }).code === 'indeterminate')
  // The takeover rejected the pending write, so nobody can settle the stale intent afterwards.
  assert.equal(h.attach.receive(remote, { v: 1, type: 'write-admission', id: intentId, allowed: true }).accepted, false)
  assert.equal(h.attach.receive(sink, { v: 1, type: 'write-admission', id: intentId, allowed: true }).accepted, false)
})

test('a foreign producer is refused on every lane without changing ownership', () => {
  const h = harness()
  const stdio = 'stdio-9'
  h.attach.bind({ producer: PRODUCER, connectionId: stdio, expectedGeneration: 0 })
  const foreign = { ...PRODUCER, source: 'foreign' }
  const next = h.attach.next(stdio, foreign)
  assert.equal(next.ok, false)
  assert.equal(next.ok ? '' : next.refused, 'identity_mismatch')
  const reply = h.attach.receive(stdio, { v: 1, type: 'receipt', id: 'x', factId: 'x', receipt: { factId: 'x', persisted: true, seq: 1 } }, foreign)
  assert.equal(reply.accepted, false)
  assert.equal(reply.refused, 'identity_mismatch')
  assert.equal(h.attach.inspect().generation, 1)
})

test('a pump that respects the connection id never writes a remote request to the stdio writer', async () => {
  // Mirrors the corrected B loop: only the stdio connection may reach write(frame).
  const h = harness()
  const stdio = 'stdio-777'
  h.attach.bind({ producer: PRODUCER, connectionId: stdio, expectedGeneration: 0 })
  const stdioFrames: CoordinatorChannelRequest[] = []
  const pumpStdio = (): void => {
    const page = h.attach.next(stdio)
    if (page.ok && page.request) stdioFrames.push(page.request)
  }

  const remote = 'remote-lease-4'
  h.attach.bind({ producer: PRODUCER, connectionId: remote, expectedGeneration: 1 })
  h.attach.hooks.factSink.record(factOf({ factId: 'fact-pump' }))
  pumpStdio()
  assert.deepEqual(stdioFrames, [], 'the replaced stdio connection must deliver nothing')

  const page = h.attach.next(remote)
  assert.ok(page.ok && page.request)
  assert.equal(h.attach.receive(remote, { v: 1, type: 'receipt', id: 'fact-pump', factId: 'fact-pump', receipt: { factId: 'fact-pump', persisted: true, seq: 1 } }).accepted, true)
})
