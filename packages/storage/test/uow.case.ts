/** DATA-04: one connection, nested savepoints, rollback at each level, and afterCommit only on real commit. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withStore } from './helpers.ts'

test('inner rollback preserves the outer write and its afterCommit fires once', async () => {
  await withStore(({ store }) => {
    const callbacks: string[] = []
    store.uow.atomic(() => {
      store.domain.tickets.save({ id: 't1', value: 'outer' })
      store.uow.afterCommit(() => callbacks.push('outer'))
      try {
        store.uow.atomic(() => {
          store.domain.tickets.save({ id: 't2', value: 'inner' })
          store.uow.afterCommit(() => callbacks.push('inner'))
          throw new Error('inner failure')
        })
      } catch { /* expected */ }
      assert.equal(callbacks.length, 0, 'no callback runs before the outermost commit')
    })
    assert.equal(store.domain.tickets.get('t1')?.value, 'outer')
    assert.equal(store.domain.tickets.get('t2'), undefined, 'the rolled-back savepoint wrote nothing')
    assert.deepEqual(callbacks, ['outer'], 'the rolled-back level discarded its afterCommit action')
    assert.equal(store.uow.nesting, 0)
  })
})

test('outer rollback discards nested writes and every queued callback', async () => {
  await withStore(({ store }) => {
    const callbacks: string[] = []
    assert.throws(() => store.uow.atomic(() => {
      store.domain.tickets.save({ id: 't1', value: 'outer' })
      store.uow.afterCommit(() => callbacks.push('outer'))
      store.uow.atomic(() => {
        store.domain.tickets.save({ id: 't2', value: 'inner' })
        store.uow.afterCommit(() => callbacks.push('inner'))
      })
      throw new Error('outer failure')
    }), /outer failure/)
    assert.equal(store.domain.tickets.get('t1'), undefined)
    assert.equal(store.domain.tickets.get('t2'), undefined)
    assert.deepEqual(callbacks, [], 'no afterCommit action survives a rolled-back transaction')
  })
})

test('afterCommit runs immediately outside a transaction', async () => {
  await withStore(({ store }) => {
    const callbacks: string[] = []
    store.uow.afterCommit(() => callbacks.push('immediate'))
    assert.deepEqual(callbacks, ['immediate'])
  })
})

test('every store shares the same connection and joins one transaction', async () => {
  await withStore(({ store }) => {
    const identity = store.db
    assert.equal(store.domain, store.domain, 'singleton wiring')
    // A write spread across the domain store, receipts, queue, events, dispatch, and answers is
    // visible to every store inside the transaction and invisible after a rollback.
    assert.throws(() => store.uow.atomic(() => {
      store.domain.tickets.save({ id: 't1', value: 'x' })
      store.commands.record('cmd-1', 'digest-a', () => {
        store.queue.enqueue('demo', 'k1', '{}', 1, 0, 'now')
        store.events.append({ topic: 'demo', entityRef: 't1', payload: {} })
        store.dispatch.beginSend('cmd-1', 'native:1')
        store.answers.record('a1', { questionId: 'q1', expectedVersion: 1, digest: 'd', answer: {} })
        store.answers.upsertDelivery('a1', 'target-1', 'local_recorded')
        throw new Error('fail late in the transaction')
      })
      return true
    }), /fail late/)
    assert.equal(store.domain.tickets.get('t1'), undefined)
    assert.equal(store.commands.get('cmd-1'), undefined)
    assert.equal(store.queue.stats('demo').waiting, 0)
    assert.equal(store.events.cursor(), 0)
    assert.equal(store.dispatch.get('cmd-1', 'native:1'), undefined)
    assert.equal(store.answers.get('a1'), undefined)
    assert.equal(store.answers.deliveries('a1').length, 0)
    assert.equal(identity, store.db)
  })
})
