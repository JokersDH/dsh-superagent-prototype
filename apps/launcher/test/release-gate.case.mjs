/** Release gates: console HTTP build provenance and runtime dependency content digests. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CONSOLE_STAMP_FILE, verifyConsoleBuild, verifyRuntimeDependencies } from '../lib/release.mjs'
import { hashDirectory } from '../../../tools/distribution/stage.mjs'

function installRootWithConsole() {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-gate-'))
  mkdirSync(join(root, 'apps/console/dist/assets'), { recursive: true })
  writeFileSync(join(root, 'apps/console/dist/index.html'), '<div id="root"></div>')
  writeFileSync(join(root, 'apps/console/dist/assets/app.js'), 'console.log(1)')
  return root
}

function releaseWith(consoleOverrides = {}) {
  return {
    build: {
      consoleMode: 'http',
      consoleRoot: 'apps/console/dist',
      consoleDigest: undefined,
      ...consoleOverrides,
    },
    dependencies: [],
  }
}

test('the static console must be a stamped HTTP build with the recorded digest', (t) => {
  const root = installRootWithConsole()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const digest = hashDirectory(join(root, 'apps/console/dist')).digest
  const release = releaseWith({ consoleDigest: digest })
  // No stamp: cannot prove the bundle is an HTTP build.
  assert.equal(verifyConsoleBuild(root, release).reason, 'console_stamp_missing_or_invalid')
  writeFileSync(
    join(root, 'apps/console/dist', CONSOLE_STAMP_FILE),
    JSON.stringify({ protocol: 'personal-console-build/1', mode: 'fixture', digest }),
  )
  assert.equal(verifyConsoleBuild(root, release).reason, 'console_stamp_not_http')
  writeFileSync(
    join(root, 'apps/console/dist', CONSOLE_STAMP_FILE),
    JSON.stringify({ protocol: 'personal-console-build/1', mode: 'http', digest: 'f'.repeat(64) }),
  )
  assert.equal(verifyConsoleBuild(root, release).reason, 'console_digest_mismatch')
  writeFileSync(
    join(root, 'apps/console/dist', CONSOLE_STAMP_FILE),
    JSON.stringify({ protocol: 'personal-console-build/1', mode: 'http', digest }),
  )
  assert.equal(verifyConsoleBuild(root, release).ok, true)
  // A release without a recorded digest cannot authorize any console.
  assert.equal(verifyConsoleBuild(root, releaseWith()).reason, 'release_has_no_console_digest')
  assert.equal(verifyConsoleBuild(root, releaseWith({ consoleMode: 'fixture' })).reason, 'console_mode_not_http')
})

test('runtime dependency bytes and versions are verified against the release digests', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-release-deps-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'apps/coordinator'), { recursive: true })
  writeFileSync(join(root, 'apps/coordinator/package.json'), JSON.stringify({ name: 'app', dependencies: { 'fake-dep': '1.0.0' } }))
  mkdirSync(join(root, 'node_modules/fake-dep'), { recursive: true })
  writeFileSync(join(root, 'node_modules/fake-dep/package.json'), JSON.stringify({ name: 'fake-dep', version: '1.0.0' }))
  writeFileSync(join(root, 'node_modules/fake-dep/index.js'), 'module.exports = 1\n')
  writeFileSync(join(root, 'node_modules/fake-dep/LICENSE'), 'MIT\n')
  const dependency = hashDirectory(join(root, 'node_modules/fake-dep'))
  const release = { dependencies: [{ name: 'fake-dep', version: '1.0.0', digest: dependency.digest, licenseFiles: ['LICENSE'] }] }
  assert.equal(verifyRuntimeDependencies(root, release).ok, true)

  writeFileSync(join(root, 'node_modules/fake-dep/index.js'), 'module.exports = 2\n')
  const changed = verifyRuntimeDependencies(root, release)
  assert.equal(changed.ok, false)
  assert.deepEqual(changed.failures.map((failure) => failure.reason), ['digest_mismatch'])

  writeFileSync(join(root, 'node_modules/fake-dep/index.js'), 'module.exports = 1\n')
  assert.equal(verifyRuntimeDependencies(root, { dependencies: [{ ...release.dependencies[0], version: '2.0.0' }] }).failures[0].reason, 'version_mismatch')
  writeFileSync(join(root, 'node_modules/fake-dep/package.json'), JSON.stringify({ name: 'fake-dep', version: '1.0.0' }))
  rmSync(join(root, 'node_modules/fake-dep'), { recursive: true, force: true })
  assert.equal(verifyRuntimeDependencies(root, release).failures[0].reason, 'unresolved')
})

test('a release without a dependency manifest fails closed', () => {
  assert.deepEqual(verifyRuntimeDependencies('/tmp', { dependencies: [] }).failures, [{ reason: 'missing_dependency_manifest' }])
})
