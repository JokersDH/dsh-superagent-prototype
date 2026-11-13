#!/usr/bin/env node
/**
 * `pa` — thin launcher for one personal install. Product commands, questions and completion stay in
 * the existing coordinator API; this CLI only manages private roots, build admission, the local
 * static console/proxy, process identity, diagnosis and backup/restore entrypoints.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PortabilityError, readEvidenceSummary } from '@personal-agent/portability'
import { EXIT, UsageError, fail, intOption, parseArgs, printResult } from '../lib/cli.mjs'
import { resolveContext, ROOT_OPTION_SPEC } from '../lib/context.mjs'
import { readLauncherConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { firstRun } from '../lib/first-run.mjs'
import { readInstanceRecord, verifyInstance } from '../lib/instance.mjs'
import { writeSupportBundle } from '../lib/support.mjs'
import { requestedScopeCheck } from '../lib/identity.mjs'
import { recoveryStatus, recoverySummary } from '../lib/recovery.mjs'
import { RECOVERY_COMMIT_REQUIREMENTS, RecoveryAuthorizationError, recoveryInspect, recoveryPrepare } from '../lib/recovery-authorization.mjs'
import { readRelease } from '../lib/release.mjs'
import { backupState, verifyBackup } from '../lib/backup.mjs'
import { importBundle, restoreState, rollbackState } from '../lib/restore.mjs'
import { startInstance } from '../lib/start.mjs'
import { prepareReview } from '../lib/review.mjs'
import { stopInstance } from '../lib/stop.mjs'
import { UpgradeError, inspectTargetInstall, readJournal, recoverSwitch, rollbackInstall, upgradeInstall } from '../lib/upgrade.mjs'
import { ACTIVATION_CONSUMPTION_REQUIREMENTS, LOCAL_RESOURCE_POLICY_DIGEST, currentMachineDigest, evaluateActivation, evaluateActivationAudit } from '../lib/recovery-activation.mjs'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const BUILD_SCRIPT = join(repoRoot, 'tools/distribution/build.mjs')
const SMOKE_SCRIPT = join(repoRoot, 'tools/distribution/smoke.mjs')

const HELP = `pa — 本机个人 Agent 助理启动器

用法: pa <command> [options]

命令:
  first-run              创建私有根目录、记录非秘密本机配置、只读探测执行器
  build                  构建 console 静态产物、运行时包 dist 与执行入口，写 release manifest
  stage                  构建并产出可搬迁的版本化 staged install 闭包
  start                  启动或复用本机实例（默认 fixture 关、个人模式）；打印网页地址
  status                 查询实例记录与真实进程身份
  stop                   按已验证进程身份优雅停止；超时如实报告未静止资源
  upgrade                切换到另一个已冻结发行版：校验目标字节、备份、精确停实例、切换指针、启动核验，失败回退指针
  upgrade-status         查看上次切换的 from/to/备份/是否回滚过数据
  rollback-install       只把二进制指针切回上一个安装（不恢复数据、不降 schema）
  recovery-activation-check  只读评估 main 的激活 intent 与本机目标 state 事实；永不授权、永不启动
  doctor                 只读诊断 Node/ABI/SQLite/构建/根目录/实例/执行器
  recovery-status        只读列出恢复 marker/待重绑定/main 新授权接口状态（不发业务）
  recovery-inspect       调用 main /v1/recovery/inspect（本机只读观测，不是授权）
  recovery-prepare       调用 main /v1/recovery/prepare 获取只读重绑定计划（不落盘、不授权）
  backup                 创建完整备份 bundle（一致 DB 快照 + 引用产物 + 必要配置）
  verify-backup          只校验 bundle（结构/摘要/DB/安全），不恢复
  import-bundle          校验并登记已有 bundle 到本机托管备份目录
  restore                恢复 bundle 到新的私有目录（不覆盖活跃 state，不自动启动）
  rollback               用升级前快照回滚（失败保留现场并回到可启动状态）

全局选项:
  --json                 机器可读输出
  --install <dir>        安装根（默认本仓）
  --config-root <dir>    私有配置根
  --data-root <dir>      私有 state/data 根（= daemon --state）
  --state <dir>          --data-root 的别名
  --cache-root <dir>     缓存根
  --logs-root <dir>      日志根
  --workspace-root <dir> 派生 worktree 根

退出码: 0 READY/成功, 1 DEGRADED, 2 BLOCKED/失败, 3 用法错误
`

const COMMON = { json: 'boolean', help: 'boolean', ...ROOT_OPTION_SPEC }

function versionInfo() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  return { name: 'pa', product: pkg.name, version: pkg.version, node: process.versions.node }
}

function printStatus(result) {
  const lines = [`status: ${result.status}`]
  if (result.instance) {
    lines.push(`  pid: ${result.instance.pid}`)
    lines.push(`  console: ${result.instance.consoleURL}`)
    lines.push(`  api: ${result.instance.apiURL}`)
    lines.push(`  mode: ${result.instance.mode} access: ${result.instance.access}`)
    lines.push(`  build: ${result.instance.buildId}`)
    lines.push(`  startup: ${result.instance.startupMode ?? 'normal'}`)
    if ((result.instance.startupMode ?? 'normal') === 'recovery_readonly') {
      lines.push('  recovery: 只读（仅历史/诊断；重绑定/重验与执行授权由 main 完成）')
      if (result.recovery) lines.push(`  pending rebind: ${result.recovery.pendingRebind.length}；requires revalidation: ${result.recovery.requiresRevalidation.length}`)
    }
  }
  for (const check of result.checks ?? []) lines.push(`  ${check.id}: ${check.ok ? 'PASS' : 'FAIL'}`)
  lines.push(`  install: ${result.installRoot}`)
  lines.push(`  state: ${result.roots.data}`)
  return lines.join('\n')
}

function commandSpecs() {
  return {
    help: {},
    version: { json: 'boolean' },
    build: { ...COMMON, output: 'string', 'release-output': 'string', 'skip-packages': 'boolean', 'skip-console': 'boolean' },
    stage: { ...COMMON, output: 'string', 'skip-packages': 'boolean', 'skip-console': 'boolean' },
    'first-run': { ...COMMON, 'adopt-release': 'boolean' },
    status: COMMON,
    doctor: { ...COMMON, deep: 'boolean', 'executors-fixture': 'string' },
    support: { ...COMMON, out: 'string' },
    'recovery-status': { ...COMMON },
    'recovery-inspect': { ...COMMON },
    'recovery-prepare': { ...COMMON, 'source-project': 'string', path: 'string', check: 'string', 'display-name': 'string' },
    start: {
      ...COMMON,
      port: 'string',
      'api-port': 'string',
      fixture: 'boolean',
      'discussion-only': 'boolean',
      'review-restored-scope': 'string',
      'require-login': 'boolean',
      open: 'boolean',
      'no-build': 'boolean',
    },
    'review-restored': { ...COMMON, state: 'string', project: 'string', 'allow-path': 'list', 'exclude-path': 'list', out: 'string' },
    stop: { ...COMMON, timeout: 'string' },
    backup: { ...COMMON, out: 'string', label: 'string' },
    'verify-backup': { ...COMMON, bundle: 'string' },
    'import-bundle': { ...COMMON, bundle: 'string' },
    restore: { ...COMMON, bundle: 'string', to: 'string', 'map-path': 'list' },
    rollback: { ...COMMON, bundle: 'string', target: 'string', last: 'boolean' },
    upgrade: { ...COMMON, to: 'string', backup: 'string', 'no-backup': 'boolean', 'no-stop': 'boolean', recover: 'boolean', force: 'boolean', mode: 'string', access: 'string' },
    'upgrade-status': { ...COMMON },
    'rollback-install': { ...COMMON, 'no-stop': 'boolean' },
    'recovery-activation-check': { ...COMMON, intent: 'string', 'target-root': 'string', audit: 'string' },
    smoke: { ...COMMON },
  }
}

async function main(argv) {
  const [command = 'help', ...rest] = argv
  const spec = commandSpecs()[command]
  if (spec === undefined) {
    process.stderr.write(`未知命令 ${command}\n\n${HELP}`)
    return EXIT.USAGE
  }
  const { values } = parseArgs(rest, spec)
  if (values.help === true) {
    printResult({ human: HELP })
    return EXIT.OK
  }
  const json = values.json === true
  if (command === 'help') {
    printResult({ human: HELP })
    return EXIT.OK
  }
  if (command === 'version') {
    printResult({ json: json ? versionInfo() : null, human: `${versionInfo().name} ${versionInfo().version} (node ${process.versions.node})` })
    return EXIT.OK
  }

  const { installRoot, roots } = resolveContext(values)

  if (command === 'build') {
    const args = [BUILD_SCRIPT, '--install-root', installRoot, '--config-root', roots.config]
    if (values.output !== undefined) args.push('--output', values.output)
    if (values['release-output'] !== undefined) args.push('--release-output', values['release-output'])
    if (values['skip-packages'] === true) args.push('--skip-packages')
    if (values['skip-console'] === true) args.push('--skip-console')
    if (json) args.push('--json')
    const child = spawnSync(process.execPath, args, { cwd: installRoot, stdio: 'inherit' })
    return child.status ?? EXIT.BLOCKED
  }

  if (command === 'stage') {
    if (values.output === undefined) return fail({ json, code: 'usage', message: 'stage 需要 --output <新的安装目录>', exitCode: EXIT.USAGE })
    const args = [BUILD_SCRIPT, '--install-root', installRoot, '--config-root', roots.config, '--output', values.output]
    if (values['skip-packages'] === true) args.push('--skip-packages')
    if (values['skip-console'] === true) args.push('--skip-console')
    if (json) args.push('--json')
    const child = spawnSync(process.execPath, args, { cwd: installRoot, stdio: 'inherit' })
    return child.status ?? EXIT.BLOCKED
  }

  if (command === 'first-run') {
    const result = await firstRun({ installRoot, roots, json, adoptExisting: values['adopt-release'] === true })
    if (result.status === 'BLOCKED') {
      printResult({
        json: json ? result : null,
        human: [`first-run: BLOCKED ${result.code}: ${result.message}`, `  ${JSON.stringify(result.detail ?? {})}`, `  hint: ${result.hint}`].join('\n'),
      })
      return EXIT.BLOCKED
    }
    printResult({
      json: json ? result : null,
      human: [
        `first-run: ${result.status}`,
        `  config: ${result.configFile}`,
        `  release: ${result.release.buildId ?? 'none'} (${result.release.reason}, provenance ${result.release.provenance})`,
        ...(result.release.hint === undefined ? [] : [`  ! ${result.release.hint}`]),
        `  created roots: ${result.created.length ? result.created.join(', ') : 'none'}`,
        `  data: ${result.roots.data}`,
        `  executor: ${result.executor.available ? result.executor.version : 'not installed (native execution disabled)'}`,
        '下一步:',
        ...result.nextSteps.map((step) => `  ${step}`),
        '限制:',
        ...result.limitations.map((item) => `  - ${item}`),
      ].join('\n'),
    })
    return EXIT.OK
  }

  if (command === 'recovery-inspect') {
    try {
      const result = await recoveryInspect({ roots })
      const human = [
        `recovery-inspect: ${result.startupMode === 'recovery_readonly' ? 'RESTORED_READONLY' : 'NORMAL'}`,
        `  fingerprint: ${result.inspectionFingerprint === null ? 'unavailable' : `${result.inspectionFingerprint.slice(0, 16)}…`}`,
        `  schema: ${String(result.productSchema ?? 'unknown')} eventCursor: ${String(result.eventCursor ?? 'unknown')} marker: ${result.markerDigest === null ? 'none' : 'present'}`,
        `  held queue: waiting ${String(result.heldQueue?.waiting ?? 'unknown')} parked ${String(result.heldQueue?.parked ?? 'unknown')}`,
        `  projects: ${result.projects.map((project) => project.id).join(', ') || 'none'}; historical attempts: ${result.historicalAttempts.length}`,
        `  blockers: ${result.blockers.map((blocker) => String(blocker.code ?? blocker)).join(', ') || 'none'}`,
        `  authorization: ${result.authorization} commitAvailable: ${result.commitAvailable}`,
        ...result.limitations.map((line) => `  ! ${line}`),
      ].join('\n')
      printResult({ json: json ? result : null, human })
      return EXIT.OK
    } catch (error) {
      if (!(error instanceof RecoveryAuthorizationError)) throw error
      const body = { status: 'BLOCKED', code: error.code, message: error.message, detail: error.detail,
        hint: '恢复检查需要已运行且可核验的实例；不在这里伪造授权或启动业务。' }
      printResult({ json: json ? body : null, human: `recovery-inspect BLOCKED ${error.code}: ${error.message}` })
      return EXIT.BLOCKED
    }
  }

  if (command === 'recovery-prepare') {
    const sourceProject = values['source-project']
    const projectPath = values.path
    if (sourceProject === undefined || projectPath === undefined) {
      printResult({ json: json ? { status: 'BLOCKED', code: 'usage', message: 'recovery-prepare 需要 --source-project 与 --path' } : null,
        human: 'recovery-prepare 需要 --source-project <现有项目id> 与 --path <当前绝对 Git 根>；--check 默认 node_test。' })
      return EXIT.BLOCKED
    }
    const bindings = [{
      sourceProjectId: sourceProject,
      project: { path: resolve(projectPath), check: values.check ?? 'node_test', ...(values['display-name'] === undefined ? {} : { displayName: values['display-name'] }) },
    }]
    try {
      const plan = await recoveryPrepare({ roots, bindings })
      const human = [
        `recovery-prepare: ${plan.authorization} commitAvailable=${plan.commitAvailable}`,
        `  plan: ${String(plan.planId ?? 'unavailable')} expires: ${String(plan.expiresAt ?? 'unavailable')}`,
        `  bindings: ${plan.bindings.map((binding) => `${String(binding.sourceProjectId)}=>${String(binding.proposedProjectId ?? binding.projectId ?? '?')}`).join(', ') || 'none'}`,
        `  blockers: ${plan.blockers.map((blocker) => String(blocker.code ?? blocker)).join(', ') || 'none'}`,
        '  commit: BLOCKED (main recovery authorization is not implemented)',
        ...RECOVERY_COMMIT_REQUIREMENTS.requiredInputs.map((line) => `  ? ${line}`),
        ...plan.limitations.map((line) => `  ! ${line}`),
      ].join('\n')
      printResult({ json: json ? { ...plan, commitRequirements: RECOVERY_COMMIT_REQUIREMENTS } : null, human })
      return EXIT.DEGRADED
    } catch (error) {
      if (!(error instanceof RecoveryAuthorizationError)) throw error
      const body = { status: 'BLOCKED', code: error.code, message: error.message, detail: error.detail, commitRequirements: RECOVERY_COMMIT_REQUIREMENTS,
        hint: '只读预检失败不改变恢复状态；不删除 marker、不重放旧队列、不切回 normal。' }
      printResult({ json: json ? body : null, human: `recovery-prepare BLOCKED ${error.code}: ${error.message}` })
      return EXIT.BLOCKED
    }
  }

  if (command === 'recovery-status') {
    const status = recoveryStatus({ roots })
    const human = [
      `recovery-status: ${status.markerPresent ? 'RESTORED_READONLY' : 'NORMAL'}`,
      `  state: ${status.stateName} startupMode: ${status.startupMode} markerPresent: ${status.markerPresent} markerValid: ${status.markerValid}`,
      `  pending rebind: ${status.pendingRebind.length}; requires revalidation: ${status.requiresRevalidation.length}; queueReplay: ${status.queueReplay}`,
      `  authorization: ${status.authorization.status}${status.authorization.owner ? ` (owner: ${status.authorization.owner})` : ''}`,
      ...status.authorization.requiredInputs?.map((line) => `    - ${line}` ) ?? [],
      ...status.limitations.map((line) => `  ! ${line}`),
    ].join('\n')
    printResult({ json: json ? status : null, human })
    return status.markerPresent ? EXIT.DEGRADED : EXIT.OK
  }

  if (command === 'recovery-activation-check') {
    if (values.intent === undefined || values['target-root'] === undefined) {
      printResult({ human: 'recovery-activation-check 需要 --intent <main intent json> --target-root <新执行 state>' })
      return EXIT.USAGE
    }
    const intentPath = resolve(values.intent)
    const targetRoot = resolve(values['target-root'])
    let intent
    try {
      intent = JSON.parse(readFileSync(intentPath, 'utf8'))
    } catch (error) {
      printResult({ json: json ? { status: 'BLOCKED', code: 'intent_unreadable', message: String(error?.message ?? error) } : null, human: `recovery-activation-check: BLOCKED intent_unreadable` })
      return EXIT.BLOCKED
    }
    // Local observations only. The source is inspected read-only if this state is a restored instance.
    let inspected = null
    try {
      inspected = await recoveryInspect({ roots })
    } catch {
      inspected = null
    }
    // Read-only: a not-yet-prepared target has no database at all, and this check must not create one.
    let targetCounts = { projects: 0, works: 0, decisions: 0, artifacts: 0, acceptedEvents: 0 }
    const targetConfigDigest = null
    const targetState = join(targetRoot, 'state.sqlite')
    if (existsSync(targetState)) {
      try {
        const summary = readEvidenceSummary(targetState)
        targetCounts = {
          projects: summary.counts.projects, works: summary.counts.works, decisions: summary.counts.decisions,
          artifacts: summary.counts.artifacts, acceptedEvents: summary.counts.acceptedEvents,
        }
      } catch {
        // Unreadable/incomplete target stays at zero counts and is still blocked by main's commit.
      }
    }
    const facts = {
      markerDigest: inspected?.markerDigest ?? null,
      inspectionFingerprint: inspected?.inspectionFingerprint ?? null,
      sourceStartupMode: inspected?.startupMode ?? null,
      sourceHeldQueueUnchanged: inspected !== null,
      machineDigest: currentMachineDigest(),
      resourcePolicyDigest: LOCAL_RESOURCE_POLICY_DIGEST,
      targetBusinessCounts: targetCounts,
      targetInstanceRecord: existsSync(join(targetRoot, 'instance.json')),
      targetCredentialFiles: 0,
      targetNativeSessions: 0,
      targetActivationRecords: 0,
      targetConfigurationDigest: targetConfigDigest,
      previousActivations: [],
      committedSourceIntent: false,
      mainCommitStatus: 'main_commit_route_unpublished',
    }
    let auditResult = null
    if (values.audit !== undefined) {
      try { auditResult = evaluateActivationAudit({ audit: JSON.parse(readFileSync(resolve(values.audit), 'utf8')), activationId: intent?.activationId ?? null })
      } catch { auditResult = evaluateActivationAudit({ audit: null }) }
    }
    const local = evaluateActivation({ intent, facts })
    const result = {
      ...local,
      ...(auditResult === null ? {} : { audit: auditResult }),
      ...(auditResult === null || auditResult.status === 'CONSISTENT_NOT_GRANTED' ? {} : { status: 'BLOCKED', code: auditResult.code }),
      consumptionRequirements: ACTIVATION_CONSUMPTION_REQUIREMENTS,
    }
    printResult({
      json: json ? result : null,
      human: [
        `recovery-activation-check: ${result.status}${result.code === null ? '' : ` (${result.code})`}`,
        `  authorization: ${result.authorization}  commitAvailable: ${String(result.commitAvailable)}`,
        `  failures: ${result.failures.length === 0 ? 'none' : result.failures.join(', ')}`,
        `  owner: ${result.owner}`,
        '  该检查只读取本机事实；main 的提交事实/回执未发布前不会启动任何新执行 state。',
      ].join('\n'),
    })
    return EXIT.BLOCKED
  }

  if (command === 'support') {
    try {
      const result = writeSupportBundle({ roots, out: values.out })
      printResult({
        json: json ? { status: 'CREATED', path: result.path, digest: result.digest, redaction: result.bundle.redaction } : null,
        human: `support: CREATED\n  path: ${result.path}\n  digest: ${result.digest}\n  redacted: conversation/reply/prompt/keys/native sessions/nonces/account dirs/argv/absolute roots`,
      })
      return 0
    } catch (error) {
      printResult({ json: json ? { status: 'BLOCKED', code: error.code ?? 'support_failed', message: error.message } : null, human: `support: BLOCKED ${error.message}` })
      return 2
    }
  }

  if (command === 'doctor') {
    const result = await runDoctor({
      installRoot,
      roots,
      deep: values.deep === true,
      executorsFixture: values['executors-fixture'] === undefined ? null : resolve(values['executors-fixture']),
    })
    const human = [
      `doctor: ${result.status}`,
      ...result.checks.map((check) => {
        const detail = check.detail === undefined ? '' : ` ${JSON.stringify(check.detail)}`
        return `  [${check.status}] ${check.id}${detail}`
      }),
    ].join('\n')
    printResult({ json: json ? result : null, human })
    return result.exitCode
  }

  if (command === 'status') {
    const record = readInstanceRecord(roots.config)
    if (record === null) {
      printResult({
        json: json ? { status: 'STOPPED', installRoot, roots } : null,
        human: `status: STOPPED\n  install: ${installRoot}\n  state: ${roots.data}\n  hint: pa start`,
      })
      return 2
    }
    const scope = requestedScopeCheck({ roots, record })
    if (!scope.ok) {
      printResult({
        json: json ? { status: 'BLOCKED', code: 'requested_root_mismatch', detail: scope, installRoot, roots } : null,
        human: `status: BLOCKED\n  code: requested_root_mismatch\n  requested: ${JSON.stringify(scope.requested)}\n  recorded: ${JSON.stringify(scope.recorded)}\n  hint: use the record's roots; nothing was stopped`,
      })
      return 2
    }
    const verification = await verifyInstance(record)
    if (verification.ok) {
      const recovery = recoverySummary(record.state)
      const result = { status: 'RUNNING', instance: record, checks: verification.checks, recovery, installRoot, roots }
      printResult({ json: json ? result : null, human: printStatus(result) })
      return EXIT.OK
    }
    const result = { status: 'UNVERIFIED', instance: record, checks: verification.checks, failures: verification.failures, installRoot, roots }
    printResult({ json: json ? result : null, human: `${printStatus(result)}\n  hint: run pa doctor; stop refuses to kill an unverified process` })
    return EXIT.DEGRADED
  }

  if (command === 'review-restored') {
    const result = prepareReview({
      state: values.state, project: values.project, allowPaths: values['allow-path'],
      excludePaths: values['exclude-path'], out: values.out,
    })
    if (!result.ok) {
      printResult({ json: json ? { status: 'BLOCKED', code: result.code, message: result.message, detail: result.detail ?? {} } : null,
        human: `review-restored: BLOCKED ${result.code}: ${result.message}` })
      return EXIT.BLOCKED
    }
    printResult({ json: json ? result : null, human: [
      `review-restored: ${result.status}`,
      `  output: ${result.output}`,
      `  projects: ${result.projects.join(', ')} expiresAt: ${result.expiresAt}`,
      `  access: ${result.access} startupAvailable: ${String(result.startupAvailable)} protocol: ${result.protocol}`,
      '  只读启动选择，不是授权；用 `pa start --discussion-only --review-restored-scope <output>` 显式消费。',
    ].join('\n') })
    return EXIT.OK
  }

  if (command === 'start') {
    const result = await startInstance({ installRoot, roots, values, log: json ? () => {} : (line) => process.stdout.write(`${line}\n`) })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail, hint: result.hint })
    if (result.reused) {
      const recovery = recoverySummary(result.record.state)
      const human = [
        `Workbench: ${result.record.consoleURL}`,
        `  mode: ${result.record.mode} access: ${result.record.access} startup: ${result.record.startupMode ?? 'normal'}`,
        `  state: ${result.record.state}`,
        ...(recovery.startupMode === 'recovery_readonly'
          ? [`  ⚠ ${recovery.warning}`, `  pending rebind: ${recovery.pendingRebind.length}；requires revalidation: ${recovery.requiresRevalidation.length}`]
          : []),
      ].join('\n')
      printResult({ json: json ? { status: 'REUSED', instance: result.record, recovery } : null, human })
      return EXIT.OK
    }
    const { record } = result
    if (json) process.stdout.write(`${JSON.stringify({ status: 'RUNNING', instance: record, recovery: result.recovery, log: result.daemon.logPath })}\n`)
    else {
      process.stdout.write(`Workbench: ${record.consoleURL}\n`)
      process.stdout.write(`  api: ${record.apiURL}\n  mode: ${record.mode} access: ${record.access} startup: ${record.startupMode}\n  state: ${record.state}\n  build: ${record.buildId}\n`)
      if (record.access === 'token') process.stdout.write(`  登录令牌文件: ${join(roots.data, 'bootstrap.key')}\n`)
      if (record.startupMode === 'recovery_readonly' && result.recovery) {
        process.stdout.write(`  ⚠ ${result.recovery.warning}\n`)
        process.stdout.write(`  pending rebind: ${result.recovery.pendingRebind.length}；requires revalidation: ${result.recovery.requiresRevalidation.length}\n`)
        process.stdout.write('  业务动作已禁用；重新绑定/重新验证与新执行授权由 main 的恢复授权完成，本启动器不提供绕过开关。\n')
      }
    }
    if (values.open === true && process.platform === 'darwin') {
      spawnSync('open', [record.consoleURL], { stdio: 'ignore' })
    }
    const exitCode = await result.wait
    // Owned daemon and static server are closed by now; exit explicitly so no idle handle delays
    // a clean stop. A failed shutdown already reports DEGRADED and never claims success.
    process.exit(exitCode)
  }

  if (command === 'stop') {
    const timeoutMs = intOption(values, 'timeout', { min: 1000, max: 60000, fallback: 8000 })
    const result = await stopInstance({ roots, timeoutMs })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail, hint: result.hint, exitCode: EXIT.DEGRADED })
    printResult({
      json: json ? result : null,
      human: `stop: ${result.status}${result.message ? ` — ${result.message}` : ''}`,
    })
    return EXIT.OK
  }

  if (command === 'upgrade') {
    try {
      if (values.recover === true) {
        const result = await recoverSwitch({ installRoot, roots, values })
        printResult({
          json: json ? result : null,
          human: [`upgrade --recover: ${result.status}`, ...(result.code ? [`  code: ${result.code}`, `  ${result.message ?? ''}`] : []), ...(result.started ? [`  pid: ${result.started.pid}`, `  api: ${result.started.apiURL}`] : []), ...(result.reason ? [`  reason: ${result.reason}`] : [])].join('\n'),
        })
        // A settled recovery is a success, whichever terminal state it reached. Refusals are BLOCKED
        // with exit 2 so scripts never treat an unsettled/blocked recovery as success.
        const settled = ['NO_OP', 'RECOVERED', 'RECOVERED_PREVIOUS', 'REVERTED', 'CONFIRMED']
        if (settled.includes(result.status)) return EXIT.OK
        return result.status === 'BLOCKED' ? EXIT.BLOCKED : EXIT.DEGRADED
      }
      const result = await upgradeInstall({ installRoot, roots, values })
      printResult({
        json: json ? result : null,
        human: [
          `upgrade: ${result.status}`,
          `  from: ${result.plan.from.buildId ?? 'none'} (schema ${result.plan.from.schema ?? 'unknown'})`,
          `  to:   ${result.plan.to.buildId} (schema ${result.plan.to.schema ?? 'unknown'})`,
          `  instance: ${result.started.apiURL} pid ${result.started.pid}`,
          `  backup: ${result.backup === null ? 'skipped (explicit --no-backup)' : result.backup.path}`,
          `  data: ${result.plan.to.schema !== result.plan.from.schema ? 'schema changed by the target on first start; not rolled back' : 'unchanged schema; post-upgrade records remain in place'}`,
          `  journal: ${result.journalPath}`,
        ].join('\n'),
      })
      return EXIT.OK
    } catch (error) {
      if (!(error instanceof UpgradeError)) throw error
      printResult({
        json: json ? { status: 'BLOCKED', code: error.code, message: error.message, detail: error.detail } : null,
        human: [`upgrade: BLOCKED ${error.code}: ${error.message}`, `  ${JSON.stringify(error.detail ?? {})}`].join('\n'),
      })
      return EXIT.BLOCKED
    }
  }

  if (command === 'upgrade-status') {
    const journal = readJournal(roots.config)
    const target = (() => {
      try {
        return values.to === undefined ? null : inspectTargetInstall(values.to).release.buildId
      } catch (error) {
        return error.code ?? 'target_invalid'
      }
    })()
    const result = journal === null
      ? { status: 'NONE', configRoot: roots.config }
      : { status: journal.status, configRoot: roots.config, from: journal.from, to: journal.to, switchedAt: journal.switchedAt, confirmedAt: journal.confirmedAt ?? null, backup: journal.backup ?? null, dataRolledBack: journal.dataRolledBack === true, previousReleasePath: journal.previousReleasePath ?? null, ...(target === null ? {} : { targetCheck: target }) }
    printResult({
      json: json ? result : null,
      human: [
        `upgrade-status: ${result.status}`,
        ...(result.from ? [`  from: ${result.from.buildId} (schema ${result.from.schema})`, `  to:   ${result.to.buildId} (schema ${result.to.schema})`] : []),
        ...(result.backup ? [`  backup: ${result.backup.path}`] : []),
        ...(result.dataRolledBack ? ['  data rolled back: yes'] : ['  data rolled back: no']),
      ].join('\n'),
    })
    return journal === null ? EXIT.DEGRADED : EXIT.OK
  }

  if (command === 'rollback-install') {
    try {
      const result = await rollbackInstall({ installRoot, roots, values })
      printResult({
        json: json ? result : null,
        human: [
          `rollback-install: ${result.status}`,
          `  from: ${result.from ?? 'unknown'} -> ${result.to ?? 'unknown'}`,
          '  仅切换二进制指针；不恢复备份、不降 schema、不删除升级后数据。',
          `  ${result.note}`,
        ].join('\n'),
      })
      return EXIT.OK
    } catch (error) {
      if (!(error instanceof UpgradeError)) throw error
      printResult({
        json: json ? { status: 'BLOCKED', code: error.code, message: error.message, detail: error.detail } : null,
        human: [`rollback-install: BLOCKED ${error.code}: ${error.message}`].join('\n'),
      })
      return EXIT.BLOCKED
    }
  }

  if (command === 'backup') {
    const result = await backupState({ installRoot, roots, values })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail, hint: result.hint })
    printResult({
      json: json ? result : null,
      human: [
        `backup: ${result.status}`,
        `  bundle: ${result.bundlePath}`,
        `  sha256: ${result.archiveSha256}`,
        `  entries: ${result.counts.entries} (artifacts ${result.counts.artifacts}, excluded ${result.counts.excluded})`,
        `  database: integrity=${result.database.integrity} foreignKeyViolations=${result.database.foreignKeyViolations}`,
        '限制:',
        ...result.limitations.map((item) => `  - ${item}`),
      ].join('\n'),
    })
    return EXIT.OK
  }

  if (command === 'verify-backup') {
    const result = await verifyBackup({ roots, values })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail })
    printResult({
      json: json ? result : null,
      human: [
        `verify-backup: ${result.status}`,
        `  bundle: ${result.bundlePath}`,
        `  manifest: ${result.manifestDigest}`,
        `  producer: ${result.producer.product} ${result.producer.version} (${result.producer.platform}/${result.producer.arch}, node ${result.producer.node}, sqlite ${result.producer.sqlite})`,
        `  entries: ${result.counts.entries} (artifacts ${result.counts.artifacts})`,
        `  database: integrity=${result.database.integrity} foreignKeyViolations=${result.database.foreignKeyViolations} schema=${result.database.productSchema}`,
      ].join('\n'),
    })
    return EXIT.OK
  }

  if (command === 'import-bundle') {
    const result = await importBundle({ roots, values })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail })
    printResult({
      json: json ? result : null,
      human: [
        `import-bundle: ${result.status}`,
        `  bundle: ${result.bundlePath}`,
        `  sha256: ${result.archiveSha256}`,
        `  entries: ${result.counts.entries} (artifacts ${result.counts.artifacts})`,
      ].join('\n'),
    })
    return EXIT.OK
  }

  if (command === 'restore') {
    const result = await restoreState({ roots, values })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail, hint: result.hint })
    printResult({
      json: json ? result : null,
      human: [
        `restore: ${result.status}`,
        `  target: ${result.target}`,
        `  report: ${result.reportPath}`,
        `  entries: ${result.report.entries.count} (source state ${result.report.bundle.sourceStateName})`,
        `  database: integrity=${result.report.database.integrity} schema=${result.report.database.productSchema}`,
        `  pending rebind: ${result.report.pathMappings.pendingRebind.length}`,
        '下一步:',
        ...result.nextSteps.map((line) => `  ${line}`),
      ].join('\n'),
    })
    return EXIT.OK
  }

  if (command === 'rollback') {
    const result = await rollbackState({ roots, values })
    if (!result.ok) return fail({ json, code: result.code, message: result.message, detail: result.detail, hint: result.hint })
    printResult({
      json: json ? result : null,
      human: [
        `rollback: ${result.status}`,
        `  target: ${result.target}`,
        `  failed state kept at: ${result.failedDir}`,
        `  report: ${result.reportPath}`,
        ...result.notes.map((line) => `  - ${line}`),
      ].join('\n'),
    })
    return EXIT.OK
  }

  // Later stages wire the remaining commands; keep the failure explicit in the checkpoint.
  const release = readRelease(roots.config)
  return fail({
    json,
    code: 'not_implemented',
    message: `命令 ${command} 尚未在本检查点接线`,
    detail: { config: readLauncherConfig(roots.config) !== null, release: release.release?.buildId ?? null },
    exitCode: EXIT.USAGE,
    hint: '本检查点只交付 first-run/build/doctor/status；后续阶段补齐 start/stop/backup/restore/rollback。',
  })
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${HELP}`)
      process.exitCode = EXIT.USAGE
    } else if (error instanceof PortabilityError) {
      process.stderr.write(`BLOCKED ${error.code}: ${error.message}\n`)
      if (Object.keys(error.detail).length) process.stderr.write(`  ${JSON.stringify(error.detail)}\n`)
      process.exitCode = EXIT.BLOCKED
    } else {
      process.stderr.write(`BLOCKED unexpected: ${error?.stack ?? error}\n`)
      process.exitCode = EXIT.BLOCKED
    }
  })
