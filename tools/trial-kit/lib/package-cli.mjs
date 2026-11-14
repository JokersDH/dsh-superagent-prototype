/**
 * Run only the package commands whose read-only semantics were checked against the shipped source:
 * `pa help` (static text), `pa status` (reads the instance record and verifies process identity) and
 * `pa doctor` (read-only diagnosis; it never creates roots and never prints credentials).
 *
 * Every command is pointed at roots this run created inside its own output directory. The executor
 * probe is redirected to a local fixture version script and an empty CODEX_HOME, so neither the
 * operator's real CLI nor any home credential file is consulted. `pa support` is deliberately not
 * part of this list: it opens the product database with write-capable pragmas when one exists.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIMITS } from './limits.mjs'
import { TrialKitError } from './output.mjs'

function ensurePrivateDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TrialKitError('root_unsafe', 'Expected a real private directory', { path })
  if ((info.mode & 0o077) !== 0) chmodSync(path, 0o700)
  return path
}

function listTree(root) {
  const entries = []
  const visit = (absolute, rel) => {
    for (const name of readdirSync(absolute)) {
      const childAbsolute = join(absolute, name)
      const childRel = rel === '' ? name : `${rel}/${name}`
      const info = lstatSync(childAbsolute)
      if (info.isDirectory()) visit(childAbsolute, childRel)
      else entries.push({ path: childRel, kind: info.isSymbolicLink() ? 'symlink' : 'file', bytes: info.isFile() ? info.size : null })
    }
  }
  if (existsSync(root)) visit(root, '')
  return entries
}

function runBinary(binary, args, env, timeoutMs) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: LIMITS.maxDiagnosticOutputBytes, env })
  return {
    exit: result.status ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function parseJson(stdout) {
  try { return JSON.parse(stdout) } catch { return null }
}

/**
 * Prepare the explicit private environment and run the three checked commands.
 * Returns raw command results plus the root tree before/after for the side-effect assertion.
 */
export function runPackageCommands({ installRoot, out, timeoutMs = 60_000 }) {
  const roots = {}
  for (const name of ['config', 'data', 'cache', 'logs', 'workspaces']) roots[name] = ensurePrivateDir(join(out, 'roots', name))
  const fixtureRoot = ensurePrivateDir(join(out, 'fixture'))
  const codexHome = ensurePrivateDir(join(fixtureRoot, 'codex-home'))
  const codexFixture = join(fixtureRoot, 'codex-fixture')
  writeFileSync(codexFixture, '#!/bin/sh\nprintf "codex 0.0.0-trial-fixture\\n"\n', { mode: 0o700 })
  const executorsFixture = join(fixtureRoot, 'executors.json')
  writeFileSync(executorsFixture, `${JSON.stringify({ requiredReview: false, executors: [] }, null, 2)}\n`, { mode: 0o600 })

  // `doctor` reads the release manifest from the config root. Copy the package's own manifest into
  // this run's private config root (never modify the package); the copy is recorded for review.
  const packageRelease = join(installRoot, 'var/config/release.json')
  let releaseCopy = null
  if (existsSync(packageRelease)) {
    releaseCopy = join(roots.config, 'release.json')
    copyFileSync(packageRelease, releaseCopy)
    const info = statSync(releaseCopy)
    writeFileSync(releaseCopy, readFileSync(releaseCopy), { mode: 0o600 })
    void info
  }

  const env = {
    ...process.env,
    PA_INSTALL_ROOT: join(installRoot, 'app'),
    PA_CONFIG_ROOT: roots.config,
    PA_DATA_ROOT: roots.data,
    PA_CACHE_ROOT: roots.cache,
    PA_LOGS_ROOT: roots.logs,
    PA_WORKSPACE_ROOT: roots.workspaces,
    PA_NODE: process.execPath,
    PA_CODEX_BIN: codexFixture,
    CODEX_HOME: codexHome,
  }
  const binPa = join(installRoot, 'bin/pa')
  const before = listTree(out)
  const commands = []
  const help = runBinary(binPa, ['help'], env, timeoutMs)
  commands.push({ id: 'help', arguments: ['help'], exit: help.exit, timedOut: help.timedOut, stdoutBytes: Buffer.byteLength(help.stdout), stderrBytes: Buffer.byteLength(help.stderr) })
  const status = runBinary(binPa, ['status', '--json'], env, timeoutMs)
  commands.push({ id: 'status', arguments: ['status', '--json'], exit: status.exit, timedOut: status.timedOut, stdoutBytes: Buffer.byteLength(status.stdout), stderrBytes: Buffer.byteLength(status.stderr) })
  const doctor = runBinary(binPa, ['doctor', '--json', '--executors-fixture', executorsFixture], env, timeoutMs)
  commands.push({ id: 'doctor', arguments: ['doctor', '--json', '--executors-fixture', '<out>/fixture/executors.json'], exit: doctor.exit, timedOut: doctor.timedOut, stdoutBytes: Buffer.byteLength(doctor.stdout), stderrBytes: Buffer.byteLength(doctor.stderr) })
  const after = listTree(out)

  return {
    commands,
    help: { exit: help.exit, firstLine: help.stdout.split('\n')[0]?.slice(0, 120) ?? null },
    status: { exit: status.exit, value: parseJson(status.stdout.trim()), rawStderr: status.stderr.slice(0, 500) },
    doctor: { exit: doctor.exit, value: parseJson(doctor.stdout.trim()), rawStderr: doctor.stderr.slice(0, 800) },
    roots,
    env,
    releaseCopy: releaseCopy === null ? null : 'roots/config/release.json',
    fixture: { codexBin: 'fixture/codex-fixture', codexHome: 'fixture/codex-home', executors: 'fixture/executors.json' },
    writes: { before, after, unexpected: after.filter((entry) => !before.some((previous) => previous.path === entry.path)) },
  }
}

/** Check ids the package's own doctor must PASS for this machine/package to be a runnable candidate. */
export const REQUIRED_DOCTOR_CHECKS = [
  'node_version', 'platform', 'sqlite_binding', 'release_binding', 'release_manifest',
  'console_assets', 'console_mode', 'runtime_dependencies', 'source_identity', 'runtime_abi', 'support_matrix', 'roots',
]

export const EXPECTED_WARN_DOCTOR_CHECKS = ['instance', 'state', 'ports', 'executor_codex', 'review_executor', 'upgrade_journal']
