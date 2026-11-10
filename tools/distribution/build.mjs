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
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SUPPORTED_NODE = '>=24.21.0 <25'
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
]

const { values } = parseArgs({
  options: {
    'install-root': { type: 'string' },
    'config-root': { type: 'string' },
    output: { type: 'string' },
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

function walkFiles(root, base = root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(absolute, base))
    else if (entry.isFile()) files.push(relative(base, absolute).split('\\').join('/'))
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
if (!values['skip-console']) {
  runPnpm(['--filter', '@personal-agent/console', 'build'], {
    label: 'console build',
    env: { ...process.env, VITE_CONSOLE_MODE: 'http', NODE_ENV: 'production' },
  })
}

const packageDirs = []
const artifacts = []
for (const name of PACKAGES) {
  const dist = join(installRoot, 'packages', name, 'dist')
  try {
    if (!lstatSync(dist).isDirectory()) fail(`package ${name} has no dist directory`)
  } catch {
    fail(`package ${name} has no built dist directory`)
  }
  packageDirs.push(`packages/${name}`)
  for (const file of walkFiles(dist)) {
    const absolute = join(dist, file)
    const bytes = readFileSync(absolute)
    artifacts.push({ path: `packages/${name}/dist/${file}`, bytes: bytes.byteLength, sha256: sha256(bytes), kind: 'runtime' })
  }
}
const consoleRoot = 'apps/console/dist'
try {
  if (!lstatSync(join(installRoot, consoleRoot)).isDirectory()) fail('console has no static dist output')
} catch {
  fail('console has no static dist output; run without --skip-console')
}
for (const file of walkFiles(join(installRoot, consoleRoot))) {
  const bytes = readFileSync(join(installRoot, consoleRoot, file))
  artifacts.push({ path: `${consoleRoot}/${file}`, bytes: bytes.byteLength, sha256: sha256(bytes), kind: 'console' })
}
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
  build: { consoleMode: 'http', consoleRoot, packageCount: PACKAGES.length },
  artifacts,
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
if (values.output !== undefined) {
  mkdirSync(values.output, { recursive: true, mode: 0o755 })
  atomicWriteJson(join(values.output, 'release.json'), release)
}

if (!values['skip-self-check']) {
  const { verifyReleaseArtifacts } = await import('../../apps/launcher/lib/release.mjs')
  const check = verifyReleaseArtifacts(installRoot, release, { hash: true })
  if (!check.ok) fail(`release self-check failed: ${JSON.stringify(check.failures.slice(0, 10))}`)
}

const summary = {
  status: 'OK',
  buildId,
  config: configPath,
  output: values.output ?? null,
  source: release.source,
  producer: { node: release.producer.node, sqlite, abi, platform: release.producer.platform, arch: release.producer.arch },
  artifacts: { count: artifacts.length, bytes: artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0) },
  limitations: release.limitations,
}
if (values.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
else process.stdout.write(`release ${buildId} recorded at ${configPath} (${artifacts.length} artifacts)\n`)
