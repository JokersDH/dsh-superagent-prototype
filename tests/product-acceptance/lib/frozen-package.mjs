/**
 * Frozen install artifacts and helper provenance.
 *
 * Every installed-layer check must name the exact bytes it exercised. Artifacts are read from the
 * producer's `install-artifact.json` next to the tar (or an explicit JSON override), and a helper
 * module may only be imported from the frozen package extracted from that same tar. A developer
 * checkout cannot stand in for an older shipped binary.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DEFAULT_FROZEN_DIRS = Object.freeze({
  baseline: process.env.PA_E_INSTALL_BASELINE_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave16-target',
  target: process.env.PA_E_INSTALL_TARGET_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave17-target',
  cross: process.env.PA_E_INSTALL_CROSS_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave11-target',
})

/** Reads the artifact tuple from the producer's manifest next to the frozen tar. */
export function loadFrozenArtifact(role, dirName) {
  const envJson = process.env[`PA_E_${role.toUpperCase()}_ARTIFACT_JSON`]
  if (envJson !== undefined) return { role, ...JSON.parse(envJson) }
  const dir = resolve(dirName)
  const manifest = JSON.parse(readFileSync(join(dir, 'install-artifact.json'), 'utf8'))
  return {
    role,
    name: manifest.name,
    tarPath: manifest.tarPath ?? join(dir, `${manifest.name}.tar.gz`),
    tarSha256: manifest.digests.tarSha256,
    tarBytes: manifest.digests.tarBytes,
    installManifestSha256: manifest.digests.installManifestSha256,
    releaseManifestSha256: manifest.digests.releaseManifestSha256,
    closureDigest: manifest.digests.closureDigest,
    files: manifest.files?.count,
    buildId: manifest.buildId,
    sourceCommit: manifest.source.commit,
    sourceDirty: manifest.source.dirty === true,
    productSchema: manifest.producer.productSchema,
    platform: manifest.producer.platform,
    arch: manifest.producer.arch,
    node: manifest.producer.node,
    abi: String(manifest.producer.abi),
  }
}

export const frozenArtifactSubject = spec => ({
  source: spec.sourceCommit,
  buildId: spec.buildId,
  schema: spec.productSchema,
  tarSha256: spec.tarSha256,
  tarBytes: spec.tarBytes,
  platform: spec.platform,
  arch: spec.arch,
  abi: spec.abi,
})

/** The exact helper package identity handed to the ownership probe; never a checkout path. */
export function helperPackage(spec) {
  return {
    tarPath: spec.tarPath,
    tarSha256: spec.tarSha256,
    tarBytes: spec.tarBytes,
    sourceCommit: spec.sourceCommit,
    buildId: spec.buildId,
    productSchema: spec.productSchema,
  }
}

/** Reads one packaged file without extracting the whole tar. */
export function packagedFile(spec, suffix) {
  if (!existsSync(spec.tarPath)) return undefined
  const listing = spawnSync('tar', ['-tzf', spec.tarPath], { encoding: 'utf8', timeout: 60_000 })
  const entry = String(listing.stdout).split('\n').find(line => line.endsWith(suffix))
  if (!entry) return undefined
  const read = spawnSync('tar', ['-xOzf', spec.tarPath, entry], { encoding: 'utf8', timeout: 60_000 })
  return read.status === 0 ? read.stdout : undefined
}

/** sha256/size of one packaged file, taken from the frozen tar bytes. */
export function packagedFileDigest(spec, suffix) {
  if (!existsSync(spec.tarPath)) return undefined
  const listing = spawnSync('tar', ['-tzf', spec.tarPath], { encoding: 'utf8', timeout: 60_000 })
  const entry = String(listing.stdout).split('\n').find(line => line.endsWith(suffix))
  if (!entry) return undefined
  const read = spawnSync('tar', ['-xOzf', spec.tarPath, entry], { timeout: 60_000 })
  if (read.status !== 0) return undefined
  const bytes = read.stdout
  return { entry, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }
}

export function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function fileSize(path) {
  return statSync(path).size
}
