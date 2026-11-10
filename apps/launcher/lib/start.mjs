/**
 * `pa start`: verify the built release (including real content digests), resolve the requested
 * identity (install/state/mode/access/ports/build/startupMode), reuse only a fully verified instance
 * that matches that identity, or start one owned daemon plus the static console server.
 *
 * Restored states are forced into main's `recovery_readonly` composition: the launcher requests it
 * explicitly, verifies `/v1/health.startupMode`, and never deletes the restore marker or offers a
 * self-authorized resume switch.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ensureRoots } from '@personal-agent/portability'
import { EXIT } from './cli.mjs'
import { readLauncherConfig } from './config.mjs'
import { spawnDaemon } from './daemon.mjs'
import { processStart, readInstanceRecord, removeInstanceRecord, verifyInstance, writeInstanceRecord } from './instance.mjs'
import { expectedStartupMode, recoverySummary } from './recovery.mjs'
import { httpGet } from './http-probe.mjs'
import { consoleIndexPath, readRelease, statFile, verifyReleaseArtifacts } from './release.mjs'
import { createDistributionServer, listenDistributionServer } from './static-server.mjs'

export const DEFAULT_CONSOLE_PORT = 5190
export const DEFAULT_API_PORT = 8790
export const STARTUP_MODES = ['normal', 'recovery_readonly']

const blocked = (code, message, detail = {}, hint) => ({ ok: false, code, message, detail, ...(hint ? { hint } : {}) })

function freePort(port) {
  return new Promise((resolvePromise) => {
    const socket = createServer()
    socket.once('error', (error) => resolvePromise({ ok: false, code: error.code }))
    socket.listen(port, '127.0.0.1', () => socket.close(() => resolvePromise({ ok: true })))
  })
}

const canonicalPath = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Fields that must match before an existing instance may be reused. Reuse is never inferred from a
 * listening port alone: a different state/mode/access/build/startup mode/port is a stable conflict.
 */
function identityDifferences(record, desired) {
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
 * Executes the start flow. Returns either a reuse result (the existing instance stays attached) or a
 * running result with `wait` resolving to the launcher exit code once the owned process is gone.
 */
export async function startInstance({ installRoot, roots, values, log = (line) => process.stdout.write(`${line}\n`) }) {
  const config = readLauncherConfig(roots.config)
  if (config === null)
    return blocked('first_run_required', '本机尚未初始化私有根目录与 launcher 配置', { config: roots.config }, '先运行 `pa first-run`。')

  const releaseState = readRelease(roots.config)
  if (releaseState.release === null)
    return blocked(
      'release_missing',
      '没有可用于启动的构建清单，运行时不回退 Vite dev server',
      { path: releaseState.path, cause: releaseState.message ?? releaseState.code },
      '先运行一次 `pa build`（源码更新后同样执行）。',
    )
  const release = releaseState.release
  if (release.producer.node !== process.versions.node)
    return blocked('runtime_mismatch', '当前 Node 与 release 记录不一致', {
      releaseNode: release.producer.node,
      currentNode: process.versions.node,
    }, '用构建该 release 的 Node 24.21.x 启动，或重新 `pa build`。')
  // Startup verifies the actual executed bytes: a same-length mutation must not pass.
  const artifacts = verifyReleaseArtifacts(installRoot, release, { hash: true })
  if (!artifacts.ok)
    return blocked('release_artifact_missing', '构建产物与 release manifest 的内容摘要不一致', {
      failures: artifacts.failures.slice(0, 20),
      buildId: release.buildId,
    }, '重新运行 `pa build`；不要服务过期或被修改的字节。')
  if (!statFile(consoleIndexPath(installRoot, release))?.isFile())
    return blocked('console_assets_missing', '静态网页产物缺失', { root: release.build.consoleRoot }, '重新运行 `pa build`。')

  const ensured = ensureRoots(roots)
  const consolePort = values.port === undefined ? DEFAULT_CONSOLE_PORT : Number(values.port)
  const apiPort = values['api-port'] === undefined ? DEFAULT_API_PORT : Number(values['api-port'])
  for (const [name, value] of [
    ['port', consolePort],
    ['api-port', apiPort],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1024 || value > 65535)
      return blocked('invalid_port', `--${name} 必须是 1024-65535 的整数`, { value })
  }
  if (consolePort === apiPort) return blocked('invalid_port', '网页与接口端口不能相同')
  const mode = values.fixture === true ? 'fixture' : 'personal'
  const access = values['require-login'] === true ? 'token' : 'local-development'
  const startupMode = expectedStartupMode(ensured.roots.data)
  const recovery = recoverySummary(ensured.roots.data)
  const desired = {
    install: canonicalPath(installRoot),
    state: canonicalPath(ensured.roots.data),
    mode,
    access,
    buildId: release.buildId,
    startupMode,
    consoleURL: `http://127.0.0.1:${consolePort}`,
    apiURL: `http://127.0.0.1:${apiPort}`,
  }

  let existing = null
  try {
    existing = readInstanceRecord(roots.config)
  } catch (error) {
    return blocked('invalid_instance_record', '实例记录不可信，拒绝复用', { cause: error.message, code: error.code }, '运行 `pa doctor` 检查私有状态。')
  }
  if (existing !== null) {
    const verification = await verifyInstance(existing)
    if (!verification.ok)
      return blocked(
        'instance_identity_mismatch',
        '已有实例记录但真实进程身份不一致；不结束未知进程',
        { failures: verification.failures, record: existing },
        '运行 `pa stop` 清理可核实实例，或 `pa doctor` 查看详情。',
      )
    const differences = identityDifferences(existing, desired)
    if (differences.length > 0)
      return blocked(
        'instance_conflict',
        '已运行实例与本次请求的身份不一致；不静默复用不同 state/mode/access/build/端口',
        { differences, running: { pid: existing.pid, consoleURL: existing.consoleURL, state: existing.state } },
        '用与运行实例相同的参数复用；要切换请先 `pa stop`，再以新参数启动。',
      )
    return { ok: true, reused: true, record: existing, release, startupMode, recovery }
  }

  for (const [name, port] of [
    ['port', consolePort],
    ['api-port', apiPort],
  ]) {
    const availability = await freePort(port)
    if (!availability.ok)
      return blocked('port_in_use', `本机端口 ${port} 已被占用`, { name, port, cause: availability.code }, '用 --port/--api-port 选择其它端口，或先运行 `pa doctor` 核对已有实例。')
  }

  const consoleURL = desired.consoleURL
  const apiURL = desired.apiURL
  const server = createDistributionServer({
    staticRoot: join(installRoot, release.build.consoleRoot),
    apiOrigin: apiURL,
    buildId: release.buildId,
  })
  await listenDistributionServer(server, consolePort)

  const daemon = spawnDaemon({
    installRoot,
    apiPort,
    state: ensured.roots.data,
    consoleURL,
    apiURL,
    mode,
    access,
    startupMode,
    logsRoot: ensured.roots.logs,
    buildId: release.buildId,
    forward: values.json !== true,
  })

  const stopFailedStart = async () => {
    server.close()
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    await daemon.stop({ timeoutMs: 5000 })
  }

  let health
  try {
    health = await daemon.waitForHealth(30_000)
  } catch (error) {
    await stopFailedStart()
    return blocked(
      'daemon_start_failed',
      '产品服务未能在限期内就绪',
      { cause: error.message, tail: daemon.tail(), log: daemon.logPath, mode, startupMode },
      mode === 'personal'
        ? '个人模式需要已准入的原生执行器（Codex 0.164.0 / darwin arm64）。可先用 --fixture 验证受控链路，或查看日志与 `pa doctor`。'
        : '查看 daemon 日志与 `pa doctor`；不要重复启动。',
    )
  }

  const observedStartupMode = health?.startupMode === 'recovery_readonly' ? 'recovery_readonly' : 'normal'
  if (observedStartupMode !== startupMode) {
    await stopFailedStart()
    return blocked(
      'startup_mode_mismatch',
      startupMode === 'recovery_readonly'
        ? '恢复态实例没有进入只读模式，拒绝把它呈现为可用实例'
        : '普通启动被产品服务报告为恢复只读，拒绝继续',
      { expected: startupMode, observed: observedStartupMode, health },
      startupMode === 'recovery_readonly'
        ? '检查 restore-report.json 是否完整以及 main 的恢复入口；不会删除 marker，也不会自建绕过开关。'
        : 'state 在启动期间出现 restore marker；用 `pa doctor` 核对后重新启动。',
    )
  }

  let html = ''
  try {
    const page = await httpGet(`${consoleURL}/`, { timeoutMs: 5000 })
    html = page.status === 200 ? page.body : ''
  } catch {
    html = ''
  }
  if (!html.includes('<div id="root">')) {
    await stopFailedStart()
    return blocked('console_unavailable', '静态网页未能通过自检', { log: daemon.logPath }, '重新运行 `pa build` 并检查日志。')
  }

  const record = {
    protocol: 'personal-product-instance/1',
    pid: process.pid,
    processStart: await processStart(process.pid),
    apiPid: daemon.apiPid,
    consolePid: process.pid,
    apiURL,
    consoleURL,
    state: ensured.roots.data,
    install: canonicalPath(installRoot),
    buildId: release.buildId,
    mode,
    access,
    startupMode,
    startedAt: new Date().toISOString(),
  }
  writeInstanceRecord(roots.config, record)
  let closing
  const trace = (label) => {
    if (process.env.PA_DEBUG_SHUTDOWN === '1') process.stderr.write(`[shutdown ${Date.now()}ms] ${label}\n`)
  }
  const closeServer = () =>
    new Promise((resolvePromise) => {
      server.close(() => resolvePromise())
      // Idle keep-alive sockets from the console self-check must not delay a clean exit.
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    })
  const shutdown = () =>
    (closing ??= (async () => {
      trace('begin')
      const stopResult = await daemon.stop({ timeoutMs: 8000 })
      trace('daemon-stopped')
      await closeServer()
      trace('server-closed')
      try {
        removeInstanceRecord(roots.config)
      } catch {
        /* the record may already be gone; never hide the stop result */
      }
      return stopResult
    })())

  const wait = new Promise((resolvePromise) => {
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      resolvePromise(code)
    }
    const onSignal = () => {
      trace('signal')
      void shutdown().then((result) => {
        trace('shutdown-done')
        finish(result.stillAlive ? EXIT.DEGRADED : EXIT.OK)
      })
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    daemon.exited.then(async (result) => {
      await closeServer()
      try { removeInstanceRecord(roots.config) } catch { /* already gone */ }
      log(`daemon 已退出（code ${result.code ?? result.signal}）；日志: ${daemon.logPath}`)
      for (const line of daemon.tail().slice(-10)) log(`  ${line}`)
      finish(result.code === 0 ? EXIT.OK : EXIT.DEGRADED)
    })
  })
  return { ok: true, reused: false, record, release, daemon, server, shutdown, wait, startupMode, recovery, health }
}
