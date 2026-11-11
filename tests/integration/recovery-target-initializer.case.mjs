import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore, PRODUCT_SCHEMA_VERSION } from '../../packages/storage/dist/index.js'
import { initializeRecoveryTarget } from '../../apps/coordinator/product/recovery-target-initializer.ts'

const material = stateRoot => ({ protocol: 'recovery-target-material/1', activationId: 'activation', generationId: 'generation', stateRoot,
  intentDigest: 'a'.repeat(64), configurationDigest: 'b'.repeat(64), manifestDigest: 'c'.repeat(64), productSchema: PRODUCT_SCHEMA_VERSION,
  preparedAt: '2026-11-11T00:00:00.000Z', startupAvailable: false })
function root(t) {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'pa-target-init-')))
  chmodSync(value, 0o700); t.after(() => rmSync(value, { recursive: true, force: true })); return value
}
test('exclusive initialization uses the production schema with no business queues or writer claim', async t => {
  const target = root(t)
  await initializeRecoveryTarget(material(target))
  const store = new ProductStore({ path: join(target, 'state.sqlite') })
  try {
    assert.equal(store.database.productSchema, PRODUCT_SCHEMA_VERSION)
    assert.equal(store.database.checkIntegrity().integrity, 'ok')
    assert.equal(store.domain.tickets.list().length, 0)
    assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 20).length, 0)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM writer_claim').get().n, 0)
  } finally { store.close() }
  const before = readFileSync(join(target, 'state.sqlite'))
  await assert.rejects(initializeRecoveryTarget(material(target)))
  assert.deepEqual(readFileSync(join(target, 'state.sqlite')), before)
})
test('foreign, partial and symlinked targets are never opened, migrated or overwritten', async t => {
  const target = root(t), partial = Buffer.from('foreign or interrupted database')
  writeFileSync(join(target, 'state.sqlite'), partial)
  await assert.rejects(initializeRecoveryTarget(material(target)))
  assert.deepEqual(readFileSync(join(target, 'state.sqlite')), partial)
  const linkParent = root(t), link = join(linkParent, 'alias')
  symlinkSync(target, link)
  await assert.rejects(initializeRecoveryTarget(material(link)))
  assert.deepEqual(readFileSync(join(target, 'state.sqlite')), partial)
})
test('non-private or wrong-schema material is rejected before database creation', async t => {
  const target = root(t)
  chmodSync(target, 0o755)
  await assert.rejects(initializeRecoveryTarget(material(target)))
  chmodSync(target, 0o700)
  await assert.rejects(initializeRecoveryTarget({ ...material(target), productSchema: PRODUCT_SCHEMA_VERSION + 1 }))
})
