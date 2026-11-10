import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Ports the user's live instances use. Acceptance never binds, probes or stops these. */
export const RESERVED_PORTS = new Set([5180, 5181, 8796, 8797, 5173, 5174, 8791, 8787])

export async function pickPort() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const server = createServer()
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    })
    await new Promise((resolve) => server.close(resolve))
    if (!RESERVED_PORTS.has(port) && port >= 1024) return port
  }
  throw new Error('Could not reserve an unprivileged loopback port')
}

export function tempState(prefix = 'pa-acceptance-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const state = join(root, 'state')
  mkdirSync(state, { recursive: true, mode: 0o700 })
  return { root, state }
}

export async function waitForHttp(url, { timeoutMs = 20_000, accept = () => true } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) })
      if (response.ok && (await accept(response))) return true
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error?.message
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`Timed out waiting for ${url}: ${last ?? 'no response'}`)
}

function tail(file, limit = 4000) {
  try {
    return readFileSync(file, 'utf8').slice(-limit)
  } catch {
    return ''
  }
}

function killTree(child, signal) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

function processStart(pid) {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

/**
 * Observation of processes that claim to belong to this instance. A missing platform tool makes the
 * measurement UNKNOWN rather than zero.
 */
export function processSnapshot(pid) {
  const snapshot = { pid, processStart: processStart(pid), observedAt: new Date().toISOString() }
  try {
    const line = execFileSync('ps', ['-o', 'pid=,ppid=,rss=,etime=,stat=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim()
    const [observedPid, ppid, rssKb, elapsed, state] = line.split(/\s+/)
    snapshot.pid = Number(observedPid)
    snapshot.ppid = Number(ppid)
    snapshot.rssKb = Number(rssKb)
    snapshot.elapsed = elapsed
    snapshot.state = state
  } catch {
    snapshot.rssKb = null
  }
  try {
    snapshot.openFds = execFileSync('sh', ['-c', `lsof -p ${Number(pid)} 2>/dev/null | grep -c '^f' || true`], {
      encoding: 'utf8',
    }).trim()
    snapshot.openFds = Number(snapshot.openFds)
  } catch {
    snapshot.openFds = null
  }
  try {
    snapshot.children = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    snapshot.children = []
  }
  return snapshot
}

class InstanceHandle {
  constructor({ child, port, stateRoot, logFile, kind }) {
    this.child = child
    this.port = port
    this.stateRoot = stateRoot
    this.logFile = logFile
    this.kind = kind
    this.stopping = false
    this.exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  }

  log() {
    return tail(this.logFile)
  }

  snapshot() {
    return processSnapshot(this.child.pid)
  }

  async stop({ timeoutMs = 12_000 } = {}) {
    this.stopping = true
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    killTree(this.child, 'SIGTERM')
    const closed = await Promise.race([
      this.exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ])
    if (!closed) {
      killTree(this.child, 'SIGKILL')
      await Promise.race([this.exited, new Promise((resolve) => setTimeout(resolve, 4000))])
    }
  }
}

/**
 * Launches the real controlled product entry as a child process in a private state directory.
 * `--native` is never passed: this lane is deterministic fixtures only.
 */
export async function startProduct({
  root,
  port,
  stateRoot,
  consoleOrigin,
  env = {},
  extraArgs = [],
  kind = 'product',
}) {
  const logFile = join(stateRoot, 'acceptance-server.log')
  const child = spawn(
    process.execPath,
    [
      'apps/coordinator/product/demo.ts',
      '--port',
      String(port),
      '--state',
      stateRoot,
      '--console-origin',
      consoleOrigin,
      ...extraArgs,
    ],
    {
      cwd: root,
      env: { ...process.env, ...env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const handle = new InstanceHandle({ child, port, stateRoot, logFile, kind })
  const sink = []
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      sink.push(chunk)
      if (sink.length > 400) sink.shift()
    })
  child.once('exit', (code) => {
    if (code !== 0 && !handle.stopping) sink.push(Buffer.from(`\n[exit ${code}]\n`))
  })
  try {
    await waitForHttp(`http://127.0.0.1:${port}/v1/health`, {
      accept: async (response) => (await response.json()).status === 'ok',
    })
  } catch (error) {
    await handle.stop()
    throw new Error(`${error.message}\nServer log:\n${sink.join('').slice(-3000)}`)
  }
  return handle
}

/** Launches the packaged fixture workbench (same-origin console + product API) for browser work. */
export async function startWorkbench({ root, port, apiPort, stateRoot, env = {} }) {
  const logFile = join(stateRoot, 'acceptance-workbench.log')
  const child = spawn(
    process.execPath,
    [
      'tools/dev/workbench.mjs',
      '--fixture',
      '--port',
      String(port),
      '--api-port',
      String(apiPort),
      '--state',
      stateRoot,
    ],
    {
      cwd: root,
      env: { ...process.env, ...env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const handle = new InstanceHandle({ child, port, stateRoot, logFile, kind: 'workbench' })
  const sink = []
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      sink.push(chunk)
      if (sink.length > 400) sink.shift()
    })
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 30_000 })
  } catch (error) {
    await handle.stop()
    throw new Error(`${error.message}\nWorkbench log:\n${sink.join('').slice(-4000)}`)
  }
  const recordPath = join(stateRoot, 'workbench.json')
  const recordDeadline = Date.now() + 25_000
  while (!existsSync(recordPath) && Date.now() < recordDeadline)
    await new Promise((resolve) => setTimeout(resolve, 100))
  if (!existsSync(recordPath)) {
    await handle.stop()
    throw new Error(`Workbench record was not published\nWorkbench log:\n${sink.join('').slice(-4000)}`)
  }
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  handle.record = record
  handle.apiURL = record.apiURL
  return handle
}

export function cleanup({ root, state }, { keep = false } = {}) {
  if (keep) return { kept: root }
  rmSync(root, { recursive: true, force: true })
  return { kept: null }
}

export function stateSizeKb(path) {
  if (!existsSync(path)) return 0
  try {
    return Number(
      execFileSync('du', ['-sk', path], { encoding: 'utf8' }).trim().split(/\s+/)[0],
    )
  } catch {
    return null
  }
}
