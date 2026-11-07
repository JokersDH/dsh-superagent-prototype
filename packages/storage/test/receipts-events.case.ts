/** DATA-03 replay semantics for command and fact receipts, and DATA-08's gap-free event cursor. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CommandConflict, FactConflict } from '../src/index.ts'
import { withStore } from './helpers.ts'

test('the same command ID and payload digest records once and replays without re-applying', async () => {
  await withStore(({ store }) => {
    let applies = 0
    const first = store.commands.record('cmd-1', 'digest-a', () => {
      applies++
      store.queue.enqueue('demo', 'k1', '{}', 1, 0, 'now')
      return { workId: 'w1' }
    })
    assert.equal(first.replayed, false)
    assert.deepEqual(first.result, { workId: 'w1' })
    assert.equal(first.seq, 1)

    const replay = store.commands.record('cmd-1', 'digest-a', () => { applies++; return { workId: 'other' } })
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.result, { workId: 'w1' }, 'the recorded result is returned')
    assert.equal(replay.seq, first.seq)
    assert.equal(applies, 1, 'the work applied once')
    assert.equal(store.queue.stats('demo').waiting, 1, 'no duplicate queue row')
    assert.equal(store.events.cursor(), 1, 'no duplicate event')
  })
})

test('the same command ID with a different payload digest is refused and never overwrites the receipt', async () => {
  await withStore(({ store }) => {
    store.commands.record('cmd-1', 'digest-a', () => ({ ok: true }))
    assert.throws(() => store.commands.record('cmd-1', 'digest-b', () => ({ ok: false })), CommandConflict)
    assert.equal(store.commands.get('cmd-1')?.payloadDigest, 'digest-a')
  })
})

test('fact receipts deduplicate by ID and digest and return the recorded sequence', async () => {
  await withStore(({ store }) => {
    let applies = 0
    const first = store.facts.record('fact-1', 'payload-a', () => { applies++ })
    assert.deepEqual(first, { factId: 'fact-1', persisted: true, seq: 1 })
    const replay = store.facts.record('fact-1', 'payload-a', () => { applies++ })
    assert.deepEqual(replay, first)
    assert.equal(applies, 1)
    assert.throws(() => store.facts.record('fact-1', 'payload-b', () => {}), FactConflict)
  })
})

test('the event cursor is gap-free: a rolled-back transaction consumes no sequence number', async () => {
  await withStore(({ store }) => {
    store.uow.atomic(() => {
      store.events.append({ topic: 'a', entityRef: 'e1', payload: { n: 1 } })
      store.events.append({ topic: 'a', entityRef: 'e1', payload: { n: 2 } })
    })
    assert.equal(store.events.cursor(), 2)
    assert.throws(() => store.uow.atomic(() => {
      store.events.append({ topic: 'b', entityRef: 'e2', payload: { n: 3 } })
      throw new Error('rolled back')
    }))
    assert.equal(store.events.cursor(), 2, 'the rolled-back append left no gap')
    const next = store.events.append({ topic: 'c', entityRef: 'e3', payload: { n: 4 } })
    assert.equal(next, 3, 'the next committed event takes the next sequence number')
    const page = store.events.after(0, 2)
    assert.deepEqual(page.map(event => event.seq), [1, 2], 'paging in sequence order')
    assert.deepEqual(store.events.after(page[1]!.seq).map(event => event.seq), [3])
    const payloadRef = store.events.append({ topic: 'big', entityRef: 'e4', payloadRef: 'artifact-1' })
    const stored = store.events.after(payloadRef - 1, 1)[0]!
    assert.equal(stored.payload, null)
    assert.equal(stored.payloadRef, 'artifact-1')
    assert.throws(() => store.events.append({ topic: 'empty', entityRef: 'e5' }), /payload or a payload reference/)
  })
})
