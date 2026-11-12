/**
 * Instance identity helpers shared by start, status, stop, doctor and stale-record cleanup.
 *
 * Identity is compared field-by-field: install/state/mode/access/build/startupMode/ports. The
 * coordinator child is verified by its exact argv array (not a substring), start time, uid, parent,
 * cwd, listener and health projection. A recorded breadcrumb is never evidence that a process is
 * gone; a live but unmatched PID is never signalled.
 */
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { basename, isAbsolute, join, resolve } from 'node:path'

export const STARTUP_MODES = ['normal', 'recovery_readonly']
export const MODES = ['fixture', 'personal']
export const ACCESS_MODES = ['local-development', 'token']

export function canonicalPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Fields that must match before an existing instance may be reused. */
export function identityDifferences(record, desired) {
  const differences = []
  const compare = (field, expected, actual) => {
    if (expected !== actual) differences.push({ field, expected, actual })
  }
  compare('install', desired.install, canonicalPath(record.install))
  compare('state', desired.state, canonicalPath(record.state))
  compare('mode', desired.mode, record.mode)
  compare('access', desired.access, record.access)
  compare('buildId', desired.buildId, record.buildId)
  compare('startupMode', desired.startupMode, record.startupMode ?? 'normal')
  compare('consoleURL', desired.consoleURL, record.consoleURL)
  compare('apiURL', desired.apiURL, record.apiURL)
  return differences
}

/**
 * The requested roots must agree with the recorded instance before any command acts on it. A
 * shared install path can serve independent state roots, so a record is never authority for a
 * different requested data/install root: callers refuse without signalling, deleting the record or
 * moving the pointer.
 */
export function requestedScopeCheck({ roots, record, requireInstall = false }) {
  const checks = []
  const failures = []
  const add = (id, ok, detail) => {
    checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
    if (!ok) failures.push(id)
  }
  const requestedState = canonicalPath(roots.data)
  const requestedInstall = canonicalPath(roots.install)
  const recordedState = canonicalPath(record.state)
  const recordedInstall = canonicalPath(record.install)
  const installMatches = recordedInstall === requestedInstall || recordedInstall === canonicalPath(join(requestedInstall, 'app'))
  const requestedConfig = canonicalPath(roots.config)
  const recordedConfig = record.configRoot === undefined ? null : canonicalPath(record.configRoot)
  // A legacy record (written before configRoot existed) is bound only when its own recorded launcher
  // argv still names this exact config/data/install triple. A copied record keeps the original argv,
  // so a copying config root cannot self-certify through its own launcher.json; missing argv is unknown.
  const legacyConfigBound = () => {
    const argv = Array.isArray(record.launcherArgv) ? record.launcherArgv.map(String) : null
    if (argv === null || argv.length < 3) return false
    const valueOf = (flag) => {
      const index = argv.lastIndexOf(flag)
      if (index < 0 || index + 1 >= argv.length) return null
      return argv[index + 1]
    }
    const argvConfig = valueOf('--config-root')
    const argvData = valueOf('--data-root')
    const argvInstall = valueOf('--install')
    if (argvConfig === null || argvData === null || argvInstall === null) return false
    const installOk = [canonicalPath(roots.install), canonicalPath(record.install ?? '')].includes(canonicalPath(argvInstall))
      || [roots.install, dirnameCanonical(record.install ?? '')].includes(canonicalPath(argvInstall))
    return canonicalPath(argvConfig) === requestedConfig &&
      canonicalPath(argvData) === canonicalPath(roots.data) &&
      installOk
  }
  const configBound = recordedConfig !== null ? recordedConfig === requestedConfig : legacyConfigBound()
  add('requested_config', configBound, {
    requested: requestedConfig, recorded: recordedConfig, legacy: recordedConfig === null, legacyConfigBound: recordedConfig === null ? legacyConfigBound() : false,
  })
  add('requested_state', recordedState === requestedState, { requested: requestedState, recorded: recordedState })
  add('requested_install', installMatches, { requested: requestedInstall, recorded: recordedInstall })
  if (!installMatches && !requireInstall) failures.splice(failures.indexOf('requested_install'), 1)
  return {
    ok: failures.length === 0,
    installMatches,
    checks,
    failures,
    requested: { config: requestedConfig, state: requestedState, install: requestedInstall },
    recorded: { config: recordedConfig, state: recordedState, install: recordedInstall, buildId: record.buildId ?? null, mode: record.mode ?? null },
  }
}

/** The expected coordinator argv recorded on an instance. */
export function expectedDaemonArgv(record) {
  const argv = [
    join(record.install, 'apps/coordinator/product/demo.ts'),
    '--port',
    String(new URL(record.apiURL).port),
    '--state',
    record.state,
    '--console-origin',
    record.consoleURL,
    '--startup-mode',
    record.startupMode ?? 'normal',
  ]
  if ((record.startupMode ?? 'normal') !== 'recovery_readonly') {
    argv.push('--assistant')
    if (record.mode === 'personal') argv.push('--native')
  }
  if (record.access === 'local-development') argv.push('--local-access')
  return argv
}

/** Split an OS command line into tokens. Quoting is not reconstructed; exact recorded argv wins. */
export function commandTokens(command) {
  if (typeof command !== 'string') return []
  return command.trim().split(/\s+/).filter(Boolean)
}

/**
 * Parse the coordinator command line structurally: the state value must be the exact token after
 * `--state` (never a substring match), the port and console origin must match, and the script must
 * be the recorded coordinator entry.
 */
export function parseDaemonInvocation(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 2) return null
  const [executable, script, ...rest] = tokens
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) continue
    const equals = token.indexOf('=')
    if (equals > 2) {
      options[token.slice(2, equals)] = token.slice(equals + 1)
      continue
    }
    const name = token.slice(2)
    const next = rest[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      options[name] = next
      index += 1
    } else options[name] = true
  }
  return { executable, script, options }
}

export function daemonInvocationMismatches(record, tokens) {
  const parsed = parseDaemonInvocation(tokens)
  if (parsed === null) return ['unparseable_command']
  const mismatches = []
  const expectedScript = join(record.install, 'apps/coordinator/product/demo.ts')
  if (parsed.script !== expectedScript) mismatches.push('script')
  if (parsed.options.port !== String(new URL(record.apiURL).port)) mismatches.push('port')
  if (parsed.options.state !== record.state) mismatches.push('state')
  if (parsed.options['console-origin'] !== record.consoleURL) mismatches.push('console_origin')
  if ((parsed.options['startup-mode'] ?? 'normal') !== (record.startupMode ?? 'normal')) mismatches.push('startup_mode')
  return mismatches
}

/**
 * A recorded argv array and the exact OS command line must agree token-for-token. `ps` may print the
 * executable as its basename (`node`), so argv[0] is compared flexibly; every other token must be
 * identical (this is what prevents `foo` from matching `foo-other`).
 */
export function argvMatchesCommand(argv, command, options = {}) {
  if (!Array.isArray(argv) || argv.length < 2 || typeof command !== 'string') return false
  const executable = argv[0]
  if (typeof executable !== 'string' || executable.length === 0) return false
  // The OS prints argv space-joined without quoting, so a path containing spaces cannot be split into
  // tokens. Consume each recorded entry in order from the raw command line with argument boundaries.
  const occurrence = (from, form) => {
    if (form.length === 0) return -1
    let index = command.indexOf(form, from)
    while (index !== -1) {
      const before = index === 0 || command[index - 1] === ' '
      const after = index + form.length === command.length || command[index + form.length] === ' '
      if (before && after) return index
      index = command.indexOf(form, index + 1)
    }
    return -1
  }
  const executableOk = command.startsWith(executable) || command.startsWith(basename(executable)) ||
    command.includes(`/${basename(executable)} `) || command === basename(executable)
  if (!executableOk && command.indexOf(executable) === -1 && command.indexOf(basename(executable)) === -1) return false
  let cursor = 0
  for (let index = 1; index < argv.length; index += 1) {
    const entry = argv[index]
    if (typeof entry !== 'string') return false
    const forms = [entry]
    if (isAbsolute(entry)) forms.push(canonicalPath(entry))
    if (index === 1 && typeof options.baseDir === 'string' && !isAbsolute(entry)) {
      forms.push(join(options.baseDir, entry))
      forms.push(canonicalPath(join(options.baseDir, entry)))
    }
    if (index === 1 && typeof options.baseDir === 'string' && isAbsolute(entry) && entry.startsWith(`${options.baseDir}/`)) {
      // The OS may print the script as a path relative to the install root.
      forms.push(entry.slice(options.baseDir.length + 1))
    }
    let found = -1
    let formLength = 0
    for (const form of forms) {
      const position = occurrence(cursor, form)
      if (position === -1) continue
      if (found === -1 || position < found) { found = position; formLength = form.length }
    }
    if (found === -1) return false
    cursor = found + formLength
  }
  // No trailing argument may follow the recorded argv.
  return command.slice(cursor).trim() === ''
}
