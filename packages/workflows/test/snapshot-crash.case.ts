/** Wave-13 A7: snapshot registration before/after is a real process crash, not an in-memory flag. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '@personal-agent/storage'
import { WorkflowSnapshots } from '../src/index.ts'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'snapshot-crash.mjs')

function run(mode: 'before' | 'after') {
  const root = mkdtempSync(join(tmpdir(), `snapshot-crash-${mode}-`)), db = join(root, 'state.sqlite'), snapshot = join(root, 'snapshot')
  const child = spawnSync(process.execPath, [fixture, db, snapshot, mode], { encoding: 'utf8', timeout: 20000 })
  assert.equal(child.signal, 'SIGKILL', child.stderr)
  return { root, db, snapshot }
}

test('SIGKILL before snapshot creation leaves committed source data and no snapshot', () => {
  const { root, db, snapshot } = run('before')
  try {
    assert.equal(existsSync(snapshot), false)
    const store = new ProductStore({ path: db })
    try { assert.equal(store.product.works.get('snapshot-work')?.title, 'Snapshot crash work') } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SIGKILL after snapshot creation leaves a verifiable snapshot with the committed work', () => {
  const { root, db, snapshot } = run('after')
  try {
    const store = new ProductStore({ path: db })
    try {
      const verification = new WorkflowSnapshots(store).verify(snapshot)
      assert.equal(verification.status, 'ok', verification.message)
      assert.equal(verification.database.integrity, 'ok')
      assert.equal(verification.artifacts.length, 1)
      assert.equal(verification.artifacts[0]?.status, 'ok')
    } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a partial snapshot directory without a manifest is blocked, never a usable complete backup', () => {
  const { root, db, snapshot } = run('after')
  try {
    const store = new ProductStore({ path: db })
    try {
      rmSync(join(snapshot, 'snapshot.json'))
      const verification = new WorkflowSnapshots(store).verify(snapshot)
      assert.equal(verification.status, 'blocked')
      assert.match(verification.message ?? '', /manifest|missing/i)
    } finally { store.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
