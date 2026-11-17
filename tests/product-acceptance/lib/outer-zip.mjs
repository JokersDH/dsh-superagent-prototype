/**
 * The one shareable outer distribution ZIP.
 *
 * Verification is by the ZIP's own bytes: its SHA-256 against `SHA256SUMS`, its size and inner
 * identity against `package-result.json`, and the extracted inner install/runtime/license digests
 * against that same result. Extraction happens into a caller-supplied private directory with a
 * redirected HOME; no user instance, Application Support root or vendor model is touched.
 */
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const OUTER_ZIP_DIR = process.env.PA_E_W34_ZIP_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave33-preview-f880e5b'
export const OUTER_ZIP_NAME = process.env.PA_E_W34_ZIP_NAME ?? 'PersonalAgent-Preview-f880e5b.zip'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function parseJson(text) {
  const value = String(text ?? '').trim()
  try { return JSON.parse(value) } catch {
    try { return JSON.parse(value.split('\n').filter(Boolean).at(-1)) } catch { return undefined }
  }
}

/** Reads the ZIP and its two sidecars; nothing here trusts a filename alone. */
export function verifyOuterZip(dir = OUTER_ZIP_DIR, zipName = OUTER_ZIP_NAME) {
  const zipPath = join(dir, zipName)
  if (!existsSync(zipPath)) throw new Error(`outer ZIP is absent: ${zipPath}`)
  const zipBytes = readFileSync(zipPath)
  const digest = sha256(zipBytes)
  const sumsPath = join(dir, 'SHA256SUMS')
  const resultPath = join(dir, 'package-result.json')
  const sums = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8').trim() : ''
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : null
  return { zipPath, zipBytes, sha256: digest, bytes: zipBytes.byteLength, sums,
    sumsMatch: sums.includes(digest), result,
    resultMatch: result ? result.zipSha256 === digest && result.zipBytes === zipBytes.byteLength : null }
}

/** A private HOME with an `open` stub so the packaged launcher never opens a real browser window. */
export function privateHome(prefix = 'pa-e-w33-home-') {
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const bin = join(home, 'bin')
  mkdirSync(bin, { recursive: true })
  const openStub = join(bin, 'open')
  writeFileSync(openStub, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  chmodSync(openStub, 0o755)
  return home
}

export const launcherEnv = (home, extra = {}) => ({
  ...process.env, HOME: home, ...extra,
  PATH: `${join(home, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}`,
})

/** Extracts into `<home>/dist` and binds the inner install/runtime/license to the recorded result. */
export const W36_ZIP_DIR = process.env.PA_E_RM01_W36_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave36-preview-14a6b45'
export const W36_ZIP_NAME = 'PersonalAgent-Preview-14a6b45.zip'
export const W35_ZIP_DIR = process.env.PA_E_W36_W35_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave35-preview-599de3e'
export const W35_ZIP_NAME = 'PersonalAgent-Preview-599de3e.zip'

export function extractOuterZip(zip, home) {
  const extractRoot = join(home, 'dist')
  mkdirSync(extractRoot, { recursive: true })
  const unzipped = spawnSync('unzip', ['-q', zip.zipPath, '-d', extractRoot], { timeout: 180_000 })
  if (unzipped.status !== 0) throw new Error(`unzip ${unzipped.status}: ${String(unzipped.stderr).slice(-300)}`)
  let root = join(extractRoot, OUTER_ZIP_NAME.replace(/\.zip$/u, ''))
  if (!existsSync(root)) {
    const first = readdirSync(extractRoot).find(name => existsSync(join(extractRoot, name, 'runtime/bin/node')))
    if (first) root = join(extractRoot, first)
  }
  const manifest = JSON.parse(readFileSync(join(root, 'preview-manifest.json'), 'utf8'))
  const installBytes = readFileSync(join(root, 'install/install.json'))
  const runtimeBytes = readFileSync(join(root, 'runtime/bin/node'))
  const licenseBytes = readFileSync(join(root, 'runtime/LICENSE'))
  return { root, install: join(root, 'install'), nodePath: join(root, 'runtime/bin/node'), manifest,
    entries: readdirSync(join(root, 'install')).length,
    digests: { installManifest: sha256(installBytes), runtime: sha256(runtimeBytes), license: sha256(licenseBytes) } }
}
