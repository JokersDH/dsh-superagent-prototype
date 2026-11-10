#!/usr/bin/env node
/**
 * Zero-model install smoke: build the static/runtime artifacts, create private roots through
 * `pa first-run`, then run `pa doctor` against the recorded release manifest. It makes no model or
 * native-agent call and starts no daemon; the full trial smoke is tools/distribution/smoke.mjs.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PA = join(REPO_ROOT, 'apps/launcher/bin/pa.mjs')
const BUILD = join(REPO_ROOT, 'tools/distribution/build.mjs')
const REPORTS = join(REPO_ROOT, 'tools/distribution/reports')

const { values } = parseArgs({
  options: {
    'keep-root': { type: 'string' },
    'reuse-config-root': { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
  },
})

const evidence = { case: 'DIST-INSTALL-01', status: 'FAIL', startedAt: new Date().toISOString(), steps: [], limitations: [] }
const step = (id, action) => {
  try {
    const result = action()
    evidence.steps.push({ id, status: 'PASS', ...(result === undefined ? {} : { result }) })
    return result
  } catch (error) {
    evidence.steps.push({ id, status: 'FAIL', message: String(error.message ?? error) })
    evidence.status = 'FAIL'
    throw error
  }
}

function run(file, args, label, { allowExit = [0] } = {}) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300000 })
  if (!allowExit.includes(result.status)) {
    throw new Error(`${label} failed (exit ${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr }
}

const root = values['keep-root'] ? mkdirSync(values['keep-root'], { recursive: true, mode: 0o700 }) ?? values['keep-root'] : mkdtempSync(join(tmpdir(), 'pa-install-smoke-'))
const configRoot = values['reuse-config-root'] ?? join(root, 'config')
const dataRoot = join(root, 'data')
const cacheRoot = join(root, 'cache')
const logsRoot = join(root, 'logs')
const workspaceRoot = join(root, 'workspaces')
const rootsArgs = [
  '--install', REPO_ROOT,
  '--config-root', configRoot,
  '--data-root', dataRoot,
  '--cache-root', cacheRoot,
  '--logs-root', logsRoot,
  '--workspace-root', workspaceRoot,
]

try {
  if (!values['skip-build']) {
    step('build', () => {
      const result = run(BUILD, ['--install-root', REPO_ROOT, '--config-root', configRoot, '--json'], 'pa build')
      const summary = JSON.parse(result.stdout)
      if (summary.status !== 'OK') throw new Error('build did not report OK')
      return { buildId: summary.buildId, artifacts: summary.artifacts }
    })
  }
  step('release-manifest', () => {
    const path = join(configRoot, 'release.json')
    if (!existsSync(path)) throw new Error('release manifest was not written')
    const release = JSON.parse(readFileSync(path, 'utf8'))
    if (release.format !== 'pa-release' || release.formatVersion !== 1) throw new Error('unexpected release format')
    if (!Array.isArray(release.artifacts) || release.artifacts.length === 0) throw new Error('release has no artifacts')
    const index = release.artifacts.find((artifact) => artifact.path === 'apps/console/dist/index.html')
    if (!index) throw new Error('release does not list the static console entry')
    return { buildId: release.buildId, artifacts: release.artifacts.length }
  })
  step('first-run', () => {
    const result = run(PA, ['first-run', '--json', ...rootsArgs], 'pa first-run')
    const parsed = JSON.parse(result.stdout)
    if (parsed.status !== 'OK') throw new Error('first-run did not report OK')
    if (parsed.configFile !== join(configRoot, 'launcher.json')) throw new Error('first-run config path mismatch')
    return { created: parsed.created, configFile: parsed.configFile }
  })
  const doctor = step('doctor', () => {
    const result = run(PA, ['doctor', '--json', ...rootsArgs], 'pa doctor', { allowExit: [0, 1] })
    const parsed = JSON.parse(result.stdout)
    const failing = parsed.checks.filter((check) => check.status === 'FAIL')
    if (failing.length) throw new Error(`doctor reported FAIL: ${JSON.stringify(failing)}`)
    if (!['READY', 'DEGRADED'].includes(parsed.status)) throw new Error(`unexpected doctor status ${parsed.status}`)
    for (const required of ['node_version', 'sqlite_binding', 'release_manifest', 'console_assets', 'roots']) {
      if (!parsed.checks.some((check) => check.id === required && check.status === 'PASS'))
        throw new Error(`required doctor check did not pass: ${required}`)
    }
    return { status: parsed.status, exitCode: result.exit, checks: parsed.checks.length }
  })
  evidence.status = 'PASS'
  evidence.platform = { platform: process.platform, arch: process.arch, node: process.versions.node }
  evidence.limitations.push(
    'This smoke builds and diagnoses one install; it starts no daemon and makes no model request.',
    'Only darwin/arm64 is a measured candidate; other platforms remain NOT_TESTED.',
  )
  evidence.result = doctor

} catch {
  evidence.status = 'FAIL'
} finally {
  mkdirSync(REPORTS, { recursive: true })
  evidence.finishedAt = new Date().toISOString()
  writeFileSync(join(REPORTS, 'install-smoke.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  if (!values['keep-root']) rmSync(root, { recursive: true, force: true })
  else process.stderr.write(`kept smoke root: ${root}\n`)
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
