/**
 * Read-only diagnosis. Doctor never creates roots, never starts a process, and never prints a
 * credential. Exit codes: 0 READY (runnable), 1 DEGRADED (usable for diagnosis/settings but an
 * execution or platform capability is missing), 2 BLOCKED (this build cannot run here).
 */
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describeRoots, platformSupport } from '@personal-agent/portability'
import { EXIT } from './cli.mjs'
import {
  SUPPORTED_PLATFORM,
  SUPPORTED_ARCH,
  SUPPORTED_NODE as DIAGNOSTIC_NODE,
  SUPPORTED_SQLITE,
  probeAuthorExecutor,
  probePorts,
  probeRuntime,
  readAuthorEvidence,
} from './diagnostics.mjs'
import { readInstanceRecord, verifyInstance } from './instance.mjs'
import { recoverySummary } from './recovery.mjs'
import {
  SUPPORTED_NODE,
  consoleIndexPath,
  readRelease,
  statFile,
  verifyConsoleBuild,
  verifyReleaseArtifacts,
  verifyRuntimeDependencies,
} from './release.mjs'
import { releaseBinding } from './release-bootstrap.mjs'

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

/**
 * Author executor diagnostics. The Codex CLI is the currently admitted author; a missing binary or
 * private auth file disables native execution but does not invent a fallback executor.
 */
async function checkAuthorExecutor(installRoot) {
  const evidence = readAuthorEvidence(installRoot)
  const probe = probeAuthorExecutor({
    installRoot,
    required: false,
    expectedVersion: evidence?.profileVersion ?? null,
  })
  const detail = {
    ...probe.facts,
    evidence: evidence === null ? { status: 'unknown', note: 'No checked-in native product evidence in this install' } : {
      status: evidence.status,
      profileVersion: evidence.profileVersion,
      sourceCommit: evidence.sourceCommit,
    },
    hint: 'Install and admit Codex CLI in your own account; this launcher never installs/upgrades it or reads credentials.',
  }
  if (!probe.facts.available) return warn('executor_codex', { ...detail, message: probe.message })
  if (probe.code === 'author_executor_version_mismatch') return warn('executor_codex', { ...detail, message: probe.message })
  if (!probe.facts.authPresent) return warn('executor_codex', { ...detail, message: 'No private author auth file was found; native execution stays disabled.' })
  return pass('executor_codex', detail)
}

/**
 * Reviewer (second executor) diagnostics. Until B/main publish an executor capability interface,
 * the review entry stays unavailable/experimental; a fixture may describe diagnostic-only facts.
 * This never writes a second secret configuration and never echoes credentials.
 */
function checkReviewExecutor(fixturePath) {
  if (fixturePath !== null) {
    let fixture
    try {
      fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
    } catch (error) {
      return fail('review_executor', { reason: 'fixture_unreadable', message: String(error?.message ?? error).slice(0, 300) })
    }
    const executors = Array.isArray(fixture.executors) ? fixture.executors : []
    const reviewer = executors.find((executor) => executor.role === 'reviewer')
    const required = fixture.requiredReview === true
    if (!reviewer)
      return required
        ? fail('review_executor', { reason: 'required_reviewer_missing', message: 'Required review mode has no admitted reviewer executor.', executors: executors.map((e) => e.role) })
        : warn('review_executor', { reason: 'reviewer_unavailable', message: 'No reviewer executor; author path stays usable and review stays unavailable.', executors: executors.map((e) => e.role) })
    return pass('review_executor', {
      role: 'reviewer',
      profileId: reviewer.profileId ?? null,
      version: reviewer.version ?? null,
      capabilities: Array.isArray(reviewer.capabilities) ? reviewer.capabilities : [],
      admitted: reviewer.admitted === true,
      required,
    })
  }
  return warn('review_executor', {
    reason: 'no_executor_interface',
    message: 'B/main have not published a second-executor capability interface; the review entry stays experimental and disabled by default.',
    hint: 'Author execution remains available; required review mode is BLOCKED until an admitted reviewer is configured.',
  })
}

export async function runDoctor({ installRoot, roots, deep = false, executorsFixture = null }) {
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

  // Is this config root bound to this exact install? A root that was never initialized, or one that
  // still points at another build, explains a `release_missing`/stale-start symptom before start.
  const binding = releaseBinding({ installRoot, configRoot: roots.config })
  // A pending install-switch journal means the pointer/instance state is not settled; the user needs
  // one explicit next action, not a hand-edited release.json or a deleted marker.
  const switchJournal = (() => {
    try { return JSON.parse(readFileSync(join(roots.config, 'install-switch.json'), 'utf8')) } catch { return null }
  })()
  if (switchJournal === null) checks.push(pass('upgrade_journal', { status: 'none' }))
  else if (switchJournal.status === 'confirmed' || String(switchJournal.status).startsWith('reverted'))
    checks.push(pass('upgrade_journal', { status: switchJournal.status }))
  else
    checks.push(warn('upgrade_journal', {
      status: switchJournal.status,
      hint: switchJournal.status === 'target_stop_unproven'
        ? 'A failed target could not be proven stopped. Run `pa upgrade --recover` (it retries the proven stop and only then reverts); do not start another writer.'
        : 'Run `pa upgrade --recover`; it settles the interrupted switch in the recorded mode/access without rolling data back.',
    }))

  if (binding.bound) checks.push(pass('release_binding', { buildId: binding.installBuildId, digest: binding.configDigest }))
  else if (binding.code === 'release_missing' || binding.code === 'source_build_no_install_manifest')
    checks.push(warn('release_binding', {
      code: binding.code,
      path: binding.path,
      hint: binding.code === 'release_missing'
        ? 'Run `pa first-run` in this config root; a distribution install adopts the release manifest recorded inside it.'
        : 'This is a source-checkout build (no install inventory). Distribution provenance is only claimed by `<install>/bin/pa`.',
    }))
  else
    checks.push(fail('release_binding', {
      code: binding.code,
      path: binding.path,
      configDigest: binding.configDigest,
      installDigest: binding.installDigest,
      installBuildId: binding.installBuildId,
      message: binding.message,
      hint: 'The config root holds a release manifest from a different install. Use `pa upgrade --to <install>` or a fresh config root; do not copy manifests by hand.',
    }))

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
    const consoleCheck = verifyConsoleBuild(installRoot, release)
    checks.push(
      consoleCheck.ok
        ? pass('console_mode', { mode: 'http', digest: consoleCheck.digest })
        : fail('console_mode', { reason: consoleCheck.reason, hint: 'Rebuild without --skip-console.' }),
    )
    const dependencyCheck = verifyRuntimeDependencies(installRoot, release)
    checks.push(
      dependencyCheck.ok
        ? pass('runtime_dependencies', { checked: dependencyCheck.checked })
        : fail('runtime_dependencies', { failures: dependencyCheck.failures.slice(0, 20) }),
    )
    checks.push(
      release.source.commit !== 'unknown' && release.source.dirty
        ? warn('source_identity', { commit: release.source.commit, dirty: release.source.dirty })
        : pass('source_identity', { commit: release.source.commit, dirty: release.source.dirty }),
    )
    const runtime = probeRuntime({ installRoot, release })
    checks.push(
      runtime.ok
        ? pass('runtime_abi', runtime.facts)
        : fail('runtime_abi', { code: runtime.code, message: runtime.message, ...runtime.facts }),
    )
    checks.push(pass('support_matrix', {
      measured: [`${SUPPORTED_PLATFORM}-${SUPPORTED_ARCH}`, 'node ' + DIAGNOSTIC_NODE],
      node: DIAGNOSTIC_NODE,
      abi: release.admission?.abi ?? process.versions.modules,
      sqlite: `>=${SUPPORTED_SQLITE}`,
      notTested: ['linux', 'win32', 'darwin-x64', 'other Node ABIs', 'other machines'],
    }))
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
  const recovery = recoverySummary(roots.data)
  if (recovery.markerPresent) {
    checks.push(
      warn('recovery_marker', {
        startupMode: 'recovery_readonly',
        markerValid: recovery.markerValid,
        pendingRebind: recovery.pendingRebind.length,
        requiresRevalidation: recovery.requiresRevalidation.length,
        message: recovery.warning,
      }),
    )
  } else {
    checks.push(pass('recovery_marker', { startupMode: 'normal' }))
  }
  if (instanceRecord === null) {
    const ports = await probePorts([['console', 5190], ['api', 8790]])
    const busy = ports.filter((entry) => !entry.ok)
    checks.push(
      busy.length === 0
        ? pass('ports', { checked: ports.map((entry) => `${entry.name}:${entry.port}`) })
        : warn('ports', { busy, hint: 'Choose other --port/--api-port values; do not stop an unverified process.' }),
    )
  } else {
    checks.push(pass('ports', { instance: instanceRecord.pid, consoleURL: instanceRecord.consoleURL, apiURL: instanceRecord.apiURL }))
  }
  checks.push(await checkAuthorExecutor(installRoot))
  checks.push(checkReviewExecutor(executorsFixture))

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
