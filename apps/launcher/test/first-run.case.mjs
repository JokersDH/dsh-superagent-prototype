/**
 * `firstRun` must stay runnable in four real situations without borrowing a default root or crashing
 * on a null provenance record:
 *   1. empty install root + empty config root (fresh source checkout, nothing built);
 *   2. source checkout whose config root already has a `pa build` release manifest;
 *   3. complete distribution install + empty overridden config root (adoption);
 *   4. distribution install whose recorded release bytes drifted (refusal, nothing written).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { firstRun } from '../lib/first-run.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const privateDir = (root, name) => {
  const path = join(root, name)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
  return path
}

const rootsFor = (installPath, configRoot, root) => ({
  install: installPath,
  config: configRoot,
  data: join(root, 'data'),
  cache: join(root, 'cache'),
  logs: join(root, 'logs'),
  workspace: join(root, 'workspace'),
})

const releaseDocument = (buildId, commit) => ({
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

function makeDistribution(root, { name = 'install', buildId = 'build-ffffffffffffffff', commit = 'f'.repeat(40), drift = false } = {}) {
  const install = join(root, name)
  const app = join(install, 'app')
  mkdirSync(join(app, 'apps/console/dist'), { recursive: true, mode: 0o755 })
  writeFileSync(join(app, 'apps/console/dist/index.html'), '<div id="root"></div>')
  const releaseBytes = Buffer.from(`${JSON.stringify(releaseDocument(buildId, commit), null, 2)}\n`)
  mkdirSync(join(install, 'var/config'), { recursive: true, mode: 0o700 })
  writeFileSync(join(install, 'var/config/release.json'), releaseBytes)
  const manifestFiles = [{ path: 'var/config/release.json', kind: 'file', bytes: releaseBytes.byteLength, sha256: sha256(releaseBytes) }]
  if (drift) {
    const drifted = Buffer.from(releaseBytes)
    drifted[drifted.indexOf(Buffer.from('2026-11-11T00:00:00.000Z')) + 17] = '1'.charCodeAt(0)
    writeFileSync(join(install, 'var/config/release.json'), drifted)
  }
  writeFileSync(join(install, 'install.json'), `${JSON.stringify({
    format: 'pa-install', formatVersion: 1, buildId, source: { commit }, appRoot: 'app', files: manifestFiles,
  }, null, 2)}\n`)
  return { install, app }
}

test('fresh source checkout with an empty config root returns an explicit unverified release state', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-first-run-empty-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const checkout = join(root, 'checkout')
  mkdirSync(join(checkout, 'apps', 'launcher'), { recursive: true })
  writeFileSync(join(checkout, 'package.json'), '{}\n')
  const config = privateDir(root, 'config')
  const result = await firstRun({ installRoot: checkout, roots: rootsFor(checkout, config, root) })
  assert.equal(result.status, 'OK')
  assert.equal(result.release.reason, 'release_missing_development')
  assert.equal(result.release.provenance, 'unverified')
  assert.equal(result.release.buildId, null)
  assert.equal(result.release.commit, null)
  assert.equal(typeof result.release.hint, 'string')
  // No fabricated release is written into the private root.
  assert.throws(() => readFileSync(join(config, 'release.json')))
})

test('source checkout with an existing build release reports it as unverified provenance', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-first-run-source-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const checkout = join(root, 'checkout')
  mkdirSync(join(checkout, 'apps', 'launcher'), { recursive: true })
  writeFileSync(join(checkout, 'package.json'), '{}\n')
  const config = privateDir(root, 'config')
  writeFileSync(join(config, 'release.json'), `${JSON.stringify(releaseDocument('build-source-0001', 'c'.repeat(40)), null, 2)}\n`)
  const before = readFileSync(join(config, 'release.json'))
  const result = await firstRun({ installRoot: checkout, roots: rootsFor(checkout, config, root) })
  assert.equal(result.status, 'OK')
  assert.equal(result.release.reason, 'unverified_source_build')
  assert.equal(result.release.provenance, 'unverified')
  assert.equal(result.release.buildId, 'build-source-0001')
  assert.equal(result.release.commit, 'c'.repeat(40))
  assert.equal(result.release.digest, null)
  assert.ok(readFileSync(join(config, 'release.json')).equals(before), 'first-run must not rewrite a source release')
})

test('a complete distribution install adopts its release into an overridden config root', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-first-run-install-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { app } = makeDistribution(root)
  const config = privateDir(root, 'config')
  const result = await firstRun({ installRoot: app, roots: rootsFor(app, config, root) })
  assert.equal(result.status, 'OK')
  assert.equal(result.release.reason, 'initialized_from_install')
  assert.equal(result.release.provenance, 'install_inventory')
  assert.equal(result.release.buildId, 'build-ffffffffffffffff')
  assert.equal(typeof result.release.digest, 'string')
  assert.equal(result.release.digest.length, 64)
})

test('a drifted distribution release blocks first-run and writes nothing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-first-run-drift-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { app } = makeDistribution(root, { drift: true })
  const config = privateDir(root, 'config')
  const result = await firstRun({ installRoot: app, roots: rootsFor(app, config, root) })
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.code, 'install_manifest_tampered')
  assert.throws(() => readFileSync(join(config, 'release.json')), 'a refused first-run must not write a release manifest')
})
