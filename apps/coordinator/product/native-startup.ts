import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { NativeProjectRegistry, ensureStarterProject } from './project-registry.ts'
import type { NativeProductConfiguration } from './native-config.ts'
import type { AgentProfile } from '@personal-agent/contracts'

/** Enable only the installed version covered by this MVP's real native product lane. */
export function admittedNativeProfile(): AgentProfile {
  const executable = execFileSync('which', ['codex'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const version = execFileSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  const evidence = JSON.parse(
    readFileSync(new URL('../../../reports/releases/native-mvp/native-product.json', import.meta.url), 'utf8'),
  )
  if (
    evidence.status !== 'PASS_REAL_NATIVE_PRODUCT' ||
    evidence.profileVersion !== version ||
    process.platform !== 'darwin' ||
    process.arch !== 'arm64'
  )
    throw new Error('当前 Codex 版本或平台尚未通过本机 MVP 原生验收，请运行原生验收后再启用。')
  return {
    id: 'profile-codex-native',
    revision: 1,
    driverId: 'codex-native',
    driverApiMajor: 1,
    driverRelease: '0.1.0-native-mvp',
    executable,
    argv: ['app-server', '--disable', 'apps', '-c', 'mcp_servers={}', '-c', 'web_search="disabled"'],
    expectedVersion: version,
    nativeConfigRef: 'codex-operator-settings',
    permissionPolicyRevision: 'codex-worktree-1',
    requiredFeatures: [],
  }
}
export function nativeStartup(stateRoot: string) {
  const profile = admittedNativeProfile()
  const registry = new NativeProjectRegistry(stateRoot)
  if (!registry.list().length) {
    const path = join(homedir(), '.local/share/superagent-personal/projects/starter')
    ensureStarterProject(path)
    registry.save(registry.prepare({ path, displayName: '我的开发项目', check: 'node_test' }))
  }
  const projects = registry.list()
  const native: NativeProductConfiguration = {
    profile,
    projects: projects.map((project) => ({ id: project.id, path: project.path, check: registry.check(project) })),
    approvalPolicy: 'on-request',
  }
  return {
    native,
    registry,
    projects: projects.map((project) => ({
      id: project.id,
      displayName: project.displayName,
      scope: registry.scope(project),
    })),
    workspaceRoot: join(
      homedir(),
      '.local/share/superagent-personal/workspaces',
      canonicalDigest(stateRoot).slice(0, 24),
    ),
  }
}
