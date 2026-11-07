/**
 * DATA-02/DATA-04 queue participation: rows enqueued inside a command transaction commit or roll
 * back with it; and REL-02 storage wiring: the Effects algorithm over the real SQLite queue parks
 * unknown sends and resumes unrelated rows after a restart.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Effects, Later, UnknownSend } from '@personal-agent/effects'
import { withStore } from './helpers.ts'

test('queue rows enqueued inside a transaction disappear with it', async () => {
  await withStore(async ({ store }) => {
    assert.throws(() => store.uow.atomic(() => {
      store.queue.enqueue('demo', 'k1', '{"n":1}', 1, 0, 'now')
      throw new Error('fail after enqueue')
    }))
    assert.equal(store.queue.stats('demo').waiting, 0, 'no effect escapes a rolled-back command')

    store.uow.atomic(() => { store.queue.enqueue('demo', 'k1', '{"n":1}', 1, 0, 'now') })
    assert.equal(store.queue.stats('demo').waiting, 1)
  })
})

test('the SQLite queue coalesces by kind and key, keeping position and payload generation', async () => {
  await withStore(async ({ store }) => {
    store.queue.enqueue('launch', 'a1', '{"n":1}', 1, 0, 'now')
    store.queue.enqueue('launch', 'other', '{"n":9}', 2, 0, 'now')
    store.queue.enqueue('launch', 'a1', '{"n":2}', 3, 0, 'now')
    const rows = store.queue.dueRows('launch', Number.MAX_SAFE_INTEGER, 10)
    assert.deepEqual(rows.map(row => row.key), ['a1', 'other'], 'coalescing keeps queue position')
    assert.equal(rows[0]!.payload, '{"n":2}', 'the newer payload replaced the older')
    assert.equal(rows[0]!.generation, 1)
    assert.equal(rows[0]!.attempts, 0)
  })
})

test('the Effects algorithm over SQLite dispatches, retries Later, and parks an unknown send across a restart', async () => {
  await withStore(async ({ store }) => {
    let now = 0
    const clock = (): number => now
    const effects = new Effects(store.queue, undefined, clock)
    const seen: string[] = []
    effects.handle('answer', async (payload, key) => {
      seen.push(key)
      const value = payload as { mode: string }
      if (value.mode === 'unknown') throw new UnknownSend('receipt lost', 'transport_lost')
      if (value.mode === 'later') throw new Later('paused')
    }, { retry: [1000, 60_000] })
    effects.enqueue('answer', 'q1', { mode: 'unknown' })
    effects.enqueue('answer', 'q2', { mode: 'later' })
    effects.start()
    await effects.idle()
    assert.deepEqual(seen.sort(), ['q1', 'q2'])
    assert.equal(store.queue.parked('answer').length, 1, 'the unknown send is parked for reconcile')
    assert.equal(store.queue.parked('answer')[0]!.key, 'q1')
    await effects.drain()

    // A restart sees the parked row and the rescheduled Later row exactly as the durable table left them;
    // advancing the clock past the Later retry delay makes only that row due.
    now = 1000
    const restarted = new Effects(store.queue, undefined, clock)
    const resumed: string[] = []
    restarted.handle('answer', payload => { resumed.push((payload as { mode: string }).mode); return Promise.resolve() })
    restarted.start()
    await restarted.idle()
    assert.deepEqual(resumed, ['later'], 'only the rescheduled row dispatches; the parked row waits for reconcile')
    assert.equal(store.queue.parked('answer').length, 1)
    restarted.cancel('answer', 'q2')
    assert.equal(store.queue.stats('answer').waiting, 0)
  })
})

test('completing a replaced row leaves the newer payload for a later dispatch', async () => {
  await withStore(async ({ store }) => {
    const effects = new Effects(store.queue, undefined, () => 0)
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const seen: number[] = []
    effects.handle('launch', async payload => { seen.push((payload as { n: number }).n); if ((payload as { n: number }).n === 1) await gate })
    effects.enqueue('launch', 'a1', { n: 1 })
    effects.start()
    await new Promise(resolve => setImmediate(resolve))
    effects.enqueue('launch', 'a1', { n: 2 })
    release()
    await effects.idle()
    assert.deepEqual(seen, [1, 2], 'the newer payload dispatches after the running attempt completes')
    assert.equal(store.queue.stats('launch').waiting, 0)
  })
})
