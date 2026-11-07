/** REL-02: dispatch classification — only a provable not_sent may send again; written/indeterminate must reconcile first. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UnknownSend, Effects } from '@personal-agent/effects'
import { withStore } from './helpers.ts'

test('a new or not_sent send proceeds; written and indeterminate block for reconcile', async () => {
  await withStore(async ({ store }) => {
    const ledger = store.dispatch
    assert.deepEqual(ledger.beginSend('cmd-1', 'native:q1'), { proceed: true, state: 'not_sent' })
    assert.deepEqual(ledger.beginSend('cmd-1', 'native:q1'), { proceed: true, state: 'not_sent' }, 'a retry before any write is provably safe')

    ledger.markWritten('cmd-1', 'native:q1')
    assert.deepEqual(ledger.beginSend('cmd-1', 'native:q1'), { proceed: false, state: 'written' }, 'after the intention mark the outcome is unknown')

    ledger.markAccepted('cmd-1', 'native:q1', 'native-ack-9')
    const accepted = ledger.get('cmd-1', 'native:q1')!
    assert.equal(accepted.delivery, 'native_accepted')
    assert.equal(accepted.nativeRef, 'native-ack-9')
    assert.deepEqual(ledger.beginSend('cmd-1', 'native:q1'), { proceed: false, state: 'native_accepted' })

    assert.deepEqual(ledger.beginSend('cmd-2', 'native:q2'), { proceed: true, state: 'not_sent' })
    ledger.markIndeterminate('cmd-2', 'native:q2', 'ack lost')
    assert.deepEqual(ledger.beginSend('cmd-2', 'native:q2'), { proceed: false, state: 'indeterminate' })
    assert.match(ledger.get('cmd-2', 'native:q2')!.error!, /ack lost/)
  })
})

test('an unknown send parks its queue row while the ledger records indeterminate, and neither is retried', async () => {
  await withStore(async ({ store }) => {
    let now = 0
    const effects = new Effects(store.queue, undefined, () => now)
    let sends = 0
    effects.handle('native_send', async (_payload, key) => {
      const target = `native:${key}`
      const begin = store.dispatch.beginSend(key, target)
      if (!begin.proceed) throw new UnknownSend(`blocked in ${begin.state}`, 'state_indeterminate')
      sends++
      store.dispatch.markWritten(key, target)
      store.dispatch.markIndeterminate(key, target, 'ack lost after write')
      throw new UnknownSend('ack lost after write', 'transport_lost')
    })
    effects.enqueue('native_send', 'q1', {})
    effects.start()
    await effects.idle()
    assert.equal(sends, 1)
    assert.equal(store.queue.parked('native_send').length, 1)
    assert.equal(store.dispatch.get('q1', 'native:q1')!.delivery, 'indeterminate')

    // Restart and a due time both leave the parked row alone; a reconcile pass owns it now.
    now = 10_000_000
    const restarted = new Effects(store.queue, undefined, () => now)
    restarted.handle('native_send', () => Promise.resolve())
    restarted.start()
    await restarted.idle()
    assert.equal(store.queue.parked('native_send').length, 1)
    assert.equal(store.dispatch.get('q1', 'native:q1')!.delivery, 'indeterminate')
  })
})
