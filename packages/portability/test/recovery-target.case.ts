/**
 * D3: private recovery-target materialization. No process is started, no database/credential/queue is
 * copied, and every write stays inside the constructor-configured trusted private parent.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PortabilityError,
  PortabilityRecoveryTargetMaterializer,
  RECOVERY_TARGET_MANIFEST_FILE,
} from '../src/index.ts'

const base = () => join(tmpdir(), `pa-target-${process.pid}-${Math.random().toString(16).slice(2)}`)
const privateDir = (path: string) => { mkdirSync(path, { recursive: true }); chmodSync(path, 0o700); return path }
const preparation = (activationId = 'activation-1', sourceRoot = '/Users/example/state', generationId = 'generation-1') => ({
  protocol: 'recovery-target-preparation/1' as const,
  source: {
    protocol: 'recovery-activation-commit/1',
    intent: {
      protocol: 'recovery-activation-intent/1',
      activationId,
      commandId: `command-${activationId}`,
      planId: 'plan-1',
      planDigest: 'b'.repeat(64),
      source: { stateId: 'state-old', stateRoot: sourceRoot, markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
      target: { generationId, stateRoot: `/tmp/target-${activationId}`, configurationDigest: 'e'.repeat(64) },
      principal: { userId: 'local-user', authorityRef: 'authority-1' },
      machineDigest: 'f'.repeat(64),
      resourcePolicyDigest: 'a'.repeat(64),
      createdAt: '2026-11-11T00:00:00.000Z',
      expiresAt: '2026-11-11T00:05:00.000Z',
    },
    sourceReceipt: { commandId: `command-${activationId}`, seq: 1 },
  },
  configuration: {
    protocol: 'recovery-target-configuration/1' as const,
    projects: [{ sourceProjectId: 'project-a', targetProjectId: 'project-a-copy', registration: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'ref' } }],
    executor: { profileId: 'fixture', profileVersion: '1' },
  },
  startupAvailable: false as const,
})

test('prepare creates a private manifest-only target with no database or credential', async () => {
  const parent = privateDir(join(base(), 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    const material = await materializer.prepare(preparation())
    assert.equal(material.startupAvailable, false)
    assert.equal(material.productSchema, 15)
    assert.equal(material.generationId, 'generation-1')
    assert.ok(material.intentDigest.startsWith('sha256:'))
    assert.ok(material.configurationDigest.startsWith('sha256:'))
    const targetRoot = join(parent, 'activation-1')
    assert.equal(material.stateRoot, targetRoot)
    assert.deepEqual(readdirSync(targetRoot), [RECOVERY_TARGET_MANIFEST_FILE])
    assert.equal(existsSync(join(targetRoot, 'state.sqlite')), false)
    assert.equal(existsSync(join(targetRoot, 'credential')), false)
    const mode = (await import('node:fs')).statSync(targetRoot).mode & 0o777
    assert.equal(mode, 0o700)
    const manifestMode = (await import('node:fs')).statSync(join(targetRoot, RECOVERY_TARGET_MANIFEST_FILE)).mode & 0o777
    assert.equal(manifestMode, 0o600)
    assert.equal((await materializer.read(targetRoot))?.manifestDigest, material.manifestDigest)
  } finally { rmSync(parent, { recursive: true, force: true }) }
})

test('repeat prepare with the same identity is idempotent, a different digest is refused', async () => {
  const parent = privateDir(join(base(), 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    const first = await materializer.prepare(preparation())
    const second = await materializer.prepare(preparation())
    assert.equal(second.manifestDigest, first.manifestDigest)
    const changed = preparation('activation-1')
    changed.configuration = { ...changed.configuration, executor: { profileId: 'other', profileVersion: '1' } }
    await assert.rejects(() => materializer.prepare(changed), (error: unknown) =>
      error instanceof PortabilityError && error.code === 'target_identity_mismatch')
  } finally { rmSync(parent, { recursive: true, force: true }) }
})

test('the trusted parent must be absolute, private, owned and not a symlink', () => {
  const root = base()
  const loose = privateDir(root)
  chmodSync(loose, 0o755)
  try {
    assert.throws(() => new PortabilityRecoveryTargetMaterializer({ trustedParent: 'relative/path', productSchema: 15 }), (error: unknown) => error instanceof PortabilityError && error.code === 'target_parent_unsafe')
    assert.throws(() => new PortabilityRecoveryTargetMaterializer({ trustedParent: loose, productSchema: 15 }), (error: unknown) => error instanceof PortabilityError && error.code === 'target_parent_unsafe')
    const parent = privateDir(join(root, 'parent'))
    const link = join(root, 'linked-parent')
    symlinkSync(parent, link)
    assert.throws(() => new PortabilityRecoveryTargetMaterializer({ trustedParent: link, productSchema: 15 }), (error: unknown) => error instanceof PortabilityError && error.code === 'target_parent_unsafe')
    assert.throws(() => new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 0 }), (error: unknown) => error instanceof PortabilityError && error.code === 'target_invalid')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a foreign directory, a foreign manifest and a preparation claiming startup are refused', async () => {
  const root = base()
  const parent = privateDir(join(root, 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    mkdirSync(join(parent, 'activation-1'), { mode: 0o700 })
    writeFileSync(join(parent, 'activation-1', 'stranger.txt'), 'x')
    await assert.rejects(() => materializer.prepare(preparation()), (error: unknown) => error instanceof PortabilityError && error.code === 'target_exists')
    rmSync(join(parent, 'activation-1'), { recursive: true, force: true })
    const claimed = { ...preparation(), startupAvailable: true } as unknown as ReturnType<typeof preparation>
    await assert.rejects(() => materializer.prepare(claimed), (error: unknown) => error instanceof PortabilityError && error.code === 'target_invalid')
    const sourceInside = preparation('activation-2', join(parent, 'old-state'))
    await assert.rejects(() => materializer.prepare(sourceInside), (error: unknown) => error instanceof PortabilityError && error.code === 'target_parent_unsafe')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('tampered manifest bytes or permissions are refused on read/update', async () => {
  const parent = privateDir(join(base(), 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    const material = await materializer.prepare(preparation())
    const manifestPath = join(material.stateRoot, RECOVERY_TARGET_MANIFEST_FILE)
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, JSON.stringify({ ...parsed, productSchema: 99 }))
    assert.throws(() => materializer.read(material.stateRoot), (error: unknown) => error instanceof PortabilityError && error.code === 'target_manifest_invalid')
    writeFileSync(manifestPath, JSON.stringify(parsed))
    chmodSync(manifestPath, 0o644)
    assert.throws(() => materializer.read(material.stateRoot), (error: unknown) => error instanceof PortabilityError && error.code === 'target_manifest_invalid')
    await assert.rejects(() => materializer.prepare(preparation()), (error: unknown) => error instanceof PortabilityError && error.code === 'target_manifest_invalid')
  } finally { rmSync(parent, { recursive: true, force: true }) }
})

test('discardStaging removes only proven-owned staging, never an initialized target', async () => {
  const parent = privateDir(join(base(), 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    const material = await materializer.prepare(preparation())
    await materializer.discardStaging('activation-unknown')
    mkdirSync(join(parent, 'activation-foreign'), { mode: 0o700 })
    await assert.rejects(() => materializer.discardStaging('activation-foreign'), (error: unknown) => error instanceof PortabilityError && error.code === 'target_not_staging')
    const init = preparation('activation-ready')
    const ready = await materializer.prepare(init)
    writeFileSync(join(ready.stateRoot, 'state.sqlite'), '')
    await assert.rejects(() => materializer.discardStaging('activation-ready'), (error: unknown) => error instanceof PortabilityError && error.code === 'target_not_staging')
    assert.equal(existsSync(join(ready.stateRoot, 'state.sqlite')), true)
    await materializer.discardStaging('activation-1')
    assert.equal(existsSync(material.stateRoot), false)
  } finally { rmSync(parent, { recursive: true, force: true }) }
})

test('a symlinked target directory and a hard-linked manifest are refused', async () => {
  const root = base()
  const parent = privateDir(join(root, 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    const elsewhere = privateDir(join(root, 'elsewhere'))
    const link = join(parent, 'activation-symlink')
    symlinkSync(elsewhere, link)
    await assert.rejects(() => materializer.prepare(preparation('activation-symlink')), (error: unknown) => error instanceof PortabilityError && error.code === 'target_exists')
    const material = await materializer.prepare(preparation('activation-hardlink'))
    const manifestPath = join(material.stateRoot, RECOVERY_TARGET_MANIFEST_FILE)
    const copyPath = join(root, 'manifest-copy.json')
    writeFileSync(copyPath, readFileSync(manifestPath))
    unlinkSync(manifestPath)
    linkSync(copyPath, manifestPath)
    assert.throws(() => materializer.read(material.stateRoot), (error: unknown) => error instanceof PortabilityError && error.code === 'target_manifest_invalid')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('materialize refuses duplicate project mappings and empty configurations', async () => {
  const parent = privateDir(join(base(), 'parent'))
  try {
    const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent: parent, productSchema: 15 })
    const duplicated = preparation()
    duplicated.configuration = {
      ...duplicated.configuration,
      projects: [duplicated.configuration.projects[0]!, duplicated.configuration.projects[0]!],
    }
    await assert.rejects(() => materializer.prepare(duplicated), (error: unknown) => error instanceof PortabilityError && error.code === 'target_identity_mismatch')
    const empty = preparation()
    empty.configuration = { ...empty.configuration, projects: [] }
    await assert.rejects(() => materializer.prepare(empty), (error: unknown) => error instanceof PortabilityError && error.code === 'target_invalid')
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
