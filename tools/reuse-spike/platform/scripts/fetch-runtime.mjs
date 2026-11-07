#!/usr/bin/env node
/**
 * Fetch and verify the *proposed* release combination into this experiment's own cache:
 *   - Node 24.22.2 (host platform/arch tarball, sha256 from the published SHASUMS256.txt)
 *   - pnpm 11.7.0 (npm tarball, sha512 from the registry's dist.integrity)
 *
 * Everything lands under .cache/ (git-ignored). Nothing is installed globally: the current shell's
 * Node/nvm/Homebrew state is untouched. Idempotent: a second run re-verifies checksums and returns
 * the same paths. Exits non-zero with an explicit message when the host platform is outside this
 * experiment's matrix, so callers record NOT_TESTED instead of guessing.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { release as osRelease } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NODE_VERSION = '24.22.2'
const PNPM_VERSION = '11.7.0'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
const DOWNLOADS = join(CACHE, 'downloads')
const RUNTIMES = join(CACHE, 'runtimes')
const MANIFEST = join(CACHE, 'runtime-manifest.json')

export const PROPOSED = { node: NODE_VERSION, pnpm: PNPM_VERSION }

/** Host tag used by Node's dist naming; throws for hosts this experiment does not cover. */
export function hostTag() {
  const { platform, arch } = process
  const supported = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
  }
  const tag = supported[`${platform}-${arch}`]
  if (!tag) throw new Error(`NOT_TESTED: host ${platform}/${arch} is outside this experiment's matrix`)
  return tag
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const sha512base64 = buffer => createHash('sha512').update(buffer).digest('base64')

async function get(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function cachedDownload(url, destination) {
  if (existsSync(destination)) return readFile(destination)
  const bytes = await get(url)
  await writeFile(destination, bytes)
  return bytes
}

function untar(archive, destination, extraArgs) {
  execFileSync('tar', ['-xf', archive, '-C', destination, ...extraArgs], { stdio: 'pipe' })
}

async function ensureNode() {
  const tag = hostTag()
  const archiveName = `node-v${NODE_VERSION}-${tag}.tar.gz`
  const archivePath = join(DOWNLOADS, archiveName)
  const runtimeDir = join(RUNTIMES, `node-v${NODE_VERSION}-${tag}`)

  const shasums = (await get(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).toString('utf8')
  const expected = shasums
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .find(parts => parts[1] === archiveName)?.[0]
  if (!expected) throw new Error(`nodejs.org SHASUMS256.txt has no entry for ${archiveName}`)

  const bytes = await cachedDownload(`https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`, archivePath)
  const actual = sha256(bytes)
  if (actual !== expected) throw new Error(`Node archive checksum mismatch: ${actual} != ${expected}`)

  if (!existsSync(join(runtimeDir, 'bin', 'node'))) untar(archivePath, RUNTIMES, [])
  const nodeBin = join(runtimeDir, 'bin', 'node')
  const reported = execFileSync(nodeBin, ['-p', 'process.version'], { encoding: 'utf8' }).trim()
  if (reported !== `v${NODE_VERSION}`) throw new Error(`extracted node reports ${reported}, expected v${NODE_VERSION}`)

  return {
    version: NODE_VERSION,
    platformTag: tag,
    archive: archiveName,
    url: `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`,
    sha256: expected,
    binary: nodeBin,
    reported,
  }
}

async function ensurePnpm() {
  const metadata = JSON.parse((await get(`https://registry.npmjs.org/pnpm/${PNPM_VERSION}`)).toString('utf8'))
  const tarballUrl = metadata.dist?.tarball
  const integrity = metadata.dist?.integrity
  if (!tarballUrl || !integrity?.startsWith('sha512-')) throw new Error('pnpm registry metadata lacks tarball/integrity')

  const archiveName = `pnpm-${PNPM_VERSION}.tgz`
  const archivePath = join(DOWNLOADS, archiveName)
  const runtimeDir = join(RUNTIMES, `pnpm-${PNPM_VERSION}`)
  const cli = join(runtimeDir, 'bin', 'pnpm.cjs')

  const bytes = await cachedDownload(tarballUrl, archivePath)
  const actual = `sha512-${sha512base64(bytes)}`
  if (actual !== integrity) throw new Error(`pnpm tarball integrity mismatch: ${actual} != ${integrity}`)

  if (!existsSync(cli)) {
    await mkdir(runtimeDir, { recursive: true })
    untar(archivePath, runtimeDir, ['--strip-components=1'])
  }
  const reported = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim()
  if (!reported.includes(PNPM_VERSION)) throw new Error(`pnpm reports ${reported}, expected ${PNPM_VERSION}`)

  return { version: PNPM_VERSION, url: tarballUrl, integrity, cli, reported }
}

export async function ensureRuntime() {
  await mkdir(DOWNLOADS, { recursive: true })
  await mkdir(RUNTIMES, { recursive: true })
  const node = await ensureNode()
  const pnpm = await ensurePnpm()
  const manifest = {
    fetchedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, release: osRelease() },
    node,
    pnpm,
  }
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureRuntime()
    .then(manifest => {
      process.stdout.write(`node  ${manifest.node.reported}  ${manifest.node.binary}\n`)
      process.stdout.write(`pnpm  ${manifest.pnpm.reported}  ${manifest.pnpm.cli}\n`)
      process.stdout.write(`manifest ${MANIFEST}\n`)
    })
    .catch(error => {
      process.stderr.write(`fetch-runtime failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    })
}
