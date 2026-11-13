#!/usr/bin/env node
/**
 * Build a versioned, self-contained staged install closure for one machine profile.
 *
 * The closure contains the bytes that are actually executed at runtime: the coordinator TypeScript
 * entry (Node type stripping), the launcher, the static HTTP console build, every runtime workspace
 * package `dist`, and the external runtime dependency closure (with licenses). It does not reference
 * the original checkout or the builder's node_modules. Same-machine/ABI portability only; copying the
 * directory to another OS/architecture/ABI is NOT claimed.
 *
 * Output layout:
 *   install.json            closure manifest (pa-install/1) with every file digest + dependencies
 *   bin/pa                  wrapper that pins PA_* roots under var/ unless the caller overrides them
 *   app/                    install root consumed by the launcher
 *   var/config/release.json pa-release/1 manifest (same bytes as the built release)
 *   LICENSE                 repository license
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INSTALL_FORMAT = 'pa-install'
export const INSTALL_FORMAT_VERSION = 1

export class StageError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'StageError'
    this.code = code
    this.detail = detail
  }
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

function walkFiles(root, base = root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(absolute, base))
    else if (entry.isFile()) files.push(relative(base, absolute).split('\\').join('/'))
  }
  return files
}

export function hashDirectory(root) {
  const files = walkFiles(root).map((path) => {
    const bytes = readFileSync(join(root, path))
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
  })
  // One trailing newline per file record, matching the launcher's runtime verifier.
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`)
  return { digest: hash.digest('hex'), files }
}

const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING|NOTICE)(?:\..*)?$/i
const licenseFilesIn = (root) => {
  try {
    return readdirSync(root).filter((name) => LICENSE_FILE.test(name)).sort()
  } catch {
    return []
  }
}

/** Find the package directory that owns `entryPath` and declares `name`. */
function packageRootOf(entryPath, name) {
  let directory = dirname(entryPath)
  for (let depth = 0; depth < 12; depth += 1) {
    const packageJson = join(directory, 'package.json')
    if (existsSync(packageJson)) {
      try {
        if (JSON.parse(readFileSync(packageJson, 'utf8')).name === name) return directory
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

function resolvePackage(name, anchorPackageJson) {
  const require = createRequire(anchorPackageJson)
  for (const specifier of [name, `${name}/package.json`]) {
    try {
      const resolved = require.resolve(specifier)
      const root = packageRootOf(resolved, name)
      if (root !== null) return root
    } catch {
      /* try next specifier */
    }
  }
  throw new StageError('dependency_unresolved', `Cannot resolve runtime dependency ${name}`, { anchor: anchorPackageJson })
}

/**
 * Resolve the external (non-workspace) runtime dependency closure from explicit anchors and verify
 * only one version of each package name is reachable.
 */
export function resolveExternalClosure(anchorPackageJsonPaths) {
  const resolved = new Map()
  const queue = []
  const enqueueFrom = (packageJsonPath) => {
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    for (const name of Object.keys(manifest.dependencies ?? {})) queue.push([name, packageJsonPath])
  }
  anchorPackageJsonPaths.forEach(enqueueFrom)
  while (queue.length > 0) {
    const [name, anchor] = queue.shift()
    if (name.startsWith('@personal-agent/')) continue
    const directory = resolvePackage(name, anchor)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    const existing = resolved.get(name)
    if (existing !== undefined) {
      if (existing.directory !== directory && existing.version !== manifest.version)
        throw new StageError('dependency_conflict', `Two incompatible versions of ${name} are required`, {
          first: existing.version,
          second: manifest.version,
        })
      continue
    }
    resolved.set(name, { name, version: manifest.version, directory })
    for (const dependency of Object.keys(manifest.dependencies ?? {})) queue.push([dependency, join(directory, 'package.json')])
  }
  return [...resolved.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Every workspace package under packages/* and packages/drivers/*. The coordinator imports some
 * sibling packages by relative `src/` paths, so a closure must ship their source trees as well as
 * built dist and expose bare `@personal-agent/*` specifiers through node_modules links.
 */
export function workspacePackages(repoRoot) {
  const packages = []
  const scan = (root, relativeRoot) => {
    for (const name of readdirSync(root).sort()) {
      const directory = join(root, name)
      const manifestPath = join(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      packages.push({ name: manifest.name, directory, relative: `${relativeRoot}/${name}` })
    }
  }
  scan(join(repoRoot, 'packages'), 'packages')
  const drivers = join(repoRoot, 'packages/drivers')
  if (existsSync(drivers)) scan(drivers, 'packages/drivers')
  return packages.sort((left, right) => left.name.localeCompare(right.name))
}

function writePrivate(path, bytes) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, bytes, { mode: 0o600 })
}

function copyWorkspacePackage(source, destination) {
  mkdirSync(destination, { recursive: true, mode: 0o755 })
  cpSync(join(source, 'package.json'), join(destination, 'package.json'))
  for (const directory of ['src', 'dist']) {
    if (existsSync(join(source, directory))) cpSync(join(source, directory), join(destination, directory), { recursive: true })
  }
  for (const name of readdirSync(source)) {
    if (LICENSE_FILE.test(name) || name === 'README.md') cpSync(join(source, name), join(destination, name))
  }
}

export function stageInstall(options) {
  const repoRoot = options.repoRoot
  const output = options.output
  const release = options.release
  const releasePath = options.releasePath
  if (existsSync(output)) {
    const stat = lstatSync(output)
    if (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(output).length > 0)
      throw new StageError('target_not_empty', 'Staged install output must be a new or empty directory', { output })
  }
  const staging = `${output}.staging-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true, mode: 0o755 })
  try {
    const appRoot = join(staging, 'app')
    mkdirSync(appRoot, { recursive: true, mode: 0o755 })

    // 1. Static console (HTTP build) and repository license.
    cpSync(join(repoRoot, 'apps/console/dist'), join(appRoot, 'apps/console/dist'), { recursive: true })
    const licensePath = join(repoRoot, 'LICENSE')
    if (existsSync(licensePath)) {
      // The release verifies `LICENSE` relative to the install root (`app/`); keep a copy at the
      // closure root as well for humans.
      cpSync(licensePath, join(appRoot, 'LICENSE'))
      cpSync(licensePath, join(staging, 'LICENSE'))
    }

    // 2. Workspace packages: package.json + source + built dist + license/readme, preserving the
    // packages/drivers nested layout so relative `src/` imports keep resolving.
    const workspace = workspacePackages(repoRoot)
    for (const pkg of workspace) {
      const destination = join(appRoot, pkg.relative)
      copyWorkspacePackage(pkg.directory, destination)
      if (!pkg.name.startsWith('@personal-agent/')) continue
      const short = pkg.name.slice('@personal-agent/'.length)
      mkdirSync(join(appRoot, 'node_modules/@personal-agent'), { recursive: true, mode: 0o755 })
      const linkPath = join(appRoot, 'node_modules/@personal-agent', short)
      if (!existsSync(linkPath)) symlinkSync(`../../${pkg.relative}`, linkPath)
    }

    // 3. External runtime dependency closure, copied with licenses.
    const anchors = [
      join(repoRoot, 'apps/coordinator/package.json'),
      join(repoRoot, 'apps/launcher/package.json'),
      ...workspace.map((pkg) => join(pkg.directory, 'package.json')),
    ]
    const external = resolveExternalClosure(anchors)
    const dependencies = []
    for (const pkg of external) {
      const destination = join(appRoot, 'node_modules', pkg.name)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 })
      cpSync(pkg.directory, destination, { recursive: true })
      const hashed = hashDirectory(destination)
      dependencies.push({
        name: pkg.name,
        version: pkg.version,
        digest: hashed.digest,
        files: hashed.files.length,
        licenseFiles: licenseFilesIn(destination),
      })
    }

    // 4. Executed coordinator/launcher sources with their resources.
    if (existsSync(join(repoRoot, 'package.json'))) cpSync(join(repoRoot, 'package.json'), join(appRoot, 'package.json'))
    for (const directory of ['apps/coordinator', 'apps/launcher', 'apps/runner']) {
      cpSync(join(repoRoot, directory), join(appRoot, directory), {
        recursive: true,
        filter: (source) => !/(?:node_modules|\.test-output|test-result)/.test(source),
      })
    }
    const nativeEvidence = 'reports/releases/native-mvp/native-product.json'
    if (existsSync(join(repoRoot, nativeEvidence))) {
      mkdirSync(dirname(join(appRoot, nativeEvidence)), { recursive: true, mode: 0o755 })
      cpSync(join(repoRoot, nativeEvidence), join(appRoot, nativeEvidence))
    }

    // 5. Release manifest at the default config root so a relocated closure can start without rebuild.
    mkdirSync(join(staging, 'var/config'), { recursive: true, mode: 0o700 })
    writePrivate(join(staging, 'var/config/release.json'), readFileSync(releasePath))
    mkdirSync(join(staging, 'var'), { recursive: true, mode: 0o700 })

    // 6. Entry wrapper. Roots default inside the closure but stay overridable for a real user profile.
    const wrapper = `#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PA_INSTALL_ROOT="$DIR/app"
export PA_CONFIG_ROOT="\${PA_CONFIG_ROOT:-$DIR/var/config}"
export PA_DATA_ROOT="\${PA_DATA_ROOT:-$DIR/var/data}"
export PA_CACHE_ROOT="\${PA_CACHE_ROOT:-$DIR/var/cache}"
export PA_LOGS_ROOT="\${PA_LOGS_ROOT:-$DIR/var/logs}"
export PA_WORKSPACE_ROOT="\${PA_WORKSPACE_ROOT:-$DIR/var/workspaces}"
exec "\${PA_NODE:-node}" "$DIR/app/apps/launcher/bin/pa.mjs" "$@"
`
    mkdirSync(join(staging, 'bin'), { recursive: true, mode: 0o755 })
    writeFileSync(join(staging, 'bin/pa'), wrapper, { mode: 0o755 })

    // 7. Closure inventory: every regular file plus links, relative to the install dir.
    const entries = []
    const walk = (directory, base) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        const absolute = join(directory, entry.name)
        const path = relative(base, absolute).split('\\').join('/')
        if (entry.isSymbolicLink()) {
          entries.push({ path, kind: 'symlink', target: readlinkSync(absolute) })
          continue
        }
        if (entry.isDirectory()) {
          walk(absolute, base)
          continue
        }
        if (!entry.isFile()) continue
        const bytes = readFileSync(absolute)
        entries.push({ path, kind: 'file', bytes: bytes.byteLength, sha256: sha256(bytes) })
      }
    }
    walk(staging, staging)

    const install = {
      format: INSTALL_FORMAT,
      formatVersion: INSTALL_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      source: release.source,
      buildId: release.buildId,
      producer: {
        product: release.producer.product,
        version: release.producer.version,
        node: release.producer.node,
        pnpm: release.producer.pnpm,
        sqlite: release.producer.sqlite,
        productSchema: release.producer.productSchema,
        platform: release.producer.platform,
        arch: release.producer.arch,
        abi: release.admission?.abi ?? null,
      },
      appRoot: 'app',
      entry: 'bin/pa',
      entryFile: 'app/apps/launcher/bin/pa.mjs',
      coordinatorEntry: 'app/apps/coordinator/product/demo.ts',
      entrypoints: {
        launcher: 'app/apps/launcher/bin/pa.mjs',
        coordinator: 'app/apps/coordinator/product/demo.ts',
        runner: 'app/apps/runner/src/index.ts',
        consoleEntry: 'app/apps/console/dist/index.html',
        nativeBinding: 'app/node_modules/better-sqlite3',
      },
      workspacePackages: workspace.map((pkg) => ({
        name: pkg.name,
        path: `app/${pkg.relative}`,
        source: existsSync(join(pkg.directory, 'src')),
        dist: existsSync(join(pkg.directory, 'dist')),
      })),
      supportMatrix: {
        measured: ['darwin/arm64 + Node 24.21.x + SQLite ABI 137'],
        node: '>=24.21.0 <25',
        abi: release.admission?.abi ?? null,
        sqlite: '>=3.53.4',
        notTested: ['linux', 'win32', 'darwin-x64', 'other Node ABIs', 'other machines', 'personal native execution'],
      },
      consoleRoot: 'app/apps/console/dist',
      releaseManifest: 'var/config/release.json',
      dependencies,
      files: entries,
      commands: [
        './bin/pa first-run',
        './bin/pa doctor',
        './bin/pa start',
        './bin/pa stop',
      ],
      limitations: [
        'Same-machine/ABI closure: do not copy to another OS, architecture or Node ABI and claim support.',
        'Only darwin/arm64 with the recorded Node 24.21.x and SQLite ABI is a measured candidate.',
        'Native authentication, environment authority and model keys are not included; each user supplies their own.',
        'The original checkout and the builder node_modules are not referenced at runtime; the wrapper pins roots inside this directory unless overridden.',
        '`pa build` is not available in a staged install (prebuilt closure); upgrade by staging a new version.',
      ],
    }
    writeFileSync(join(staging, 'install.json'), `${JSON.stringify(install, null, 2)}\n`, { mode: 0o600 })

    // 8. Self-check: every listed file must match, and the staged install must pass its own
    // release/ABI/console/dependency gates before it is promoted.
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      const bytes = readFileSync(join(staging, entry.path))
      if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256)
        throw new StageError('install_digest_mismatch', 'Staged file does not match its recorded digest', { path: entry.path })
    }
    const wrapperPath = join(staging, 'bin/pa')
    const doctor = spawnSync(wrapperPath, ['doctor', '--json'], {
      cwd: staging,
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 120_000,
    })
    let doctorResult = null
    try { doctorResult = JSON.parse(doctor.stdout) } catch { doctorResult = null }
    if (doctor.status === 2 || doctorResult === null)
      throw new StageError('install_load_failed', 'Staged install failed its own doctor gate', {
        exit: doctor.status,
        stdout: (doctor.stdout ?? '').slice(0, 4000),
        stderr: (doctor.stderr ?? '').slice(0, 4000),
      })
    const requiredChecks = ['release_manifest', 'runtime_abi', 'console_mode', 'runtime_dependencies']
    const failedChecks = requiredChecks.filter((id) => !(doctorResult.checks ?? []).some((check) => check.id === id && check.status === 'PASS'))
    if (failedChecks.length > 0)
      throw new StageError('install_gate_failed', 'Staged install did not pass required doctor gates', { failedChecks, status: doctorResult.status })
    // Promote only after the self-check succeeded; a failed stage leaves no partial output.
    if (existsSync(output)) rmdirSync(output)
    renameSync(staging, output)
    return { install, installPath: join(output, 'install.json'), output }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

export function stageFromRelease({ repoRoot, output, releasePath }) {
  const release = JSON.parse(readFileSync(releasePath, 'utf8'))
  return stageInstall({ repoRoot, output, release, releasePath })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const outputIndex = args.indexOf('--output')
  if (outputIndex === -1) {
    process.stderr.write('usage: stage.mjs --output <new-dir> --repo-root <root> --release <release.json>\n')
    process.exit(2)
  }
  const repoIndex = args.indexOf('--repo-root')
  const releaseIndex = args.indexOf('--release')
  try {
    const result = stageFromRelease({
      repoRoot: repoIndex === -1 ? process.cwd() : args[repoIndex + 1],
      output: args[outputIndex + 1],
      releasePath: releaseIndex === -1 ? join(process.cwd(), '.local-state/release.json') : args[releaseIndex + 1],
    })
    process.stdout.write(`${JSON.stringify({ status: 'OK', ...result }, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`stage BLOCKED ${error.code ?? 'error'}: ${error.message}\n`)
    process.exit(2)
  }
}
