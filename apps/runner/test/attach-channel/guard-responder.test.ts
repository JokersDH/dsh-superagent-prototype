/**
 * wave-29 I3 — native admission is a decision, not a side effect of having a fact sink.
 *
 * The independent audit found the current B in-process lane answers `native-write-intent` with
 * `allowed: !businessClosed`, so an attempt with no main/Broker guard at all grants a native write
 * (guardCalls 0). These cases pin the correct contract on the responder this package ships:
 * a sink can record facts, but only an explicit current guard can allow a write, and every intent
 * needs its own decision.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import type { CoordinatorChannelReply, CoordinatorChannelRequest } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { createCoordinatorSinkResponder } from '../../src/attach-channel/sink-responder.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'
import { answerCommand, DurableSink, factOf, LIMITS, ManualClock, PRODUCER } from './fixtures.ts'
import type { Json } from '../../../../packages/contracts/src/types.ts'

function wire(
  guard: ((command: import('../../../../packages/contracts/src/types.ts').RunnerCommand) => Promise<boolean>) | undefined,
  options: { readonly autoAnswer?: boolean } = {},
) {
  const clock = new ManualClock()
  const sink = new DurableSink()
  const payloads = new Map<string, Json>([['payload-wire', { answer: 42 }]])
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits: LIMITS, now: clock.now, schedule: clock.schedule })
  const requests: CoordinatorChannelRequest[] = []
  const pump = async (request: CoordinatorChannelRequest): Promise<boolean> => {
    const reply = await responder(request)
    return reply ? lease.receive(reply) : false
  }
  const responder = createCoordinatorSinkResponder({
    facts: { record: sink.record },
    payloads: { read: async reference => {
      const value = payloads.get(reference)
      if (value === undefined) throw new Error('missing payload')
      return value
    } },
    // Deliberately allow an absent guard at the type level of this test so the runtime fail-closed
    // branch is exercised exactly as a mis-wired service would hit it.
    guardNativeWrite: guard as never,
  })
  const lease = channel.bind({
    producer: PRODUCER,
    connectionId: 'sink',
    expectedGeneration: 0,
    send: request => {
      requests.push(request)
      if (options.autoAnswer !== false) void pump(request)
    },
  })
  return { clock, sink, channel, requests, lease, pump, queueReply: (reply: CoordinatorChannelReply) => lease.receive(reply) }
}

const allow = async () => true
const deny = async () => false
const boom = async () => {
  throw new Error('guard unavailable')
}

test('a wired guard is consulted exactly once per intent and its answer settles only that intent', async () => {
  let calls = 0
  const w = wire(async () => {
    calls += 1
    return true
  })
  const command = makeCommand('answer', { id: 'command-guarded' })
  const first = w.channel.beforeNativeWrite(command)
  const firstIntent = w.requests.at(-1)
  assert.ok(firstIntent && firstIntent.type === 'native-write-intent')
  assert.equal(calls, 1)
  assert.equal(firstIntent.command.id, command.id)
  assert.notEqual(firstIntent.id, command.id)
  await first
  assert.equal(calls, 1)

  const second = w.channel.beforeNativeWrite(command)
  const secondIntent = w.requests.at(-1)
  assert.ok(secondIntent && secondIntent.type === 'native-write-intent')
  assert.equal(calls, 2, 'a second intent must reach the guard again')
  assert.notEqual(secondIntent.id, firstIntent.id)
  await second
  assert.equal(calls, 2)
})

test('a denying guard refuses the hook and never produces an allow', async () => {
  let calls = 0
  const w = wire(async () => {
    calls += 1
    return false
  })
  const pending = w.channel.beforeNativeWrite(makeCommand('answer', { id: 'command-denied' }))
  await assert.rejects(pending, (error: unknown) => error instanceof NativeWriteDenied)
  assert.equal(calls, 1)
})

test('a guard that throws is not an approval: the hook rejects and no allow frame is produced', async () => {
  let calls = 0
  const w = wire(async () => {
    calls += 1
    throw new Error('broker unavailable')
  })
  const pending = w.channel.beforeNativeWrite(makeCommand('answer', { id: 'command-throw' }))
  await assert.rejects(pending, (error: unknown) => error instanceof NativeWriteDenied)
  assert.equal(calls, 1)
  const admission = w.requests.length
  assert.equal(admission, 1, 'only the intent was sent; no synthetic approval')
})

test('a responder without any guard fails closed instead of inheriting the attempt-open state', async () => {
  const w = wire(undefined)
  const pending = w.channel.beforeNativeWrite(makeCommand('answer', { id: 'command-no-guard' }))
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof NativeWriteDenied)
    return true
  })
})

test('the B-style hazard (`allowed: !businessClosed`) is reproduced as a labelled negative', async () => {
  // This reproduces the audited B sink lane on purpose: it has a fact sink but no guard and answers
  // allow whenever the attempt is open (guardCalls 0). It is a hazard double, never production code.
  const clock = new ManualClock()
  const sink = new DurableSink()
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits: LIMITS, now: clock.now, schedule: clock.schedule })
  let businessClosed = false
  const legacyResponder = async (request: CoordinatorChannelRequest): Promise<CoordinatorChannelReply | undefined> => {
    if (request.type === 'fact') return { v: 1, type: 'receipt', id: request.fact.factId, factId: request.fact.factId, receipt: await sink.record(request.fact) }
    if (request.type === 'payload-read') return undefined
    if (request.type === 'native-write-intent') return { v: 1, type: 'write-admission', id: request.id, allowed: !businessClosed }
    return undefined
  }
  const lease = channel.bind({
    producer: PRODUCER,
    connectionId: 'sink',
    expectedGeneration: 0,
    send: request => {
      void legacyResponder(request).then(reply => reply && lease.receive(reply))
    },
  })
  // Hazard: a native intent is allowed with zero guard consultations.
  await channel.beforeNativeWrite(makeCommand('answer', { id: 'command-hazard' }))
  assert.equal(businessClosed, false)

  // The shipped responder refuses the same wiring when the guard is absent.
  const guarded = createCoordinatorSinkResponder({ facts: { record: sink.record }, payloads: { read: async () => null }, guardNativeWrite: undefined as never })
  const reply = await guarded({ v: 1, type: 'native-write-intent', id: 'intent-x', command: answerCommand('command-hazard') })
  assert.deepEqual(reply, { v: 1, type: 'write-admission', id: 'intent-x', allowed: false })
})

test('fact and payload lanes keep their original identities and ownership', async () => {
  const w = wire(allow)
  const fact = factOf({ factId: 'fact-lane' })
  const receipt = await w.channel.recordFact(fact)
  assert.equal(receipt.factId, 'fact-lane')
  assert.deepEqual(w.sink.calls, ['fact-lane'])

  const value = await w.channel.readPayload('payload-wire')
  assert.deepEqual(value, { answer: 42 })
})

test('a fact sink failure answers ack-failed and rejects instead of acknowledging', async () => {
  const clock = new ManualClock()
  const channel = new CoordinatorChannelModule({ producer: PRODUCER, limits: LIMITS, now: clock.now, schedule: clock.schedule })
  const responder = createCoordinatorSinkResponder({
    facts: { record: async () => {
      throw new Error('disk full')
    } },
    payloads: { read: async () => null },
    guardNativeWrite: allow,
  })
  const lease = channel.bind({
    producer: PRODUCER,
    connectionId: 'sink',
    expectedGeneration: 0,
    send: request => {
      void responder(request).then(reply => reply && lease.receive(reply))
    },
  })
  const pending = channel.recordFact(factOf({ factId: 'fact-ack-fail' }))
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'fact_ack_failed')
    return true
  })
})

test('a stale allowed reply still cannot approve a later intent through the guarded responder', async () => {
  let calls = 0
  const w = wire(async () => {
    calls += 1
    return true
  }, { autoAnswer: false })
  const command = answerCommand('command-replay')
  const first = w.channel.beforeNativeWrite(command)
  const settledIntent = w.requests.at(-1)
  assert.ok(settledIntent && settledIntent.type === 'native-write-intent')
  assert.equal(await w.pump(settledIntent), true)
  await first
  assert.equal(calls, 1)

  const second = w.channel.beforeNativeWrite(command)
  // Replaying the first intent's settled frame is refused and never reaches the guard.
  assert.equal(w.queueReply({ v: 1, type: 'write-admission', id: settledIntent.id, allowed: true }), false)
  assert.equal(calls, 1, 'the replay did not reach the guard')
  const secondIntent = w.requests.at(-1)
  assert.ok(secondIntent && secondIntent.type === 'native-write-intent')
  assert.notEqual(secondIntent.id, settledIntent.id)
  assert.equal(await w.pump(secondIntent), true)
  await second
  assert.equal(calls, 2)
})
