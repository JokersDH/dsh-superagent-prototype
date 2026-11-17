/**
 * W35 acceptance: what the runtime identity actually establishes.
 *
 * A manifest is a claim; the file digests inside it are checkable; and "this is the process that is
 * running" is only true when main/D supply their own start record. The three levels are kept apart so
 * a forged manifest, a missing file or a comment cannot produce a confident identity.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inspectRuntimeIdentity } from '../src/runtime-identity.ts'

const BUILD = '8296720d8a25f38c'
const SOURCE = '82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2'
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

interface InstallOptions {
  /** Overwrite one manifest digest after the file list is built. */
  forgeDigestOf?: string
  /** Remove one file from disk while the manifest still lists it. */
  deleteFile?: string
  /** Put the only route reference inside a comment. */
  commentOnlyRoute?: boolean
}

/** An install whose manifest lists the exact files and digests that exist on disk. */
function install(options: InstallOptions = {}): { root: string; files: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'usage-runtime-evidence-'))
  const files: Record<string, string> = {
    'app/packages/usage-insights/dist/index.js':
      'export { analyzeUsageInsights, buildInsightExport, buildDisplayExport, buildSupportReport }\n',
    'app/apps/coordinator/http/app.ts': options.commentOnlyRoute
      ? "// app.get('/v1/insights', h)\n// app.get('/v1/insights/export', h)\n// app.get('/v1/insights/support', h)\nexport const h = 1\n"
      : "app.get('/v1/insights', h)\napp.get('/v1/insights/export', h)\napp.get('/v1/insights/support', h)\n",
    'app/apps/console/dist/assets/index-abc.js': 'const t={downloadUsageObservation:q=>q};fetch("/v1/insights/export")\n',
  }
  files['bin/pa'] = '#!/bin/sh\nexec node main.js "$@"\n'
  const manifest = {
    format: 'pa-install', formatVersion: 1,
    source: { commit: SOURCE, branch: 'main', dirty: false },
    buildId: BUILD,
    files: Object.entries(files).map(([path, text]) => ({ path, kind: 'file', bytes: Buffer.byteLength(text), sha256: sha(text) })),
  }
  if (options.forgeDigestOf !== undefined) {
    const entry = manifest.files.find(file => file.path === options.forgeDigestOf)
    if (entry) entry.sha256 = 'f'.repeat(64)
  }
  const onDisk = { ...files }
  if (options.deleteFile !== undefined) delete onDisk[options.deleteFile]
  for (const [path, text] of Object.entries(onDisk)) {
    mkdirSync(join(root, 'install', path, '..'), { recursive: true })
    writeFileSync(join(root, 'install', path), text)
  }
  mkdirSync(join(root, 'install'), { recursive: true })
  writeFileSync(join(root, 'install', 'install.json'), JSON.stringify(manifest))
  return { root, files }
}

test('a verified inventory establishes the identity, without claiming it is running', () => {
  const { root } = install()
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.inventory.mode, 'hash')
  assert.equal(identity.inventory.state, 'complete')
  assert.equal(identity.inventory.hashed, 4)
  assert.deepEqual(identity.inventory.mismatches, [])
  assert.equal(identity.evidence, 'inventory_verified')
  assert.equal(identity.running, null)
  assert.ok(identity.unknown.some(entry => /no process start identity/.test(entry)),
    'nothing about the running process is claimed')
  assert.equal(identity.origin?.buildId, BUILD)
  rmSync(root, { recursive: true, force: true })
})

test('a forged manifest digest is caught and withdraws the evidence level', () => {
  const target = 'app/packages/usage-insights/dist/index.js'
  const { root } = install({ forgeDigestOf: target })
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.inventory.state, 'partial')
  assert.ok(identity.inventory.mismatches.some(entry => entry.path === target && /digest mismatch/.test(entry.reason)),
    JSON.stringify(identity.inventory.mismatches))
  // The claimed build/source are still reported, but nothing is presented as verified.
  assert.equal(identity.origin?.buildId, BUILD)
  assert.equal(identity.evidence, 'self_declared')
  rmSync(root, { recursive: true, force: true })
})

test('a file missing from the installation is a mismatch, not a smaller inventory', () => {
  const target = 'app/apps/console/dist/assets/index-abc.js'
  const { root } = install({ deleteFile: target })
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.inventory.state, 'partial')
  assert.ok(identity.inventory.mismatches.some(entry => entry.path === target && /missing/.test(entry.reason)))
  assert.equal(identity.evidence, 'self_declared')
  // The capability still reads from what is installed: no download bundle, no browser trigger.
  assert.equal(identity.capabilities?.displayDownload, false)
  rmSync(root, { recursive: true, force: true })
})

test('a route mentioned only in a comment is not a capability', () => {
  const { root } = install({ commentOnlyRoute: true })
  const identity = inspectRuntimeIdentity({ installRoot: root })
  assert.equal(identity.capabilities?.pageObservation, false)
  assert.equal(identity.capabilities?.numericExport, true, 'the library export is real, the route is not')
  assert.equal(identity.capabilities?.displayDownload, false)
  assert.equal(identity.capabilities?.supportSummary, false)
  rmSync(root, { recursive: true, force: true })
})

test('a caller-supplied root can never confirm that this is what is running', () => {
  const { root } = install()
  const claimed = inspectRuntimeIdentity({ installRoot: root, running: { root, pid: 4242, startedAt: '2026-11-16T00:00:00.000Z' } })
  assert.equal(claimed.running?.rootMatches, true)
  assert.equal(claimed.running?.provenance, 'caller-string')
  assert.equal(claimed.evidence, 'inventory_verified', 'the files are verified; the process is not')
  assert.ok(claimed.unknown.some(entry => /caller-supplied root is not a start record/.test(entry)))

  const other = mkdtempSync(join(tmpdir(), 'usage-runtime-other-'))
  const wrong = inspectRuntimeIdentity({ installRoot: root, running: { root: other, pid: 1 } })
  assert.equal(wrong.running?.rootMatches, false)
  assert.equal(wrong.evidence, 'inventory_verified')
  rmSync(root, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
})

test('the original start record confirms the running installation it names', () => {
  const { root } = install()
  const entry = join(root, 'install', 'bin', 'pa')
  const record = {
    source: 'main-start-record' as const, entry, root, pid: 4242,
    startedAt: '2026-11-16T00:00:00.000Z', uid: 501, argv: [entry, 'status'], config: join(root, 'install', 'var', 'config'),
  }
  const confirmed = inspectRuntimeIdentity({ installRoot: root, running: record })
  assert.equal(confirmed.running?.provenance, 'main-start-record')
  assert.equal(confirmed.running?.checks.entryInsideRoot, true)
  assert.equal(confirmed.running?.checks.entryIsTheRecordedEntry, true)
  assert.equal(confirmed.running?.checks.argvHeadMatchesEntry, true)
  assert.equal(confirmed.running?.checks.configInsideRootOrPrivate, true)
  assert.equal(confirmed.evidence, 'running_confirmed')

  // A record whose entry is not this installation's launcher is a difference, not a confirmation.
  const foreignEntry = install()
  const foreign = inspectRuntimeIdentity({ installRoot: root, running: { ...record, entry: join(foreignEntry.root, 'install', 'bin', 'pa') } })
  assert.equal(foreign.running?.checks.entryInsideRoot, false)
  assert.equal(foreign.evidence, 'inventory_verified')
  assert.ok(foreign.running?.reasons.some(reason => /entry is not a file inside/.test(reason)))

  // An argv that does not begin with the recorded entry is refused rather than trusted.
  const wrongArgv = inspectRuntimeIdentity({ installRoot: root, running: { ...record, argv: ['/usr/local/bin/node', 'main.js'] } })
  assert.equal(wrongArgv.running?.checks.argvHeadMatchesEntry, false)
  assert.equal(wrongArgv.evidence, 'inventory_verified')

  // A config root outside both the installation and the private app support area is a difference.
  const wrongConfig = inspectRuntimeIdentity({ installRoot: root, running: { ...record, config: '/tmp/somewhere-else' } })
  assert.equal(wrongConfig.running?.checks.configInsideRootOrPrivate, false)
  assert.equal(wrongConfig.evidence, 'inventory_verified')

  // A record that names another root never confirms this tree.
  const mismatch = inspectRuntimeIdentity({ installRoot: root, running: { ...record, root: foreignEntry.root } })
  assert.equal(mismatch.running?.rootMatches, false)
  assert.equal(mismatch.evidence, 'inventory_verified')
  rmSync(root, { recursive: true, force: true })
  rmSync(foreignEntry.root, { recursive: true, force: true })
})

test('mode and size checks are weaker and say so', () => {
  const { root } = install()
  const sizeOnly = inspectRuntimeIdentity({ installRoot: root, verify: 'size' })
  assert.equal(sizeOnly.inventory.mode, 'size')
  assert.equal(sizeOnly.inventory.hashed, 0)
  assert.equal(sizeOnly.inventory.state, 'complete')
  assert.equal(sizeOnly.evidence, 'inventory_verified', 'sizes plus presence is still a checked inventory')

  const unchecked = inspectRuntimeIdentity({ installRoot: root, verify: 'none' })
  assert.equal(unchecked.inventory.state, 'partial')
  assert.equal(unchecked.evidence, 'self_declared')
  rmSync(root, { recursive: true, force: true })
})
