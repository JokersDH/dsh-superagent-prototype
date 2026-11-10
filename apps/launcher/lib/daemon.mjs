/**
 * Supervise the existing coordinator product entry as an owned child process. The launcher adds no
 * business logic: it passes the selected private state, loopback API port and authorized console
 * origin, then waits for `GET /v1/health`. Daemon output is bounded and redacted before it reaches a
 * private log or the operator terminal.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { httpGet } from './http-probe.mjs'

export const LOG_LIMIT_BYTES = 2 * 1024 * 1024

const REDACTIONS = [
  [/\b[a-f0-9]{64}\b/g, '[redacted-hex64]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[redacted]'],
  [/(\b(?:api[_-]?key|apiKey|token|authorization|password|secret|bootstrap)\b"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1[redacted]'],
  [/\/\/[^/\s@]+:[^@/\s]+@/g, '//[redacted]@'],
]

/** Never persist or echo an obvious credential; unknown future formats stay visible as text. */
export function redact(line) {
  let output = line
  for (const [pattern, replacement] of REDACTIONS) output = output.replace(pattern, replacement)
  return output
}

export function createBoundedLog(logsRoot, buildId) {
  mkdirSync(logsRoot, { recursive: true, mode: 0o700 })
  const path = join(logsRoot, `daemon-${buildId}.log`)
  let bytes = 0
  try {
    bytes = statSync(path).size
  } catch {
    bytes = 0
  }
  if (bytes >= LOG_LIMIT_BYTES) {
    try {
      renameSync(path, `${path}.1`)
      bytes = 0
    } catch {
      /* a missing/unwritable old log is not a start blocker */
    }
  }
  const write = (text) => {
    const payload = text.endsWith('\n') ? text : `${text}\n`
    try {
      appendFileSync(path, payload, { mode: 0o600 })
      bytes += Buffer.byteLength(payload)
      if (bytes >= LOG_LIMIT_BYTES) {
        try {
          renameSync(path, `${path}.1`)
          bytes = 0
        } catch {
          /* rotation is best effort; the file is private and bounded per start */
        }
      }
    } catch {
      /* logging must never break the product process lifecycle */
    }
  }
  return { path, write }
}

export function daemonArgv({ installRoot, apiPort, state, consoleURL, mode, access }) {
  const argv = [
    join(installRoot, 'apps/coordinator/product/demo.ts'),
    '--port',
    String(apiPort),
    '--state',
    state,
    '--console-origin',
    consoleURL,
    '--assistant',
  ]
  if (mode === 'personal') argv.push('--native')
  if (access === 'local-development') argv.push('--local-access')
  return argv
}

export async function waitForHealth(apiURL, child, { timeoutMs = 30_000, childExit } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`产品服务在就绪前退出（exit ${child.exitCode ?? child.signalCode}）`)
    try {
      const response = await httpGet(`${apiURL}/v1/health`, { timeoutMs: 750, parseJson: true })
      if (response.status === 200 && response.body?.status === 'ok') return response.body
    } catch {
      /* bounded retry while the product entry binds its port */
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`产品服务在 ${timeoutMs}ms 内未就绪（${apiURL}/v1/health）`)
}

/**
 * Spawn the owned daemon. Callers must stop it through `stopDaemon`, which signals only this child
 * and reports resources that outlive the deadline.
 */
export function spawnDaemon(options) {
  const { installRoot, apiPort, state, consoleURL, mode, access, logsRoot, buildId } = options
  const log = createBoundedLog(logsRoot, buildId)
  const tail = []
  const child = spawn(process.execPath, daemonArgv({ installRoot, apiPort, state, consoleURL, mode, access }), {
    cwd: installRoot,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const onLine = (streamName) => (line) => {
    const redacted = redact(line)
    log.write(`[${streamName}] ${redacted}`)
    if (tail.length >= 120) tail.shift()
    tail.push(redacted)
    if (options.forward === true) process.stderr.write(`[daemon:${streamName}] ${redacted}\n`)
  }
  for (const [stream, name] of [
    [child.stdout, 'out'],
    [child.stderr, 'err'],
  ]) {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        onLine(name)(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
      }
      if (buffer.length > 64 * 1024) {
        onLine(name)(buffer)
        buffer = ''
      }
    })
    stream.on('end', () => {
      if (buffer) onLine(name)(buffer)
    })
  }
  const exited = new Promise((resolvePromise) => {
    child.once('exit', (code, signal) => resolvePromise({ code, signal }))
  })
  return {
    child,
    apiPid: child.pid,
    logPath: log.path,
    tail: () => tail.slice(-20),
    exited,
    waitForHealth: (timeoutMs) => waitForHealth(`${options.apiURL}`, child, { timeoutMs }),
    async stop({ timeoutMs = 8000 } = {}) {
      if (child.exitCode !== null || child.signalCode !== null) return { stopped: true, stillAlive: false, code: child.exitCode ?? 0 }
      child.kill('SIGTERM')
      const timeout = new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), timeoutMs))
      const result = await Promise.race([exited, timeout])
      if (result !== 'timeout') return { stopped: true, stillAlive: false, code: result.code ?? 0 }
      child.kill('SIGKILL')
      const forced = await Promise.race([exited, new Promise((resolvePromise) => setTimeout(() => resolvePromise('timeout'), 2000))])
      return { stopped: forced !== 'timeout', stillAlive: forced === 'timeout', code: 'stop_timeout_resources_alive' }
    },
  }
}

/** Report whether a log file exists (diagnosis only; contents are redacted at write time). */
export function logExists(path) {
  return existsSync(path)
}
