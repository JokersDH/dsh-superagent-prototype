#!/usr/bin/env node
/**
 * `pa` — thin launcher for one personal install. Product commands, questions and completion stay in
 * the existing coordinator API; this CLI only manages private roots, build admission, the local
 * static console/proxy, process identity, diagnosis and backup/restore entrypoints.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PortabilityError } from '@personal-agent/portability'
import { EXIT, UsageError, fail, intOption, parseArgs, printResult } from '../lib/cli.mjs'
import { resolveContext, ROOT_OPTION_SPEC } from '../lib/context.mjs'
import { readLauncherConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { firstRun } from '../lib/first-run.mjs'
import { readInstanceRecord, verifyInstance } from '../lib/instance.mjs'
import { recoverySummary } from '../lib/recovery.mjs'
import { readRelease } from '../lib/release.mjs'
import { backupState, verifyBackup } from '../lib/backup.mjs'
import { importBundle, restoreState, rollbackState } from '../lib/restore.mjs'
import { startInstance } from '../lib/start.mjs'
import { stopInstance } from '../lib/stop.mjs'

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
  doctor                 只读诊断 Node/ABI/SQLite/构建/根目录/实例/执行器
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
    'first-run': COMMON,
    status: COMMON,
    doctor: { ...COMMON, deep: 'boolean', 'executors-fixture': 'string' },
    start: {
      ...COMMON,
      port: 'string',
      'api-port': 'string',
      fixture: 'boolean',
      'require-login': 'boolean',
      open: 'boolean',
      'no-build': 'boolean',
    },
    stop: { ...COMMON, timeout: 'string' },
    backup: { ...COMMON, out: 'string', label: 'string' },
    'verify-backup': { ...COMMON, bundle: 'string' },
    'import-bundle': { ...COMMON, bundle: 'string' },
    restore: { ...COMMON, bundle: 'string', to: 'string', 'map-path': 'list' },
    rollback: { ...COMMON, bundle: 'string', target: 'string', last: 'boolean' },
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
    const result = await firstRun({ installRoot, roots, json })
    printResult({
      json: json ? result : null,
      human: [
        `first-run: ${result.status}`,
        `  config: ${result.configFile}`,
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
