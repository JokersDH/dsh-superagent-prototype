/** Text channel receipts (upstream outbox semantics) and answer deliveries (DATA-07 storage material). */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AnswerConflict, CHANNEL_SEND_KIND } from '../src/index.ts'
import { withStore } from './helpers.ts'

const message = (id: string, ticketId = 't1') => ({
  id,
  channel: { source: 'chat', thread: 'c1', address: { message: id } },
  text: `text ${id}`,
  kind: 'reply' as const,
  ticketId,
})

test('channel receipts are idempotent, settle once, and withdraw only pending messages', async () => {
  await withStore(({ store }) => {
    assert.equal(store.channels.add(message('m1')), true)
    assert.equal(store.channels.add(message('m1')), false, 'a recorded message ID keeps its first receipt')
    assert.equal(store.channels.status('m1'), 'pending')
    assert.equal(store.channels.waiting().length, 1)

    store.channels.settle(message('m1'), 'sent')
    assert.equal(store.channels.status('m1'), 'sent')
    assert.equal(store.channels.withdraw('m1'), false, 'a sent message cannot be withdrawn')
    assert.equal(store.channels.add(message('m1')), false, 'a settled ID cannot be queued again')

    store.channels.add(message('m2'))
    assert.equal(store.channels.withdraw('m2'), true)
    assert.equal(store.channels.status('m2'), undefined)

    store.channels.add(message('m3'))
    store.channels.settle(message('m3'), 'channelGone')
    assert.deepEqual(store.channels.get('m3')!.dropped?.reason, 'channelGone')
  })
})

test('the weak FIFO holds a later message behind an earlier pending one of the same ticket and conversation', async () => {
  await withStore(({ store }) => {
    store.channels.add(message('m1'))
    store.channels.add(message('m2'))
    store.channels.add(message('other', 't2'))
    assert.equal(store.channels.behind('m2', 3), true, 'the later message of the same ticket/conversation waits')
    assert.equal(store.channels.behind('other', 3), false, 'another ticket clears independently')
    // After the head fails repeatedly the send kind's attempts pass the threshold, and the follower proceeds.
    store.queue.enqueue(CHANNEL_SEND_KIND, 'm1', '{}', 1, 0, 'now')
    store.queue.recordFailure(CHANNEL_SEND_KIND, 'm1', 1, 0, 3, 'failed', 0)
    assert.equal(store.channels.behind('m2', 3), false)
    store.channels.settle(message('m1'), 'sent')
    assert.equal(store.channels.behind('m2', 3), false)
  })
})

test('an answer is recorded once per ID and each native target has exactly one delivery row', async () => {
  await withStore(({ store }) => {
    assert.deepEqual(store.answers.record('a1', { questionId: 'q1', expectedVersion: 1, digest: 'digest-a', answer: { kind: 'choices' } }), { alreadyRecorded: false })
    assert.deepEqual(store.answers.record('a1', { questionId: 'q1', expectedVersion: 1, digest: 'digest-a', answer: { kind: 'choices' } }), { alreadyRecorded: true })
    assert.throws(() => store.answers.record('a1', { questionId: 'q1', expectedVersion: 1, digest: 'digest-b', answer: {} }), AnswerConflict)

    store.answers.upsertDelivery('a1', 'target-1', 'local_recorded', 'ev-local')
    store.answers.upsertDelivery('a1', 'target-2', 'local_recorded')
    store.answers.upsertDelivery('a1', 'target-1', 'response_written', 'ev-written')
    const deliveries = store.answers.deliveries('a1')
    assert.equal(deliveries.length, 2, 'no second row per target')
    assert.deepEqual(deliveries.find(delivery => delivery.targetBindingId === 'target-1')!.status, 'response_written')
    assert.deepEqual(deliveries.find(delivery => delivery.targetBindingId === 'target-2')!.status, 'local_recorded')

    // Recovery reads per-target statuses back; an expired target stays expired and is not resurrected.
    store.answers.upsertDelivery('a1', 'target-2', 'expired')
    const recovered = store.answers.deliveries('a1')
    assert.deepEqual(recovered.find(delivery => delivery.targetBindingId === 'target-2')!.status, 'expired')
    assert.equal(recovered.length, 2)
  })
})
