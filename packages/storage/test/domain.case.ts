/** Domain aggregate tables: JSON roundtrips, generated-column working sets, the trigger/thread index, and decision history. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withStore } from './helpers.ts'

const trigger = (id: string, threads: string[], at: string) => ({
  id,
  at,
  human: true,
  threads: threads.map(thread => ({ source: 'chat', id: thread })),
  text: `message ${id}`,
  meta: {},
})

test('aggregates round-trip through their tables unchanged', async () => {
  await withStore(({ store }) => {
    store.domain.tickets.save({ id: 't1', title: 'x', assignments: [], undelivered: [] })
    assert.deepEqual(store.domain.tickets.get('t1'), { id: 't1', title: 'x', assignments: [], undelivered: [] })

    store.domain.threads.save({ key: 'chat:t1', ref: { source: 'chat', id: 't1' }, subscriptions: [], pending: [] })
    assert.deepEqual(store.domain.threads.get('chat:t1')?.pending, [])

    store.domain.decisions.save({ id: 'd1', threadKey: 'chat:t1', kind: 'ignore' })
    assert.equal(store.domain.decisions.byThread('chat:t1').length, 1)

    store.domain.triggers.save(trigger('e1', ['t1'], '2026-11-07T00:00:01Z'))
    assert.equal(store.domain.triggers.get('e1')?.text, 'message e1')
    store.domain.triggers.saveDisposition('e1', { fanout: ['t1'], at: '2026-11-07T00:00:01Z' })
    assert.deepEqual(store.domain.triggers.disposition('e1')?.fanout, ['t1'])
  })
})

test('generated working-set columns expose active tickets and threads only', async () => {
  await withStore(({ store }) => {
    store.domain.tickets.save({ id: 'idle', assignments: [{ id: 'a', state: 'ended' }], undelivered: [] })
    store.domain.tickets.save({ id: 'undelivered', assignments: [{ id: 'a', state: 'running' }], undelivered: ['i1'] })
    store.domain.tickets.save({ id: 'running', assignments: [{ id: 'a', state: 'running' }], undelivered: [] })
    store.domain.tickets.save({ id: 'ended', ended: { at: 'x', by: 'executor', outcome: 'completed' }, assignments: [], undelivered: ['i1'] })
    // An ended ticket with undelivered inputs stays in the active set so the engine can wake it.
    assert.deepEqual(store.domain.tickets.active().map(ticket => ticket.id).sort(), ['ended', 'running', 'undelivered'])
    assert.deepEqual(store.domain.tickets.open().map(ticket => ticket.id).sort(), ['idle', 'running', 'undelivered'])

    store.domain.threads.save({ key: 'chat:idle', ref: { source: 'chat', id: 'idle' }, subscriptions: [], pending: [] })
    store.domain.threads.save({ key: 'chat:pending', ref: { source: 'chat', id: 'pending' }, subscriptions: [], pending: ['e1'] })
    store.domain.threads.save({ key: 'chat:evaluating', ref: { source: 'chat', id: 'evaluating' }, subscriptions: ['t1'], pending: [], evaluating: { id: 'v1' } })
    assert.deepEqual(store.domain.threads.active().map(thread => thread.key).sort(), ['chat:evaluating', 'chat:pending'])
  })
})

test('saving a trigger re-indexes the threads it belongs to', async () => {
  await withStore(({ store }) => {
    store.domain.triggers.save(trigger('e1', ['t1', 't2'], '2026-11-07T00:00:01Z'))
    const count = () => Number((store.db.prepare('SELECT COUNT(*) AS n FROM trigger_thread WHERE id = ?').get('e1') as { n: number }).n)
    assert.equal(count(), 2)
    store.domain.triggers.save(trigger('e1', ['t2', 't3'], '2026-11-07T00:00:02Z'))
    assert.equal(count(), 2, 'the earlier index rows for this trigger are replaced')
    const rows = store.db.prepare('SELECT thread FROM trigger_thread WHERE id = ? ORDER BY thread').all('e1') as { thread: string }[]
    assert.deepEqual(rows.map(row => row.thread), ['chat:t2', 'chat:t3'])
  })
})

test('list order matches the upstream store: tickets newest first, threads in insertion order', async () => {
  await withStore(({ store }) => {
    store.domain.tickets.save({ id: 'first', assignments: [], undelivered: [] })
    store.domain.tickets.save({ id: 'second', assignments: [], undelivered: [] })
    assert.deepEqual(store.domain.tickets.list().map(ticket => ticket.id), ['second', 'first'])
    store.domain.threads.save({ key: 'chat:a', ref: { source: 'chat', id: 'a' }, subscriptions: [], pending: [] })
    store.domain.threads.save({ key: 'chat:b', ref: { source: 'chat', id: 'b' }, subscriptions: [], pending: [] })
    assert.deepEqual(store.domain.threads.list().map(thread => thread.key), ['chat:a', 'chat:b'])
  })
})
