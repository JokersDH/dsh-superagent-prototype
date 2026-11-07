import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProgressCoalescer, type Scheduler } from '../src/index.ts'
import type { ProgressUpdate } from '../../contracts/src/types.ts'
import { makeProgress } from '../../testing/src/fixtures.ts'

function manualScheduler(): Scheduler & { fire(): void } {
  const timers = new Map<number, () => void>()
  let next = 1
  return {
    setTimeout(callback) {
      const id = next++
      timers.set(id, callback)
      return id
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    fire() {
      const callbacks = [...timers.values()]
      timers.clear()
      for (const callback of callbacks) callback()
    },
  }
}

test('coalesces a burst to the newest update per window', () => {
  const published: ProgressUpdate[] = []
  const scheduler = manualScheduler()
  const coalescer = new ProgressCoalescer({ publish: update => published.push(update), scheduler, windowMs: 100 })
  coalescer.push(makeProgress({ text: 'one' }))
  coalescer.push(makeProgress({ text: 'two' }))
  coalescer.push(makeProgress({ text: 'three' }))
  assert.equal(published.length, 0)
  assert.deepEqual(coalescer.stats(), { received: 3, published: 0, coalesced: 2, rejected: 0, pending: 1, lastPublishAt: null })
  scheduler.fire()
  assert.equal(published.length, 1)
  assert.equal(published[0]?.text, 'three')
  const after = coalescer.stats()
  assert.equal(after.received, 3)
  assert.equal(after.published, 1)
  assert.equal(after.coalesced, 2)
  assert.equal(after.pending, 0)
  assert.equal(typeof after.lastPublishAt, 'number')
})

test('flush publishes immediately and cancels the pending timer', () => {
  const published: ProgressUpdate[] = []
  const scheduler = manualScheduler()
  const coalescer = new ProgressCoalescer({ publish: update => published.push(update), scheduler })
  coalescer.push(makeProgress({ text: 'latest' }))
  coalescer.flush()
  assert.equal(published.length, 1)
  scheduler.fire() // the timer was cleared, so nothing is published twice
  assert.equal(published.length, 1)
  assert.equal(coalescer.stats().published, 1)
})

test('does nothing when there is no pending progress', () => {
  const published: ProgressUpdate[] = []
  const coalescer = new ProgressCoalescer({ publish: update => published.push(update), scheduler: manualScheduler() })
  coalescer.flush()
  assert.deepEqual(published, [])
  assert.equal(coalescer.stats().published, 0)
})
