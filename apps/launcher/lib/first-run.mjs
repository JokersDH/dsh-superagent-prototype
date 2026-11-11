/**
 * `pa first-run`: create/verify private roots, record non-secret launcher config, bind the release
 * manifest of this exact install into the selected config root, and probe the executor.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensureRoots, platformSupport } from '@personal-agent/portability'
import { writeLauncherConfig } from './config.mjs'
import { ReleaseBootstrapError, hasInstallManifest, initializeRelease } from './release-bootstrap.mjs'
import { readRelease } from './release.mjs'

const execute = promisify(execFile)

async function probeExecutor() {
  try {
    const which = await execute('which', ['codex'], { timeout: 2000, encoding: 'utf8' })
    const executable = which.stdout.trim()
    const version = await execute(executable, ['--version'], { timeout: 10000, encoding: 'utf8' })
    return { available: true, executable, version: version.stdout.trim() }
  } catch {
    return { available: false, note: 'No installed Codex CLI found; native execution remains disabled until you admit one.' }
  }
}

/**
 * First run never asks for or stores model/API keys. Explicit model settings are submitted only
 * through the authenticated local web entry (`POST /v1/assistant/model`) after the instance is up.
 */
export async function firstRun({ installRoot, roots, json, adoptExisting = false }) {
  const ensured = ensureRoots(roots)
  const { path } = writeLauncherConfig(roots.config, ensured.roots)
  // A config root chosen with --config-root/PA_CONFIG_ROOT does not contain release.json; adopt the
  // manifest that is baked into this install, after proving it is the same install bytes.
  let release
  if (hasInstallManifest(installRoot)) {
    try {
      release = initializeRelease({ installRoot, configRoot: roots.config, adoptExisting })
    } catch (error) {
      if (!(error instanceof ReleaseBootstrapError)) throw error
      return {
        status: 'BLOCKED',
        code: error.code,
        message: error.message,
        detail: error.detail,
        configFile: path,
        roots: ensured.roots,
        hint: 'Install from a real distribution (`<install>/bin/pa`); first-run does not borrow a source checkout or an unverified release manifest.',
      }
    }
  } else {
    // Source checkout / bare app copy: no install inventory exists, so nothing may be adopted and no
    // release is claimed. `pa build --install-root . --config-root <this root>` writes one explicitly.
    const existing = readRelease(roots.config)
    release = existing.release === null
      ? { status: 'OK', adopted: false, reason: 'release_missing_development', path: existing.path, buildId: null, source: null, digest: null }
      : {
          status: 'OK',
          adopted: false,
          reason: 'unverified_source_build',
          path: existing.path,
          buildId: existing.release.buildId,
          source: existing.release.source,
          digest: null,
        }
  }
  const executor = await probeExecutor()
  const platform = platformSupport()
  const result = {
    status: 'OK',
    configFile: path,
    created: ensured.created,
    roots: ensured.roots,
    release: {
      path: release.path,
      buildId: release.buildId,
      commit: release.source.commit,
      digest: release.digest,
      reason: release.reason,
      adopted: release.adopted,
    },
    platform,
    executor,
    nextSteps: [
      'node apps/launcher/bin/pa.mjs build   # once per source update',
      'node apps/launcher/bin/pa.mjs start   # prints the local console URL',
      'Open the console and configure your model connection in the authenticated settings view.',
    ],
    limitations: [
      'No credential, model key or native session is collected by first-run.',
      platform.tested ? 'darwin/arm64 is the only measured candidate.' : platform.note,
    ],
  }
  return result
}
