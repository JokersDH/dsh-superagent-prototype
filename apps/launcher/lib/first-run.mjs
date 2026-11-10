/** `pa first-run`: create/verify private roots, record non-secret launcher config, probe the executor. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensureRoots, platformSupport } from '@personal-agent/portability'
import { writeLauncherConfig } from './config.mjs'

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
export async function firstRun({ installRoot, roots, json }) {
  const ensured = ensureRoots(roots)
  const { path } = writeLauncherConfig(roots.config, ensured.roots)
  const executor = await probeExecutor()
  const platform = platformSupport()
  const result = {
    status: 'OK',
    configFile: path,
    created: ensured.created,
    roots: ensured.roots,
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
