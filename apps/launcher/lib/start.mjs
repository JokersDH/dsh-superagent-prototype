/**
 * `pa start`: verify the build release, reuse a fully verified instance, or start one owned daemon
 * plus the static console server and record the instance. The browser keeps one origin: static
 * assets are served from this launcher and `/v1` is piped to the coordinator's loopback API.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { ensureRoots } from '@personal-agent/portability'
import { EXIT } from './cli.mjs'
import { readLauncherConfig } from './config.mjs'
import { spawnDaemon } from './daemon.mjs'
import { processStart, readInstanceRecord, removeInstanceRecord, verifyInstance, writeInstanceRecord } from './instance.mjs'
import { httpGet } from './http-probe.mjs'
import { consoleIndexPath, readRelease, statFile, verifyReleaseArtifacts } from './release.mjs'
import { createDistributionServer, listenDistributionServer } from './static-server.mjs'

export const DEFAULT_CONSOLE_PORT = 5190
export const DEFAULT_API_PORT = 8790

const blocked = (code, message, detail = {}, hint) => ({ ok: false, code, message, detail, ...(hint ? { hint } : {}) })

function freePort(port) {
  return new Promise((resolvePromise) => {
    const socket = createServer()
    socket.once('error', (error) => resolvePromise({ ok: false, code: error.code }))
    socket.listen(port, '127.0.0.1', () => socket.close(() => resolvePromise({ ok: true })))
  })
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
  const artifacts = verifyReleaseArtifacts(installRoot, release, { hash: false })
  if (!artifacts.ok)
    return blocked('release_artifact_missing', '构建产物与 release manifest 不一致', {
      failures: artifacts.failures.slice(0, 20),
      buildId: release.buildId,
    }, '重新运行 `pa build`；不要服务过期字节。')
  if (!statFile(consoleIndexPath(installRoot, release))?.isFile())
    return blocked('console_assets_missing', '静态网页产物缺失', { root: release.build.consoleRoot }, '重新运行 `pa build`。')

  let existing = null
  try {
    existing = readInstanceRecord(roots.config)
  } catch (error) {
    return blocked('invalid_instance_record', '实例记录不可信，拒绝复用', { cause: error.message, code: error.code }, '运行 `pa doctor` 检查私有状态。')
  }
  if (existing !== null) {
    const verification = await verifyInstance(existing)
    if (verification.ok) return { ok: true, reused: true, record: existing, release }
    return blocked(
      'instance_identity_mismatch',
      '已有实例记录但真实进程身份不一致；不结束未知进程',
      { failures: verification.failures, record: existing },
      '运行 `pa stop` 清理可核实实例，或 `pa doctor` 查看详情。',
    )
  }

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
  for (const [name, port] of [
    ['port', consolePort],
    ['api-port', apiPort],
  ]) {
    const availability = await freePort(port)
    if (!availability.ok)
      return blocked('port_in_use', `本机端口 ${port} 已被占用`, { name, port, cause: availability.code }, '用 --port/--api-port 选择其它端口，或先运行 `pa doctor` 核对已有实例。')
  }

  const consoleURL = `http://127.0.0.1:${consolePort}`
  const apiURL = `http://127.0.0.1:${apiPort}`
  const mode = values.fixture === true ? 'fixture' : 'personal'
  const access = values['require-login'] === true ? 'token' : 'local-development'
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
    logsRoot: ensured.roots.logs,
    buildId: release.buildId,
    forward: values.json !== true,
  })

  try {
    await daemon.waitForHealth(30_000)
  } catch (error) {
    server.close()
    await daemon.stop({ timeoutMs: 5000 })
    removeStale()
    return blocked(
      'daemon_start_failed',
      '产品服务未能在限期内就绪',
      { cause: error.message, tail: daemon.tail(), log: daemon.logPath, mode },
      mode === 'personal'
        ? '个人模式需要已准入的原生执行器（Codex 0.164.0 / darwin arm64）。可先用 --fixture 验证受控链路，或查看日志与 `pa doctor`。'
        : '查看 daemon 日志与 `pa doctor`；不要重复启动。',
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
    server.close()
    await daemon.stop({ timeoutMs: 5000 })
    removeStale()
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
    install: installRoot,
    buildId: release.buildId,
    mode,
    access,
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
  return { ok: true, reused: false, record, release, daemon, server, shutdown, wait }
}

function removeStale() {
  // The failed start never wrote an instance record; nothing to clean.
}
