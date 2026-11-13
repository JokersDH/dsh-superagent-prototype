/** Complete backup bundle: consistent snapshot, referenced artifacts, exclusions and fail-closed verification. */
import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { ProductStore } from '@personal-agent/storage'
import {
  BUNDLE_FORMAT,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  PortabilityError,
  canonicalJson,
  createBundle,
  manifestDigest,
  readTarGz,
  validateManifest,
  verifyBundle,
  writeTarGz,
} from '../src/index.ts'

const temp = (name: string) => mkdtempSync(join(tmpdir(), `pa-bundle-${name}-`))

interface StateContext {
  readonly root: string
  readonly stateDir: string
  readonly store: ProductStore
  readonly artifactId: string
  readonly artifactBytes: Buffer
}

function makeState(name: string): StateContext {
  const root = temp(name)
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  const artifactBytes = Buffer.from('frozen candidate evidence\n')
  const written = store.artifacts.write(artifactBytes)
  store.artifacts.insert(written)
  store.queue.enqueue('launch', 'attempt-1', JSON.stringify({ ticket: 't1' }), 1, 0, new Date().toISOString())
  store.events.append({ topic: 'bundle.test', entityRef: 'e1', payload: { n: 1 } })
  writeFileSync(
    join(stateDir, 'native-projects.json'),
    JSON.stringify({ version: 1, projects: [{ id: 'project-a', path: '/Users/example/repo', displayName: 'repo', check: { executable: 'node' }, environment: { policy: 'offline_install', storeDir: '/Users/example/store' } }] }),
    { mode: 0o600 },
  )
  writeFileSync(join(stateDir, 'api.key'), 'f'.repeat(64), { mode: 0o600 })
  writeFileSync(join(stateDir, 'workbench.json'), '{"pid":123}', { mode: 0o600 })
  writeFileSync(join(stateDir, 'scratch-project.json'), '{"path":"/tmp/pa-project-x"}', { mode: 0o600 })
  mkdirSync(join(stateDir, 'environments/attempt-1'), { recursive: true, mode: 0o700 })
  writeFileSync(join(stateDir, 'environments/attempt-1/receipt.json'), '{"signature":"old-machine"}', { mode: 0o600 })
  writeFileSync(join(stateDir, 'artifacts', 'orphan.bin'), 'unreferenced', { mode: 0o600 })
  mkdirSync(join(root, 'cache'), { recursive: true, mode: 0o700 })
  return { root, stateDir, store, artifactId: written.id, artifactBytes }
}

async function create(context: StateContext, name = 'bundle.pab') {
  return createBundle({
    stateDir: context.stateDir,
    outputPath: join(context.root, name),
    stagingRoot: join(context.root, 'cache'),
    productVersion: '0.1.0',
    instance: { running: true, access: 'local-development' },
    now: new Date('2026-11-10T05:00:00.000Z'),
  })
}

async function extractEntry(bundlePath: string, entryPath: string, destination: string): Promise<void> {
  let fd: number | null = null
  await readTarGz(bundlePath, {
    start(entry) {
      if (entry.path === entryPath) fd = openSync(destination, 'w', 0o600)
    },
    chunk(chunk) {
      if (fd !== null) writeSync(fd, chunk)
    },
    end() {
      if (fd !== null) {
        closeSync(fd)
        fd = null
      }
    },
  })
}

test('a bundle captures the snapshot, referenced artifacts and bindings, and excludes credentials/authority', async (t) => {
  const context = makeState('complete')
  try {
    const result = await create(context)
    const manifest = result.manifest
    assert.equal(manifest.format, BUNDLE_FORMAT)
    assert.equal(manifest.source.stateName, 'state')
    assert.equal(manifest.source.instanceRunning, true)
    assert.ok(manifest.entries.some((entry) => entry.path === DATABASE_ENTRY))
    assert.ok(manifest.entries.some((entry) => entry.path === `artifacts/${context.artifactId}`))
    assert.ok(manifest.entries.some((entry) => entry.path === 'config/native-projects.json'))
    assert.equal(manifest.artifactRefs.length, 1)
    assert.equal(manifest.database.integrity, 'ok')
    assert.equal(manifest.database.foreignKeyViolations, 0)
    assert.ok((manifest.database.productSchema ?? 0) >= 1)
    assert.equal(manifest.selection.includeProjectContent, false)
    const excluded = new Map(manifest.selection.excluded.map((entry) => [entry.path, entry.reason]))
    assert.equal(excluded.get('api.key'), 'credential')
    assert.equal(excluded.get('workbench.json'), 'launcher-runtime-record')
    assert.equal(excluded.get('scratch-project.json'), 'development-fixture-reference')
    assert.equal(excluded.get('environments'), 'machine-bound-environment-authority')
    assert.match(excluded.get('artifacts') ?? '', /unreferenced-or-temporary-files:2/)
    assert.ok(manifest.pathMap.some((binding) => binding.role === 'project' && binding.original === '/Users/example/repo'))
    assert.ok(manifest.pathMap.some((binding) => binding.role === 'project-environment' && binding.original === '/Users/example/store'))
    assert.ok(!manifest.entries.some((entry) => entry.path.endsWith('.key')))
    assert.ok(statSync(result.bundlePath).size > 0)

    const verified = await verifyBundle(result.bundlePath, { stagingRoot: join(context.root, 'cache') })
    assert.equal(verified.manifestDigest, manifestDigest(manifest))
    assert.equal(verified.entries[0]?.path, MANIFEST_ENTRY)
    assert.equal(verified.database.integrity, 'ok')
    assert.equal(verified.database.foreignKeyViolations, 0)
    const listed = new Set(verified.manifest.entries.map((entry) => entry.path))
    assert.ok(!listed.has('api.key'))
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

test('a live writer during the snapshot still yields a consistent, gap-free database', { timeout: 120_000 }, async (t) => {
  const context = makeState('consistent')
  try {
    let appended = 0
    // Bounded writes keep the WAL active while the online backup runs; an unbounded hammer would
    // make SQLite restart the backup forever (engine behavior, not a bundle defect).
    const writer = (async () => {
      for (let index = 0; index < 40; index += 1) {
        context.store.events.append({ topic: 'bundle.live', entityRef: 'e-live', payload: { n: index } })
        appended += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    })()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const result = await create(context, 'live.pab')
    await writer
    assert.ok(appended > 0)

    const verified = await verifyBundle(result.bundlePath, { stagingRoot: join(context.root, 'cache') })
    assert.equal(verified.database.integrity, 'ok')
    assert.equal(verified.database.foreignKeyViolations, 0)

    // Inspect the archived database directly: the event sequence is contiguous and queued business
    // is preserved in place (verification never dispatches it).
    const extracted = join(context.root, 'extracted.sqlite')
    await extractEntry(result.bundlePath, DATABASE_ENTRY, extracted)
    const db = new Database(extracted, { readonly: true })
    try {
      const stats = db.prepare('SELECT MIN(seq) AS min, MAX(seq) AS max, COUNT(*) AS count FROM event_log').get() as {
        min: number
        max: number
        count: number
      }
      assert.equal(stats.count, stats.max - stats.min + 1, 'event log has no gap')
      const queue = db.prepare("SELECT COUNT(*) AS count FROM effect WHERE kind = 'launch'").get() as { count: number }
      assert.equal(queue.count, 1, 'queued business is preserved, not removed or replayed')
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM command_receipts').get() as { count: number }).count, 0)
      assert.equal(String(db.pragma('integrity_check', { simple: true })), 'ok')
    } finally {
      db.close()
    }
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

test('missing or corrupted referenced artifacts fail the backup instead of being skipped', async (t) => {
  const missing = makeState('missing')
  try {
    const artifactPath = join(missing.stateDir, 'artifacts', missing.artifactId)
    unlinkSync(artifactPath)
    await assert.rejects(() => create(missing), (error) => error instanceof PortabilityError && error.code === 'artifact_missing')
  } finally {
    missing.store.close()
    rmSync(missing.root, { recursive: true, force: true })
  }
  const corrupt = makeState('corrupt')
  try {
    writeFileSync(join(corrupt.stateDir, 'artifacts', corrupt.artifactId), 'tampered bytes', { mode: 0o600 })
    await assert.rejects(
      () => create(corrupt),
      (error) => error instanceof PortabilityError && error.code === 'artifact_digest_mismatch',
    )
  } finally {
    corrupt.store.close()
    rmSync(corrupt.root, { recursive: true, force: true })
  }
})

test('verification refuses truncated, unsupported-version and manifest-mismatched bundles', async (t) => {
  const context = makeState('verify-negatives')
  try {
    const valid = await create(context, 'valid.pab')
    const cache = join(context.root, 'cache')

    const truncated = join(context.root, 'truncated.pab')
    const bytes = readFileSync(valid.bundlePath)
    writeFileSync(truncated, bytes.subarray(0, bytes.length - 12))
    await assert.rejects(() => verifyBundle(truncated, { stagingRoot: cache }), (error) => error instanceof PortabilityError && error.code === 'archive_invalid')

    const extracted = join(context.root, 'db.sqlite')
    await extractEntry(valid.bundlePath, DATABASE_ENTRY, extracted)
    const dbBytes = readFileSync(extracted)
    const artifactPath = `artifacts/${context.artifactId}`
    const artifactBytes = readFileSync(join(context.stateDir, artifactPath))
    const manifest = validateManifest(JSON.parse(JSON.stringify(valid.manifest)))

    const futureVersion = join(context.root, 'future.pab')
    await writeTarGz(futureVersion, [
      { path: MANIFEST_ENTRY, source: Buffer.from(`${JSON.stringify({ ...manifest, formatVersion: 2 })}\n`) },
      { path: DATABASE_ENTRY, source: dbBytes },
      { path: artifactPath, source: artifactBytes },
      { path: 'config/native-projects.json', source: readFileSync(join(context.stateDir, 'native-projects.json')) },
    ])
    await assert.rejects(
      () => verifyBundle(futureVersion, { stagingRoot: cache }),
      (error) => error instanceof PortabilityError && error.code === 'manifest_version_unsupported',
    )

    const tamperedManifest = {
      ...manifest,
      entries: manifest.entries.map((entry) =>
        entry.path === artifactPath ? { ...entry, sha256: 'b'.repeat(64) } : entry,
      ),
    }
    const tampered = join(context.root, 'tampered.pab')
    await writeTarGz(tampered, [
      { path: MANIFEST_ENTRY, source: Buffer.from(`${canonicalJson(validateManifest(tamperedManifest))}\n`) },
      { path: DATABASE_ENTRY, source: dbBytes },
      { path: artifactPath, source: artifactBytes },
      { path: 'config/native-projects.json', source: readFileSync(join(context.stateDir, 'native-projects.json')) },
    ])
    await assert.rejects(
      () => verifyBundle(tampered, { stagingRoot: cache }),
      (error) => error instanceof PortabilityError && error.code === 'bundle_digest_mismatch',
    )

    const missingEntry = join(context.root, 'missing-entry.pab')
    await writeTarGz(missingEntry, [
      { path: MANIFEST_ENTRY, source: Buffer.from(`${canonicalJson(manifest)}\n`) },
      { path: DATABASE_ENTRY, source: dbBytes },
    ])
    await assert.rejects(
      () => verifyBundle(missingEntry, { stagingRoot: cache }),
      (error) => error instanceof PortabilityError && error.code === 'archive_invalid',
    )
  } finally {
    context.store.close()
    rmSync(context.root, { recursive: true, force: true })
  }
})

test('a bundle cannot be created for a state without a product database', async (t) => {
  const root = temp('no-db')
  try {
    const stateDir = join(root, 'state')
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
    mkdirSync(join(root, 'cache'), { recursive: true, mode: 0o700 })
    await assert.rejects(
      () => createBundle({ stateDir, outputPath: join(root, 'x.pab'), stagingRoot: join(root, 'cache') }),
      (error) => error instanceof PortabilityError && error.code === 'database_unavailable',
    )
    assert.equal(existsSync(join(root, 'x.pab')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
