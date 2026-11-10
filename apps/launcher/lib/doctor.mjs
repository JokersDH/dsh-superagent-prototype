/**
 * Read-only diagnosis. Doctor never creates roots, never starts a process, and never prints a
 * credential. Exit codes: 0 READY (runnable), 1 DEGRADED (usable for diagnosis/settings but an
 * execution or platform capability is missing), 2 BLOCKED (this build cannot run here).
 */
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describeRoots, platformSupport } from '@personal-agent/portability'
import { EXIT } from './cli.mjs'
import { readInstanceRecord, verifyInstance } from './instance.mjs'
import { SUPPORTED_NODE, consoleIndexPath, readRelease, statFile, verifyReleaseArtifacts } from './release.mjs'

const execute = promisify(execFile)

function parseNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

/** The distribution admits exactly the written `>=24.21.0 <25` range; anything else is refused. */
export function satisfiesSupportedNode(version) {
  const parsed = parseNodeVersion(version)
  if (!parsed) return false
  return compare(parsed, [24, 21, 0]) >= 0 && parsed[0] < 25
}

const pass = (id, detail) => ({ id, status: 'PASS', ...(detail === undefined ? {} : { detail }) })
const warn = (id, detail) => ({ id, status: 'WARN', ...(detail === undefined ? {} : { detail }) })
const fail = (id, detail) => ({ id, status: 'FAIL', ...(detail === undefined ? {} : { detail }) })

async function checkSqlite(installRoot) {
  try {
    const storagePackage = join(installRoot, 'packages/storage/package.json')
    const require = createRequire(storagePackage)
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    try {
      const version = db.prepare('select sqlite_version() as version').get().version
      return pass('sqlite_binding', { sqlite: String(version), abi: process.versions.modules, node: process.versions.node })
    } finally {
      db.close()
    }
  } catch (error) {
    return fail('sqlite_binding', {
      message: 'The native SQLite binding cannot be loaded by this Node runtime',
      cause: String(error.message ?? error),
      hint: 'Reinstall dependencies with the supported Node 24.21.x; do not switch the binding silently.',
    })
  }
}

async function checkExecutor() {
  try {
    const which = await execute('which', ['codex'], { timeout: 2000, encoding: 'utf8' })
    const executable = which.stdout.trim()
    const version = await execute(executable, ['--version'], { timeout: 10000, encoding: 'utf8' })
    return pass('executor_codex', { executable, version: version.stdout.trim() })
  } catch {
    return warn('executor_codex', {
      message: 'No installed Codex CLI was found; native execution stays disabled.',
      hint: 'Install and admit a native executor in your own account; this launcher never installs or upgrades it.',
    })
  }
}

export async function runDoctor({ installRoot, roots, deep = false }) {
  const checks = []
  checks.push(
    satisfiesSupportedNode(process.versions.node)
      ? pass('node_version', { node: process.versions.node, supported: SUPPORTED_NODE })
      : fail('node_version', { node: process.versions.node, supported: SUPPORTED_NODE }),
  )
  const platform = platformSupport()
  checks.push(
    platform.tested
      ? pass('platform', { platform: platform.platform, arch: platform.arch })
      : warn('platform', { platform: platform.platform, arch: platform.arch, note: platform.note }),
  )
  checks.push(await checkSqlite(installRoot))

  const releaseState = readRelease(roots.config)
  if (releaseState.release === null) {
    checks.push(
      fail('release_manifest', {
        message: releaseState.message ?? 'No built release manifest is recorded for this install',
        path: releaseState.path,
        hint: 'Run `pa build` once to build the console/assets and record the release manifest.',
      }),
    )
  } else {
    const release = releaseState.release
    const artifacts = verifyReleaseArtifacts(installRoot, release, { hash: deep })
    checks.push(
      artifacts.ok
        ? pass('release_manifest', { buildId: release.buildId, artifacts: artifacts.checked, deep })
        : fail('release_manifest', { buildId: release.buildId, failures: artifacts.failures.slice(0, 20) }),
    )
    const index = consoleIndexPath(installRoot, release)
    checks.push(
      statFile(index)?.isFile()
        ? pass('console_assets', { root: release.build.consoleRoot })
        : fail('console_assets', { message: 'Static console entry is missing from the release', path: index }),
    )
    checks.push(
      release.source.commit !== 'unknown' && release.source.dirty
        ? warn('source_identity', { commit: release.source.commit, dirty: release.source.dirty })
        : pass('source_identity', { commit: release.source.commit, dirty: release.source.dirty }),
    )
  }

  const rootReports = describeRoots(roots)
  const missing = rootReports.filter((report) => !report.exists)
  const unsafe = rootReports.filter((report) => report.exists && !report.private)
  if (unsafe.length) checks.push(fail('roots', { unsafe: unsafe.map((report) => ({ name: report.name, path: report.path })) }))
  else if (missing.length) checks.push(warn('roots', { missing: missing.map((report) => report.name), hint: 'Run `pa first-run` to create private product roots.' }))
  else checks.push(pass('roots', { count: rootReports.length }))

  let instanceRecord = null
  try {
    instanceRecord = readInstanceRecord(roots.config)
  } catch (error) {
    checks.push(fail('instance_record', { code: error.code, message: error.message }))
  }
  if (instanceRecord === null) {
    checks.push(warn('instance', { message: 'No managed instance is recorded; run `pa start`.' }))
  } else {
    const verification = await verifyInstance(instanceRecord)
    checks.push(
      verification.ok
        ? pass('instance', { pid: instanceRecord.pid, consoleURL: instanceRecord.consoleURL, mode: instanceRecord.mode })
        : fail('instance', { pid: instanceRecord.pid, failures: verification.failures, hint: 'Run `pa stop`; it refuses to kill an unverified process.' }),
    )
  }

  if (existsSync(join(roots.data, 'state.sqlite'))) {
    checks.push(pass('state', { database: 'present' }))
  } else {
    checks.push(warn('state', { message: 'No product database yet; the first start creates a new private state.' }))
  }
  checks.push(await checkExecutor())

  const status = checks.some((check) => check.status === 'FAIL')
    ? 'BLOCKED'
    : checks.some((check) => check.status === 'WARN')
      ? 'DEGRADED'
      : 'READY'
  const exitCode = status === 'READY' ? EXIT.OK : status === 'DEGRADED' ? EXIT.DEGRADED : EXIT.BLOCKED
  return {
    status,
    exitCode,
    checkedAt: new Date().toISOString(),
    installRoot,
    roots,
    checks,
  }
}
