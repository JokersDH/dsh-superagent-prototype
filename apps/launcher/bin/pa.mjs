#!/usr/bin/env node
/**
 * `pa` — thin launcher for one personal install. Product commands, questions and completion stay in
 * the existing coordinator API; this CLI only manages private roots, build admission, the local
 * static console/proxy, process identity, diagnosis and backup/restore entrypoints.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PortabilityError } from '@personal-agent/portability'
import { EXIT, UsageError, fail, intOption, parseArgs, printResult } from '../lib/cli.mjs'
import { resolveContext, ROOT_OPTION_SPEC } from '../lib/context.mjs'
import { readLauncherConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { firstRun } from '../lib/first-run.mjs'
import { readInstanceRecord, verifyInstance } from '../lib/instance.mjs'
import { readRelease } from '../lib/release.mjs'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const BUILD_SCRIPT = join(repoRoot, 'tools/distribution/build.mjs')
const SMOKE_SCRIPT = join(repoRoot, 'tools/distribution/smoke.mjs')

const HELP = `pa — 本机个人 Agent 助理启动器

用法: pa <command> [options]

命令:
  first-run              创建私有根目录、记录非秘密本机配置、只读探测执行器
  build                  构建 console 静态产物与运行时包 dist，写 release manifest
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
    build: { ...COMMON, output: 'string' },
    'first-run': COMMON,
    status: COMMON,
    doctor: { ...COMMON, deep: 'boolean' },
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
    backup: { ...COMMON, out: 'string', label: 'string', 'include-project-content': 'boolean' },
    'verify-backup': { ...COMMON, bundle: 'string' },
    'import-bundle': { ...COMMON, bundle: 'string' },
    restore: { ...COMMON, bundle: 'string', 'map-path': 'list' },
    rollback: { ...COMMON, bundle: 'string', last: 'boolean' },
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
    const result = await runDoctor({ installRoot, roots, deep: values.deep === true })
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
      const result = { status: 'RUNNING', instance: record, checks: verification.checks, installRoot, roots }
      printResult({ json: json ? result : null, human: printStatus(result) })
      return EXIT.OK
    }
    const result = { status: 'UNVERIFIED', instance: record, checks: verification.checks, failures: verification.failures, installRoot, roots }
    printResult({ json: json ? result : null, human: `${printStatus(result)}\n  hint: run pa doctor; stop refuses to kill an unverified process` })
    return EXIT.DEGRADED
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
