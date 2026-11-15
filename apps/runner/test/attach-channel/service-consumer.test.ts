/**
 * wave-29 I4/I8 — service-shaped consumer: the wiring `runner-service` actually needs.
 *
 * The consumer below mirrors the real service lanes with the shipped pieces only:
 * an in-process sink lane answered by the guard-bound responder, an authenticated attach lane that
 * takes the lease over by explicit CAS, and one pull queue owned by `RunnerAttachChannel`. It holds
 * no pending map, timer or generation of its own.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CoordinatorChannelReply,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import type { RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { RunnerAttachChannel } from '../../src/attach-channel/attach.ts'
import { createCoordinatorSinkResponder } from '../../src/attach-channel/sink-responder.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { answerCommand, DurableSink, factOf, LIMITS, ManualClock, PRODUCER } from './fixtures.ts'

class ServiceConsumer {
  readonly clock = new ManualClock()
  readonly sink = new DurableSink()
  readonly guardCalls: RunnerCommand[] = []
  readonly payloads = new Map<string, unknown>([['payload-svc', { answer: 'ok' }]])
  readonly attach = new RunnerAttachChannel({ producer: PRODUCER, limits: LIMITS, now: this.clock.now, schedule: this.clock.schedule })
  readonly #responder = createCoordinatorSinkResponder({
    facts: { record: this.sink.record },
    payloads: { read: async reference => {
      if (!this.payloads.has(reference)) throw new Error('missing payload')
      return this.payloads.get(reference) as never
    } },
    guardNativeWrite: async command => {
      this.guardCalls.push(command)
      return true
    },
  })

  bind(connectionId: string, expectedGeneration: number): number {
    return this.attach.bind({ producer: PRODUCER, connectionId, expectedGeneration })
  }

  /** Drain one request of a lane through the responder, then hand the answer to that lane. */
  async pump(connectionId: string): Promise<boolean> {
    const next = this.attach.next(connectionId)
    assert.equal(next.ok, true)
    if (!next.ok || !next.request) return false
    const reply = await this.#responder(next.request)
    return reply ? this.attach.receive(connectionId, reply).accepted : false
  }

  get responder(): (request: CoordinatorChannelRequest) => Promise<CoordinatorChannelReply | undefined> {
    return this.#responder
  }
}

test('sink lane: three callbacks resolve through the guarded responder with one guard call', async () => {
  const service = new ServiceConsumer()
  service.bind('sink', 0)

  const fact = service.attach.hooks.factSink.record(factOf({ factId: 'fact-svc' }))
  const payload = service.attach.hooks.payloads.read('payload-svc')
  const write = service.attach.hooks.beforeNativeWrite(answerCommand('command-svc'))
  assert.equal(service.attach.outboundCount, 3)

  // Same order as a poll loop: one outstanding request at a time, head-stable.
  assert.equal(await service.pump('sink'), true)
  assert.equal(await service.pump('sink'), true)
  assert.equal(await service.pump('sink'), true)

  assert.deepEqual(await fact, { factId: 'fact-svc', persisted: true, seq: 1 })
  assert.deepEqual(await payload, { answer: 'ok' })
  await write
  assert.equal(service.guardCalls.length, 1)
  assert.equal(service.guardCalls[0]?.id, 'command-svc')
  assert.equal(service.attach.outboundCount, 0)
  assert.deepEqual(service.attach.inspect().pendingWrites, 0)
})

test('attach takeover: CAS replaces the sink lease, retries data and never migrates a write', async () => {
  const service = new ServiceConsumer()
  service.bind('sink', 0)

  // A fact is outstanding on the sink lane and deliberately unanswered.
  const fact = service.attach.hooks.factSink.record(factOf({ factId: 'fact-takeover' }))
  assert.equal(service.attach.outboundCount, 1)

  // An authenticated attach client takes over with the current generation.
  assert.equal(service.bind('attach', 1), 2)

  // The sink lane is inert: it can neither poll nor answer any more.
  const stale = service.attach.next('sink')
  assert.equal(stale.ok, false)
  assert.equal(stale.ok ? '' : stale.refused, 'stale_connection')
  const staleReply = service.attach.receive('sink', { v: 1, type: 'receipt', id: 'fact-takeover', factId: 'fact-takeover', receipt: { factId: 'fact-takeover', persisted: true, seq: 9 } })
  assert.equal(staleReply.accepted, false)

  // The same original fact (id and body) is retried on the attach lane and settles there once.
  const retried = service.attach.next('attach')
  assert.ok(retried.ok && retried.request && retried.request.type === 'fact')
  assert.equal(retried.request.fact.factId, 'fact-takeover')
  assert.deepEqual(retried.request.fact, factOf({ factId: 'fact-takeover' }))
  assert.equal(service.attach.outboundCount, 1)
  assert.equal(await service.pump('attach'), true)
  assert.deepEqual(await fact, { factId: 'fact-takeover', persisted: true, seq: 1 })
  // The sink was never asked on the dead lane, so the durable write happens exactly once.
  assert.deepEqual(service.sink.calls, ['fact-takeover'])
  assert.equal(service.attach.outboundCount, 0)
})

test('a write pending at takeover becomes indeterminate and its old approval cannot be replayed', async () => {
  const service = new ServiceConsumer()
  service.bind('sink', 0)
  const pending = service.attach.hooks.beforeNativeWrite(answerCommand('command-takeover'))
  const intent = service.attach.next('sink')
  assert.ok(intent.ok && intent.request && intent.request.type === 'native-write-intent')

  assert.equal(service.bind('attach', 1), 2)
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.code, 'indeterminate')
    return true
  })
  assert.equal(service.guardCalls.length, 0, 'no guard decision existed for the abandoned intent')

  const replayed = service.attach.receive('sink', { v: 1, type: 'write-admission', id: intent.request.id, allowed: true })
  assert.equal(replayed.accepted, false)
  const onNewLane = service.attach.receive('attach', { v: 1, type: 'write-admission', id: intent.request.id, allowed: true })
  assert.equal(onNewLane.accepted, false)

  // A fresh intent for the same business command needs its own decision.
  const again = service.attach.hooks.beforeNativeWrite(answerCommand('command-takeover'))
  assert.equal(await service.pump('attach'), true)
  await again
  assert.equal(service.guardCalls.length, 1)
})

test('denial and guard failure in the service lane reject the hook without a write', async () => {
  const service = new ServiceConsumer()
  service.bind('sink', 0)
  const denyAttach = new RunnerAttachChannel({ producer: PRODUCER, limits: LIMITS, now: service.clock.now, schedule: service.clock.schedule })
  const denier = createCoordinatorSinkResponder({
    facts: { record: service.sink.record },
    payloads: { read: async () => null },
    guardNativeWrite: async () => false,
  })
  denyAttach.bind({ producer: PRODUCER, connectionId: 'deny', expectedGeneration: 0 })
  const pending = denyAttach.hooks.beforeNativeWrite(answerCommand('command-denied-svc'))
  const next = denyAttach.next('deny')
  assert.ok(next.ok && next.request)
  const reply = await denier(next.request)
  assert.ok(reply)
  assert.equal(denyAttach.receive('deny', reply).accepted, true)
  await assert.rejects(pending, (error: unknown) => error instanceof NativeWriteDenied)
})

test('module close through the adapter settles every lane and refuses later work', async () => {
  const service = new ServiceConsumer()
  service.bind('sink', 0)
  const fact = service.attach.hooks.factSink.record(factOf({ factId: 'fact-close-svc' }))
  const write = service.attach.hooks.beforeNativeWrite(answerCommand('command-close-svc'))

  service.attach.close('attempt closed')
  await assert.rejects(fact, (error: unknown) => (error as { code?: string }).code === 'closed')
  await assert.rejects(write, (error: unknown) => (error as { code?: string }).code === 'indeterminate')

  assert.deepEqual(service.attach.inspect(), {
    state: 'closed', generation: 1, pendingFacts: 0, pendingPayloads: 0, pendingWrites: 0, pendingBytes: 0,
  })
  assert.equal(service.attach.outboundCount, 0)
  assert.equal(service.attach.next('sink').ok, false)
})
