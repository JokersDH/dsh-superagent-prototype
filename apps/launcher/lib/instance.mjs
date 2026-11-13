/**
 * The local instance record and real process-identity checks. `pa start` may reuse an instance only
 * after the recorded pid, process start time, cwd, launcher command line, uid, listeners and health
 * endpoint all agree; `pa stop` signals only a fully verified instance and reports resources that
 * remain alive after the timeout. A PID that merely looks similar is never killed.
 */
import { execFile } from 'node:child_process'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { argvMatchesCommand, commandTokens, daemonInvocationMismatches } from './identity.mjs'

const execute = promisify(execFile)
export const INSTANCE_PROTOCOL = 'personal-product-instance/1'
export const INSTANCE_FILE = 'instance.json'
const LAUNCHER_COMMAND = /(?:^|[\s/])apps\/launcher\/bin\/pa\.mjs\s+start(?:\s|$)/
const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/

export class InstanceError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'InstanceError'
    this.code = code
    this.detail = detail
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const optionalArgv = (value, field) => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new InstanceError('invalid_instance_record', `Instance ${field} is invalid`)
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 4096) throw new InstanceError('invalid_instance_record', `Instance ${field} entry is invalid`)
  }
  return [...value]
}

const pid = (value, field) => {
  if (!Number.isSafeInteger(value) || value <= 1) throw new InstanceError('invalid_instance_record', `Instance field ${field} is not a pid`)
  return value
}

export function instancePath(configRoot) {
  return join(configRoot, INSTANCE_FILE)
}

export function validateInstanceRecord(value) {
  if (!isRecord(value)) throw new InstanceError('invalid_instance_record', 'Instance record must be an object')
  if (value.protocol !== INSTANCE_PROTOCOL) throw new InstanceError('invalid_instance_record', 'Instance protocol is not supported')
  const apiURL = String(value.apiURL ?? '')
  const consoleURL = String(value.consoleURL ?? '')
  if (!LOCAL_ORIGIN.test(apiURL) || !LOCAL_ORIGIN.test(consoleURL) || apiURL === consoleURL)
    throw new InstanceError('invalid_instance_record', 'Instance URLs must be distinct numeric loopback origins')
  const record = {
    protocol: INSTANCE_PROTOCOL,
    pid: pid(value.pid, 'pid'),
    processStart: typeof value.processStart === 'string' && value.processStart.length > 0 && value.processStart.length <= 128
      ? value.processStart
      : (() => { throw new InstanceError('invalid_instance_record', 'Instance process start identity is missing') })(),
    apiPid: pid(value.apiPid, 'apiPid'),
    consolePid: pid(value.consolePid, 'consolePid'),
    apiURL,
    consoleURL,
    state: typeof value.state === 'string' && resolve(value.state) === value.state ? value.state : (() => { throw new InstanceError('invalid_instance_record', 'Instance state path must be absolute') })(),
    install: typeof value.install === 'string' && resolve(value.install) === value.install ? value.install : (() => { throw new InstanceError('invalid_instance_record', 'Instance install path must be absolute') })(),
    buildId: typeof value.buildId === 'string' && value.buildId.length <= 128 ? value.buildId : (() => { throw new InstanceError('invalid_instance_record', 'Instance build id is invalid') })(),
    mode: ['fixture', 'personal'].includes(value.mode) ? value.mode : (() => { throw new InstanceError('invalid_instance_record', 'Instance mode is invalid') })(),
    access: ['local-development', 'token'].includes(value.access) ? value.access : (() => { throw new InstanceError('invalid_instance_record', 'Instance access mode is invalid') })(),
    startupMode: value.startupMode === undefined ? 'normal' : ['normal', 'recovery_readonly'].includes(value.startupMode) ? value.startupMode : (() => { throw new InstanceError('invalid_instance_record', 'Instance startup mode is invalid') })(),
    ...(optionalArgv(value.launcherArgv, 'launcherArgv') === undefined ? {} : { launcherArgv: optionalArgv(value.launcherArgv, 'launcherArgv') }),
    ...(value.launcherCwd === undefined
      ? {}
      : {
          launcherCwd:
            typeof value.launcherCwd === 'string' && resolve(value.launcherCwd) === value.launcherCwd
              ? value.launcherCwd
              : (() => { throw new InstanceError('invalid_instance_record', 'Instance launcherCwd is invalid') })(),
        }),
    ...(optionalArgv(value.apiArgv, 'apiArgv') === undefined ? {} : { apiArgv: optionalArgv(value.apiArgv, 'apiArgv') }),
    ...(value.apiProcessStart === undefined
      ? {}
      : {
          apiProcessStart:
            typeof value.apiProcessStart === 'string' && value.apiProcessStart.length > 0 && value.apiProcessStart.length <= 128
              ? value.apiProcessStart
              : (() => { throw new InstanceError('invalid_instance_record', 'Instance apiProcessStart is invalid') })(),
        }),
    ...(value.apiUid === undefined
      ? {}
      : {
          apiUid:
            Number.isSafeInteger(value.apiUid) && value.apiUid >= 0
              ? value.apiUid
              : (() => { throw new InstanceError('invalid_instance_record', 'Instance apiUid is invalid') })(),
        }),
    startedAt: typeof value.startedAt === 'string' && !Number.isNaN(Date.parse(value.startedAt)) ? value.startedAt : (() => { throw new InstanceError('invalid_instance_record', 'Instance startedAt is invalid') })(),
    ...(value.configRoot === undefined
      ? {}
      : {
          configRoot:
            typeof value.configRoot === 'string' && resolve(value.configRoot) === value.configRoot
              ? value.configRoot
              : (() => { throw new InstanceError('invalid_instance_record', 'Instance configRoot is invalid') })(),
        }),
  }
  return record
}

export function readInstanceRecord(configRoot) {
  const path = instancePath(configRoot)
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new InstanceError('instance_unreadable', 'Cannot inspect the instance record', { cause: error.code })
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384 || (stat.mode & 0o077) !== 0)
    throw new InstanceError('invalid_instance_record', 'Instance record file is unsafe')
  if (process.getuid && stat.uid !== process.getuid())
    throw new InstanceError('invalid_instance_record', 'Instance record is not owned by the current user')
  try {
    return validateInstanceRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (error instanceof InstanceError) throw error
    throw new InstanceError('invalid_instance_record', 'Instance record is not valid JSON', { cause: error.message })
  }
}

/** Atomic private write (0600) so a crash cannot leave a half-written instance record. */
export function writeInstanceRecord(configRoot, record) {
  // Bind the record to the config root that first wrote it. Copying a record file or re-writing an
  // existing record into another config root keeps the original binding, so a copy cannot authorize
  // a command aimed at the copying config root. Legacy records without the field stay unknown.
  // The in-memory identity is bound too, so a caller that later copies this same object into another
  // config root carries the original binding instead of laundering it.
  if (typeof record.configRoot !== 'string') record.configRoot = resolve(configRoot)
  const bound = { ...record, configRoot: resolve(record.configRoot) }
  const bytes = Buffer.from(`${JSON.stringify(bound, null, 2)}\n`)
  const path = instancePath(configRoot)
  const temporary = `${path}.${process.pid}.tmp`
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
    try { unlinkSync(temporary) } catch { /* renamed or already absent */ }
  }
  return path
}

export function removeInstanceRecord(configRoot) {
  try { unlinkSync(instancePath(configRoot)) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

async function command(file, argv) {
  try {
    return (await execute(file, argv, { timeout: 2000, maxBuffer: 65536, encoding: 'utf8' })).stdout.trim()
  } catch {
    return null
  }
}

export async function processStart(pidValue = process.pid) {
  return command('ps', ['-p', String(pidValue), '-o', 'lstart='])
}

/** Capture the start time and uid of an owned child for later identity comparison. */
export async function captureProcessFacts(pidValue) {
  const [start, uid] = await Promise.all([
    processStart(pidValue),
    command('ps', ['-p', String(pidValue), '-o', 'uid=']),
  ])
  return { processStart: start, uid: uid === null ? null : Number(uid) }
}

export async function processAlive(pidValue) {
  try {
    process.kill(pidValue, 0)
  } catch (error) {
    return error.code === 'EPERM'
  }
  // A child that already exited but has not been reaped by a blocked parent is a zombie: kill(0)
  // still succeeds, but the process owns no resources and must not be reported as alive.
  const stat = await command('ps', ['-p', String(pidValue), '-o', 'stat='])
  if (stat === null) return false
  return !stat.trim().toUpperCase().startsWith('Z')
}

/**
 * When the launcher is gone, prove the recorded API child is still the coordinator process for this
 * exact private state before signalling it. A reused PID or a different command line is refused.
 */
/**
 * When the launcher is gone, prove the recorded coordinator child is still the same process for this
 * exact private state before signalling it. The recorded argv is compared token-for-token (never a
 * substring), together with start time, uid, cwd and listener. A reused PID or a different command
 * line is refused, and a removed breadcrumb is not treated as proof that the process disappeared.
 */
export async function verifyCoordinatorProcess(record) {
  const checks = []
  const failures = []
  const record0 = (id, ok, detail) => {
    checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
    if (!ok) failures.push(id)
  }
  if (!(await processAlive(record.apiPid))) {
    record0('api_alive', false)
    return { ok: false, checks, failures }
  }
  record0('api_alive', true)
  const [commandLine, uid, start, cwd] = await Promise.all([
    command('ps', ['-ww', '-p', String(record.apiPid), '-o', 'command=']),
    command('ps', ['-p', String(record.apiPid), '-o', 'uid=']),
    processStart(record.apiPid),
    command('lsof', ['-a', '-p', String(record.apiPid), '-d', 'cwd', '-Fn']),
  ])
  const argvExact = record.apiArgv !== undefined && argvMatchesCommand(record.apiArgv, commandLine ?? '', { baseDir: record.install })
  const structural = record.apiArgv === undefined ? daemonInvocationMismatches(record, commandTokens(commandLine ?? '')) : []
  record0('api_argv', commandLine !== null && (record.apiArgv !== undefined ? argvExact : structural.length === 0), {
    exact: record.apiArgv !== undefined ? argvExact : null,
    mismatches: structural,
  })
  record0('api_process_start', record.apiProcessStart === undefined || start === record.apiProcessStart, {
    expected: record.apiProcessStart ?? null,
    observed: start,
  })
  record0('api_owner', uid !== null && (!process.getuid || Number(uid) === process.getuid()) && (record.apiUid === undefined || Number(uid) === record.apiUid))
  record0('api_cwd', cwd !== null && cwd.split('\n').includes(`n${resolve(record.install)}`))
  const apiPort = new URL(record.apiURL).port
  const listener = await command('lsof', ['-a', '-p', String(record.apiPid), '-iTCP:' + apiPort, '-sTCP:LISTEN', '-Fn'])
  record0('api_listener', listener !== null && listener.split('\n').includes(`p${record.apiPid}`))
  return { ok: failures.length === 0, checks, failures }
}

/**
 * Listener pids on a loopback port. Used only to detect an UNKNOWN live owner of a recorded port;
 * the caller never signals these pids based on this observation alone.
 */
export async function processCommand(pid) {
  return command('ps', ['-ww', '-p', String(pid), '-o', 'command='])
}

/** Numeric owner uid of one pid, or null when ps cannot answer. */
export async function processUid(pid) {
  const value = await command('ps', ['-p', String(pid), '-o', 'uid='])
  return value !== null && /^\d+$/.test(value) ? Number(value) : null
}

export async function listenersOnPort(port) {
  const output = await command('lsof', ['-nP', '-iTCP:' + String(port), '-sTCP:LISTEN', '-Fn'])
  if (output === null) return { supported: true, pids: [] }
  const pids = [...output.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])).filter((value) => Number.isInteger(value))
  return { supported: true, pids: [...new Set(pids)] }
}

export async function stopProcess(pidValue, { timeoutMs = 8000 } = {}) {
  try {
    process.kill(pidValue, 'SIGTERM')
  } catch (error) {
    if (error.code === 'ESRCH') return { stopped: true, stillAlive: false, code: null }
    return { stopped: false, stillAlive: true, code: 'stop_signal_failed' }
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await processAlive(pidValue))) return { stopped: true, stillAlive: false, code: null }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  const stillAlive = await processAlive(pidValue)
  return { stopped: !stillAlive, stillAlive, code: stillAlive ? 'stop_timeout_resources_alive' : null }
}

/**
 * Verify that the recorded process is still the same launcher process for this install and that
 * both child listeners still belong to the recorded pids. Returns evidence, never throws for a
 * mismatch (the caller decides how to report it).
 */
export async function verifyInstance(record, options = {}) {
  const checks = []
  const failures = []
  const record0 = (id, ok, detail) => {
    checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
    if (!ok) failures.push(id)
    return ok
  }
  const alive = await processAlive(record.pid)
  if (!record0('launcher_alive', alive)) return { ok: false, checks, failures }
  const [start, commandLine, uid, cwd] = await Promise.all([
    processStart(record.pid),
    command('ps', ['-ww', '-p', String(record.pid), '-o', 'command=']),
    command('ps', ['-p', String(record.pid), '-o', 'uid=']),
    command('lsof', ['-a', '-p', String(record.pid), '-d', 'cwd', '-Fn']),
  ])
  record0('process_start', start !== null && start === record.processStart, start ?? 'unavailable')
  const launcherMatches = record.launcherArgv !== undefined
    ? commandLine !== null && argvMatchesCommand(record.launcherArgv, commandLine, { baseDir: record.install })
    : commandLine !== null && LAUNCHER_COMMAND.test(commandLine)
  record0('launcher_command', launcherMatches, record.launcherArgv !== undefined ? 'exact_argv' : 'legacy_pattern')
  record0('owner', uid !== null && (!process.getuid || Number(uid) === process.getuid()))
  // A staged closure can be launched from any working directory; the recorded launcher cwd is the
  // identity, while the install root stays the authority for what bytes are executed.
  const expectedCwd = resolve(record.launcherCwd ?? options.installRoot ?? record.install)
  record0(
    'cwd',
    cwd !== null && cwd.split('\n').includes(`n${expectedCwd}`),
    cwd === null ? 'unavailable' : 'cwd_checked',
  )
  record0('install_identity', resolve(options.installRoot ?? record.install) === record.install)

  // The API child is verified by exact argv (or structural parse for legacy records), start time,
  // uid, parent, cwd and listener — not by a listening port alone.
  const [apiCommand, apiUid, apiParent, apiStart, apiCwd] = await Promise.all([
    command('ps', ['-ww', '-p', String(record.apiPid), '-o', 'command=']),
    command('ps', ['-p', String(record.apiPid), '-o', 'uid=']),
    command('ps', ['-p', String(record.apiPid), '-o', 'ppid=']),
    processStart(record.apiPid),
    command('lsof', ['-a', '-p', String(record.apiPid), '-d', 'cwd', '-Fn']),
  ])
  const apiArgvExact = record.apiArgv !== undefined && argvMatchesCommand(record.apiArgv, apiCommand ?? '', { baseDir: record.install })
  const apiStructural = record.apiArgv === undefined ? daemonInvocationMismatches(record, commandTokens(apiCommand ?? '')) : []
  record0('api_argv', apiCommand !== null && (record.apiArgv !== undefined ? apiArgvExact : apiStructural.length === 0), {
    exact: record.apiArgv !== undefined ? apiArgvExact : null,
    mismatches: apiStructural,
  })
  record0('api_process_start', record.apiProcessStart === undefined || apiStart === record.apiProcessStart, {
    expected: record.apiProcessStart ?? null,
    observed: apiStart,
  })
  record0('api_owner', apiUid !== null && (!process.getuid || Number(apiUid) === process.getuid()) && (record.apiUid === undefined || Number(apiUid) === record.apiUid))
  record0('api_parent', apiParent !== null && Number(apiParent) === record.pid)
  record0('api_cwd', apiCwd !== null && apiCwd.split('\n').includes(`n${resolve(record.install)}`))

  const listeners = await Promise.all(
    [
      [record.apiPid, new URL(record.apiURL).port],
      [record.consolePid, new URL(record.consoleURL).port],
    ].map(async ([childPid, port]) => {
      const [output, identity] = await Promise.all([
        command('lsof', ['-a', '-p', String(childPid), '-iTCP:' + port, '-sTCP:LISTEN', '-Fn']),
        command('ps', ['-p', String(childPid), '-o', 'ppid=', '-o', 'uid=']),
      ])
      const [parent, childUid] = (identity ?? '').split(/\s+/).map(Number)
      // The console listener lives in the launcher process itself; the API listener is its child.
      const parentOk = childPid === record.pid || parent === record.pid
      return (
        output !== null && output.split('\n').includes(`p${childPid}`) &&
        parentOk &&
        (!process.getuid || childUid === process.getuid())
      )
    }),
  )
  record0('listeners', listeners.every(Boolean))
  let health = null
  try {
    const response = await fetch(`${record.apiURL}/v1/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' })
    health = response.ok ? await response.json() : null
  } catch {
    health = null
  }
  record0('health', health !== null && health.status === 'ok', health === null ? 'unreachable' : health.mode)
  // The running consumer must actually be in the recorded mode: an upgrade that silently falls back
  // from personal to fixture (or the reverse) is an identity mismatch, not a successful switch.
  record0(
    'runtime_mode',
    health !== null && health.mode === record.mode,
    { expected: record.mode, observed: health?.mode ?? null },
  )
  const observedStartupMode = health?.startupMode === 'recovery_readonly' ? 'recovery_readonly' : 'normal'
  record0(
    'startup_mode',
    observedStartupMode === (record.startupMode ?? 'normal'),
    { expected: record.startupMode ?? 'normal', observed: observedStartupMode },
  )
  return { ok: failures.length === 0, checks, failures, health }
}

/** Stop only a verified instance; report honestly when the process outlives the deadline. */
export async function stopVerifiedInstance(record, options = {}) {
  const verification = await verifyInstance(record, options)
  if (!verification.ok)
    return { stopped: false, stillAlive: true, verification, code: 'instance_identity_mismatch' }
  const result = await stopProcess(record.pid, { timeoutMs: options.timeoutMs ?? 8000 })
  return { ...result, verification }
}
