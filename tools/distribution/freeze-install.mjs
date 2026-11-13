#!/usr/bin/env node
/**
 * Freeze one staged install as an E-consumable artifact: verify every recorded file digest, confirm
 * the closure contains no credentials/runtime records or absolute checkout paths, then write a tar.gz
 * and a small artifact manifest (install/release/tar digests, buildId, platform/ABI, dependency
 * closure, support matrix). The install directory itself stays outside Git.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const installDir = resolve(option('--install') ?? '')
const artifactDir = resolve(option('--artifact-dir') ?? '')
const name = option('--name') ?? `wave06-alpha-${Date.now()}`
if (!option('--install') || !option('--artifact-dir')) {
  process.stderr.write('usage: freeze-install.mjs --install <staged-install-dir> --artifact-dir <existing-dir> [--name <artifact-name>]\n')
  process.exit(2)
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const FORBIDDEN = /(?:^|\/)(?:api\.key|auth\.json|\.env|instance\.json|launcher\.json|start\.lock|native-sessions)(?:\/|$)/

try {
  const manifestPath = join(installDir, 'install.json')
  const releasePath = join(installDir, 'var/config/release.json')
  if (!existsSync(manifestPath)) throw new Error('install.json is missing')
  if (!existsSync(releasePath)) throw new Error('var/config/release.json is missing')
  const install = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (install.format !== 'pa-install' || install.formatVersion !== 1) throw new Error('unsupported install manifest')
  const forbidden = install.files.filter((entry) => FORBIDDEN.test(entry.path))
  if (forbidden.length > 0) throw new Error(`closure contains secret/runtime material: ${forbidden.slice(0, 5).map((entry) => entry.path)}`)
  const absolutePaths = install.files.filter((entry) => entry.path.startsWith('/') || entry.path.includes('..'))
  if (absolutePaths.length > 0) throw new Error('closure contains unsafe/absolute paths')
  let totalBytes = 0
  for (const entry of install.files) {
    if (entry.kind !== 'file') continue
    const absolute = join(installDir, entry.path)
    if (!existsSync(absolute)) throw new Error(`recorded file is missing: ${entry.path}`)
    const bytes = readFileSync(absolute)
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`file digest mismatch: ${entry.path}`)
    totalBytes += bytes.byteLength
  }
  const lines = install.files.filter((entry) => entry.kind === 'file').map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)
  const closureDigest = sha256(lines.join('\n'))
  mkdirSync(artifactDir, { recursive: true, mode: 0o755 })
  const tarPath = join(artifactDir, `${name}.tar.gz`)
  if (existsSync(tarPath)) throw new Error(`artifact tar already exists: ${tarPath}`)
  const tar = spawnSync('tar', ['-czf', tarPath, '-C', dirname(installDir), basename(installDir)], { encoding: 'utf8', timeout: 300_000 })
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`)
  const tarBytes = readFileSync(tarPath)
  const artifact = {
    protocol: 'pa-install-artifact/1',
    createdAt: new Date().toISOString(),
    name,
    source: install.source,
    buildId: install.buildId,
    producer: install.producer,
    supportMatrix: install.supportMatrix,
    entrypoints: install.entrypoints,
    workspacePackageCount: install.workspacePackages.length,
    dependencies: install.dependencies.map((dependency) => ({ name: dependency.name, version: dependency.version, digest: dependency.digest, licenseFiles: dependency.licenseFiles })),
    files: { count: install.files.length, bytes: totalBytes },
    digests: {
      installManifestSha256: sha256(readFileSync(manifestPath)),
      releaseManifestSha256: sha256(readFileSync(releasePath)),
      closureDigest,
      tarSha256: sha256(tarBytes),
      tarBytes: tarBytes.byteLength,
    },
    installDirectory: installDir,
    tarPath,
    extraction: `tar -xzf ${tarPath} -C <new-root>`,
    commands: install.commands,
    limitations: install.limitations,
  }
  const artifactPath = join(artifactDir, `${name}.json`)
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o644 })
  writeFileSync(join(artifactDir, 'install-artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o644 })
  process.stdout.write(`${JSON.stringify({ status: 'FROZEN', artifactPath, ...artifact }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`freeze BLOCKED: ${String(error?.message ?? error)}\n`)
  process.exit(2)
}
