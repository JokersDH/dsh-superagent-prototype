/** OPS-03: consistent backup with WAL active, verified restore, and no automatic business resend after restore. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { backupDatabase, ProductStore, verifyDatabase } from '../src/index.ts'
import { makeStore, tempDir } from './helpers.ts'

test('backup while WAL is active restores a consistent snapshot, and opening it dispatches nothing', async () => {
  const source = makeStore()
  const restoreDir = tempDir('storage-restore-')
  try {
    // Live data across every family the product relies on.
    source.store.domain.tickets.save({ id: 't1', assignments: [], undelivered: [] })
    source.store.commands.record('cmd-1', 'digest-a', () => ({ ok: true }))
    source.store.queue.enqueue('launch', 'a1', '{}', 1, 0, 'now')
    source.store.channels.add({ id: 'm1', channel: { source: 'chat', thread: 'c', address: {} }, text: 'hi', kind: 'reply' })
    source.store.answers.record('ans-1', { questionId: 'q1', expectedVersion: 1, digest: 'd', answer: {} })
    source.store.answers.upsertDelivery('ans-1', 'target-1', 'local_recorded')
    assert.equal(String(source.store.db.pragma('journal_mode', { simple: true })), 'wal')

    const destination = join(restoreDir, 'restored.sqlite')
    const result = await backupDatabase(source.store.db, destination)
    assert.equal(result.integrity, 'ok')
    assert.equal(result.foreignKeyViolations, 0)
    assert.ok(result.bytes > 0)
    assert.equal(result.productSchema, source.store.database.productSchema)

    const verified = verifyDatabase(destination)
    assert.deepEqual(verified, { integrity: 'ok', foreignKeyViolations: 0, productSchema: source.store.database.productSchema })

    // Opening the restored copy (in reconcile mode) must not start the effect queue or resend business.
    const restored = new ProductStore({ path: destination })
    try {
      assert.equal(restored.domain.tickets.get('t1')?.id, 't1')
      assert.equal(restored.commands.get('cmd-1')?.payloadDigest, 'digest-a')
      assert.equal(restored.queue.stats('launch').waiting, 1, 'queued business is preserved, not auto-dispatched')
      assert.equal(restored.channels.status('m1'), 'pending')
      assert.deepEqual(restored.answers.deliveries('ans-1').map(delivery => delivery.status), ['local_recorded'])
      assert.deepEqual(restored.database.checkIntegrity(), { integrity: 'ok', foreignKeyViolations: 0 })
    } finally { restored.close() }
  } finally {
    source.store.close()
    rmSync(source.dir, { recursive: true, force: true })
    rmSync(restoreDir, { recursive: true, force: true })
  }
})
