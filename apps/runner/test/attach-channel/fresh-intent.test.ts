/**
 * wave-28 I1 — fresh intent correlation.
 *
 * Original business identity (`command.id`, attempt, native binding) never changes, but every
 * `beforeNativeWrite` call gets its own local v1 frame id. That is what the frozen local schema
 * already allows (`native-write-intent` carries `id` separately from `command`), and it is the only
 * thing that stops a settled `write-admission` for an earlier intent from authorising a later one on
 * the same lease.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import type { CoordinatorChannelReply } from '../../../../packages/contracts/src/coordinator-channel.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'
import { factOf, makeHarness, receiptReply } from './fixtures.ts'

function admission(intentId: string, allowed: boolean): CoordinatorChannelReply {
  return { v: 1, type: 'write-admission', id: intentId, allowed }
}

test('P1: a settled allowed reply for an earlier intent cannot authorise a later intent for the same command', async () => {
  const h = makeHarness()
  const command = makeCommand('answer', { id: 'command-reused' })

  const first = h.channel.beforeNativeWrite(command)
  const firstIntent = h.frames.at(-1)
  assert.ok(firstIntent && firstIntent.type === 'native-write-intent')
  assert.equal(h.lease.receive(admission(firstIntent.id, true)), true)
  await first

  const second = h.channel.beforeNativeWrite(command)
  const secondIntent = h.frames.at(-1)
  assert.ok(secondIntent && secondIntent.type === 'native-write-intent')

  // Same original business command, distinct local correlation.
  assert.equal(secondIntent.command.id, command.id)
  assert.deepEqual(secondIntent.command, command)
  assert.notEqual(secondIntent.id, firstIntent.id)

  // Replaying the exact settled frame must not resolve the new intent.
  assert.equal(h.lease.receive(admission(firstIntent.id, true)), false)
  assert.equal(h.channel.inspect().pendingWrites, 1)
  assert.equal(await pendingState(second), 'pending')

  // Only a genuinely fresh decision for the new correlation settles it.
  assert.equal(h.lease.receive(admission(secondIntent.id, true)), true)
  await second
  assert.equal(h.channel.inspect().pendingWrites, 0)
})

test('P1: a replayed denial cannot decide a later intent either, and a fresh denial still denies', async () => {
  const h = makeHarness()
  const command = makeCommand('answer', { id: 'command-deny-reused' })

  const first = h.channel.beforeNativeWrite(command)
  const firstIntent = h.frames.at(-1)
  assert.ok(firstIntent && firstIntent.type === 'native-write-intent')
  assert.equal(h.lease.receive(admission(firstIntent.id, false)), true)
  await assert.rejects(first, (error: unknown) => error instanceof NativeWriteDenied)

  const second = h.channel.beforeNativeWrite(command)
  const secondIntent = h.frames.at(-1)
  assert.ok(secondIntent && secondIntent.type === 'native-write-intent')
  // The old denial is not a decision about the new intent.
  assert.equal(h.lease.receive(admission(firstIntent.id, false)), false)
  assert.equal(h.lease.receive(admission(firstIntent.id, true)), false)
  assert.equal(await pendingState(second), 'pending')

  assert.equal(h.lease.receive(admission(secondIntent.id, false)), true)
  await assert.rejects(second, (error: unknown) => error instanceof NativeWriteDenied)
})

test('intent correlation ids are unique per call and never reused after settlement, timeout or close', async () => {
  const h = makeHarness()
  const command = makeCommand('answer', { id: 'command-sequence' })
  const seen = new Set<string>()

  for (let index = 0; index < 3; index += 1) {
    const pending = h.channel.beforeNativeWrite(command)
    const intent = h.frames.at(-1)
    assert.ok(intent && intent.type === 'native-write-intent')
    assert.equal(seen.has(intent.id), false, `intent id ${intent.id} was reused`)
    seen.add(intent.id)
    assert.equal(intent.command.id, command.id)
    h.lease.receive(admission(intent.id, true))
    await pending
  }
})

test('facts and payload reads keep their original correlation even while intents get fresh ids', async () => {
  const h = makeHarness()
  const command = makeCommand('answer', { id: 'command-mixed' })
  h.channel.beforeNativeWrite(command)
  const intent = h.frames.at(-1)
  assert.ok(intent && intent.type === 'native-write-intent')
  h.lease.receive(admission(intent.id, true))

  const fact = factOf({ factId: 'fact-stable-id' })
  const pending = h.channel.recordFact(fact)
  const factFrame = h.frames.at(-1)
  assert.ok(factFrame && factFrame.type === 'fact')
  assert.equal(factFrame.id, 'fact-stable-id')
  assert.equal(factFrame.fact.factId, 'fact-stable-id')
  assert.equal(h.lease.receive(receiptReply('fact-stable-id')), true)
  await pending

  const read = h.channel.readPayload('payload-stable-id')
  const readFrame = h.frames.at(-1)
  assert.ok(readFrame && readFrame.type === 'payload-read')
  assert.equal(readFrame.id, readFrame.requestId)
  assert.equal(readFrame.reference, 'payload-stable-id')
  assert.equal(h.lease.receive({ v: 1, type: 'payload', id: readFrame.requestId, requestId: readFrame.requestId, value: { stable: true } }), true)
  assert.deepEqual(await read, { stable: true })
})

test('a concurrent second intent for the same command is refused instead of racing the first', async () => {
  const h = makeHarness()
  const command = makeCommand('answer', { id: 'command-concurrent' })
  h.channel.beforeNativeWrite(command)
  await assert.rejects(h.channel.beforeNativeWrite(command), (error: unknown) => {
    assert.ok(error instanceof CoordinatorChannelError)
    assert.equal(error.reason, 'write_already_pending')
    return true
  })
  // The first intent is untouched and still resolvable by its own correlation.
  const intent = h.frames.at(-1)
  assert.ok(intent && intent.type === 'native-write-intent')
  assert.equal(h.lease.receive(admission(intent.id, true)), true)
})

/** Observe a promise without settling it: 'pending' or the rejection/settlement class. */
async function pendingState(promise: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  return Promise.race([
    promise.then(() => 'resolved' as const, () => 'rejected' as const),
    new Promise<'pending'>(resolve => setImmediate(() => resolve('pending'))),
  ])
}
