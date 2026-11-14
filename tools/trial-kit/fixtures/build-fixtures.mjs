#!/usr/bin/env node
/**
 * Build the tiny `pa-install` fixtures used by the trial-kit negative controls.
 *
 * The fixture is a complete, internally consistent install closure (manifest + release manifest +
 * console stamp + external dependency + internal workspace symlink), small enough to build and
 * re-hash in a test. Mutations then break exactly one property each, so a refused preflight can be
 * attributed to the intended rule instead of an unrelated precondition.
 *
 * Fixtures are created at test time in a caller-owned temporary directory; nothing here is
 * committed, and nothing reads or writes a real product state.
 */
import { createHash } from 'node:crypto'
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function writeFile(root, rel, content, mode = 0o644) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
  writeFileSync(path, content, { mode })
}

function listEntries(root) {
  const entries = []
  const visit = (absolute, rel) => {
    for (const name of readdirSync(absolute)) {
      const childAbsolute = join(absolute, name)
      const childRel = rel === '' ? name : `${rel}/${name}`
      const info = lstatSync(childAbsolute)
      if (info.isDirectory()) visit(childAbsolute, childRel)
      else if (info.isFile()) entries.push({ path: childRel, kind: 'file', bytes: info.size, sha256: sha256(readFileSync(childAbsolute)) })
      else if (info.isSymbolicLink()) entries.push({ path: childRel, kind: 'symlink', target: readlinkSync(childAbsolute) })
    }
  }
  visit(root, '')
  return entries
}

function closureDigest(entries) {
  const lines = entries.filter((entry) => entry.kind === 'file').map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)
  return sha256(lines.join('\n'))
}

export function buildTinyInstall(root, { prefix = 'install' } = {}) {
  const installRoot = join(root, prefix)
  const productSchema = 18
  const buildId = '0123456789abcdef'
  const source = { commit: 'a'.repeat(40), branch: 'fixture', dirty: false }
  const producer = { product: 'dsh-superagent', version: '0.1.0', node: process.versions.node, pnpm: '11.7.0', sqlite: '3.53.4', productSchema, platform: process.platform, arch: process.arch, abi: process.versions.modules }
  const supportMatrix = { measured: [`${process.platform}/${process.arch} + Node ${process.versions.node}`], node: '>=24.21.0 <25', abi: process.versions.modules, sqlite: '>=3.53.4', notTested: ['other platforms'] }

  const doctorChecks = ['node_version', 'platform', 'sqlite_binding', 'release_binding', 'release_manifest', 'console_assets', 'console_mode', 'runtime_dependencies', 'source_identity', 'runtime_abi', 'support_matrix', 'roots']
    .map((id) => ({ id, status: 'PASS' }))
    .concat([{ id: 'state', status: 'WARN', detail: { message: 'No product database yet' } }])
  const doctorJson = JSON.stringify({ status: 'DEGRADED', exitCode: 1, checkedAt: '2026-01-01T00:00:00.000Z', checks: doctorChecks })
  const supportJson = JSON.stringify({ protocol: 'pa-support/1', generatedAt: '2026-01-01T00:00:00.000Z', productSchema, platform: { platform: process.platform, arch: process.arch }, roots: {}, state: {}, redaction: { included: false } })
  writeFile(installRoot, 'bin/pa', [
    '#!/bin/sh',
    'set -eu',
    'if [ -n "${TRIAL_PA_CALL_LOG:-}" ]; then printf "%s\\n" "$*" >> "$TRIAL_PA_CALL_LOG"; fi',
    'command="${1:-help}"',
    'case "$command" in',
    '  help) printf "%s\\n" "pa fixture help (read-only)"; exit 0 ;;',
    '  status) printf "%s\\n" \'{"status":"STOPPED","roots":{}}\'; exit 2 ;;',
    `  doctor) printf '%s\\n' '${doctorJson}'; exit 1 ;;`,
    '  support) shift; out=""; while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2 ;; *) shift ;; esac; done; [ -n "$out" ] || exit 2; umask 077; printf \'%s\\n\' ' + `'${supportJson}'` + ' > "$out"; echo \'{"status":"CREATED"}\'; exit 0 ;;',
    '  *) printf "%s\\n" "unknown" >&2; exit 2 ;;',
    'esac',
    '',
  ].join('\n'), 0o755)
  writeFile(installRoot, 'app/package.json', `${JSON.stringify({ name: 'dsh-superagent', version: '0.1.0', private: true }, null, 2)}\n`)
  writeFile(installRoot, 'app/LICENSE', 'MIT fixture license\n')
  writeFile(installRoot, 'app/apps/launcher/bin/pa.mjs', '#!/usr/bin/env node\nprocess.stdout.write("fixture pa help\\n")\n', 0o755)
  writeFile(installRoot, 'app/apps/coordinator/product/demo.ts', 'export const fixture = true\n')
  writeFile(installRoot, 'app/apps/runner/src/index.ts', 'export const fixtureRunner = true\n')
  const consoleDigest = sha256('fixture-console-build')
  writeFile(installRoot, 'app/apps/console/dist/index.html', '<!doctype html><title>fixture</title>\n')
  writeFile(installRoot, 'app/apps/console/dist/.pa-console-build.json', `${JSON.stringify({ protocol: 'personal-console-build/1', mode: 'http', digest: consoleDigest })}\n`)
  writeFile(installRoot, 'app/node_modules/tiny-dep/package.json', `${JSON.stringify({ name: 'tiny-dep', version: '1.0.0' }, null, 2)}\n`)
  writeFile(installRoot, 'app/node_modules/tiny-dep/LICENSE', 'tiny dep license\n')
  writeFile(installRoot, 'app/packages/workspace/package.json', `${JSON.stringify({ name: '@fixture/workspace', version: '0.1.0' }, null, 2)}\n`)
  mkdirSync(join(installRoot, 'app/node_modules/@fixture'), { recursive: true, mode: 0o755 })
  symlinkSync('../../packages/workspace', join(installRoot, 'app/node_modules/@fixture/workspace'))

  const artifacts = [
    { path: 'LICENSE', bytes: lstatSync(join(installRoot, 'app/LICENSE')).size, sha256: sha256(readFileSync(join(installRoot, 'app/LICENSE'))), kind: 'license' },
    { path: 'apps/console/dist/index.html', bytes: lstatSync(join(installRoot, 'app/apps/console/dist/index.html')).size, sha256: sha256(readFileSync(join(installRoot, 'app/apps/console/dist/index.html'))), kind: 'console' },
  ]
  const release = {
    format: 'pa-release', formatVersion: 1, buildId, createdAt: '2026-01-01T00:00:00.000Z', source, producer,
    build: { consoleMode: 'http', consoleRoot: 'apps/console/dist', consoleDigest, packageCount: 1 },
    artifacts,
    dependencies: [{ name: 'tiny-dep', version: '1.0.0', digest: '0'.repeat(64), licenseFiles: ['LICENSE'] }],
  }
  writeFile(installRoot, 'var/config/release.json', `${JSON.stringify(release, null, 2)}\n`)
  const entries = listEntries(installRoot)
  const install = {
    format: 'pa-install', formatVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', source, buildId, producer,
    appRoot: 'app', entry: 'bin/pa', entryFile: 'app/apps/launcher/bin/pa.mjs', coordinatorEntry: 'app/apps/coordinator/product/demo.ts',
    entrypoints: {
      launcher: 'app/apps/launcher/bin/pa.mjs', coordinator: 'app/apps/coordinator/product/demo.ts',
      runner: 'app/apps/runner/src/index.ts', consoleEntry: 'app/apps/console/dist/index.html', nativeBinding: 'app/node_modules/tiny-dep',
    },
    workspacePackages: [{ name: '@fixture/workspace', path: 'app/packages/workspace', source: true, dist: false }],
    supportMatrix,
    consoleRoot: 'apps/console/dist',
    releaseManifest: 'var/config/release.json',
    dependencies: [{ name: 'tiny-dep', version: '1.0.0', digest: '0'.repeat(64), licenseFiles: ['LICENSE'] }],
    files: entries,
    commands: ['./bin/pa help', './bin/pa doctor'],
    limitations: ['fixture only'],
  }
  writeFile(installRoot, 'install.json', `${JSON.stringify(install, null, 2)}\n`)

  return { root, installRoot, install, release, closureDigest: closureDigest(entries), entries }
}

export function buildArtifact(fixture, tarPath, name = 'fixture-package') {
  const tarBytes = readFileSync(tarPath)
  const installManifestSha256 = sha256(readFileSync(join(fixture.installRoot, 'install.json')))
  const releaseManifestSha256 = sha256(readFileSync(join(fixture.installRoot, 'var/config/release.json')))
  return {
    protocol: 'pa-install-artifact/1', createdAt: '2026-01-01T00:00:00.000Z', name,
    source: fixture.install.source, buildId: fixture.install.buildId, producer: fixture.install.producer,
    supportMatrix: fixture.install.supportMatrix, entrypoints: fixture.install.entrypoints,
    workspacePackageCount: fixture.install.workspacePackages.length,
    dependencies: fixture.install.dependencies.map((dependency) => ({ name: dependency.name, version: dependency.version, digest: dependency.digest, licenseFiles: dependency.licenseFiles })),
    files: { count: fixture.entries.length, bytes: fixture.entries.filter((entry) => entry.kind === 'file').reduce((sum, entry) => sum + entry.bytes, 0) },
    digests: { installManifestSha256, releaseManifestSha256, closureDigest: fixture.closureDigest, tarSha256: sha256(tarBytes), tarBytes: tarBytes.byteLength },
    limitations: ['fixture only'],
  }
}

export function packFixture(fixture, tarPath) {
  rmSync(tarPath, { force: true })
  const result = spawnSync('tar', ['-czf', tarPath, '-C', fixture.root, 'install'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`fixture tar failed: ${result.stderr}`)
  return buildArtifact(fixture, tarPath)
}

/** One intentional defect per fixture variant. */
export function mutate(fixture, variant) {
  const root = fixture.root
  const installPath = join(fixture.installRoot, 'install.json')
  const read = () => JSON.parse(readFileSync(installPath, 'utf8'))
  const write = (value) => writeFileSync(installPath, `${JSON.stringify(value, null, 2)}\n`)
  if (variant === 'bad-hash') {
    const install = read()
    const target = install.files.find((entry) => entry.kind === 'file')
    target.sha256 = 'b'.repeat(64)
    write(install)
  } else if (variant === 'extra-file') {
    writeFile(fixture.installRoot, 'app/undeclared.txt', 'not listed\n')
  } else if (variant === 'missing-file') {
    rmSync(join(fixture.installRoot, 'app/LICENSE'))
  } else if (variant === 'external-symlink') {
    const linkPath = join(fixture.installRoot, 'app/node_modules/@fixture/workspace')
    rmSync(linkPath)
    symlinkSync('/etc/hosts', linkPath)
    const install = read()
    const link = install.files.find((entry) => entry.kind === 'symlink')
    link.target = '/etc/hosts'
    write(install)
  } else if (variant === 'bad-json') {
    writeFileSync(installPath, '{ not json')
  } else if (variant === 'missing-dep') {
    rmSync(join(fixture.installRoot, 'app/node_modules/tiny-dep/package.json'))
  } else if (variant === 'abi-mismatch') {
    const install = read()
    install.producer.abi = '999'
    write(install)
  } else if (variant === 'wrong-console-stamp') {
    writeFile(fixture.installRoot, 'app/apps/console/dist/.pa-console-build.json', `${JSON.stringify({ protocol: 'personal-console-build/1', mode: 'http', digest: 'c'.repeat(64) })}\n`)
  } else if (variant === 'missing-release') {
    rmSync(join(fixture.installRoot, 'var/config/release.json'))
  } else {
    throw new Error(`unknown fixture variant ${variant}`)
  }
  return fixture
}

export function cloneFixture(fixture, destinationRoot) {
  cpSync(fixture.root, destinationRoot, { recursive: true, verbatimSymlinks: true })
  const installRoot = join(destinationRoot, relative(fixture.root, fixture.installRoot))
  return { ...fixture, root: destinationRoot, installRoot }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const out = args[args.indexOf('--out') + 1]
  if (!out) {
    process.stderr.write('usage: build-fixtures.mjs --out <new-directory>\n')
    process.exit(2)
  }
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const fixture = buildTinyInstall(out)
  const artifact = packFixture(fixture, join(out, 'tiny-install.tar.gz'))
  writeFileSync(join(out, 'tiny-install-artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ install: fixture.installRoot, tar: join(out, 'tiny-install.tar.gz'), artifact: join(out, 'tiny-install-artifact.json'), closureDigest: fixture.closureDigest }, null, 2)}\n`)
}
