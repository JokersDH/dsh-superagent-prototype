/**
 * Trusted `release.json` initialization for the private config root.
 *
 * A distribution install carries exactly one authoritative release manifest inside its own bytes
 * (`<install>/var/config/release.json`), and `install.json` records that file's size and digest.
 * `pa build` writes it when the install is produced with an explicit config root; nothing copies it
 * to a user's `--config-root`/`PA_CONFIG_ROOT`. Without this step `pa start` correctly refuses with
 * `release_missing`, but a colleague cannot fix that with the documented flow.
 *
 * This module adopts the install's own manifest into the selected private config root and refuses
 * anything that is not provably the same install:
 *
 * - the install manifest must exist, parse as `pa-install/1` and describe this install root;
 * - the release bytes must match the size/digest recorded in `install.json` (tamper/same-size drift);
 * - the release buildId/source commit must agree with `install.json`;
 * - every release artifact path must stay inside the install root;
 * - an existing different `release.json` is a source conflict, not something to overwrite silently.
 *
 * It never reads the author checkout, never falls back to a default root, never copies credentials,
 * and writes at most `<config-root>/release.json` with mode 0600.
 */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { ReleaseError, RELEASE_FILE, validateRelease } from './release.mjs'

export class ReleaseBootstrapError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'ReleaseBootstrapError'
    this.code = code
    this.detail = detail
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `<install>/install.json`, i.e. the manifest that shipped with this install tree. */
export const installManifestPath = (installRoot) => join(dirname(installRoot), 'install.json')

/** The release manifest inside the install bytes, as recorded by `install.json`. */
export const installReleasePath = (installRoot) => join(dirname(installRoot), 'var', 'config', RELEASE_FILE)

const readInstallManifest = (installRoot) => {
  const path = installManifestPath(installRoot)
  if (!existsSync(path))
    throw new ReleaseBootstrapError('install_manifest_missing', 'No distribution install manifest was found next to this install root', { path,
      hint: 'Run the launcher from an installed distribution (`<install>/bin/pa`), not from a source checkout or a copied `app/` directory.' })
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    throw new ReleaseBootstrapError('install_manifest_unreadable', 'The install manifest cannot be read', { path })
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
    throw new ReleaseBootstrapError('install_manifest_unreadable', 'The install manifest is not a regular file', { path })
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new ReleaseBootstrapError('install_manifest_invalid', 'The install manifest is not valid JSON', { path })
  }
  if (!isRecord(manifest) || manifest.format !== 'pa-install' || manifest.formatVersion !== 1)
    throw new ReleaseBootstrapError('install_manifest_invalid', 'The install manifest is not a supported pa-install/1 document', { path })
  if (typeof manifest.buildId !== 'string' || manifest.buildId.length === 0 || manifest.buildId.length > 128)
    throw new ReleaseBootstrapError('install_manifest_invalid', 'The install manifest has no valid buildId', { path })
  if (!isRecord(manifest.source) || typeof manifest.source.commit !== 'string')
    throw new ReleaseBootstrapError('install_manifest_invalid', 'The install manifest has no source commit', { path })
  if (!Array.isArray(manifest.files))
    throw new ReleaseBootstrapError('install_manifest_invalid', 'The install manifest has no file inventory', { path })
  return { path, manifest }
}

const assertInstallRootMatches = (installRoot, manifest) => {
  // The launcher's install root is `<install>/app`; the manifest root is `<install>`.
  const expected = resolve(dirname(installRoot))
  const declared = typeof manifest.root === 'string' ? resolve(manifest.root) : null
  if (declared !== null && declared !== expected)
    throw new ReleaseBootstrapError('install_root_mismatch', 'The install manifest belongs to a different install root', {
      declared,
      expected,
    })
  const appRoot = typeof manifest.appRoot === 'string' ? resolve(expected, manifest.appRoot) : null
  if (appRoot !== null && appRoot !== resolve(installRoot))
    throw new ReleaseBootstrapError('install_root_mismatch', 'The install manifest appRoot does not match the launcher install root', {
      appRoot,
      installRoot: resolve(installRoot),
    })
}

const readRecordedRelease = (installRoot, manifest) => {
  const candidate = readInstallReleaseBytes(installRoot)
  const relativePath = 'var/config/release.json'
  const recorded = manifest.files.find((entry) => isRecord(entry) && entry.path === relativePath)
  if (recorded === undefined)
    throw new ReleaseBootstrapError('install_manifest_invalid', 'The install manifest does not record its release manifest', { path: relativePath })
  if (recorded.bytes !== candidate.bytes || recorded.sha256 !== candidate.sha256)
    throw new ReleaseBootstrapError('install_manifest_tampered', 'The install release manifest does not match the install inventory (size or digest)', {
      expected: { bytes: recorded.bytes, sha256: recorded.sha256 },
      observed: candidate,
    })
  return candidate
}

const readInstallReleaseBytes = (installRoot) => {
  const path = installReleasePath(installRoot)
  if (!existsSync(path))
    throw new ReleaseBootstrapError('install_release_missing', 'The install does not contain a release manifest', { path,
      hint: 'Stage or build the distribution again; the install must contain var/config/release.json.' })
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    throw new ReleaseBootstrapError('install_release_unreadable', 'The install release manifest cannot be read', { path })
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
    throw new ReleaseBootstrapError('install_release_unreadable', 'The install release manifest is not a regular file', { path })
  const bytes = readFileSync(path)
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes), content: bytes }
}

const assertReleaseMatchesInstall = (release, manifest) => {
  if (release.buildId !== manifest.buildId)
    throw new ReleaseBootstrapError('release_source_mismatch', 'The release manifest buildId does not match the install manifest', {
      releaseBuildId: release.buildId,
      installBuildId: manifest.buildId,
    })
  if (release.source.commit !== manifest.source.commit)
    throw new ReleaseBootstrapError('release_source_mismatch', 'The release manifest source commit does not match the install manifest', {
      releaseCommit: release.source.commit,
      installCommit: manifest.source.commit,
    })
}

const assertArtifactsInsideInstall = (installRoot, release) => {
  const root = resolve(installRoot) + sep
  for (const artifact of release.artifacts) {
    const absolute = resolve(installRoot, artifact.path)
    if (!(`${absolute}${sep}`.startsWith(root) && absolute !== resolve(installRoot)))
      throw new ReleaseBootstrapError('release_source_mismatch', 'A release artifact points outside this install root', {
        path: artifact.path,
      })
    if (!existsSync(absolute))
      throw new ReleaseBootstrapError('install_incomplete', 'A release artifact is missing from the install', { path: artifact.path })
  }
}

const writePrivate = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
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
    try { unlinkSync(temporary) } catch { /* renamed or already gone */ }
  }
}

export const readTargetRelease = (configRoot) => {
  const path = join(configRoot, RELEASE_FILE)
  if (!existsSync(path)) return null
  try {
    const bytes = readFileSync(path)
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes), content: bytes }
  } catch {
    return { path, bytes: -1, sha256: null, content: null, unreadable: true }
  }
}

/**
 * Initialize/adopt the release manifest for one private config root.
 *
 * `adoptExisting` is only used by an explicit install switch (upgrade), which first moves the old
 * manifest aside; a plain first-run never overwrites a different source.
 */
export function initializeRelease({ installRoot, configRoot, adoptExisting = false, now = new Date() }) {
  if (!isAbsolute(installRoot) || !isAbsolute(configRoot))
    throw new ReleaseBootstrapError('invalid_root', 'Install and config roots must be absolute paths', { installRoot, configRoot })
  const { manifest } = readInstallManifest(installRoot)
  assertInstallRootMatches(installRoot, manifest)
  const installRelease = readRecordedRelease(installRoot, manifest)
  let release
  try {
    release = validateRelease(JSON.parse(installRelease.content.toString('utf8')))
  } catch (error) {
    if (error instanceof ReleaseError)
      throw new ReleaseBootstrapError(error.code === 'release_invalid' ? 'release_invalid' : error.code, `The install release manifest is invalid: ${error.message}`, error.detail ?? {})
    throw new ReleaseBootstrapError('release_invalid', 'The install release manifest is not valid JSON')
  }
  assertReleaseMatchesInstall(release, manifest)
  assertArtifactsInsideInstall(installRoot, release)

  const target = join(configRoot, RELEASE_FILE)
  const existing = readTargetRelease(configRoot)
  if (existing !== null) {
    if (existing.unreadable === true)
      throw new ReleaseBootstrapError('release_target_unreadable', 'An unreadable release manifest already exists in the config root', { path: target })
    if (existing.sha256 === installRelease.sha256) {
      return {
        status: 'OK',
        adopted: false,
        reason: 'already_initialized',
        path: target,
        buildId: release.buildId,
        source: release.source,
        digest: existing.sha256,
      }
    }
    if (!adoptExisting) {
      const previous = (() => {
        try {
          return validateRelease(JSON.parse(existing.content.toString('utf8')))
        } catch {
          return null
        }
      })()
      throw new ReleaseBootstrapError('release_source_conflict', 'The config root already holds a release manifest from a different install', {
        path: target,
        existing: previous === null ? { digest: existing.sha256 } : { buildId: previous.buildId, commit: previous.source.commit, digest: existing.sha256 },
        incoming: { buildId: release.buildId, commit: release.source.commit, digest: installRelease.sha256 },
        hint: 'Use `pa upgrade --to <install>` to switch installs deliberately, or choose a fresh --config-root.',
      })
    }
  }

  writePrivate(target, installRelease.content)
  const readback = readFileSync(target)
  if (sha256(readback) !== installRelease.sha256)
    throw new ReleaseBootstrapError('release_write_unverified', 'The written release manifest does not match the install bytes')
  return {
    status: 'OK',
    adopted: true,
    reason: existing === null ? 'initialized_from_install' : 'replaced_by_explicit_switch',
    path: target,
    buildId: release.buildId,
    source: release.source,
    digest: installRelease.sha256,
    at: now.toISOString(),
  }
}

/**
 * A source checkout (or a bare `app/` copy) has no install manifest. That is not a distribution
 * install, so first-run does not adopt anything; it reports the state instead of pretending success.
 */
export const hasInstallManifest = (installRoot) => {
  try {
    return lstatSync(installManifestPath(installRoot)).isFile()
  } catch {
    return false
  }
}

/** Non-mutating check used by doctor/status: is the config root bound to this exact install? */
export function releaseBinding({ installRoot, configRoot }) {
  const existing = readTargetRelease(configRoot)
  if (existing === null || existing.unreadable === true)
    return { bound: false, code: existing === null ? 'release_missing' : 'release_target_unreadable', path: join(configRoot, RELEASE_FILE) }
  if (!hasInstallManifest(installRoot))
    // A source checkout writes its release manifest directly with `pa build`; it has no install
    // inventory to bind against, so this is a development build, not a distribution provenance claim.
    return { bound: false, code: 'source_build_no_install_manifest', path: existing.path, configDigest: existing.sha256 }
  try {
    const { manifest } = readInstallManifest(installRoot)
    const installRelease = readRecordedRelease(installRoot, manifest)
    return {
      bound: existing.sha256 === installRelease.sha256,
      code: existing.sha256 === installRelease.sha256 ? null : 'release_source_conflict',
      path: existing.path,
      configDigest: existing.sha256,
      installDigest: installRelease.sha256,
      installBuildId: manifest.buildId,
    }
  } catch (error) {
    return { bound: false, code: error.code ?? 'install_manifest_invalid', path: existing.path, message: error.message }
  }
}
