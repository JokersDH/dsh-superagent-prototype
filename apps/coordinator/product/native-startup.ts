import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { NativeProjectRegistry, ensureStarterProject } from './project-registry.ts'
import type { NativeProductConfiguration } from './native-config.ts'
import type { AgentProfile, ExecutionUnavailableReason } from '@personal-agent/contracts'

export class NativeAdmissionError extends Error {
  readonly reason: ExecutionUnavailableReason
  constructor(reason: ExecutionUnavailableReason) { super('开发执行器尚未就绪。'); this.reason = reason }
}

/** Enable only the installed version covered by this MVP's real native product lane. */
export function admittedNativeProfile(): AgentProfile {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new NativeAdmissionError('unsupported_platform')
  let executable: string, version: string, evidence
  try { executable = execFileSync('which', ['codex'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw new NativeAdmissionError('not_installed') }
  if (!executable) throw new NativeAdmissionError('not_installed')
  try { version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw new NativeAdmissionError('probe_failed') }
  try { evidence = JSON.parse(readFileSync(new URL('../../../reports/releases/native-mvp/native-product.json', import.meta.url), 'utf8')) }
  catch { throw new NativeAdmissionError('not_admitted') }
  if (
    evidence.status !== 'PASS_REAL_NATIVE_PRODUCT' ||
    typeof evidence.profileVersion !== 'string'
  )
    throw new NativeAdmissionError('not_admitted')
  if (evidence.profileVersion !== version) throw new NativeAdmissionError('incompatible_version')
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
function startupWithProfile(stateRoot: string, profile: AgentProfile) {
  const registry = new NativeProjectRegistry(stateRoot)
  if (!registry.list().length) {
    const path = join(homedir(), '.local/share/superagent-personal/projects/starter')
    ensureStarterProject(path)
    registry.save(registry.prepare({ path, displayName: '我的开发项目', check: 'node_test' }))
  }
  const projects = registry.list()
  const native: NativeProductConfiguration = {
    profile,
    projects: projects.map((project) => ({ id: project.id, path: project.path, check: registry.check(project),
      ...(project.environment ? { environment: registry.environment(project)! } : {}) })),
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

export function nativeStartup(stateRoot: string) { return startupWithProfile(stateRoot, admittedNativeProfile()) }

export const DISCUSSION_PROJECT = {
  id: 'project-personal-dialogue', displayName: '个人对话', discussionOnly: true,
  scope: { projectId: 'project-personal-dialogue', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] },
} as const

/** Expected executor failures do not prevent dialogue. Invalid private project data still fails. */
export function preparePersonalStartup(stateRoot: string, options: { discussionOnly?: boolean; admit?: () => AgentProfile } = {}) {
  let profile: AgentProfile | undefined, unavailable: ExecutionUnavailableReason | undefined
  if (options.discussionOnly) unavailable = 'operator_disabled'
  else {
    try { profile = (options.admit ?? admittedNativeProfile)() }
    catch (error) { if (!(error instanceof NativeAdmissionError)) throw error; unavailable = error.reason }
  }
  if (profile) return startupWithProfile(stateRoot, profile)
  const registry = new NativeProjectRegistry(stateRoot)
  return { registry, projects: registry.list().map(project => ({ id: project.id, displayName: project.displayName, scope: registry.scope(project) })),
    workspaceRoot: join(homedir(), '.local/share/superagent-personal/workspaces', canonicalDigest(stateRoot).slice(0, 24)),
    executionUnavailable: unavailable! }
}
