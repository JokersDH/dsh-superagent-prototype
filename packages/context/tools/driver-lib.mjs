/** Bounded, cancellable primitives shared by the personal-review driver and its fault tests. */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export class DriverError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'DriverError'
    this.code = code
    this.detail = detail
  }
}

export const DEFAULTS = Object.freeze({ perRequestMs: 5000, deadlineMs: 180000, readinessMs: 150000, stopGraceMs: 8000, stopKillMs: 2000, logBytes: 65536 })

/** Tail-only bounded log sink; never grows with unbounded child output. */
export function logSink(limit = DEFAULTS.logBytes) {
  let text = ''
  return {
    push(bytes) {
      text += String(bytes)
      if (text.length > limit) text = text.slice(-limit)
    },
    get value() { return text },
  }
}

export function remaining(deadlineAt, capMs) {
  const left = deadlineAt - Date.now()
  if (left <= 0) throw new DriverError('deadline_exceeded', 'The overall driver deadline elapsed')
  return Math.max(1, Math.min(capMs, left))
}

/**
 * One bounded HTTP request. The abort signal is capped by both the per-request budget and the
 * overall deadline, so a connected but silent peer cannot hold the flow open.
 */
export async function httpJson(url, options = {}, budgets = {}) {
  const timeoutMs = remaining(budgets.deadlineAt ?? Date.now() + DEFAULTS.deadlineMs, budgets.perRequestMs ?? DEFAULTS.perRequestMs)
  let response
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    throw new DriverError(aborted ? 'request_timeout' : 'request_failed', aborted
      ? `Request exceeded ${timeoutMs}ms: ${url}` : `Request failed: ${url}`, { cause: String(error?.message ?? error) })
  }
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { throw new DriverError('invalid_json', `Response was not complete JSON: ${url}`, { status: response.status, bytes: text.length }) }
  return { status: response.status, json, bytes: text.length }
}

/**
 * Readiness loop that fails immediately when the spawned entry already exited, never accumulating
 * unbounded logs. `onChildExit` may declare an intentional exit (e.g. verified reuse).
 */
export async function waitUntil(read, { deadlineAt, intervalMs = 100, child, logs, onChildExit } = {}) {
  for (;;) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      const exit = { exitCode: child.exitCode, signalCode: child.signalCode, log: logs?.value ?? '' }
      if (onChildExit) {
        const declared = await onChildExit(exit)
        if (declared) return declared
      }
      throw new DriverError('entry_exited', 'The personal entry exited before the flow completed', exit)
    }
    if (Date.now() > deadlineAt) throw new DriverError('readiness_timeout', 'The personal entry did not become ready before the deadline', { log: logs?.value ?? '' })
    try {
      const value = await read()
      if (value) return value
    } catch (error) {
      if (error instanceof DriverError && !['request_failed', 'invalid_json', 'request_timeout'].includes(error.code)) throw error
    }
    await new Promise((done) => setTimeout(done, intervalMs))
  }
}

/** Stops only the exact child this driver spawned; escalates once, then reports cleanup failure. */
export async function stopChild(child, { graceMs = DEFAULTS.stopGraceMs, killMs = DEFAULTS.stopKillMs } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return { stopped: true, escalated: false }
  const waitExit = (ms) => new Promise((done) => {
    const timer = setTimeout(() => done(false), ms)
    child.once('exit', () => { clearTimeout(timer); done(true) })
  })
  child.kill('SIGTERM')
  if (await waitExit(graceMs)) return { stopped: true, escalated: false }
  child.kill('SIGKILL')
  if (await waitExit(killMs)) return { stopped: true, escalated: true }
  throw new DriverError('cleanup_timeout', 'The spawned entry did not stop within the cleanup budget', { pid: child.pid })
}

/** Runs the package's own identity function in a child so the expected digest is not re-implemented here. */
export function restoredReviewIdentity(file, modulePath, timeoutMs = 10000) {
  const code = `const {pathToFileURL}=await import('node:url');const m=await import(pathToFileURL(process.argv[1]).href);process.stdout.write(m.restoredReviewIdentity(process.argv[2]))`
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code, modulePath, file],
    { encoding: 'utf8', timeout: timeoutMs })
  if (result.error || result.status !== 0) throw new DriverError('identity_unavailable', 'The package identity function could not read the review file', {
    status: result.status, stderr: String(result.stderr ?? '').slice(-2000),
  })
  const value = String(result.stdout ?? '').trim()
  if (!/^[a-f0-9]{64}$/.test(value)) throw new DriverError('identity_unavailable', 'The package identity function did not return a 64-hex digest', { value })
  return value
}
