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
import { existsSync, lstatSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { ensureRoots, readEvidenceSummary } from '@personal-agent/portability'
import { EXIT } from './cli.mjs'
import { readLauncherConfig } from './config.mjs'
import { daemonArgv, spawnDaemon } from './daemon.mjs'
import { restoredReviewIdentity } from '../../coordinator/product/restored-review.ts'
import { probeAuthorExecutor, probeRuntime, readAuthorEvidence } from './diagnostics.mjs'
import { canonicalPath, identityDifferences } from './identity.mjs'
import { captureProcessFacts, processStart, readInstanceRecord, removeInstanceRecord, verifyInstance, writeInstanceRecord } from './instance.mjs'
import { requestedScopeCheck } from './identity.mjs'
import { StartLockHeld, acquireStartLock } from './start-lock.mjs'
import { expectedStartupMode, recoverySummary } from './recovery.mjs'
import { httpGet } from './http-probe.mjs'
import { consoleIndexPath, readRelease, statFile, verifyConsoleBuild, verifyReleaseArtifacts, verifyRuntimeDependencies } from './release.mjs'
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

/**
 * Executes the start flow. Returns either a reuse result (the existing instance stays attached) or a
 * running result with `wait` resolving to the launcher exit code once the owned process is gone.
 */
/**
 * Serialize startup: exactly one launcher may pass identity checks and write the instance record.
 * A live startup lock yields `start_in_progress`; a dead breadcrumb is removed and retried.
 */
export async function startInstance(args) {
  const config = readLauncherConfig(args.roots.config)
  if (config === null)
    return blocked('first_run_required', '本机尚未初始化私有根目录与 launcher 配置', { config: args.roots.config }, '先运行 `pa first-run`。')
  let lock
  try {
    lock = await acquireStartLock(args.roots.config)
  } catch (error) {
    if (error instanceof StartLockHeld)
      return blocked('start_in_progress', '另一个 `pa start` 正在进行', { holder: error.holder }, '等待其结束或运行 `pa status`/`pa doctor`；不会并发启动第二个实例。')
    throw error
  }
  try {
    return await startInstanceLocked(args)
  } finally {
    lock.release()
  }
}

async function startInstanceLocked({ installRoot, roots, values, log = (line) => process.stdout.write(`${line}\n`) }) {
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
  // The console must be a verified HTTP build, not a stale fixture bundle marked as HTTP.
  const consoleCheck = verifyConsoleBuild(installRoot, release)
  if (!consoleCheck.ok)
    return blocked('console_mode_mismatch', '静态 console 不是已验证的 HTTP 构建', consoleCheck, '重新运行 `pa build`（不要用 --skip-console 复用旧产物）。')
  // Runtime dependencies that are actually resolved from this install must match the release digests.
  const dependencyCheck = verifyRuntimeDependencies(installRoot, release)
  if (!dependencyCheck.ok)
    return blocked('dependency_digest_mismatch', '运行依赖与 release 记录不一致', {
      failures: dependencyCheck.failures.slice(0, 20),
      checked: dependencyCheck.checked,
    }, '重新 `pa build`/`pa stage`；不要混用其它 checkout 或 node_modules。')
  // Explain an incompatible Node/ABI/SQLite binding before spawning anything.
  const runtime = probeRuntime({ installRoot, release })
  if (!runtime.ok)
    return blocked('runtime_incompatible', '当前 Node/平台/ABI 无法运行该构建', {
      code: runtime.code,
      message: runtime.message,
      ...runtime.facts,
    }, '使用构建该 release 的 Node 24.21.x 与 darwin/arm64；不要升级全局 runtime 或替换 native binding。')

  const ensured = ensureRoots(roots)
  const canonicalInstall = canonicalPath(installRoot)
  const canonicalState = canonicalPath(ensured.roots.data)
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
  const discussionOnly = values['discussion-only'] === true
  const access = values['require-login'] === true ? 'token' : 'local-development'
  const startupMode = expectedStartupMode(canonicalState)
  const recovery = recoverySummary(canonicalState)
  // Main's explicit restored-personal review is opt-in only. The launcher never scans for a review
  // file, never derives one from the restore report and never enables it for fixture/normal startup.
  const reviewRestoredScope =
    typeof values['review-restored-scope'] === 'string' ? resolve(values['review-restored-scope']) : null
  if (reviewRestoredScope !== null) {
    if (mode !== 'personal' || startupMode !== 'recovery_readonly' || !discussionOnly)
      return blocked(
        'review_requires_restored_personal',
        '显式历史审阅只适用于已恢复 personal 的 discussion-only 只读启动',
        { mode, startupMode, discussionOnly },
        '先恢复状态，再以 `pa start --discussion-only --review-restored-scope <file>` 启动；不会用 fixture 代替 personal。',
      )
    let stat = null
    try {
      stat = lstatSync(reviewRestoredScope)
    } catch {
      return blocked('review_scope_missing', '显式 review 配置文件不存在', { path: reviewRestoredScope }, '用 main 的 review-restored 命令重新生成新的私有文件。')
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      return blocked(
        'review_scope_invalid',
        'review 配置必须是当前用户拥有的 private regular file（0600，非符号链接）',
        { regular: stat.isFile(), symlink: stat.isSymbolicLink(), uid: stat.uid, mode: stat.mode & 0o777 },
        '重新生成 private 文件；不接受旧文件、FIFO、符号链接或宽权限文件。',
      )
  }
  let requestedReviewIdentity = null
  if (reviewRestoredScope !== null) {
    try {
      requestedReviewIdentity = restoredReviewIdentity(reviewRestoredScope)
    } catch (error) {
      return blocked(
        'review_scope_invalid',
        'review 配置未通过 main 的同一文件校验（签名/结构/权限）',
        { path: reviewRestoredScope, cause: String(error?.message ?? error) },
        '用包内 `pa review-restored` 重新生成 0600 配置；不从未验证文件推导选择。',
      )
    }
  }

  // Exact schema rejection before any process is spawned: a state written by a newer build is not
  // opened by an older binary at all (the daemon would fail with MigrationIntegrityError, but that is
  // a crash, not a diagnostic refusal, and it must never look like a healthy start attempt).
  const stateDatabase = join(canonicalState, 'state.sqlite')
  try {
    const observed = existsSync(stateDatabase) ? readEvidenceSummary(stateDatabase) : null
    if (observed !== null && typeof release?.producer?.productSchema === 'number' && observed.productSchema > release.producer.productSchema)
      return blocked(
        'state_schema_newer_than_binary',
        `state schema ${observed.productSchema} is newer than this binary (${release.producer.productSchema})`,
        { stateSchema: observed.productSchema, binarySchema: release.producer.productSchema, state: canonicalState, buildId: release.buildId },
        'Use the newer distribution for this state, or restore a backup made by this build. This binary does not downgrade or delete the state.',
      )
  } catch (error) {
    // readEvidenceSummary refuses a future schema itself; that is exactly the case this preflight is
    // here for, so turn it into the explicit refusal instead of letting the daemon crash later.
    if (error?.code === 'schema_unsupported' && typeof error.detail?.productSchema === 'number')
      return blocked(
        'state_schema_newer_than_binary',
        `state schema ${error.detail.productSchema} is newer than this binary (${error.detail.supported})`,
        { stateSchema: error.detail.productSchema, binarySchema: error.detail.supported, state: canonicalState },
        'Use the newer distribution for this state, or restore a backup made by this build. This binary does not downgrade or delete the state.',
      )
  }
  const desired = {
    install: canonicalInstall,
    state: canonicalState,
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
    const scope = requestedScopeCheck({ roots, record: existing, requireInstall: true })
    if (!scope.ok)
      return blocked(
        'requested_root_mismatch',
        '实例记录属于其他 state/install；不复用、不结束该进程',
        { scope },
        '用记录所属的参数启动，或对该实例执行 `pa stop`；不会按 PID 猜测。',
      )
    const verification = await verifyInstance(existing)
    if (!verification.ok)
      return blocked(
        'instance_identity_mismatch',
        '已有实例记录但真实进程身份不一致；不结束未知进程',
        { failures: verification.failures, record: existing },
        '运行 `pa stop` 清理可核实实例，或 `pa doctor` 查看详情。',
      )
    // Compare the requested normalized file identity with the actual daemon health digest before
    // any port/access conflict branch. The record is never a substitute for live health, and an
    // unbound/different/missing selection must not stop or mutate the existing instance.
    let liveHealth = null
    try {
      const response = await httpGet(`${existing.apiURL}/v1/health`, { timeoutMs: 2000, parseJson: true })
      if (response.status === 200) liveHealth = response.body
    } catch {
      liveHealth = null
    }
    if (liveHealth === null)
      return blocked(
        'instance_health_unavailable',
        '已有实例记录存在，但无法核验其实际 health；不复用、不结束未知进程',
        { pid: existing.pid, apiURL: existing.apiURL },
        '先用 `pa doctor`/`pa status` 核对实际实例与端口；不根据记录猜测选择。',
      )
    if (requestedReviewIdentity !== null && (liveHealth.mode !== 'personal' || liveHealth.startupMode !== 'recovery_readonly')) {
      return blocked(
        'restored_review_selection_mismatch',
        '已有实例不是 personal/recovery_readonly；显式 review 选择不能升级普通/fixture 实例',
        { liveMode: liveHealth.mode ?? null, liveStartupMode: liveHealth.startupMode ?? null, requestedReviewIdentity },
        '先正常 `pa stop` 经核实的该实例，再以 restored personal discussion-only 启动；不会原地提升权限。',
      )
    }
    const liveReviewIdentity = typeof liveHealth.restoredReviewDigest === 'string' ? liveHealth.restoredReviewDigest : null
    if (requestedReviewIdentity !== liveReviewIdentity)
      return blocked(
        'restored_review_selection_mismatch',
        '本次显式 review 选择与已运行实例的实际选择不同；保留旧 PID，不复用、不结束',
        { requestedReviewIdentity, liveReviewIdentity, pid: existing.pid },
        '用与运行实例相同的已验证文件复用，或先 `pa stop` 旧实例再以新选择启动；不会重新签发/刷新旧窗口。',
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

  if (mode === 'personal' && !discussionOnly) {
    const evidence = readAuthorEvidence(installRoot)
    const expectedVersion = evidence?.status === 'PASS_REAL_NATIVE_PRODUCT' ? evidence.profileVersion : null
    const executor = probeAuthorExecutor({ installRoot, required: true, expectedVersion })
    if (!executor.ok)
      return blocked(
        executor.code ?? 'author_executor_unavailable',
        '个人模式需要已准入的作者执行器与私有认证；不会回退到 fixture，也不会读取凭据内容',
        { ...executor.facts, evidenceStatus: evidence?.status ?? 'unknown', evidenceProfileVersion: evidence?.profileVersion ?? null },
        '在你自己的账号安装/登录已准入的 Codex CLI 0.164.0 后再启动；可用 --fixture 验证受控链路。本启动器不安装、不升级、不重置 native 账号。',
      )
  }

  const consoleURL = desired.consoleURL
  const apiURL = desired.apiURL
  const server = createDistributionServer({
    staticRoot: join(canonicalInstall, release.build.consoleRoot),
    apiOrigin: apiURL,
    buildId: release.buildId,
  })
  await listenDistributionServer(server, consolePort)

  const expectedArgv = daemonArgv({
    discussionOnly,
    reviewRestoredScope,
    installRoot: canonicalInstall,
    apiPort,
    state: canonicalState,
    consoleURL,
    mode,
    access,
    startupMode,
  })
  const daemon = spawnDaemon({
    discussionOnly,
    reviewRestoredScope,
    installRoot: canonicalInstall,
    apiPort,
    state: canonicalState,
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
  if (requestedReviewIdentity !== null) {
    if (health?.mode !== 'personal' || observedStartupMode !== 'recovery_readonly' || health?.restoredReviewDigest !== requestedReviewIdentity) {
      await stopFailedStart()
      return blocked(
        'restored_review_selection_mismatch',
        '新实例 health 未携带本次已验证 review 选择摘要；拒绝把未生效选择当作已审阅启动',
        { requestedReviewIdentity, health },
        '核对包内 prepare/consumer 是否同版本；不重签、不降级到 fixture，也不保留错误实例。',
      )
    }
  }
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

  const apiFacts = await captureProcessFacts(daemon.apiPid)
  const record = {
    protocol: 'personal-product-instance/1',
    pid: process.pid,
    processStart: await processStart(process.pid),
    launcherArgv: process.argv,
    launcherCwd: process.cwd(),
    apiPid: daemon.apiPid,
    consolePid: process.pid,
    apiArgv: [process.execPath, ...expectedArgv],
    apiProcessStart: apiFacts.processStart,
    apiUid: apiFacts.uid ?? (process.getuid ? process.getuid() : 0),
    apiURL,
    consoleURL,
    state: canonicalState,
    install: canonicalInstall,
    buildId: release.buildId,
    mode,
    access,
    startupMode,
    startedAt: new Date().toISOString(),
  }
  if (process.env.PA_SUPPRESS_INSTANCE_RECORD === '1')
    // Test-only fault injection for the upgrade window "health answered but the record was never
    // persisted". It must be opt-in; normal starts always persist their identity before serving.
    log('  [fault] instance record suppressed (PA_SUPPRESS_INSTANCE_RECORD=1)')
  else writeInstanceRecord(roots.config, record)
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
