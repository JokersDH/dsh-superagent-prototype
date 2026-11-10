import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectWorkspace, nodeRangeSatisfied, versionsEqual } from './project.ts'
import { scanInstalledTree } from './installed.ts'
import { standaloneProcessPort } from './process.ts'
import { canonical, isDirectory, projectSnapshot, sha256 } from './paths.ts'
import type { EnvironmentProcessPort, PreparationPolicy } from './types.ts'

export interface EnvironmentInspectionInput {
  projectPath: string
  workspacePath: string
  policy?: PreparationPolicy
  storeDir?: string
  managerCommand?: string
  processPort?: EnvironmentProcessPort
  signal?: AbortSignal
}

export interface EnvironmentInspection {
  protocol: 'environment-inspection/1'
  status: 'ready_to_prepare' | 'blocked' | 'unknown'
  code: string
  message: string
  suggestions: readonly string[]
  project: { kind: 'single_package' | 'unsupported'; packageJsonDigest?: string }
  node: { declared?: string; actual: string; satisfied: boolean | 'unknown' }
  manager: { name: 'pnpm' | 'npm' | 'none'; declaredVersion?: string; actualVersion?: string; versionMatch: boolean | 'unknown' }
  lockFiles: readonly { name: string; digest: string }[]
  dependencies: { declared: number; installed: boolean | 'unknown'; drift: boolean | 'unknown' }
  capabilities: {
    existingOnly: boolean
    offlineInstall: boolean
    offlineStoreAuthorized: boolean | 'unknown'
    offlineCacheSufficient: 'unknown'
    projectHooksBlocked: boolean
  }
  /** Public, path-free diagnostics suitable for a UI/doctor. */
  diagnostics: readonly string[]
  /** Restricted evidence references (digests, not raw stderr or absolute user paths). */
  evidence: readonly { ref: string; summary: string }[]
  /** Snapshot digest used by tests/integration to prove inspection is read-only. */
  readOnlySnapshot: { project: string; workspace: string }
}

const suggestions: Record<string, readonly string[]> = {
  offline_store_missing: ['请为离线安装指定一个位于项目/工作区之外的授权 store 目录。', 'store 需要由授权操作者提前预热，模块不会联网安装。'],
  offline_cache_missing: ['离线缓存可能缺少依赖；请在授权环境中预热后重试。', '预检无法证明缓存充分，不会运行安装来探测。'],
  lock_mismatch: ['请把 lockfile 与 package.json 对齐后重新提交。'],
  project_hooks_unsupported: ['请移除 .pnpmfile.cjs/.npmrc/package.json#pnpm 等钩子配置，或使用显式支持的配置。'],
  unsafe_link: ['请修复指向工作区外的依赖符号链接。', '不要用链接到原项目 node_modules 的方式假装隔离。'],
  dependencies_missing: ['可以在 existing_only 下提供工作区内的 node_modules，或改用离线安装。'],
  environment_drift: ['依赖树已变化，请重新准备环境，不要复用旧凭证。'],
  invalid_engine_range: ['请把 engines.node 修正为有效的 semver 范围。'],
  node_version_mismatch: ['请切换到满足 engines.node 的 Node 版本或调整声明。'],
  manager_version_mismatch: ['请让 packageManager 与实际可离线执行的包管理器版本一致；模块不会自动升级。'],
  unsupported_workspace: ['当前为 monorepo/workspace 布局；单包预检暂不支持，可等待受限 workspace 模式。'],
  unsupported_manager: ['仅支持 pnpm/npm 单包；yarn/bun 需要单独适配。'],
  ambiguous_lock: ['请只保留一个 lockfile。'],
  network_dependency: ['请移除需要联网/git 的依赖，使用本地 tarball 或授权离线 store。'],
  workspace_environment_untrusted: ['请使用可信清理入口处理既有环境目录，不要伪造 marker。'],
  environment_state_untrusted: ['工作区 marker 没有签名收据支持；保留现场，使用可信凭证或由所有者处理。'],
  workspace_replaced: ['工作区目录已被替换；旧环境不得复用或清理，请重新准备。'],
  authority_root_required: ['生产准备需要项目/工作区之外的私有 authorityRoot；不能使用无凭证模式。'],
  authority_invalid: ['authorityRoot 必须存在、为当前用户私有目录且不在项目/工作区内。'],
  authority_unavailable: ['authorityRoot 不可读取或已被破坏；缺失收据不能恢复成 ready。'],
  receipt_missing: ['签收据已丢失；不能恢复为 ready，也不会自动删除环境。'],
  receipt_forged: ['收据签名/内容不匹配；按不可信处理并保留现场。'],
  receipt_mismatch: ['ref 与签名收据不一致；拒绝复用与清理。'],
  ownership_changed: ['归属目录已被替换或删除；拒绝复用与清理。'],
  cleanup_forbidden: ['归属 inode 已变化；不删除该目录。'],
  cleanup_unproven: ['无法证明进程或目录已停止/清理；不得当作完成。'],
  cancelled: ['准备已取消；仅清理本次拥有的状态。'],
  timeout: ['准备超时；检查进程组是否停止后重试。'],
  output_limit: ['输出超出合并字节预算；安装被终止。'],
  disk_limit: ['工作区超出磁盘预算；安装被终止。'],
  install_failed: ['离线安装失败；请查看受限诊断并修正输入。'],
  manager_missing: ['包管理器不可执行；不会联网安装或升级。'],
}
const suggest = (code: string) => suggestions[code] ?? ['请根据诊断修正项目配置后重试。']
const chinese = (code: string): string => {
  const messages: Record<string, string> = {
    ready: '项目可以准备；预检不安装依赖。',
    unknown: '无法证明离线缓存是否足够；未运行安装。',
    invalid_package_json: 'package.json 缺失或不是合法对象。',
    unsupported_workspace: '当前是 monorepo/workspace 布局，单包预检不支持。',
    unsupported_manager: '仅支持 pnpm/npm。',
    ambiguous_lock: '同时存在 pnpm 与 npm lockfile，无法安全选择。',
    manager_lock_mismatch: 'packageManager 与 lockfile 不匹配。',
    invalid_package_manager: 'packageManager 声明无效。',
    invalid_engine_range: 'engines.node 不是有效 semver 范围。',
    node_version_mismatch: '当前 Node 版本不满足 engines.node。',
    project_hooks_unsupported: '项目包含会执行代码或改变安装输出的钩子/配置。',
    unsafe_link: '依赖存在指向工作区外的符号链接。',
    broken_link: '依赖存在失效符号链接。',
    network_dependency: '存在需要联网或 git 的依赖。',
    dependencies_missing: '声明的依赖尚未安装。',
    offline_store_missing: '未提供授权离线 store。',
    invalid_store: 'store 路径不安全或无效。',
    environment_drift: '已安装依赖树与准备凭证不一致。',
  }
  return messages[code] ?? '存在阻塞项。'
}

/** Runtime validation for UI/doctor consumers; a hand-written parser for this package-local shape. */
export function parseEnvironmentInspection(value: unknown): EnvironmentInspection {
  if (!value || typeof value !== 'object') throw new Error('inspection must be an object')
  const v = value as Record<string, unknown>
  if (v.protocol !== 'environment-inspection/1') throw new Error('inspection protocol mismatch')
  if (!['ready_to_prepare', 'blocked', 'unknown'].includes(String(v.status))) throw new Error('inspection status invalid')
  if (typeof v.code !== 'string' || typeof v.message !== 'string') throw new Error('inspection code/message missing')
  if (!Array.isArray(v.suggestions) || !v.suggestions.every(item => typeof item === 'string')) throw new Error('inspection suggestions invalid')
  for (const field of ['project', 'node', 'manager', 'dependencies', 'capabilities', 'readOnlySnapshot']) {
    if (!v[field] || typeof v[field] !== 'object') throw new Error(`inspection ${field} missing`)
  }
  if (!Array.isArray(v.lockFiles) || !Array.isArray(v.diagnostics) || !Array.isArray(v.evidence)) throw new Error('inspection arrays invalid')
  return value as EnvironmentInspection
}

/** Read-only preflight: no marker/environment creation, install, git write or project-hook execution. */
export async function inspectEnvironment(input: EnvironmentInspectionInput): Promise<EnvironmentInspection> {
  if (!input || typeof input.projectPath !== 'string' || typeof input.workspacePath !== 'string'
    || !input.projectPath.startsWith('/') || !input.workspacePath.startsWith('/')
    || !isDirectory(input.projectPath) || !isDirectory(input.workspacePath))
    throw new Error('inspectEnvironment requires absolute existing project and workspace directories')
  const project = canonical(input.projectPath), workspace = canonical(input.workspacePath)
  const readOnlySnapshot = { project: projectSnapshot(project), workspace: projectSnapshot(workspace) }
  const diagnostics: string[] = []
  const evidence: { ref: string; summary: string }[] = []
  const policy = input.policy
  const inspection = inspectWorkspace(workspace)
  const scan = scanInstalledTree(workspace, inspection.dependencies)
  const engineRange = inspection.packageJson.engines?.node
  const engine = engineRange ? nodeRangeSatisfied(engineRange) : true
  const hookBlocked = inspection.unsupportedProjectFiles.length > 0
  const storeAuthorized = input.storeDir !== undefined && input.storeDir.startsWith('/') && isDirectory(input.storeDir)
  let actualVersion: string | undefined
  let versionMatch: boolean | 'unknown' = 'unknown'
  if (inspection.dependencies.length) {
    const command = input.managerCommand ?? (inspection.manager === 'none' ? undefined : inspection.manager)
    if (command) {
      const home = mkdtempSync(join(tmpdir(), 'pa-env-inspect-'))
      try {
        const result = await (input.processPort ?? standaloneProcessPort).run(command, ['--version'], {
          cwd: workspace, env: { PATH: process.env.PATH ?? '', HOME: home },
          timeoutMs: 10_000, maxOutputBytes: 8192, ...(input.signal ? { signal: input.signal } : {}),
        })
        if (result.code === 0 && result.quiescence === 'confirmed') {
          actualVersion = result.stdout.trim().replace(/^v/, '')
          versionMatch = inspection.declaredVersion && actualVersion ? versionsEqual(inspection.declaredVersion, actualVersion) : 'unknown'
        }
      } finally { rmSync(home, { recursive: true, force: true }) }
    }
  }
  const base = {
    protocol: 'environment-inspection/1' as const,
    project: { kind: inspection.blocked?.code === 'unsupported_workspace' ? 'unsupported' as const : 'single_package' as const, ...(inspection.packageJsonDigest ? { packageJsonDigest: inspection.packageJsonDigest } : {}) },
    node: { ...(engineRange ? { declared: engineRange } : {}), actual: process.versions.node, satisfied: engine ?? 'unknown' as const },
    manager: { name: inspection.manager, ...(inspection.declaredVersion ? { declaredVersion: inspection.declaredVersion } : {}), ...(actualVersion ? { actualVersion } : {}), versionMatch },
    lockFiles: inspection.lockFiles, readOnlySnapshot,
    capabilities: {
      existingOnly: !inspection.blocked && (!inspection.dependencies.length || !scan.problem),
      offlineInstall: inspection.manager === 'pnpm' && !inspection.blocked && !hookBlocked && inspection.lockFiles.some(lock => lock.name === 'pnpm-lock.yaml'),
      offlineStoreAuthorized: storeAuthorized ? true : input.storeDir ? false : 'unknown' as const,
      offlineCacheSufficient: 'unknown' as const,
      projectHooksBlocked: hookBlocked,
    },
    dependencies: {
      declared: inspection.dependencies.length,
      installed: inspection.dependencies.length ? !scan.problem : true,
      drift: scan.problem ? 'unknown' as const : false,
    },
  }
  if (inspection.blocked) {
    diagnostics.push(chinese(inspection.blocked.code))
    return { ...base, status: 'blocked', code: inspection.blocked.code, message: chinese(inspection.blocked.code), suggestions: suggest(inspection.blocked.code), diagnostics, evidence }
  }
  if (hookBlocked) {
    diagnostics.push(chinese('project_hooks_unsupported'))
    if (policy === 'offline_install') return { ...base, status: 'blocked', code: 'project_hooks_unsupported', message: chinese('project_hooks_unsupported'), suggestions: suggest('project_hooks_unsupported'), diagnostics, evidence }
  }
  if (inspection.declaredVersion && (versionMatch === false || actualVersion === undefined)) {
    diagnostics.push(chinese('manager_version_mismatch'))
    return { ...base, status: 'blocked', code: 'manager_version_mismatch', message: chinese('manager_version_mismatch'), suggestions: suggest('manager_version_mismatch'), diagnostics, evidence }
  }
  if (engine === false) return { ...base, status: 'blocked', code: 'node_version_mismatch', message: chinese('node_version_mismatch'), suggestions: suggest('node_version_mismatch'), diagnostics, evidence }
  if (engine === undefined) diagnostics.push('engines.node 范围无法解析，未作为通过证据。')
  if (policy === 'offline_install') {
    if (inspection.manager !== 'pnpm') return { ...base, status: 'blocked', code: 'offline_install_unsupported', message: '离线安装仅支持 pnpm。', suggestions: suggest('offline_install_unsupported'), diagnostics, evidence }
    if (!storeAuthorized) return { ...base, status: 'blocked', code: 'offline_store_missing', message: chinese('offline_store_missing'), suggestions: suggest('offline_store_missing'), diagnostics, evidence }
    if (scan.problem) {
      diagnostics.push(scan.problem.message)
      return { ...base, status: 'blocked', code: scan.problem.code, message: chinese(scan.problem.code), suggestions: suggest(scan.problem.code), diagnostics, evidence }
    }
    evidence.push({ ref: `environment:inspect:store:${sha256(canonical(input.storeDir!))}`, summary: 'authorized offline store identity' })
    diagnostics.push('离线缓存是否充分无法在不运行安装的情况下证明。')
    return { ...base, status: 'unknown', code: 'offline_cache_unproven', message: chinese('unknown'), suggestions: suggest('offline_cache_missing'), diagnostics, evidence }
  }
  if (scan.problem) {
    diagnostics.push(scan.problem.message)
    return { ...base, status: 'blocked', code: scan.problem.code, message: chinese(scan.problem.code), suggestions: suggest(scan.problem.code), diagnostics, evidence }
  }
  diagnostics.push(chinese('ready'))
  evidence.push({ ref: `environment:inspect:package-json:${inspection.packageJsonDigest}`, summary: 'workspace package.json digest' })
  return { ...base, status: 'ready_to_prepare', code: 'ready', message: chinese('ready'), suggestions: [], diagnostics, evidence }
}
