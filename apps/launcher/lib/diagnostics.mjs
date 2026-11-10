/**
 * Zero-model preflight diagnostics shared by `pa start` and `pa doctor`.
 *
 * These probes explain an environment mismatch with stable codes before any daemon starts: Node /
 * platform / ABI / SQLite binding, author executor (Codex CLI) presence/version/auth file, and port
 * availability. They never call a model, never print credentials, never install/upgrade a runtime
 * and never reset a native account.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SUPPORTED_PLATFORM = 'darwin'
export const SUPPORTED_ARCH = 'arm64'
export const SUPPORTED_NODE = '>=24.21.0 <25'
export const SUPPORTED_SQLITE = '3.53.4'

export function satisfiesSupportedNode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return major === 24 && (minor > 21 || (minor === 21 && patch >= 0)) && major < 25
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Probe the native SQLite binding that the coordinator will actually load and compare the measured
 * environment to the release admission facts.
 */
export function probeRuntime({ installRoot, release }) {
  const facts = {
    node: process.versions.node,
    modulesAbi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    sqlite: null,
    releaseAbi: release?.admission?.abi ?? null,
  }
  if (!satisfiesSupportedNode(process.versions.node))
    return { ok: false, code: 'node_unsupported', message: `Node ${process.versions.node} is outside ${SUPPORTED_NODE}`, facts }
  if (release?.producer?.node && release.producer.node !== process.versions.node)
    return { ok: false, code: 'node_mismatch', message: 'Node differs from the release producer', facts }
  if (release?.producer?.platform && release.producer.platform !== process.platform)
    return { ok: false, code: 'platform_mismatch', message: 'Platform differs from the release producer', facts }
  if (release?.producer?.arch && release.producer.arch !== process.arch)
    return { ok: false, code: 'arch_mismatch', message: 'Architecture differs from the release producer', facts }
  if (release?.admission?.abi && String(release.admission.abi) !== String(process.versions.modules))
    return { ok: false, code: 'abi_mismatch', message: 'Node module ABI differs from the release admission', facts }
  let Database
  try {
    const require = createRequire(join(installRoot, 'packages/storage/package.json'))
    Database = require('better-sqlite3')
  } catch (error) {
    return {
      ok: false,
      code: 'sqlite_binding_unavailable',
      message: 'The SQLite binding cannot be loaded from this install',
      facts: { ...facts, cause: String(error?.message ?? error).slice(0, 400) },
    }
  }
  try {
    const db = new Database(':memory:')
    try {
      const row = db.prepare('SELECT sqlite_version() AS version').get()
      facts.sqlite = String(row.version)
    } finally {
      db.close()
    }
  } catch (error) {
    return {
      ok: false,
      code: 'sqlite_binding_unusable',
      message: 'The SQLite binding loaded but could not open an in-memory database',
      facts: { ...facts, cause: String(error?.message ?? error).slice(0, 400) },
    }
  }
  if (facts.sqlite !== null && facts.sqlite < SUPPORTED_SQLITE)
    return { ok: false, code: 'sqlite_version_mismatch', message: `SQLite ${facts.sqlite} is older than ${SUPPORTED_SQLITE}`, facts }
  return { ok: true, code: null, message: null, facts }
}

const codexHome = () => process.env.CODEX_HOME && process.env.CODEX_HOME.length > 0 ? process.env.CODEX_HOME : join(homedir(), '.codex')

/**
 * Probe the author executor (Codex CLI) without running a task: binary presence/version and whether a
 * private auth file exists. The file content, account and credentials are never read or echoed.
 */
export function probeAuthorExecutor({ installRoot, required = false, expectedVersion = null }) {
  const facts = { required, expectedVersion, available: false, version: null, authPresent: false, authMode: null, codexHome: codexHome() }
  const binary = process.env.PA_CODEX_BIN && process.env.PA_CODEX_BIN.length > 0 ? process.env.PA_CODEX_BIN : 'codex'
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 })
  if (result.error || result.status !== 0)
    return {
      ok: !required,
      code: required ? 'author_executor_unavailable' : null,
      message: required ? 'The author executor (Codex CLI) is not available on PATH' : null,
      facts: { ...facts, cause: String(result.error?.message ?? result.stderr ?? '').slice(0, 300) },
    }
  const version = String(result.stdout ?? '').trim().split('\n')[0]
  facts.available = true
  facts.version = version
  const authPath = join(facts.codexHome, 'auth.json')
  try {
    accessSync(authPath, constants.R_OK)
    facts.authPresent = true
    const mode = statSync(authPath).mode & 0o777
    facts.authMode = mode.toString(8)
  } catch {
    facts.authPresent = false
  }
  if (required && expectedVersion !== null && version !== expectedVersion)
    return { ok: false, code: 'author_executor_version_mismatch', message: 'Author executor version differs from the admitted profile', facts }
  if (required && !facts.authPresent)
    return { ok: false, code: 'author_auth_unavailable', message: 'No private author auth file is available for the author executor', facts }
  return { ok: true, code: null, message: null, facts }
}

/** Read the checked-in native product evidence without treating it as a live admission. */
export function readAuthorEvidence(installRoot) {
  const path = join(installRoot, 'reports/releases/native-mvp/native-product.json')
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(value)) return null
    return {
      path,
      status: typeof value.status === 'string' ? value.status : 'unknown',
      profileVersion: typeof value.profileVersion === 'string' ? value.profileVersion : null,
      sourceCommit: typeof value.sourceCommit === 'string' ? value.sourceCommit : null,
      checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : null,
      cases: Array.isArray(value.cases) ? value.cases.map((item) => ({ id: String(item.id), status: String(item.status) })) : [],
    }
  } catch {
    return null
  }
}

/** Check whether the loopback ports a start would use are free right now. */
export async function probePorts(ports) {
  const results = []
  for (const [name, port] of ports) {
    const availability = await new Promise((resolvePromise) => {
      const socket = createServer()
      socket.once('error', (error) => resolvePromise({ ok: false, code: String(error.code ?? 'unavailable') }))
      socket.listen(port, '127.0.0.1', () => socket.close(() => resolvePromise({ ok: true, code: null })))
    })
    results.push({ name, port, ...availability })
  }
  return results
}

export function defaultAuthPath() {
  return join(codexHome(), 'auth.json')
}
