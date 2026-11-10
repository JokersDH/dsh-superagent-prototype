import { execFile } from 'node:child_process'
import { closeSync, openSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { instanceState, probeInstance } from './local-instance.mjs'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const result = (id, status, code, detail, action) => ({ id, status, code, detail, ...(action ? { action } : {}) })
const guidance = {
  state_missing: '尚无启动记录，请运行 pnpm start。',
  unsafe_state_directory: '状态目录需由当前用户拥有，权限为 700；请核对配置的目录。',
  unsafe_state_file: '状态文件权限或类型异常，请核对原文件；诊断不会修改它。',
  process_identity_unproven: '记录的进程已退出或无法核对，请检查启动终端与端口占用。',
  process_identity_mismatch: '启动记录与实际进程不符，请核对所选 state；不要按记录中的 PID 直接结束进程。',
  instance_mode_mismatch: '状态记录与实际服务模式不符，请核对启动方式。',
  authentication_failed: '当前服务不接受所选 state 的凭据，请核对服务和状态目录。',
  api_unavailable: '本机接口不可用，请查看启动终端输出。',
  api_timeout: '本机接口超时，请核对服务状态。',
}

async function version(executable, pattern) {
  try {
    const { stdout } = await execute(executable, ['--version'], {
      timeout: 3000, maxBuffer: 8192, encoding: 'utf8',
      env: { ...process.env, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0' },
    })
    return stdout.trim().match(pattern)?.[0]
  } catch { return undefined }
}

export async function diagnose({ repositoryRoot = root, state } = {}) {
  const checks = []
  const [major, minor] = process.versions.node.split('.').map(Number)
  const nodeReady = major === 24 && minor >= 21
  checks.push(result('node', nodeReady ? 'PASS' : 'BLOCKED', nodeReady ? 'supported_node' : 'unsupported_node',
    process.version, nodeReady ? undefined : '产品当前要求 Node >=24.21.0 <25。'))
  const [pnpm, codex] = await Promise.all([version('pnpm', /^\d+\.\d+\.\d+$/), version('codex', /^codex-cli \d+\.\d+\.\d+/)])
  checks.push(result('package-manager', pnpm === '11.7.0' ? 'PASS' : 'BLOCKED', pnpm === '11.7.0' ? 'pinned_pnpm' : 'pnpm_unavailable_or_mismatch',
    pnpm ?? '未确认版本', pnpm === '11.7.0' ? undefined : '使用项目声明的 pnpm 11.7.0；诊断不会下载或升级。'))
  checks.push(result('codex', codex ? 'PASS' : 'NOT_TESTED', codex ? 'cli_version_observed' : 'cli_version_unavailable',
    codex ?? '未确认版本', codex ? undefined : '确认本机 Codex 可用；此项不读取认证，也不启动模型。'))
  let contracts
  try { contracts = await import(pathToFileURL(resolve(repositoryRoot, 'packages/contracts/dist/index.js'))) }
  catch {
    checks.push(result('instance', 'BLOCKED', 'contracts_unbuilt', '共享契约尚未构建。', '运行 pnpm start 完成启动构建。'))
  }
  if (contracts) {
    try {
      const instance = await probeInstance({
        root: repositoryRoot, state: instanceState(repositoryRoot, state),
        parseConfiguration: (value) => contracts.ApplicationConfigurationSchema.parse(value),
      })
      checks.push(result('instance', 'PASS', 'owned_instance_verified',
        `${instance.health.mode} · ${instance.record.consoleURL}`, instance.identity.legacy ? '旧启动记录已通过实际进程、监听端口与私有接口核对；下次正常启动会更新记录格式。' : undefined))
      const config = instance.configuration
      const enabled = config.profiles.filter((profile) => profile.kind === 'native' && profile.dispatchAllowed)
      checks.push(result('native-admission', enabled.length ? 'PASS' : instance.health.mode === 'fixture' ? 'NOT_TESTED' : 'BLOCKED',
        enabled.length ? 'native_dispatch_admitted' : 'native_not_admitted',
        enabled.length ? `${enabled.length} 个原生执行器已准入` : '当前实例没有可派工的原生执行器。',
        enabled.length ? undefined : '固定流程通过不代表原生接入通过；请核对原生兼容和执行器配置。'))
      const ready = config.projects.filter((project) => project.dispatchAllowed && project.profileIds.some((id) => config.profiles.some((profile) => profile.id === id && profile.dispatchAllowed)))
      checks.push(result('projects', ready.length ? 'PASS' : 'BLOCKED', ready.length ? 'projects_available' : 'no_dispatchable_project',
        `${ready.length}/${config.projects.length} 个项目可派工`, ready.length ? undefined : '从工作台导入已有提交且干净的本地 Git 项目。'))
      const snapshot = contracts.SnapshotSchema.parse(await instance.read('/v1/snapshot'))
      const uncertain = snapshot.works.filter((work) => work.resourceStatus === 'indeterminate')
      checks.push(result('recovery', uncertain.length ? 'BLOCKED' : 'PASS', uncertain.length ? 'writer_indeterminate' : 'no_indeterminate_writer_in_snapshot',
        `${snapshot.works.length} 项工作中，${uncertain.length} 项资源状态待核对`,
        uncertain.length ? '打开对应工作查看恢复证据；物理资源未确认前不要重复委托。' : undefined))
      const environments = await Promise.all(snapshot.works.slice(0, 10).map(async work => {
        try {
          const value = contracts.WorkEnvironmentSchema.parse(await instance.read(`/v1/works/${encodeURIComponent(work.work.id)}/environment`))
          return value.workId === work.work.id ? value : undefined
        } catch { return undefined }
      }))
      const configured = environments.filter(value => value && value.status !== 'not_configured')
      const blocked = configured.filter(value => value.status === 'blocked')
      const readyCount = configured.filter(value => value.status === 'ready').length
      checks.push(result('environment', blocked.length ? 'BLOCKED' : readyCount ? 'PASS' : 'NOT_TESTED',
        blocked.length ? 'environment_blocked' : readyCount ? 'prepared_environment_verified' : 'prepared_environment_not_observed',
        configured.length ? `抽样工作中，${readyCount} 项环境已复验，${blocked.length} 项受阻` : '当前抽样工作没有可确认的依赖准备记录。',
        blocked.length ? '打开对应工作检查环境状态；依赖漂移或准备失败不能接受交付。' : undefined))
    } catch (error) {
      const code = error.code ?? 'invalid_product_response'
      checks.push(result('instance', 'BLOCKED', code, '无法完成当前实例核对。', guidance[code] ?? '核对启动终端、所选 state 和服务版本；诊断不会更改任何状态。'))
    }
  }
  return {
    protocol: 'personal-agent-diagnostics/1', checkedAt: new Date().toISOString(),
    status: checks.some((check) => check.status === 'BLOCKED') ? 'BLOCKED' : 'PASS_WITH_SCOPED_LIMITS',
    platform: `${process.platform}/${process.arch}`, checks,
    scope: 'Read-only local process/API/version observations; no model call, native authentication probe, install, repair or database access. Snapshot scope is at most the API page limit.',
  }
}

export function formatDiagnosis(report) {
  return [
    `Personal Agent: ${report.status}`,
    ...report.checks.flatMap((check) => [`[${check.status}] ${check.id}: ${check.detail}`, ...(check.action ? [`  ${check.action}`] : [])]),
  ].join('\n') + '\n'
}

async function main() {
  const { values } = parseArgs({ options: { state: { type: 'string' }, json: { type: 'boolean', default: false }, output: { type: 'string' }, help: { type: 'boolean', default: false } } })
  if (values.help) {
    console.log('pnpm doctor [--state <private-state>] [--json] [--output <new-report.json>]')
    return
  }
  const report = await diagnose({ state: values.state })
  const serialized = JSON.stringify(report, null, 2) + '\n'
  if (values.output) {
    const fd = openSync(resolve(values.output), 'wx', 0o600)
    try { writeFileSync(fd, serialized) } finally { closeSync(fd) }
  }
  process.stdout.write(values.json ? serialized : formatDiagnosis(report))
  if (report.status === 'BLOCKED') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('诊断未完成，请核对参数、状态目录或新报告的输出路径。')
    process.exitCode = 1
  })
}
