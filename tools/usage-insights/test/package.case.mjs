/**
 * W31-G1 acceptance: the read-only package capability report.
 *
 * The archives here are synthesized in the test, so the check never depends on a machine-specific
 * release path. The two shapes model a package that only serves the page and one that also ships the
 * download chain; the report must tell them apart from the packaged bytes alone.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url))

const run = args => {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const BLOCK = 512
const writeOctal = (buffer, start, length, value) => {
  const text = value.toString(8).padStart(length - 1, '0')
  buffer.write(text, start, length - 1, 'ascii')
  buffer[start + length - 1] = 0
}
const header = (name, { type = '0', size = 0, mode = 0o644, linkname = '' } = {}) => {
  const buffer = Buffer.alloc(BLOCK)
  buffer.write(name, 0, 100, 'utf8')
  writeOctal(buffer, 100, 8, mode)
  writeOctal(buffer, 108, 8, 0)
  writeOctal(buffer, 116, 8, 0)
  writeOctal(buffer, 124, 12, size)
  writeOctal(buffer, 136, 12, 0)
  buffer.write('        ', 148, 8, 'ascii')
  buffer.write(type, 156, 1, 'ascii')
  buffer.write(linkname, 157, 100, 'utf8')
  buffer.write('ustar\0', 257, 6, 'ascii')
  buffer.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const byte of buffer) checksum += byte
  buffer.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return buffer
}
const pad = size => Buffer.alloc(Math.ceil(size / BLOCK) * BLOCK - size)

/** Assemble a `.tar.gz` from `{ path: text }` plus optional symlinks. */
function archive(files) {
  const parts = []
  for (const [path, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8')
    parts.push(header(path, { size: data.length }), data, pad(data.length))
  }
  parts.push(Buffer.alloc(BLOCK), Buffer.alloc(BLOCK))
  return gzipSync(Buffer.concat(parts))
}

const install = (overrides = {}) => JSON.stringify({
  format: 'pa-install', formatVersion: 1,
  source: { commit: 'a'.repeat(40), branch: 'codex/test', dirty: false },
  buildId: '0123456789abcdef',
  files: [{ path: 'x' }, { path: 'y' }],
  supportMatrix: { measured: ['darwin/arm64'], node: '>=24.21.0 <25', abi: '137' },
  limitations: ['test archive'],
  ...overrides,
})

const baseFiles = (indexExports, appSource, observationSource, consoleSource) => ({
  'install/install.json': install(),
  'install/app/packages/usage-insights/package.json': JSON.stringify({
    name: '@personal-agent/usage-insights', version: '0.1.0', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  }),
  'install/app/packages/usage-insights/dist/index.js': `export { ${indexExports.join(', ')} }\n`,
  'install/app/apps/coordinator/http/app.ts': appSource,
  'install/app/apps/coordinator/product/usage-observation.ts': observationSource,
  'install/app/apps/console/src/transport.ts': consoleSource,
})

const r1Files = baseFiles(
  ['analyzeUsageInsights'],
  `app.get('/v1/insights', handler)\n`,
  `export class ProductUsageObservation { async read() {} }\n`,
  `export interface ConsoleTransport { observation?(): void }\n`,
)
const r2Files = baseFiles(
  ['analyzeUsageInsights', 'buildInsightExport', 'buildDisplayExport', 'crossCheckAnalysisWithDisplay'],
  `app.get('/v1/insights', handler)\napp.get('/v1/insights/export', handler)\n`,
  `export class ProductUsageObservation { async read() {} async download() { UsageObservationDownloadSchema.parse(x) } }\n`,
  `export interface ConsoleTransport { downloadUsageObservation?(): void }\n`,
)

function workspace(files) {
  const directory = mkdtempSync(join(tmpdir(), 'usage-package-'))
  const path = join(directory, 'app.tar.gz')
  const bytes = archive(files)
  writeFileSync(path, bytes, { mode: 0o600 })
  chmodSync(path, 0o600)
  return { directory, path, sha256: createHash('sha256').update(bytes).digest('hex') }
}

test('a page-only package reports no export capability, and the expectation refuses it', () => {
  const { path, sha256 } = workspace(r1Files)
  const listed = run(['package', '--tar', path, '--expect-sha256', sha256, '--expect-build', '0123456789abcdef', '--json'])
  assert.equal(listed.status, 0, listed.stderr)
  const report = JSON.parse(listed.stdout)
  assert.equal(report.protocol, 'usage-insights-package-surface/1')
  assert.equal(report.archive.sha256, sha256)
  assert.equal(report.manifest.sourceCommit, 'a'.repeat(40))
  assert.equal(report.manifest.buildId, '0123456789abcdef')
  assert.equal(report.manifest.supportMatrix.abi, '137')
  assert.deepEqual(report.capabilities, { pageObservation: true, numericExport: false, displayDownload: false })
  assert.deepEqual(report.absent, ['numericExport', 'displayDownload'])
  assert.equal(report.usageInsights.version, '0.1.0')
  // The packaged dist is reported by name, so a missing module is visible rather than assumed.
  assert.deepEqual(report.usageInsights.distFiles, ['index.js'])

  // Declaring a capability the package does not contain is a refusal, not a warning.
  const refused = run(['package', '--tar', path, '--expect', 'pageObservation,displayDownload'])
  assert.equal(refused.status, 3)
  assert.ok(refused.stderr.includes('capability_missing: displayDownload'), refused.stderr)
  // Declaring what it does contain passes.
  assert.equal(run(['package', '--tar', path, '--expect', 'pageObservation']).status, 0)
})

test('a package with the download chain reports all three capabilities', () => {
  const { path } = workspace(r2Files)
  const result = run(['package', '--tar', path, '--expect', 'pageObservation,numericExport,displayDownload', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.deepEqual(report.capabilities, { pageObservation: true, numericExport: true, displayDownload: true })
  assert.deepEqual(report.absent, [])
  assert.equal(report.coordinator.downloadRoute, 1)
  // Either the protocol literal or the contract symbol is enough evidence of the download path.
  assert.equal(report.coordinator.downloadContract >= 1, true)
  assert.equal(report.console.layout, 'source')
  assert.equal(report.console.interfacePresent, true)
  assert.equal(report.browserTrigger, 'present')
})

test('an archive that does not match the declared identity is refused', () => {
  const { path, sha256 } = workspace(r1Files)
  const wrongDigest = run(['package', '--tar', path, '--expect-sha256', 'b'.repeat(64)])
  assert.equal(wrongDigest.status, 5)
  assert.match(wrongDigest.stderr, /does not match the declared value/)
  const wrongBuild = run(['package', '--tar', path, '--expect-build', 'ffffffffffffffff'])
  assert.equal(wrongBuild.status, 5)
  assert.equal(run(['package', '--tar', path, '--expect-sha256', sha256]).status, 0)
})

test('unreadable, oversized and malformed inputs fail before any work', () => {
  const { directory, path } = workspace(r1Files)
  assert.equal(run(['package', '--tar', 'relative.tar.gz']).status, 2)
  assert.equal(run(['package', '--tar', join(directory, 'missing.tar.gz')]).status, 5)
  // A byte budget smaller than the archive refuses the file without inflating it.
  const tooSmall = run(['package', '--tar', path, '--max-archive-bytes', '16'])
  assert.equal(tooSmall.status, 5)
  assert.match(tooSmall.stderr, /above the 16-byte budget/)
  const junk = join(directory, 'junk.tar.gz')
  writeFileSync(junk, Buffer.alloc(2048, 7), { mode: 0o600 })
  const malformed = run(['package', '--tar', junk])
  assert.equal(malformed.status, 5)
  assert.equal(/\/Users|home/.test(malformed.stderr), false, 'the error names no path')
  // Only the documented capability names are accepted.
  assert.equal(run(['package', '--tar', path, '--expect', 'numericAnalysis']).status, 2)
})

test('the report never extracts, installs or executes anything', () => {
  const { directory, path } = workspace(r1Files)
  const result = run(['package', '--tar', path, '--json'])
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.authorization, 'none')
  assert.match(report.note, /not an install/)
  // Nothing was written next to the archive.
  const entries = readFileSync(path)
  assert.ok(entries.length > 0)
  assert.deepEqual(readdirSafe(directory), ['app.tar.gz'])
})

const readdirSafe = directory => readdirSync(directory).sort()

const serverFiles = (consoleEntries) => ({
  'install/install.json': install(),
  'install/app/packages/usage-insights/package.json': JSON.stringify({
    name: '@personal-agent/usage-insights', version: '0.1.0', exports: { '.': { import: './dist/index.js' } },
  }),
  'install/app/packages/usage-insights/dist/index.js': 'export { analyzeUsageInsights, buildInsightExport, buildDisplayExport }\n',
  'install/app/apps/coordinator/http/app.ts': "app.get('/v1/insights', h)\napp.get('/v1/insights/export', h)\n",
  'install/app/apps/coordinator/product/usage-observation.ts': "const p = 'usage-observation-download/1'; UsageObservationDownload\n",
  ...consoleEntries,
})

test('a built console bundle is inspected instead of a missing source file', () => {
  // The released package ships only `dist/assets/*.js`; reading `src/transport.ts` made a real
  // capability look absent. The layout and the bundle reference are now reported together.
  const withBundle = workspace(serverFiles({
    'install/app/apps/console/dist/assets/index-abc123.js': 'const t={downloadUsageObservation:q=>q};fetch("/v1/insights/export")\n',
  }))
  const report = JSON.parse(run(['package', '--tar', withBundle.path, '--json']).stdout)
  assert.equal(report.console.layout, 'bundle')
  assert.equal(report.browserTrigger, 'present')
  assert.deepEqual(report.capabilities, { pageObservation: true, numericExport: true, displayDownload: true })

  const withoutReference = workspace(serverFiles({
    'install/app/apps/console/dist/assets/index-abc123.js': 'const t={observation:q=>q};fetch("/v1/insights")\n',
  }))
  const refused = JSON.parse(run(['package', '--tar', withoutReference.path, '--json']).stdout)
  assert.equal(refused.console.layout, 'bundle')
  assert.equal(refused.browserTrigger, 'absent')
  assert.equal(refused.capabilities.displayDownload, false, 'a user cannot trigger an export the page does not offer')

  // No console at all: the server side decides and the browser trigger stays unverifiable.
  const noConsole = workspace(serverFiles({}))
  const unknown = JSON.parse(run(['package', '--tar', noConsole.path, '--json']).stdout)
  assert.equal(unknown.console.layout, 'absent')
  assert.equal(unknown.browserTrigger, 'unverifiable')
  assert.equal(unknown.capabilities.displayDownload, true)
})

test('the archive budget is checked against the real file size', () => {
  const files = serverFiles({
    'install/app/apps/console/dist/assets/index-big.js': `${'x'.repeat(2048)}downloadUsageObservation\n`,
  })
  const { path } = workspace(files)
  const size = readFileSync(path).length
  const refused = run(['package', '--tar', path, '--max-archive-bytes', String(size - 1)])
  assert.equal(refused.status, 5, 'a budget below the real archive size refuses before scanning')
  assert.match(refused.stderr, /above the/)
  const accepted = JSON.parse(run(['package', '--tar', path, '--json', '--max-archive-bytes', String(size)]).stdout)
  assert.equal(accepted.console.layout, 'bundle')
  assert.equal(accepted.capabilities.displayDownload, true)
})
