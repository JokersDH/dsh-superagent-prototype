#!/usr/bin/env node
/**
 * Build the distribution once: runtime package `dist/` trees and the console static bundle (HTTP
 * transport mode), then write a digest-bound `pa-release/1` manifest. `pa start` consumes the
 * manifest and never launches Vite or rebuilds the repository, so runtime startup stays bounded.
 *
 * The install model is same-machine: node_modules and the native SQLite binding are not portable
 * evidence for another machine. See docs/rfcs/WP-12/0001-local-distribution-rfc.zh-CN.md.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { hashDirectory, resolveExternalClosure, stageFromRelease, workspacePackages } from './stage.mjs'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SUPPORTED_NODE = '>=24.21.0 <25'
// Every workspace package the coordinator/runner import at runtime. A package that is imported but
// not listed here fails at daemon start with ERR_MODULE_NOT_FOUND after staging, so keep this list in
// step with the runtime import graph (routing/knowledge/context/proposals came with wave-06).
const PACKAGES = [
  'contracts',
  'orchestrator-core',
  'effects',
  'storage',
  'questions',
  'application',
  'workspaces',
  'verification',
  'environment-preparation',
  'portability',
  'workflows',
  'context',
  'proposals',
  'knowledge',
  'routing',
]

const { values } = parseArgs({
  options: {
    'install-root': { type: 'string' },
    'config-root': { type: 'string' },
    output: { type: 'string' },
    'release-output': { type: 'string' },
    tag: { type: 'string' },
    'skip-console': { type: 'boolean', default: false },
    'skip-packages': { type: 'boolean', default: false },
    'skip-self-check': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})
const installRoot = resolve(values['install-root'] ?? REPO_ROOT)
if (values['config-root'] === undefined) {
  fail('--config-root is required so the launcher can read the release manifest')
}
const configRoot = resolve(values['config-root'])

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

function fail(message) {
  process.stderr.write(`build BLOCKED: ${message}\n`)
  process.exit(2)
}

function satisfiesSupportedNode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  if (major < 24) return false
  if (major > 24) return false
  if (minor < 21) return false
  if (minor === 21) return patch >= 0
  return major === 24
}

function runPnpm(args, { env = process.env, label }) {
  // Keep stdout reserved for the machine-readable summary: build tool output goes to stderr.
  const stdio = values.json ? ['ignore', process.stderr, process.stderr] : 'inherit'
  const result = spawnSync('pnpm', args, { cwd: installRoot, stdio, env })
  if (result.error || result.status !== 0) fail(`${label} failed (exit ${result.status ?? 'error'})`)
}

function git(args) {
  const result = spawnSync('git', ['-C', installRoot, ...args], { encoding: 'utf8', timeout: 10000 })
  return result.status === 0 ? result.stdout.trim() : null
}

function walkFiles(root, base = root, skipDirs = new Set(['node_modules'])) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue
      files.push(...walkFiles(absolute, base, skipDirs))
    } else if (entry.isFile()) files.push(relative(base, absolute).split('\\').join('/'))
    else fail(`unexpected non-regular file in build output: ${absolute}`)
  }
  return files
}

function pnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8', timeout: 10000 })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function sqliteFacts() {
  try {
    const require = createRequire(join(installRoot, 'packages/storage/package.json'))
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    try {
      const version = db.prepare('select sqlite_version() as version').get().version
      return { sqlite: String(version), abi: String(process.versions.modules) }
    } finally {
      db.close()
    }
  } catch (error) {
    fail(`native SQLite binding cannot be loaded by Node ${process.versions.node}: ${error.message}`)
  }
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch { /* renamed or absent */ }
  }
}

if (!satisfiesSupportedNode(process.versions.node)) {
  fail(`Node ${process.versions.node} is outside the supported ${SUPPORTED_NODE} range`)
}
try {
  if (!lstatSync(join(installRoot, 'apps/console/package.json')).isFile()) fail('not a product install root')
} catch {
  fail('not a product install root: apps/console/package.json is missing')
}

if (!values['skip-packages']) {
  runPnpm(
    [...PACKAGES.flatMap((name) => ['--filter', `@personal-agent/${name}`]), '-r', 'build'],
    { label: 'package build' },
  )
}
const consoleRoot = 'apps/console/dist'
const consoleStampPath = join(installRoot, consoleRoot, '.pa-console-build.json')

/** Digest of the built console files excluding the stamp itself. */
function consoleBundleDigest() {
  const files = walkFiles(join(installRoot, consoleRoot)).filter((file) => file !== '.pa-console-build.json')
  return sha256(files.map((file) => {
    const bytes = readFileSync(join(installRoot, consoleRoot, file))
    return `${file}\0${bytes.byteLength}\0${sha256(bytes)}`
  }).join('\n'))
}

if (!values['skip-console']) {
  runPnpm(['--filter', '@personal-agent/console', 'build'], {
    label: 'console build',
    env: { ...process.env, VITE_CONSOLE_MODE: 'http', NODE_ENV: 'production' },
  })
  const digest = consoleBundleDigest()
  atomicWriteJson(consoleStampPath, {
    protocol: 'personal-console-build/1',
    mode: 'http',
    digest,
    createdAt: new Date().toISOString(),
  })
}
// The console mode is derived from the actual build artifact, never assumed: `--skip-console` may
// reuse only an HTTP build whose recorded digest still matches the files on disk.
let consoleDigest
try {
  const stamp = JSON.parse(readFileSync(consoleStampPath, 'utf8'))
  if (stamp.protocol !== 'personal-console-build/1' || stamp.mode !== 'http')
    fail('console build stamp is not an HTTP build; rebuild without --skip-console')
  const digest = consoleBundleDigest()
  if (stamp.digest !== digest)
    fail('console files do not match the recorded HTTP build digest; rebuild without --skip-console')
  consoleDigest = digest
} catch (error) {
  if (error?.code === 'ENOENT' || /Unexpected token/.test(String(error))) fail('console build stamp is missing or unreadable; rebuild without --skip-console')
  throw error
}

const packageDirs = []
const artifacts = []
const addDirectory = (directory, prefix, kind) => {
  for (const file of walkFiles(join(installRoot, directory))) {
    const bytes = readFileSync(join(installRoot, directory, file))
    artifacts.push({ path: `${prefix}/${file}`, bytes: bytes.byteLength, sha256: sha256(bytes), kind })
  }
}
for (const name of PACKAGES) {
  const dist = join(installRoot, 'packages', name, 'dist')
  try {
    if (!lstatSync(dist).isDirectory()) fail(`package ${name} has no dist directory`)
  } catch {
    fail(`package ${name} has no built dist directory`)
  }
}
// Every workspace package: manifest, source tree (some sibling source is imported directly by the
// coordinator) and built dist when present.
const workspace = workspacePackages(installRoot)
for (const pkg of workspace) {
  const relativeDirectory = pkg.relative
  const manifestBytes = readFileSync(join(pkg.directory, 'package.json'))
  artifacts.push({
    path: `${relativeDirectory}/package.json`,
    bytes: manifestBytes.byteLength,
    sha256: sha256(manifestBytes),
    kind: 'package',
  })
  for (const directory of ['src', 'dist']) {
    const absolute = join(pkg.directory, directory)
    if (existsSync(absolute)) addDirectory(`${relativeDirectory}/${directory}`, `${relativeDirectory}/${directory}`, 'runtime')
  }
  packageDirs.push(relativeDirectory)
}
// The executed runtime includes the coordinator TypeScript entry and the launcher, not only the
// package dist trees. The static console build is listed in full.
for (const app of ['apps/coordinator', 'apps/launcher', 'apps/runner']) addDirectory(app, app, 'runtime')
addDirectory(consoleRoot, consoleRoot, 'console')
const rootPackageJson = join(installRoot, 'package.json')
if (existsSync(rootPackageJson)) {
  const bytes = readFileSync(rootPackageJson)
  artifacts.push({ path: 'package.json', bytes: bytes.byteLength, sha256: sha256(bytes), kind: 'package' })
}
const licensePath = join(installRoot, 'LICENSE')
if (existsSync(licensePath)) {
  const bytes = readFileSync(licensePath)
  artifacts.push({ path: 'LICENSE', bytes: bytes.byteLength, sha256: sha256(bytes), kind: 'license' })
}
const nativeEvidence = 'reports/releases/native-mvp/native-product.json'
if (existsSync(join(installRoot, nativeEvidence))) {
  const bytes = readFileSync(join(installRoot, nativeEvidence))
  artifacts.push({ path: nativeEvidence, bytes: bytes.byteLength, sha256: sha256(bytes), kind: 'resource' })
}

// Runtime dependency closure: package-level content digests (paths differ between a checkout and a
// staged flat node_modules, bytes must not).
const dependencyAnchors = [
  join(installRoot, 'apps/coordinator/package.json'),
  join(installRoot, 'apps/launcher/package.json'),
  ...workspace.map((pkg) => join(pkg.directory, 'package.json')),
]
const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING|NOTICE)(?:\..*)?$/i
const dependencies = resolveExternalClosure(dependencyAnchors).map((dependency) => {
  const hashed = hashDirectory(dependency.directory)
  return {
    name: dependency.name,
    version: dependency.version,
    digest: hashed.digest,
    files: hashed.files.length,
    licenseFiles: readdirSync(dependency.directory).filter((name) => LICENSE_FILE.test(name)).sort(),
  }
})
artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
if (artifacts.length === 0) fail('no build artifacts were produced')

const { sqlite, abi } = sqliteFacts()
const rootPackage = JSON.parse(readFileSync(join(installRoot, 'package.json'), 'utf8'))
const commit = git(['rev-parse', 'HEAD']) ?? 'unknown'
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
const dirty = (git(['status', '--porcelain', '--untracked-files=no']) ?? '') !== ''
const buildId = sha256(
  JSON.stringify({
    artifacts: artifacts.map(({ path, bytes, sha256: digest }) => [path, bytes, digest]),
    commit,
    tag: values.tag ?? '',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }),
).slice(0, 16)

const release = {
  format: 'pa-release',
  formatVersion: 1,
  buildId,
  createdAt: new Date().toISOString(),
  source: { commit, branch, dirty },
  producer: {
    product: 'dsh-superagent',
    version: rootPackage.version,
    node: process.versions.node,
    pnpm: pnpmVersion(),
    sqlite,
    productSchema: Number(process.env.PA_PRODUCT_SCHEMA ?? '0'),
    platform: process.platform,
    arch: process.arch,
  },
  build: { consoleMode: 'http', consoleRoot, consoleDigest, packageCount: PACKAGES.length },
  artifacts,
  dependencies,
  admission: {
    node: SUPPORTED_NODE,
    platform: process.platform,
    arch: process.arch,
    sqlite: '>=3.53.4',
    abi,
    tested: process.platform === 'darwin' && process.arch === 'arm64',
    evidence: 'darwin/arm64 measured candidate; other platforms/architectures are NOT_TESTED',
  },
  limitations: [
    'Same-machine install model: node_modules and the native SQLite binding are not portable evidence for another machine.',
    'Only darwin/arm64 with Node 24.21.x is a measured candidate; other platforms are NOT_TESTED.',
    'No credentials, account homes, native sessions or model keys are included in this manifest.',
  ],
}

// Record producer facts the launcher can show without opening the database.
try {
  const require = createRequire(join(installRoot, 'packages/storage/package.json'))
  const storage = require(join(installRoot, 'packages/storage/dist/index.js'))
  release.producer.productSchema = Number(storage.PRODUCT_SCHEMA_VERSION ?? 0)
} catch {
  release.producer.productSchema = 0
}

const configPath = join(configRoot, 'release.json')
atomicWriteJson(configPath, release)
if (values['release-output'] !== undefined) {
  mkdirSync(resolve(values['release-output']), { recursive: true, mode: 0o755 })
  atomicWriteJson(join(resolve(values['release-output']), 'release.json'), release)
}

if (!values['skip-self-check']) {
  const { verifyConsoleBuild, verifyReleaseArtifacts, verifyRuntimeDependencies } = await import('../../apps/launcher/lib/release.mjs')
  const check = verifyReleaseArtifacts(installRoot, release, { hash: true })
  if (!check.ok) fail(`release self-check failed: ${JSON.stringify(check.failures.slice(0, 10))}`)
  const dependencyCheck = verifyRuntimeDependencies(installRoot, release)
  if (!dependencyCheck.ok) fail(`dependency self-check failed: ${JSON.stringify(dependencyCheck.failures.slice(0, 10))}`)
  const consoleCheck = verifyConsoleBuild(installRoot, release)
  if (!consoleCheck.ok) fail(`console self-check failed: ${consoleCheck.reason}`)
}

let staged = null
if (values.output !== undefined) {
  try {
    staged = stageFromRelease({
      repoRoot: installRoot,
      output: resolve(values.output),
      releasePath: configPath,
    })
  } catch (error) {
    fail(`staged install failed: ${error.code ?? 'error'} ${error.message}`)
  }
}

const summary = {
  status: 'OK',
  buildId,
  config: configPath,
  output: values.output ?? null,
  tag: values.tag ?? null,
  staged: staged === null ? null : { path: staged.output, installManifest: staged.installPath },
  source: release.source,
  producer: { node: release.producer.node, sqlite, abi, platform: release.producer.platform, arch: release.producer.arch },
  artifacts: { count: artifacts.length, bytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0) },
  dependencies: { count: dependencies.length, files: dependencies.reduce((sum, dependency) => sum + dependency.files, 0) },
  console: { mode: 'http', digest: consoleDigest },
  limitations: release.limitations,
}
if (values.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
else process.stdout.write(`release ${buildId} recorded at ${configPath} (${artifacts.length} artifacts)\n`)
