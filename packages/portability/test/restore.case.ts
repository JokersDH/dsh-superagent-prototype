/** Restore activates only a verified bundle in a brand-new directory and never replays business. */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { ProductStore } from '@personal-agent/storage'
import {
  DATABASE_ENTRY,
  PortabilityError,
  createBundle,
  readRestoreReport,
  restoreBundle,
} from '../src/index.ts'

const temp = (name: string) => mkdtempSync(join(tmpdir(), `pa-restore-${name}-`))

async function makeBundle(name: string) {
  const root = temp(name)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  const artifactBytes = Buffer.from('restore evidence bytes\n')
  const written = store.artifacts.write(artifactBytes)
  store.artifacts.insert(written)
  store.queue.enqueue('launch', 'attempt-1', JSON.stringify({ ticket: 't1' }), 1, 0, new Date().toISOString())
  store.events.append({ topic: 'restore.test', entityRef: 'e1', payload: { n: 1 } })
  writeFileSync(
    join(stateDir, 'native-projects.json'),
    JSON.stringify({ version: 1, projects: [{ id: 'project-a', path: '/old/repo', displayName: 'repo', check: { executable: 'node' }, environment: { policy: 'offline_install', storeDir: '/old/store' } }] }),
    { mode: 0o600 },
  )
  writeFileSync(join(stateDir, 'api.key'), 'f'.repeat(64), { mode: 0o600 })
  mkdirSync(join(root, 'cache'), { recursive: true, mode: 0o700 })
  const bundle = await createBundle({
    stateDir,
    outputPath: join(root, 'state.pab'),
    stagingRoot: join(root, 'cache'),
    productVersion: '0.1.0',
  })
  return { root, stateDir, store, bundle, artifactId: written.id, artifactBytes }
}

test('restore activates a verified bundle into a new private state directory with explicit remapping', async (t) => {
  const context = await makeBundle('roundtrip')
  try {
    const target = join(context.root, 'restored')
    const result = await restoreBundle({
      bundlePath: context.bundle.bundlePath,
      targetStateDir: target,
      stagingRoot: join(context.root, 'cache'),
      mapPaths: [
        { from: '/old/repo', to: '/new/repo' },
        { from: '/old/store', to: '/new/store' },
      ],
    })
    assert.equal(statLstat(target).mode & 0o777, 0o700)
    assert.equal(statLstat(join(target, 'state.sqlite')).mode & 0o777, 0o600)
    assert.equal(result.report.database.integrity, 'ok')
    assert.equal(result.report.database.foreignKeyViolations, 0)
    assert.deepEqual(result.report.pathMappings.pendingRebind, [])
    assert.equal(result.report.pathMappings.applied.length, 2)
    assert.deepEqual(result.report.pathMappings.unmatchedMappings, [])
    const report = readRestoreReport(target)
    assert.equal(report?.protocol, 'personal-restore/1')
    assert.ok(report.requiresRevalidation.some((line) => /Native authentication/.test(line)))

    // Artifact bytes and identity are preserved; no credential/runtime record is restored.
    const restoredArtifact = join(target, 'artifacts', context.artifactId)
    assert.deepEqual(readFileSync(restoredArtifact), context.artifactBytes)
    assert.equal(existsSync(join(target, 'api.key')), false)
    assert.equal(existsSync(join(target, 'workbench.json')), false)
    const projects = JSON.parse(readFileSync(join(target, 'native-projects.json'), 'utf8'))
    assert.equal(projects.projects[0].path, '/new/repo')
    assert.equal(projects.projects[0].environment.storeDir, '/new/store')
    assert.equal(projects.projects[0].id, 'project-a', 'identity is preserved across remapping')

    // The restored database is readable, consistent, and its queued business was not dispatched.
    const db = new Database(join(target, 'state.sqlite'), { readonly: true })
    try {
      assert.equal(String(db.pragma('integrity_check', { simple: true })), 'ok')
      const queue = db.prepare("SELECT COUNT(*) AS count FROM effect WHERE kind = 'launch'").get() as { count: number }
      assert.equal(queue.count, 1, 'queued business is preserved')
      const receipts = db.prepare('SELECT COUNT(*) AS count FROM command_receipts').get() as { count: number }
      assert.equal(receipts.count, 0, 'restore did not dispatch anything')
      const artifacts = db.prepare('SELECT id FROM artifacts').all() as { id: string }[]
      assert.deepEqual(artifacts.map((row) => row.id), [context.artifactId])
    } finally {
      db.close()
    }
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

test('entries that are not remapped stay pending rebind and never claim a new path', async (t) => {
  const context = await makeBundle('pending')
  try {
    const target = join(context.root, 'restored')
    const result = await restoreBundle({ bundlePath: context.bundle.bundlePath, targetStateDir: target, stagingRoot: join(context.root, 'cache') })
    assert.deepEqual([...result.report.pathMappings.pendingRebind].sort(), ['/old/repo', '/old/store'])
    assert.equal(result.report.pathMappings.applied.length, 0)
    const projects = JSON.parse(readFileSync(join(target, 'native-projects.json'), 'utf8'))
    assert.equal(projects.projects[0].path, '/old/repo', 'paths are never silently rewritten')
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

test('restore refuses an existing non-empty target and leaves it untouched', async (t) => {
  const context = await makeBundle('nonempty')
  try {
    const target = join(context.root, 'restored')
    mkdirSync(target, { recursive: true, mode: 0o700 })
    writeFileSync(join(target, 'keep.txt'), 'do not overwrite', { mode: 0o600 })
    await assert.rejects(
      () => restoreBundle({ bundlePath: context.bundle.bundlePath, targetStateDir: target, stagingRoot: join(context.root, 'cache') }),
      (error) => error instanceof PortabilityError && error.code === 'target_not_empty',
    )
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'do not overwrite')
    assert.equal(existsSync(join(target, 'state.sqlite')), false)
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

test('a failed verification never creates or empties the target', async (t) => {
  const context = await makeBundle('verify-fail')
  try {
    const target = join(context.root, 'restored')
    const truncated = join(context.root, 'bad.pab')
    const bytes = readFileSync(context.bundle.bundlePath)
    writeFileSync(truncated, bytes.subarray(0, bytes.length - 16))
    await assert.rejects(
      () => restoreBundle({ bundlePath: truncated, targetStateDir: target, stagingRoot: join(context.root, 'cache') }),
      (error) => error instanceof PortabilityError && error.code === 'archive_invalid',
    )
    assert.equal(existsSync(target), false)
    assert.deepEqual(readdirSync(context.root).filter((name) => name.startsWith('.pa-restore-')), [])
    const stagingCache = readdirSync(join(context.root, 'cache')).filter((name) => name.startsWith('pa-verify-'))
    assert.deepEqual(stagingCache, [], 'verification staging is cleaned up')
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

const statLstat = (path: string) => lstatSync(path)
