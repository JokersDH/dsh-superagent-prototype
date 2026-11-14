#!/usr/bin/env node
/**
 * One parameterized personal-read review driver with two explicit dialects.
 *
 * Status terms:
 *   verified-flow      strict assertions passed against the actual serving consumer
 *   reused             a verified live instance with the same selection was reused (not stopped)
 *   refused-verified   the entry refused exactly the requested selection mismatch
 *   observed           --observe only: data was collected, nothing is asserted (never acceptance)
 *   NOT_REACHED        the selected package lacks the requested capability; no fallback was used
 *   failed             assertion, identity, deadline, HTTP or cleanup failure
 *
 * It reports what the selected files actually are. It does not certify a package; E must bind the
 * reported entry hashes to that package's own artifact before treating output as installed evidence.
 */
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, statSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULTS, DriverError, applyCleanupOutcome as applyCleanup, httpJson, logSink, remaining, restoredReviewIdentity, stopChild, waitUntil } from './driver-lib.mjs'

const args = process.argv.slice(2)
const { values } = parseArgs({ args, options: {
  install: { type: 'string' }, state: { type: 'string' }, project: { type: 'string' },
  'allow-path': { type: 'string', multiple: true }, 'exclude-path': { type: 'string', multiple: true },
  'console-port': { type: 'string' }, 'api-port': { type: 'string' }, 'model-config': { type: 'string' },
  format: { type: 'string' }, dialect: { type: 'string' },
  work: { type: 'string' }, question: { type: 'string' }, message: { type: 'string' }, 'candidate-message': { type: 'string' },
  conversation: { type: 'string' }, 'package-subject': { type: 'string' },
  'start-entry': { type: 'string' }, 'review-entry': { type: 'string' }, 'identity-module': { type: 'string' },
  'pa-entry': { type: 'string' }, record: { type: 'string' }, 'work-dir': { type: 'string' }, 'review-file': { type: 'string' },
  'config-root': { type: 'string' }, 'data-root': { type: 'string' }, 'cache-root': { type: 'string' },
  'logs-root': { type: 'string' }, 'workspace-root': { type: 'string' },
  'per-request-ms': { type: 'string' }, 'deadline-ms': { type: 'string' }, 'readiness-ms': { type: 'string' },
  'stop-grace-ms': { type: 'string' }, observe: { type: 'boolean' }, reuse: { type: 'boolean' }, keep: { type: 'boolean' },
  'expect-chat': { type: 'string' }, 'expect-candidate-prepare': { type: 'string' },
  'expect-candidates': { type: 'string' }, 'expect-reject-reason': { type: 'string' },
  'expect-candidate-digest': { type: 'string' }, 'expect-work-phase': { type: 'string' }, 'expect-delivery': { type: 'string' },
  'expect-source-state': { type: 'string' }, 'expect-scope-review': { type: 'string' }, 'expect-reason': { type: 'string', multiple: true },
  'expect-entry-refusal': { type: 'string' }, 'allow-not-reached': { type: 'boolean' },
} })

const startedAt = new Date().toISOString()
const deadlineMs = numeric('deadline-ms', 1000, 600000, DEFAULTS.deadlineMs)
const deadlineAt = Date.now() + deadlineMs
const perRequestMs = numeric('per-request-ms', 100, Math.min(60000, deadlineMs), DEFAULTS.perRequestMs)
const readinessMs = numeric('readiness-ms', 100, deadlineMs, Math.min(DEFAULTS.readinessMs, deadlineMs))
const stopGraceMs = numeric('stop-grace-ms', 100, 60000, DEFAULTS.stopGraceMs)
const cleanupReserveMs = Math.min(stopGraceMs + 2000, Math.max(1000, Math.floor(deadlineMs / 4)))
const workingDeadlineAt = deadlineAt - cleanupReserveMs
const dialect = values.dialect ?? 'source'
const observe = values.observe === true
const assertions = []
const warnings = []
const identity = { requestedFile: null, requestedDigest: null, actualHealthDigest: null, recordPid: null, childPid: null, stateRoot: null, bound: false,
  instanceProcessStart: null, instanceApiPid: null, instanceApiProcessStart: null }
const data = {}
const cleanup = { owned: false, attempted: false, stopped: false, detail: null }
let child
let packageStarted = false
let packageOwned = false
let packageRecord = null
let reused = false
let descriptor = null
let reviewFilePath = null

function numeric(name, min, max, fallback) {
  const raw = values[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new DriverError('usage', `--${name} must be an integer from ${min} to ${max}`)
  return value
}
function required(name) {
  const value = values[name]
  if (typeof value !== 'string' || !value.length) throw new DriverError('usage', `Missing --${name}`)
  return value
}
function absolute(name, value) {
  if (!isAbsolute(value)) throw new DriverError('usage', `--${name} must be absolute`)
  return resolve(value)
}
function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function entry(path) {
  try { return existsSync(path) && lstatSync(path).isFile() ? { path, sha256: sha256(path) } : { path, sha256: null } }
  catch { return { path, sha256: null } }
}
function assertResult(name, expected, actual) {
  const equal = JSON.stringify(expected) === JSON.stringify(actual)
  if (!observe) assertions.push({ name, expected, actual, ok: equal })
  if (!observe && !equal) throw new DriverError('assertion_failed', `Assertion failed: ${name}`, { name, expected, actual })
}
function assertHttp(name, expected, result) {
  assertResult(`${name}.httpStatus`, expected, result.status)
  if (!result.json || typeof result.json !== 'object') throw new DriverError('invalid_response', `${name} did not return a JSON object`)
}

function prepareReview({ command, state, project, output }) {
  const timeout = Math.max(100, Math.min(30000, workingDeadlineAt - Date.now()))
  const common = ['--state', state, '--project', project,
    ...(values['allow-path'] ?? []).flatMap((path) => ['--allow-path', path]),
    ...(values['exclude-path'] ?? []).flatMap((path) => ['--exclude-path', path])]
  const result = dialect === 'package'
    ? spawnSync(process.execPath, [command.entry, 'review-restored', ...command.rootArgs, '--json', ...common, '--out', output], { encoding: 'utf8', timeout })
    : spawnSync(process.execPath, [command.reviewEntry, ...common, '--output', output], { encoding: 'utf8', timeout })
  const code = dialect === 'package' ? 'package_review_failed' : 'review_prepare_failed'
  if (result.error || result.status !== 0) throw new DriverError(code, 'The review entry failed', { status: result.status, stderr: String(result.stderr ?? '').slice(-2000) })
  let parsed
  try { parsed = JSON.parse(String(result.stdout)) } catch { throw new DriverError(code, 'The review entry did not print complete JSON') }
  if (parsed.startupAvailable !== false) throw new DriverError(code, 'The review entry did not return a non-executable selection')
  return parsed
}

async function waitChildExit(target, ms) {
  if (!target || target.exitCode !== null || target.signalCode !== null) return true
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), Math.max(100, ms))
    target.once('exit', () => { clearTimeout(timer); done(true) })
  })
}
function readKey(state) {
  const fd = openSync(join(state, 'api.key'), 'r')
  try { return readFileSync(fd, 'utf8').trim() } finally { closeSync(fd) }
}

async function main() {
  if (!['source', 'package'].includes(dialect)) throw new DriverError('usage', '--dialect must be source or package')
  const install = absolute('install', required('install'))
  const state = absolute('state', required('state'))
  const project = required('project')
  const apiPort = numeric('api-port', 1, 65535, 0)
  if (!apiPort) throw new DriverError('usage', 'Missing --api-port')
  const consolePort = numeric('console-port', 1, 65535, 0)
  if (!consolePort) throw new DriverError('usage', 'Missing --console-port')
  const modelConfig = absolute('model-config', required('model-config'))
  const api = `http://127.0.0.1:${apiPort}`
  const workDir = mkdtempSync(join(values['work-dir'] ? absolute('work-dir', values['work-dir']) : tmpdir(), 'pa-personal-driver-'))
  mkdirSync(workDir, { recursive: true, mode: 0o700 })
  if (values.reuse === true && !values['review-file']) throw new DriverError('usage', '--reuse requires --review-file so the same selection identity is reused')
  const existingReview = values['review-file'] ? absolute('review-file', values['review-file']) : null
  if (existingReview && !entry(existingReview).sha256) throw new DriverError('review_file_missing', 'The reuse review file is not readable', { path: existingReview })
  const reviewFile = existingReview ?? join(workDir, `review-${process.pid}.json`)
  reviewFilePath = reviewFile
  const identityModule = values['identity-module'] ? absolute('identity-module', values['identity-module']) : join(install, 'apps/coordinator/product/restored-review.ts')
  if (values['data-root'] && realpathSync(absolute('data-root', values['data-root'])) !== realpathSync(state))
    throw new DriverError('usage', '--data-root must equal --state; the review driver binds one data root')
  const rootArgs = ['--install', install,
    ...(values['config-root'] ? ['--config-root', absolute('config-root', values['config-root'])] : []),
    ...(values['cache-root'] ? ['--cache-root', absolute('cache-root', values['cache-root'])] : []),
    ...(values['logs-root'] ? ['--logs-root', absolute('logs-root', values['logs-root'])] : []),
    ...(values['workspace-root'] ? ['--workspace-root', absolute('workspace-root', values['workspace-root'])] : [])]
  if (dialect === 'package' && (values['start-entry'] || values['review-entry']))
    throw new DriverError('usage', 'The package dialect uses --pa-entry only; --start-entry/--review-entry would create a foreign consumer')
  if (dialect === 'source' && values['pa-entry'])
    throw new DriverError('usage', 'The source dialect does not accept --pa-entry; pass --start-entry/--review-entry instead')
  const paEntry = values['pa-entry'] ? absolute('pa-entry', values['pa-entry']) : join(install, 'apps/launcher/bin/pa.mjs')
  const command = dialect === 'package'
    ? { kind: 'package', entry: paEntry, sha256: entry(paEntry).sha256, rootArgs, cwd: install }
    : { kind: 'source', reviewEntry: values['review-entry'] ? absolute('review-entry', values['review-entry']) : join(install, 'tools/dev/review-restored.mjs'),
        startEntry: values['start-entry'] ? absolute('start-entry', values['start-entry']) : join(install, 'tools/dev/start.mjs'), cwd: install }
  descriptor = command
  const recordPath = values.record ? absolute('record', values.record) : join(state, 'workbench.json')
  if (!entry(identityModule).sha256) throw new DriverError('identity_unavailable', 'The identity module is not a readable file', { path: identityModule })
  if (command.kind === 'source' && (!entry(command.reviewEntry).sha256 || !entry(command.startEntry).sha256))
    throw new DriverError('entry_missing', 'The source entries are not readable files')
  if (command.kind === 'package' && (!command.sha256 || !entry(paEntry).sha256))
    throw new DriverError('package_entry_missing', 'The package CLI entry is not a readable file', { path: paEntry })

  const prepared = existingReview
    ? { startupAvailable: false, projects: null }
    : prepareReview({ command, state, project, output: reviewFile })
  const mode = statSync(reviewFile).mode & 0o777
  if (mode !== 0o600) throw new DriverError('review_mode', 'The review selection is not a private 0600 file', { mode })
  identity.requestedFile = reviewFile
  identity.requestedDigest = restoredReviewIdentity(reviewFile, identityModule, Math.max(100, Math.min(10000, workingDeadlineAt - Date.now())))
  identity.stateRoot = realpathSync(state)
  const review = { file: reviewFile, sha256: sha256(reviewFile), mode, startupAvailable: prepared.startupAvailable, projects: prepared.projects ?? null }

  if (values['expect-entry-refusal']) {
    if (dialect === 'package') throw new DriverError('NOT_REACHED', 'The package refusal dialect is not available in this source checkpoint', { capability: 'start-refusal' })
    const refusal = spawnSync(process.execPath, [command.startEntry, '--state', state, '--port', String(consolePort), '--api-port', String(apiPort),
      '--discussion-only', '--review-restored-scope', reviewFile], { encoding: 'utf8', timeout: Math.min(readinessMs, remaining(deadlineAt, readinessMs)) })
    const output = `${refusal.stdout ?? ''}${refusal.stderr ?? ''}`
    if (refusal.status === 0) throw new DriverError('refusal_missing', 'The entry accepted a selection that was expected to be refused')
    if (!output.includes(values['expect-entry-refusal']))
      throw new DriverError('refusal_reason', 'The entry failed for a different reason than requested', { requested: values['expect-entry-refusal'], output: output.slice(-2000) })
    return finish('refused-verified', true, { review, output: output.slice(-2000) })
  }

  if (dialect === 'package') {
    const callPa = (commandName, args, timeoutMs) => {
      const bounded = Math.max(100, Math.min(timeoutMs, workingDeadlineAt - Date.now()))
      const result = spawnSync(process.execPath, [command.entry, commandName, ...command.rootArgs, ...args],
        { encoding: 'utf8', timeout: bounded, env: { ...process.env, PA_MODEL_CONFIG: modelConfig } })
      let parsed = null
      try { parsed = JSON.parse(String(result.stdout)) } catch { /* reported by the caller */ }
      return { status: result.status, parsed, stderr: String(result.stderr ?? '').slice(-2000) }
    }
    const before = callPa('status', ['--json', '--state', state], 15000)
    const beforeStatus = before.parsed?.status ?? 'UNKNOWN'
    if (!['STOPPED', 'RUNNING', 'UNVERIFIED', 'BLOCKED'].includes(beforeStatus))
      throw new DriverError('package_status_failed', 'The package status entry did not return a usable state', { before })
    // The package start command supervises its daemon in the foreground and prints one JSON line.
    const logs = logSink()
    child = spawn(process.execPath, [command.entry, 'start', ...command.rootArgs, '--json', '--state', state,
      '--port', String(consolePort), '--api-port', String(apiPort), '--discussion-only', '--review-restored-scope', reviewFile],
    { cwd: command.cwd, env: { ...process.env, PA_MODEL_CONFIG: modelConfig }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (bytes) => logs.push(bytes))
    child.stderr.on('data', (bytes) => logs.push(bytes))
    const parseStart = () => {
      const text = logs.value
      for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
        try {
          const value = JSON.parse(text.slice(index))
          if (value && typeof value.status === 'string') return value
        } catch { /* keep scanning earlier object starts */ }
        if (index === 0) break
      }
      return null
    }
    let parsed = null
    parsed = await waitUntil(() => parseStart(), {
      deadlineAt: Math.min(workingDeadlineAt, Date.now() + readinessMs), child, logs,
      onChildExit: (exit) => {
        const value = parseStart()
        if (value) return value
        throw new DriverError('package_start_failed', 'The package start entry exited without JSON', { ...exit })
      },
    })
    if (parsed.status === 'BLOCKED') {
      const code = parsed.code ?? 'blocked'
      const missing = ['release_missing', 'first_run_required', 'runtime_mismatch', 'runtime_incompatible', 'release_artifact_missing', 'console_assets_missing']
      if (values['allow-not-reached'] || missing.includes(code)) {
        await waitChildExit(child, 5000)
        return finish('NOT_REACHED', false, { review, capability: 'start', code, message: parsed.message ?? null })
      }
      throw new DriverError('package_start_blocked', 'The package start entry refused to run', { code, message: parsed.message ?? null })
    }
    if (!['RUNNING', 'REUSED'].includes(parsed.status)) throw new DriverError('package_start_failed', 'Unexpected package start status', { status: parsed.status })
    reused = parsed.status === 'REUSED'
    packageStarted = parsed.status === 'RUNNING'
    packageOwned = parsed.status === 'RUNNING' && beforeStatus === 'STOPPED'
    if (reused && !(await waitChildExit(child, Math.min(10000, workingDeadlineAt - Date.now()))))
      throw new DriverError('package_reuse', 'A REUSED start did not exit after reporting reuse')
    if (parsed.status === 'RUNNING' && beforeStatus !== 'STOPPED')
      throw new DriverError('package_ownership', 'The package reported RUNNING while another instance record already existed', { beforeStatus })
    const after = callPa('status', ['--json', '--state', state], 15000)
    const instance = after.parsed?.instance
    packageRecord = after.parsed?.status === 'RUNNING' ? instance : null
    if (after.parsed?.status !== 'RUNNING' || !instance)
      throw new DriverError('package_identity', 'The package status entry is not RUNNING after start', { start: parsed, after: after.parsed ?? after })
    const checks = Array.isArray(after.parsed.checks) ? after.parsed.checks : []
    if (checks.some((check) => check.ok !== true)) throw new DriverError('package_identity', 'The package instance checks are not all ok', { checks })
    const recordState = instance.state ? realpathSync(instance.state) : null
    const recordInstall = instance.install ? realpathSync(instance.install) : null
    const argv = Array.isArray(instance.apiArgv) ? instance.apiArgv.map(String) : []
    const reviewIndex = argv.indexOf('--review-restored-scope')
    const selectedArgv = reviewIndex === -1 ? null : argv[reviewIndex + 1] ?? null
    identity.recordPid = instance.pid ?? null
    identity.childPid = null
    identity.instanceProcessStart = instance.processStart ?? null
    identity.instanceApiPid = instance.apiPid ?? null
    identity.instanceApiProcessStart = instance.apiProcessStart ?? null
    identity.bound = !observe && instance.mode === 'personal' && instance.startupMode === 'recovery_readonly' &&
      recordState === identity.stateRoot && recordInstall === realpathSync(install) && (selectedArgv ? realpathSync(selectedArgv) : null) === realpathSync(reviewFile)
    assertResult('package.instance.state', identity.stateRoot, recordState)
    assertResult('package.instance.install', realpathSync(install), recordInstall)
    assertResult('package.instance.mode', 'personal', instance.mode ?? null)
    assertResult('package.instance.startupMode', 'recovery_readonly', instance.startupMode ?? null)
    assertResult('package.instance.reviewArgv', realpathSync(reviewFile), selectedArgv ? realpathSync(selectedArgv) : null)
    assertResult('package.instance.processStart', true, typeof instance.processStart === 'string' && instance.processStart.length > 0)
    assertResult('package.reuse', values.reuse === true, reused)
    assertResult('package.ownership', true, parsed.status === 'REUSED' || packageOwned)
    if (typeof instance.pid === 'number') {
      try { process.kill(instance.pid, 0) } catch { throw new DriverError('package_identity', 'The package launcher pid is not alive', { pid: instance.pid }) }
    }
    // Review identity comes from the same file digest the package validated, and health must agree.
    const live = await httpJson(`${api}/v1/health`, {}, { perRequestMs, deadlineAt: workingDeadlineAt })
    if (live.status !== 200) throw new DriverError('package_identity', 'The package health is not available', { status: live.status })
    identity.actualHealthDigest = live.json.restoredReviewDigest ?? null
    if (identity.actualHealthDigest !== identity.requestedDigest)
      throw new DriverError('package_identity', 'The package health review digest differs from the requested file', { health: identity.actualHealthDigest })
    data.instance = { pid: instance.pid, processStart: instance.processStart, apiPid: instance.apiPid, apiProcessStart: instance.apiProcessStart,
      state: recordState, install: recordInstall, buildId: instance.buildId ?? null, reused, owned: packageOwned }
  } else {
    const logs = logSink()
    child = spawn(process.execPath, [command.startEntry, '--state', state, '--port', String(consolePort), '--api-port', String(apiPort),
      '--discussion-only', '--review-restored-scope', reviewFile], {
      cwd: install, env: { ...process.env, PA_MODEL_CONFIG: modelConfig }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    identity.childPid = child.pid ?? null
    child.stdout.on('data', (bytes) => logs.push(bytes))
    child.stderr.on('data', (bytes) => logs.push(bytes))
    const reuseAllowed = values.reuse === true
    await waitUntil(async () => {
      // Reuse must be proven by the entry exiting with the verified identity, not by any healthy port.
      if (reuseAllowed) return null
      const health = await httpJson(`${api}/v1/health`, {}, { perRequestMs, deadlineAt })
      return health.status === 200 ? health.json : null
    }, {
      deadlineAt: Math.min(workingDeadlineAt, Date.now() + readinessMs), child, logs,
      onChildExit: async (exit) => {
        if (!reuseAllowed || exit.exitCode !== 0)
          throw new DriverError('entry_exited', 'The personal entry exited before the flow completed', { ...exit, reuseRequested: reuseAllowed })
        if (!existsSync(recordPath)) throw new DriverError('reuse_unbound', 'A reused entry exited without an instance record')
        const record = JSON.parse(readFileSync(recordPath, 'utf8'))
        if (record.restoredReviewDigest !== identity.requestedDigest || typeof record.pid !== 'number')
          throw new DriverError('reuse_unbound', 'The instance record does not carry this review identity', { recordDigest: record.restoredReviewDigest ?? null })
        try { process.kill(record.pid, 0) } catch { throw new DriverError('reuse_unbound', 'The recorded instance is not alive', { pid: record.pid }) }
        const health = await httpJson(`${api}/v1/health`, {}, { perRequestMs, deadlineAt })
        if (health.status !== 200) throw new DriverError('reuse_unbound', 'The reused instance health is not available', { status: health.status })
        if (health.json.restoredReviewDigest !== identity.requestedDigest)
          throw new DriverError('reuse_unbound', 'The reused instance health does not match the requested review identity', { healthDigest: health.json.restoredReviewDigest ?? null })
        reused = true
        identity.recordPid = record.pid
        identity.actualHealthDigest = health.json.restoredReviewDigest
        identity.bound = !observe && health.json.mode === 'personal' && health.json.startupMode === 'recovery_readonly' && record.pid !== child.pid
        return { mode: health.json.mode, startupMode: health.json.startupMode }
      },
    })
    if (!reused) {
      const record = await waitUntil(() => {
        if (!existsSync(recordPath)) return false
        try {
          const candidate = JSON.parse(readFileSync(recordPath, 'utf8'))
          return candidate.pid === child.pid && candidate.restoredReviewDigest === identity.requestedDigest ? candidate : false
        } catch { return false }
      }, { deadlineAt: Math.min(workingDeadlineAt, Date.now() + readinessMs), child, logs })
      identity.recordPid = record.pid ?? null
      identity.actualHealthDigest = record.restoredReviewDigest ?? null
      identity.bound = record.pid === child.pid && record.restoredReviewDigest === identity.requestedDigest && record.mode === 'personal'
      assertResult('consumer.pidIsSpawnedEntry', child.pid, record.pid)
      assertResult('consumer.recordDigest', identity.requestedDigest, record.restoredReviewDigest ?? null)
      assertResult('consumer.recordMode', 'personal', record.mode ?? null)
      assertResult('consumer.apiPort', apiPort, record.apiURL ? Number(new URL(record.apiURL).port) : null)
      try { process.kill(record.pid, 0) } catch { throw new DriverError('consumer_not_alive', 'The recorded consumer is not alive', { pid: record.pid }) }
    }
    const health = (await httpJson(`${api}/v1/health`, {}, { perRequestMs, deadlineAt: workingDeadlineAt })).json
    assertResult('health.mode', 'personal', health.mode)
    assertResult('health.startupMode', 'recovery_readonly', health.startupMode)
    assertResult('health.restoredReviewDigest', identity.requestedDigest, health.restoredReviewDigest ?? null)
    identity.actualHealthDigest = health.restoredReviewDigest ?? null
    if (!observe) identity.bound = identity.bound && health.restoredReviewDigest === identity.requestedDigest
  }

  const liveHealth = (await httpJson(`${api}/v1/health`, {}, { perRequestMs, deadlineAt: workingDeadlineAt })).json
  assertResult('health.mode', 'personal', liveHealth.mode)
  assertResult('health.startupMode', 'recovery_readonly', liveHealth.startupMode)
  assertResult('health.restoredReviewDigest', identity.requestedDigest, liveHealth.restoredReviewDigest ?? null)
  identity.actualHealthDigest = liveHealth.restoredReviewDigest ?? null
  if (!observe) identity.bound = identity.bound && liveHealth.restoredReviewDigest === identity.requestedDigest
  const health = { mode: liveHealth.mode ?? null, startupMode: liveHealth.startupMode ?? null, restoredReviewDigest: liveHealth.restoredReviewDigest ?? null }
  const headers = { authorization: `Bearer ${readKey(state)}`, 'content-type': 'application/json' }
  const call = (path, options = {}) => httpJson(`${api}${path}`, { headers, ...options }, { perRequestMs, deadlineAt: workingDeadlineAt })
  const history = await call(`/v1/context/history?projectId=${encodeURIComponent(project)}`)
  assertHttp('history', 200, history)
  const historyEntries = Array.isArray(history.json.entries) ? history.json.entries : null
  if (!historyEntries) throw new DriverError('invalid_response', 'Context history did not contain entries')
  data.history = { conversationId: history.json.conversationId ?? null, entries: historyEntries.length }
  const messageId = values.message ?? historyEntries[0]?.messageId
  if (!messageId) throw new DriverError('missing_history', 'No context history message is available for source review')
  const ordinary = await call(`/v1/messages/${encodeURIComponent(messageId)}/context/sources`)
  assertHttp('sources', 200, ordinary)
  assertResult('sources.defaultHasScopeReview', false, 'scopeReview' in ordinary.json)
  assertResult('sources.state', values['expect-source-state'] ?? 'verified', ordinary.json.state)
  if ((values['expect-scope-review'] ?? 'present') === 'present') {
    const reviewed = await call(`/v1/messages/${encodeURIComponent(messageId)}/context/sources?scopeReview=1`)
    assertHttp('sources.scopeReview', 200, reviewed)
    const review = reviewed.json.scopeReview
    if (!review) throw new DriverError('scope_review_missing', 'The opt-in diagnostic is not present in this consumer')
    assertResult('scopeReview.protocol', 'context-scope-review/1', review.protocol)
    assertResult('scopeReview.authorization', 'none', review.authorization)
    assertResult('scopeReview.partial', reviewed.json.state !== 'verified', review.partial)
    assertResult('scopeReview.withheldSourceCount',
      reviewed.json.state === 'scope_changed' ? reviewed.json.binding?.sources?.length ?? 0 : 0, review.withheldSourceCount)
    if (review.reasons.length > 7 || review.withheldSourceCount > 64)
      throw new DriverError('scope_review_unbounded', 'Scope diagnostics exceed their bound', { reasons: review.reasons.length, withheld: review.withheldSourceCount })
    for (const reason of values['expect-reason'] ?? []) assertResult(`scopeReview.reason.${reason}`, true, review.reasons.includes(reason))
    const stable = ({ observedAt, ...rest }) => JSON.stringify(rest)
    const { scopeReview, ...withoutReview } = reviewed.json
    void scopeReview
    assertResult('sources.optInBodyUnchanged', stable({ ...ordinary.json }), stable(withoutReview))
    data.sources = { messageId, state: ordinary.json.state, diagnostic: review }
  } else {
    data.sources = { messageId, state: ordinary.json.state, diagnostic: null }
  }

  if (values['candidate-message']) {
    const candidateMessage = required('candidate-message')
    const candidates = await call(`/v1/messages/${encodeURIComponent(candidateMessage)}/candidates`)
    assertHttp('candidates', 200, candidates)
    assertResult('candidates.executable', false, candidates.json.executable)
    assertResult('candidates.authorization', 'none', candidates.json.authorization)
    if ((values['expect-candidates'] ?? 'readable') === 'readable') {
      const first = candidates.json.candidates?.[0]
      if (!first) throw new DriverError('candidate_missing', 'The expected candidate is absent', { messageId: candidateMessage })
      if (values['expect-candidate-digest']) assertResult('candidate.payloadDigest', values['expect-candidate-digest'], first.payloadDigest)
      data.candidate = { messageId: candidateMessage, index: first.index, payloadDigest: first.payloadDigest }
      const preparedCandidate = await call('/v1/assistant/candidates/prepare', { method: 'POST',
        body: JSON.stringify({ messageId: candidateMessage, index: first.index, payloadDigest: first.payloadDigest }) })
      assertResult('candidatePrepare.status', Number(values['expect-candidate-prepare'] ?? 422), preparedCandidate.status)
      data.candidatePrepare = preparedCandidate.status
    } else {
      if ((candidates.json.candidates ?? []).length !== 0) throw new DriverError('candidate_unexpected', 'A candidate was readable under a narrower selection')
      assertResult('candidates.rejectReason', values['expect-reject-reason'] ?? 'scope_escalation', candidates.json.rejected?.[0]?.reason ?? null)
      data.candidate = { messageId: candidateMessage, candidates: 0, rejected: candidates.json.rejected?.[0]?.reason ?? null }
    }
  }

  const chat = await call('/v1/commands', { method: 'POST', body: JSON.stringify({ kind: 'chat', commandId: `driver-chat-${process.pid}`,
    projectId: project, conversationId: values.conversation ?? data.history?.conversationId ?? 'driver', text: 'x' }) })
  assertResult('chat.status', Number(values['expect-chat'] ?? 422), chat.status)
  data.chat = chat.status

  if (values.work) {
    const work = await call(`/v1/works/${encodeURIComponent(required('work'))}`)
    assertHttp('work', 200, work)
    assertResult('work.phase', values['expect-work-phase'] ?? 'delivered', work.json.phase ?? null)
    data.work = { id: values.work, phase: work.json.phase ?? null }
  }
  if (values.question) {
    const deliveries = await call(`/v1/questions/${encodeURIComponent(required('question'))}/deliveries`)
    assertHttp('deliveries', 200, deliveries)
    const statuses = Array.isArray(deliveries.json) ? deliveries.json.map((entry) => entry.status) : []
    if (!statuses.length) throw new DriverError('delivery_missing', 'The expected question has no deliveries', { question: values.question })
    assertResult('delivery.status', true, statuses.includes(values['expect-delivery'] ?? 'native_applied'))
    data.delivery = { question: values.question, statuses }
  }

  return finish(observe ? 'observed' : reused ? 'reused' : 'verified-flow', !observe && (reused || identity.bound), { review, health })
}

function finish(status, verified, extra = {}) {
  return {
    protocol: 'personal-review-driver/2', status, verified,
    mode: observe ? 'observe' : 'strict', dialect, format: values.format ?? 'v1', sourceOnly: dialect === 'source',
    packageSubject: values['package-subject'] ?? null,
    install: values.install ? resolve(values.install) : null,
    state: values.state ? resolve(values.state) : null,
    entries: null, review: extra.review ?? null, health: extra.health ?? null, identity,
    budgets: { perRequestMs, deadlineMs, readinessMs, cleanupReserveMs, startedAt, endedAt: new Date().toISOString() },
    data, assertions, warnings, cleanup,
    ...(extra.capability ? { capability: extra.capability, code: extra.code ?? null, message: extra.message ?? null } : {}),
    ...(extra.output ? { output: extra.output } : {}),
  }
}

function collectEntries() {
  const install = values.install ? resolve(values.install) : null
  if (!install) return null
  return {
    review: entry(values['review-entry'] ? absolute('review-entry', values['review-entry']) : join(install, dialect === 'package' ? 'apps/launcher/bin/pa.mjs' : 'tools/dev/review-restored.mjs')),
    start: entry(values['start-entry'] ? absolute('start-entry', values['start-entry']) : join(install, dialect === 'package' ? 'apps/launcher/bin/pa.mjs' : 'tools/dev/start.mjs')),
    identity: entry(values['identity-module'] ? absolute('identity-module', values['identity-module']) : join(install, 'apps/coordinator/product/restored-review.ts')),
    demo: entry(join(install, 'apps/coordinator/product/demo.ts')),
  }
}

let final
async function finalizeCleanup() {
  if (cleanup.attempted) return
  cleanup.attempted = true
  try {
    if (dialect === 'source' && child && !reused) {
      cleanup.owned = true
      if (values.keep === true) {
        cleanup.stopped = false
        cleanup.detail = 'kept-running'
        return
      }
      const stopped = await stopChild(child, { graceMs: Math.min(stopGraceMs, Math.max(100, deadlineAt - Date.now())) })
      cleanup.stopped = stopped.stopped
      cleanup.detail = stopped.escalated ? 'sigkill' : 'sigterm'
    } else if (dialect === 'package' && packageOwned && !reused && values.keep !== true) {
      cleanup.owned = true
      const stateArg = values.state ? resolve(values.state) : null
      const stop = spawnSync(process.execPath, [descriptor.entry, 'stop', ...descriptor.rootArgs, '--json', ...(stateArg ? ['--state', stateArg] : [])],
        { encoding: 'utf8', timeout: Math.max(100, Math.min(stopGraceMs, deadlineAt - Date.now())) })
      let parsed = null
      try { parsed = JSON.parse(String(stop.stdout)) } catch { /* verified below */ }
      const after = spawnSync(process.execPath, [descriptor.entry, 'status', ...descriptor.rootArgs, '--json', ...(stateArg ? ['--state', stateArg] : [])],
        { encoding: 'utf8', timeout: Math.max(100, Math.min(5000, deadlineAt - Date.now())) })
      let afterParsed = null
      try { afterParsed = JSON.parse(String(after.stdout)) } catch { /* unverified */ }
      let pidAlive = typeof packageRecord?.pid === 'number'
      for (let attempt = 0; attempt < 30 && pidAlive; attempt += 1) {
        try { process.kill(packageRecord.pid, 0) } catch { pidAlive = false; break }
        await new Promise((done) => setTimeout(done, 100))
      }
      const supervisorExited = await waitChildExit(child, Math.max(100, Math.min(stopGraceMs, deadlineAt - Date.now())))
      const verifiedStop = stop.status === 0 && parsed?.status === 'STOPPED' && afterParsed?.status === 'STOPPED' && !pidAlive && supervisorExited
      cleanup.stopped = verifiedStop
      cleanup.detail = verifiedStop ? 'pa-stop-verified' : 'pa-stop-unverified'
      if (!verifiedStop) throw new DriverError('cleanup_failed', 'The owned package instance was not verifiably stopped', {
        exit: stop.status, stop: parsed?.status ?? null, statusAfter: afterParsed?.status ?? null, pid: packageRecord?.pid ?? null, pidAlive,
        preserved: { reviewFile: reviewFilePath, state: stateArg, instanceRecord: null },
      })
    } else if (dialect === 'package' && packageStarted && !packageOwned && !reused) {
      cleanup.owned = false
      cleanup.stopped = false
      cleanup.detail = 'previously-running'
    } else {
      cleanup.owned = false
      cleanup.stopped = false
      cleanup.detail = reused ? 'reused-left-running' : values.keep === true ? 'kept-running' : 'not-owned'
    }
  } catch (error) {
    cleanup.stopped = false
    cleanup.detail = `cleanup_error:${error?.code ?? error?.message ?? error}`
    cleanup.error = error instanceof DriverError
      ? { code: error.code, message: error.message, detail: error.detail }
      : { code: 'cleanup_error', message: String(error?.message ?? error) }
    cleanup.materials = { reviewFile: reviewFilePath, state: values.state ? resolve(values.state) : null }
  }
}
try {
  final = await main()
  await finalizeCleanup()
  final = applyCleanup(final)
  final.entries = collectEntries()
  final.descriptor = { dialect, entry: descriptor?.kind === 'package' ? descriptor.entry : descriptor?.startEntry ?? null, sha256: descriptor?.kind === 'package' ? descriptor.sha256 : descriptor?.startEntry ? entry(descriptor.startEntry).sha256 : null }
  if (descriptor?.kind === 'package' && final.entries.review.sha256 !== descriptor.sha256)
    throw new DriverError('descriptor_mismatch', 'The reported package entry hash differs from the executed descriptor')
  process.stdout.write(JSON.stringify(final) + '\n')
  process.exitCode = final.status === 'NOT_REACHED' ? 4 : final.status === 'failed' ? 1 : 0
} catch (error) {
  final = finish('failed', false, {})
  await finalizeCleanup()
  final = applyCleanup(final)
  final.entries = collectEntries()
  final.descriptor = { dialect, entry: descriptor?.kind === 'package' ? descriptor.entry : null, sha256: descriptor?.kind === 'package' ? descriptor.sha256 : null }
  final.failure = error instanceof DriverError
    ? { code: error.code, message: error.message, detail: error.detail }
    : { code: 'internal', message: String(error?.message ?? error) }
  process.stdout.write(JSON.stringify(final) + '\n')
  process.exitCode = final.failure.code === 'usage' ? 2 : final.failure.code === 'NOT_REACHED' ? 4 : 1
} finally {
  await finalizeCleanup().catch(() => undefined)
}
