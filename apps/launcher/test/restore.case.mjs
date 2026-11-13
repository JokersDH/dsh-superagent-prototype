/** Restore/import/rollback entrypoints refuse ambiguous targets before touching any state. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ensureRoots, resolveRoots } from '@personal-agent/portability'
import { importBundle, resolveBundlePath, restoreState, rollbackState } from '../lib/restore.mjs'

function context() {
  const base = mkdtempSync(join(tmpdir(), 'pa-restore-cli-'))
  mkdirSync(join(base, 'install'), { recursive: true })
  const roots = resolveRoots({
    installRoot: join(base, 'install'),
    home: base,
    platform: 'darwin',
    overrides: {
      config: join(base, 'config'),
      data: join(base, 'data'),
      cache: join(base, 'cache'),
      logs: join(base, 'logs'),
      workspace: join(base, 'workspace'),
    },
  })
  ensureRoots(roots)
  return { base, roots }
}

test('restore requires an explicit bundle and target and never restores over the active state', async (t) => {
  const { base, roots } = context()
  try {
    assert.equal((await restoreState({ roots, values: {} })).code, 'usage')
    assert.equal((await restoreState({ roots, values: { bundle: 'x' } })).code, 'usage')
    assert.equal((await restoreState({ roots, values: { bundle: 'missing.pab', to: join(base, 'new') } })).code, 'archive_invalid')
    assert.equal((await restoreState({ roots, values: { bundle: 'missing.pab', to: roots.data } })).code, 'target_active')
    const badMap = await restoreState({ roots, values: { bundle: 'missing.pab', to: join(base, 'new'), 'map-path': ['relative=to'] } })
    assert.equal(badMap.code, 'usage')
    assert.equal(resolveBundlePath(roots, 'does-not-exist.pab'), null)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('import refuses a missing bundle and does not create a managed copy', async (t) => {
  const { base, roots } = context()
  try {
    const result = await importBundle({ roots, values: { bundle: join(base, 'missing.pab') } })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'archive_invalid')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('rollback without a verified snapshot or a real target is refused, not faked', async (t) => {
  const { base, roots } = context()
  try {
    const noSnapshot = await rollbackState({ roots, values: { target: join(base, 'unknown-state') } })
    assert.equal(noSnapshot.ok, false)
    assert.ok(['no_snapshot', 'target_invalid'].includes(noSnapshot.code))

    const missingTarget = await rollbackState({ roots, values: { bundle: 'missing.pab' } })
    assert.equal(missingTarget.ok, false)
    assert.equal(missingTarget.code, 'archive_invalid')

    const nonStateTarget = join(base, 'empty-state')
    mkdirSync(nonStateTarget, { recursive: true, mode: 0o700 })
    const notState = await rollbackState({ roots, values: { target: nonStateTarget } })
    assert.equal(notState.ok, false)
    assert.ok(['no_snapshot', 'target_invalid'].includes(notState.code))

    // A target with a database but no snapshot refuses without renaming anything.
    writeFileSync(join(nonStateTarget, 'state.sqlite'), 'not a real database', { mode: 0o600 })
    const noIndexedSnapshot = await rollbackState({ roots, values: { target: nonStateTarget } })
    assert.equal(noIndexedSnapshot.ok, false)
    assert.equal(noIndexedSnapshot.code, 'no_snapshot')
    assert.notEqual((await import('node:fs')).existsSync(`${nonStateTarget}.failed`), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('rollback refuses an active state with a live writer before any rename', { timeout: 60_000 }, async (t) => {
  const { createBundle } = await import('@personal-agent/portability')
  const { InstanceRegistry, ProductStore, WriterLock } = await import('@personal-agent/storage')
  const { readdirSync } = await import('node:fs')
  const base = mkdtempSync(join(tmpdir(), 'pa-rollback-active-'))
  mkdirSync(join(base, 'install'), { recursive: true })
  const roots = resolveRoots({
    installRoot: join(base, 'install'),
    home: base,
    platform: 'darwin',
    overrides: {
      config: join(base, 'config'),
      data: join(base, 'data'),
      cache: join(base, 'cache'),
      logs: join(base, 'logs'),
      workspace: join(base, 'workspace'),
    },
  })
  ensureRoots(roots)
  const stateDir = join(base, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  const artifact = store.artifacts.write(Buffer.from('rollback evidence\n'))
  store.artifacts.insert(artifact)
  store.queue.enqueue('application.execute', 'attempt-1', JSON.stringify({ ticket: 't1' }), 1, 0, new Date().toISOString())
  store.close()
  const bundle = await createBundle({
    stateDir,
    outputPath: join(base, 'snapshot.pab'),
    stagingRoot: roots.cache,
    productVersion: '0.1.0',
  })
  const live = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  const lock = new WriterLock(stateDir, new InstanceRegistry(live.db))
  try {
    lock.acquire()
    const refused = await rollbackState({ roots, values: { bundle: bundle.bundlePath, target: stateDir } })
    assert.equal(refused.ok, false)
    assert.ok(['state_in_use', 'writer_uncertain'].includes(refused.code), `unexpected code ${refused.code}`)
    assert.ok(existsSync(join(stateDir, 'state.sqlite')), 'active state was not moved')
    assert.deepEqual(readdirSync(base).filter((name) => name.includes('.failed-')), [], 'no failed directory was created')
    assert.deepEqual(readdirSync(stateDir).filter((name) => name.includes('.failed-')), [])

    const refusedRestore = await restoreState({ roots, values: { bundle: bundle.bundlePath, to: stateDir } })
    assert.equal(refusedRestore.ok, false)
    assert.equal(refusedRestore.code, 'state_in_use')
  } finally {
    lock.release()
    live.close()
  }
  const rolled = await rollbackState({ roots, values: { bundle: bundle.bundlePath, target: stateDir } })
  assert.equal(rolled.ok, true)
  assert.equal(rolled.status, 'ROLLED_BACK')
  assert.ok(existsSync(rolled.failedDir), 'the failed/pre-upgrade state directory is kept')
  assert.ok(existsSync(join(stateDir, 'state.sqlite')), 'the snapshot was restored into place')
  rmSync(base, { recursive: true, force: true })
})
