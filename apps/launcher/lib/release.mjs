/**
 * Release manifest (`pa-release/1`) written once by `tools/distribution/build.mjs` and read by the
 * launcher. It binds the runtime dists and static console assets to the exact source commit,
 * Node/SQLite/platform admission and per-file digests, so `pa start` never falls back to a Vite dev
 * server or an unbuilt checkout.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

export const RELEASE_FORMAT = 'pa-release'
export const RELEASE_FORMAT_VERSION = 1
export const SUPPORTED_NODE = '>=24.21.0 <25'
export const RELEASE_FILE = 'release.json'

export class ReleaseError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'ReleaseError'
    this.code = code
    this.detail = detail
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value, field, max = 4096) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new ReleaseError('release_invalid', `Release field ${field} is invalid`)
  return value
}
const int = (value, field) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ReleaseError('release_invalid', `Release field ${field} must be a non-negative integer`)
  return value
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function validateRelease(value) {
  if (!isRecord(value)) throw new ReleaseError('release_invalid', 'Release manifest must be an object')
  if (value.format !== RELEASE_FORMAT) throw new ReleaseError('release_invalid', 'Release format is not pa-release')
  if (value.formatVersion !== RELEASE_FORMAT_VERSION)
    throw new ReleaseError('release_version_unsupported', 'Release manifest version is not supported', {
      formatVersion: value.formatVersion,
      supported: RELEASE_FORMAT_VERSION,
    })
  const buildId = str(value.buildId, 'buildId', 128)
  const source = isRecord(value.source) ? value.source : (() => { throw new ReleaseError('release_invalid', 'Release source is missing') })()
  const producer = isRecord(value.producer) ? value.producer : (() => { throw new ReleaseError('release_invalid', 'Release producer is missing') })()
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : (() => { throw new ReleaseError('release_invalid', 'Release artifacts are missing') })()
  const seen = new Set()
  const parsed = artifacts.map((entry) => {
    if (!isRecord(entry)) throw new ReleaseError('release_invalid', 'Release artifact is not an object')
    const path = str(entry.path, 'artifacts[].path')
    if (isAbsolute(path) || path.split('/').some((segment) => segment === '..' || segment === '') || path.includes('\\'))
      throw new ReleaseError('release_invalid', 'Release artifact path must be a safe relative POSIX path', { path })
    if (seen.has(path)) throw new ReleaseError('release_invalid', 'Release lists a duplicate artifact path', { path })
    seen.add(path)
    const sha256 = str(entry.sha256, 'artifacts[].sha256', 64)
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ReleaseError('release_invalid', 'Release artifact digest is invalid', { path })
    return { path, bytes: int(entry.bytes, 'artifacts[].bytes'), sha256, kind: str(entry.kind, 'artifacts[].kind', 32) }
  })
  const admission = isRecord(value.admission) ? value.admission : (() => { throw new ReleaseError('release_invalid', 'Release admission is missing') })()
  return {
    format: RELEASE_FORMAT,
    formatVersion: RELEASE_FORMAT_VERSION,
    buildId,
    createdAt: str(value.createdAt, 'createdAt', 64),
    source: {
      commit: str(source.commit, 'source.commit', 64),
      branch: source.branch === null ? null : str(source.branch, 'source.branch', 256),
      dirty: source.dirty === true,
    },
    producer: {
      product: str(producer.product, 'producer.product', 128),
      version: str(producer.version, 'producer.version', 64),
      node: str(producer.node, 'producer.node', 64),
      pnpm: str(producer.pnpm, 'producer.pnpm', 64),
      sqlite: str(producer.sqlite, 'producer.sqlite', 64),
      productSchema: int(producer.productSchema, 'producer.productSchema'),
      platform: str(producer.platform, 'producer.platform', 64),
      arch: str(producer.arch, 'producer.arch', 64),
    },
    build: {
      consoleMode: str(value.build?.consoleMode, 'build.consoleMode', 32),
      consoleRoot: str(value.build?.consoleRoot, 'build.consoleRoot'),
      packageCount: int(value.build?.packageCount, 'build.packageCount'),
    },
    artifacts: parsed,
    admission: {
      node: str(admission.node, 'admission.node', 64),
      platform: str(admission.platform, 'admission.platform', 64),
      arch: str(admission.arch, 'admission.arch', 64),
      sqlite: str(admission.sqlite, 'admission.sqlite', 64),
    },
    limitations: Array.isArray(value.limitations) ? value.limitations.map((entry) => str(entry, 'limitations[]', 2048)) : [],
  }
}

export function readRelease(configRoot) {
  const path = join(configRoot, RELEASE_FILE)
  if (!existsSync(path)) return { release: null, path, code: 'release_missing' }
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new ReleaseError('release_invalid', 'Release manifest file is unsafe or too large')
    return { release: validateRelease(JSON.parse(readFileSync(path, 'utf8'))), path, code: null }
  } catch (error) {
    if (error instanceof ReleaseError) return { release: null, path, code: error.code, detail: error.detail, message: error.message }
    return { release: null, path, code: 'release_unreadable', message: error.message }
  }
}

/**
 * Verify that every released artifact exists with the recorded size; optionally re-hash. A missing
 * or mismatched artifact blocks startup instead of silently serving stale bytes.
 */
export function verifyReleaseArtifacts(installRoot, release, options = {}) {
  const failures = []
  let checked = 0
  for (const artifact of release.artifacts) {
    const absolute = join(installRoot, artifact.path)
    const rel = relative(installRoot, absolute)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      failures.push({ path: artifact.path, reason: 'outside_install' })
      continue
    }
    try {
      const stat = lstatSync(absolute)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        failures.push({ path: artifact.path, reason: 'not_a_regular_file' })
        continue
      }
      if (stat.size !== artifact.bytes) {
        failures.push({ path: artifact.path, reason: 'size_mismatch', expected: artifact.bytes, observed: stat.size })
        continue
      }
      if (options.hash === true) {
        const digest = sha256File(absolute)
        if (digest !== artifact.sha256) {
          failures.push({ path: artifact.path, reason: 'digest_mismatch' })
          continue
        }
      }
      checked += 1
    } catch {
      failures.push({ path: artifact.path, reason: 'missing' })
    }
  }
  return { checked, failures, ok: failures.length === 0 }
}

/** The static console entry is required before serving; it is also release-listed. */
export function consoleIndexPath(installRoot, release) {
  return join(installRoot, release.build.consoleRoot, 'index.html')
}

export function statFile(path) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}
