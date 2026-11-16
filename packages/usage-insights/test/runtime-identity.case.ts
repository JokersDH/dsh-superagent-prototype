/**
 * W34 acceptance: identity of the *running* installation.
 *
 * The archive digest says what was shipped; this reads what is installed. Every field is evidence or
 * `null`, capabilities come from the installed files rather than a manifest claim, and a mismatch is
 * reported as a difference instead of being smoothed into "unknown".
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { RuntimeIdentityFault, inspectRuntimeIdentity } from '../src/runtime-identity.ts'

const BUILD = '4dcd28f758bbb265'
const SOURCE = 'c0a1f8975232b6397dfaf92d31ac5682df2dab36'

interface InstallOptions {
  manifest?: Record<string, unknown> | null
  exportRoute?: boolean
  supportRoute?: boolean
  browserReference?: boolean
  indexExports?: string[]
}

/** A synthesized installation with the same layout a release extract produces. */
function install(options: InstallOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'usage-runtime-'))
  const app = join(root, 'install', 'app')
  const write = (path: string, text: string) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
  const manifest = options.manifest === undefined
    ? { buildId: BUILD, source: { commit: SOURCE, branch: 'main', dirty: false }, files: [{ path: 'a' }, { path: 'b' }] }
    : options.manifest
  if (manifest !== null) write(join(root, 'install', 'install.json'), JSON.stringify(manifest))
  write(join(app, 'packages', 'usage-insights', 'dist', 'index.js'),
    `export { ${(options.indexExports ?? ['analyzeUsageInsights', 'buildInsightExport', 'buildDisplayExport', 'buildSupportReport']).join(', ')} }\n`)
  write(join(app, 'apps', 'coordinator', 'http', 'app.ts'),
    `app.get('/v1/insights', h)\n${options.exportRoute === false ? '' : "app.get('/v1/insights/export', h)\n"}` +
    `${options.supportRoute === false ? '' : "app.get('/v1/insights/support', h)\n"}`)
  write(join(app, 'apps', 'console', 'dist', 'assets', 'index-abc.js'),
    options.browserReference === false ? 'const t={}\n' : 'const t={downloadUsageObservation:q=>q};fetch("/v1/insights/export")\n')
  return root
}

test('a complete installation reports build, source and capability evidence', () => {
  const root = install()
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.protocol, 'usage-insights-runtime-identity/1')
  assert.equal(identity.layout, 'install/app')
  assert.equal(identity.manifest.present, true)
  assert.equal(identity.manifest.state, 'parsed')
  assert.equal(identity.manifest.buildId, BUILD)
  assert.equal(identity.manifest.sourceCommit, SOURCE)
  assert.equal(identity.manifest.declaredFiles, 2)
  assert.deepEqual(identity.capabilities, {
    pageObservation: true, numericExport: true, displayDownload: true, supportSummary: true,
  })
  assert.equal(identity.origin?.identitySource, 'install-manifest')
  assert.equal(identity.origin?.buildId, BUILD)
  assert.equal(identity.origin?.browserTrigger, 'present')
  assert.deepEqual(identity.origin?.missing, [])
  // No archive was offered, so the archive digest stays unknown rather than being invented.
  assert.equal(identity.archive.sha256, null)
  assert.equal(identity.archive.source, 'unknown')
  assert.equal(identity.authorization, 'none')
  rmSync(root, { recursive: true, force: true })
})

test('a manifest claim cannot make a missing feature look present', () => {
  const root = install({ exportRoute: false })
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.capabilities?.displayDownload, false)
  assert.deepEqual(identity.origin?.missing, ['displayDownload'])
  // The browser still references it, which is exactly why the installed route decides the capability.
  assert.equal(identity.origin?.browserTrigger, 'present')
  rmSync(root, { recursive: true, force: true })

  const noSupport = install({ supportRoute: false })
  assert.equal(inspectRuntimeIdentity({ installRoot: noSupport }).capabilities?.supportSummary, false)
  rmSync(noSupport, { recursive: true, force: true })
})

test('a missing manifest leaves identity unknown while capability evidence remains', () => {
  const root = install({ manifest: null })
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.manifest.present, false)
  assert.equal(identity.manifest.state, 'absent')
  assert.equal(identity.origin, null, 'no declared identity means no identity')
  assert.equal(identity.capabilities?.pageObservation, true, 'installed files still describe capability')
  assert.ok(identity.unknown.some(entry => /manifest absent/.test(entry)))
  rmSync(root, { recursive: true, force: true })
})

test('a partial manifest is incomplete, not complete and not empty', () => {
  const root = install({ manifest: { buildId: BUILD, source: { branch: 'main' } } })
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.manifest.buildId, BUILD)
  assert.equal(identity.manifest.sourceCommit, null)
  assert.equal(identity.origin?.identitySource, 'incomplete-manifest')
  assert.ok(identity.unknown.some(entry => /source commit not declared/.test(entry)))
  rmSync(root, { recursive: true, force: true })

  const branchOnly = install({ manifest: { source: { commit: 'main' } } })
  assert.equal(inspectRuntimeIdentity({ installRoot: branchOnly }).origin, null, 'a branch name is not a commit')
  rmSync(branchOnly, { recursive: true, force: true })
})

test('expected identity mismatches are differences, not unknowns', () => {
  const root = install()
  const same = inspectRuntimeIdentity({ installRoot: root, expected: { buildId: BUILD, sourceCommit: SOURCE } })
  assert.equal(same.checks.buildMatches, true)
  assert.equal(same.checks.sourceMatches, true)
  assert.deepEqual(same.differences, [])

  // An old install compared with a new source: both facts are kept and the difference is stated.
  const newer = 'f'.repeat(40)
  const stale = inspectRuntimeIdentity({ installRoot: root, expected: { buildId: BUILD, sourceCommit: newer } })
  assert.equal(stale.checks.sourceMatches, false)
  assert.equal(stale.manifest.sourceCommit, SOURCE, 'the installed source is still reported as it is')
  assert.ok(stale.differences.some(entry => /≠ expected/.test(entry)))
  rmSync(root, { recursive: true, force: true })
})

test('an archive digest is only used when it was proven', () => {
  const root = install()
  const archive = join(root, 'app.tar.gz')
  writeFileSync(archive, 'not really a tar, just bytes to hash')
  const hashed = createHash('sha256').update('not really a tar, just bytes to hash').digest('hex')
  const identity = inspectRuntimeIdentity({ installRoot: root, archivePath: archive, expected: { archiveSha256: hashed } })
  assert.equal(identity.archive.sha256, hashed)
  assert.equal(identity.archive.source, 'file')
  assert.equal(identity.checks.archiveMatches, true)

  const wrongArchive = inspectRuntimeIdentity({ installRoot: root, archivePath: archive, expected: { archiveSha256: 'a'.repeat(64) } })
  assert.equal(wrongArchive.checks.archiveMatches, false)
  assert.ok(wrongArchive.differences.some(entry => /archive/.test(entry)))

  // An expected digest with no archive to hash cannot be proven.
  const unprovable = inspectRuntimeIdentity({ installRoot: root, expected: { archiveSha256: hashed } })
  assert.equal(unprovable.archive.source, 'declared')
  assert.equal(unprovable.checks.archiveMatches, null, 'comparing a value with itself proves nothing')
  assert.ok(unprovable.unknown.some(entry => /not proven/.test(entry)))
  rmSync(root, { recursive: true, force: true })
})

test('unreadable, non-directory and symlinked inputs are refused', () => {
  const missing = join(tmpdir(), `usage-runtime-missing-${Date.now()}`)
  assert.throws(() => inspectRuntimeIdentity({ installRoot: missing }), (error: unknown) =>
    error instanceof RuntimeIdentityFault && error.code === 'unreadable_root')

  const root = install()
  const file = join(root, 'install', 'install.json')
  assert.throws(() => inspectRuntimeIdentity({ installRoot: file }), (error: unknown) =>
    error instanceof RuntimeIdentityFault && error.code === 'not_a_directory')

  const linked = mkdtempSync(join(tmpdir(), 'usage-runtime-link-'))
  mkdirSync(join(linked, 'install'), { recursive: true })
  symlinkSync(file, join(linked, 'install', 'install.json'))
  assert.throws(() => inspectRuntimeIdentity({ installRoot: linked }), (error: unknown) =>
    error instanceof RuntimeIdentityFault && error.code === 'symlinked_manifest')
  rmSync(root, { recursive: true, force: true })
  rmSync(linked, { recursive: true, force: true })
})
