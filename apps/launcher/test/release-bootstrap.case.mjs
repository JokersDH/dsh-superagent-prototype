/**
 * Overridden config roots must adopt the install's own release manifest, and must refuse anything
 * that is not provably that install. These cases build a small synthetic distribution tree so they
 * run in milliseconds and never touch the author checkout.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { hasInstallManifest, releaseBinding, initializeRelease } from '../lib/release-bootstrap.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const releaseFor = (buildId, commit) => ({
  format: 'pa-release',
  formatVersion: 1,
  buildId,
  createdAt: '2026-11-11T00:00:00.000Z',
  source: { commit, branch: 'codex/g3-local-distribution', dirty: false },
  producer: {
    product: 'dsh-superagent', version: '0.1.0', node: '24.21.0', pnpm: '11.7.0',
    sqlite: '3.53.4', productSchema: 13, platform: 'darwin', arch: 'arm64',
  },
  build: { consoleMode: 'http', consoleRoot: 'apps/console/dist', packageCount: 20 },
  artifacts: [
    { path: 'apps/console/dist/index.html', bytes: 19, sha256: sha256(Buffer.from('<div id="root"></div>')), kind: 'static' },
  ],
  admission: { node: '>=24.21.0 <25', platform: 'darwin', arch: 'arm64', sqlite: '>=3.53.4', abi: '137' },
  dependencies: [],
  limitations: [],
})

/** Build one synthetic install tree: <root>/install/{app,var/config}. */
function makeInstall(root, { buildId = 'build-aaaaaaaaaaaaaaaa', commit = 'a'.repeat(40), name = 'install' } = {}) {
  const install = join(root, name)
  const app = join(install, 'app')
  mkdirSync(join(app, 'apps/console/dist'), { recursive: true, mode: 0o755 })
  writeFileSync(join(app, 'apps/console/dist/index.html'), '<div id="root"></div>')
  const release = releaseFor(buildId, commit)
  const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`)
  mkdirSync(join(install, 'var/config'), { recursive: true, mode: 0o700 })
  writeFileSync(join(install, 'var/config/release.json'), releaseBytes)
  const installManifest = {
    format: 'pa-install',
    formatVersion: 1,
    createdAt: '2026-11-11T00:00:00.000Z',
    source: { commit, branch: 'codex/g3-local-distribution', dirty: false },
    buildId,
    producer: { product: 'dsh-superagent', version: '0.1.0' },
    root: install,
    appRoot: 'app',
    files: [{ path: 'var/config/release.json', kind: 'file', bytes: releaseBytes.byteLength, sha256: sha256(releaseBytes) }],
  }
  writeFileSync(join(install, 'install.json'), `${JSON.stringify(installManifest, null, 2)}\n`)
  chmodSync(join(install, 'install.json'), 0o644)
  return { install, app, release, releaseBytes, installManifest }
}

const privateDir = (root, name) => {
  const path = join(root, name)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
  return path
}

test('an overridden config root adopts the install release manifest and is idempotent', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-bootstrap-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { app } = makeInstall(root)
  const config = privateDir(root, 'config')

  const first = initializeRelease({ installRoot: app, configRoot: config })
  assert.equal(first.status, 'OK')
  assert.equal(first.adopted, true)
  assert.equal(first.reason, 'initialized_from_install')
  const written = readFileSync(join(config, 'release.json'))
  assert.equal(sha256(written), first.digest)
  assert.equal(bindingOk(app, config), true)

  const second = initializeRelease({ installRoot: app, configRoot: config })
  assert.equal(second.status, 'OK')
  assert.equal(second.adopted, false)
  assert.equal(second.reason, 'already_initialized')
})

const bindingOk = (installRoot, configRoot) => releaseBinding({ installRoot, configRoot }).bound

test('path with spaces and unicode is adopted without escaping the roots', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-unicode-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { app } = makeInstall(root, { name: '安装 目录 with space' })
  const config = privateDir(root, '配置 根 with space')
  const result = initializeRelease({ installRoot: app, configRoot: config })
  assert.equal(result.status, 'OK')
  assert.equal(bindingOk(app, config), true)
})

test('a different existing release manifest is a source conflict, not an overwrite', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-conflict-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = makeInstall(root, { buildId: 'build-1111111111111111', commit: '1'.repeat(40), name: 'install-a' })
  const second = makeInstall(root, { buildId: 'build-2222222222222222', commit: '2'.repeat(40), name: 'install-b' })
  const config = privateDir(root, 'config')
  initializeRelease({ installRoot: first.app, configRoot: config })
  const before = readFileSync(join(config, 'release.json'))
  assert.throws(
    () => initializeRelease({ installRoot: second.app, configRoot: config }),
    (error) => error.code === 'release_source_conflict' && error.detail.existing.buildId === 'build-1111111111111111' && error.detail.incoming.buildId === 'build-2222222222222222',
  )
  assert.ok(readFileSync(join(config, 'release.json')).equals(before), 'the conflicting config manifest must not be rewritten')
  assert.equal(bindingOk(second.app, config), false)

  // An explicit install switch may adopt the new source only when asked to.
  const adopted = initializeRelease({ installRoot: second.app, configRoot: config, adoptExisting: true })
  assert.equal(adopted.adopted, true)
  assert.equal(adopted.reason, 'replaced_by_explicit_switch')
  assert.equal(bindingOk(second.app, config), true)
})

test('same-size drift in the install release manifest is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-drift-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { install, app, releaseBytes } = makeInstall(root)
  const config = privateDir(root, 'config')
  const path = join(install, 'var/config/release.json')
  // Same byte length, one digit changed: an inventory digest check must catch it.
  const drifted = Buffer.from(releaseBytes)
  const index = drifted.indexOf(Buffer.from('2026-11-11T00:00:00.000Z'))
  drifted[index + 17] = '1'.charCodeAt(0)
  assert.equal(drifted.byteLength, releaseBytes.byteLength)
  writeFileSync(path, drifted)
  assert.throws(
    () => initializeRelease({ installRoot: app, configRoot: config }),
    (error) => error.code === 'install_manifest_tampered',
  )
  assert.equal(releaseBinding({ installRoot: app, configRoot: config }).bound, false)
})

test('missing install manifest, wrong install root and incomplete artifacts are refused without writing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-missing-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { install, app } = makeInstall(root)

  const bare = join(root, 'bare-install')
  mkdirSync(join(bare, 'app'), { recursive: true })
  const config = privateDir(root, 'config')
  assert.throws(() => initializeRelease({ installRoot: join(bare, 'app'), configRoot: config }), (error) => error.code === 'install_manifest_missing')
  assert.throws(() => readFileSync(join(config, 'release.json')), 'no release manifest may be written on refusal')

  // install.json declares a different appRoot.
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  writeFileSync(join(install, 'install.json'), `${JSON.stringify({ ...manifest, appRoot: 'other' }, null, 2)}\n`)
  assert.throws(() => initializeRelease({ installRoot: app, configRoot: config }), (error) => error.code === 'install_root_mismatch')

  // Restore the manifest, then remove a release-listed artifact.
  writeFileSync(join(install, 'install.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(join(app, 'apps/console/dist/index.html'))
  assert.throws(() => initializeRelease({ installRoot: app, configRoot: config }), (error) => error.code === 'install_incomplete')
})

test('release buildId/source mismatching the install manifest is refused', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { install, app } = makeInstall(root)
  const config = privateDir(root, 'config')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  writeFileSync(join(install, 'install.json'), `${JSON.stringify({ ...manifest, buildId: 'build-different' }, null, 2)}\n`)
  assert.throws(() => initializeRelease({ installRoot: app, configRoot: config }), (error) => error.code === 'release_source_mismatch')
})

test('a source checkout has no install manifest, so first-run refuses to adopt anything and does not fake a release', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-dev-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repoLike = join(root, 'checkout')
  mkdirSync(join(repoLike, 'apps', 'launcher'), { recursive: true })
  const config = privateDir(root, 'config')
  assert.equal(hasInstallManifest(repoLike), false)
  const binding = releaseBinding({ installRoot: repoLike, configRoot: config })
  assert.equal(binding.bound, false)
  assert.equal(binding.code, 'release_missing')
  assert.throws(() => initializeRelease({ installRoot: repoLike, configRoot: config }), (error) => error.code === 'install_manifest_missing')
  assert.throws(() => readFileSync(join(config, 'release.json')), 'a development root must not receive a fabricated release manifest')
})

test('releaseBinding reports the exact binding state for doctor/status', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-binding-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { app } = makeInstall(root, { buildId: 'build-bbbbbbbbbbbbbbbb', commit: 'b'.repeat(40) })
  const config = privateDir(root, 'config')
  assert.deepEqual(releaseBinding({ installRoot: app, configRoot: config }).code, 'release_missing')
  initializeRelease({ installRoot: app, configRoot: config })
  const bound = releaseBinding({ installRoot: app, configRoot: config })
  assert.equal(bound.bound, true)
  assert.equal(bound.installBuildId, 'build-bbbbbbbbbbbbbbbb')
})
