import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, satisfies, valid, validRange } from 'semver'
import { parse as parseYaml } from 'yaml'
import type { EnvironmentDiagnostic } from './types.ts'
import { fileDigest, inside, canonical, readRegularFile, sha256 } from './paths.ts'

export interface PackageJsonShape {
  name?: string
  private?: boolean
  packageManager?: string
  workspaces?: unknown
  pnpm?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  engines?: { node?: string }
}

export interface InspectedDependency { name: string; spec: string }

export interface WorkspaceInspection {
  packageJson: PackageJsonShape
  packageJsonDigest: string
  manager: 'pnpm' | 'npm' | 'none'
  declaredVersion?: string
  lockFiles: readonly { name: string; digest: string }[]
  dependencies: readonly InspectedDependency[]
  /** Project files that can execute code or change install output; offline install refuses them. */
  unsupportedProjectFiles: readonly string[]
  diagnostics: readonly EnvironmentDiagnostic[]
  blocked?: { code: string; message: string }
}

const packageManagerPattern = /^(pnpm|npm)@([0-9][0-9A-Za-z.+-]*)(?:\+.*)?$/
const LOCK_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validated semver comparison; build metadata is ignored by semver precedence. */
export function versionsEqual(declared: string, actual: string): boolean {
  const left = valid(declared), right = valid(actual)
  return left !== null && right !== null ? eq(left, right) : declared === actual
}

/** Returns false only for a clearly valid range the current Node does not satisfy; invalid ranges are undefined. */
export function nodeRangeSatisfied(range: string, current = process.versions.node): boolean | undefined {
  if (!validRange(range)) return undefined
  return satisfies(current, range, { includePrerelease: true })
}

const blocked = (code: string, message: string): { blocked: { code: string; message: string } } => ({ blocked: { code, message } })

const invalid = (message: string): { blocked: { code: string; message: string } } => ({ blocked: { code: 'invalid_package_json', message } })

function workspaceDeclaration(workspacePath: string, packageJson: PackageJsonShape): { monorepo: boolean; error?: { code: string; message: string } } {
  const workspaces = packageJson.workspaces
  if (workspaces !== undefined) {
    if (Array.isArray(workspaces)) {
      if (!workspaces.every(entry => typeof entry === 'string')) return { monorepo: false, error: { code: 'invalid_workspace_config', message: 'package.json workspaces must contain only strings.' } }
      if (workspaces.length > 0) return { monorepo: true }
    } else if (isRecord(workspaces)) {
      const packages = workspaces.packages
      if (packages === undefined) return { monorepo: true }
      if (!Array.isArray(packages) || !packages.every(entry => typeof entry === 'string')) return { monorepo: false, error: { code: 'invalid_workspace_config', message: 'package.json workspaces.packages must contain only strings.' } }
      if (packages.length > 0) return { monorepo: true }
    } else {
      return { monorepo: false, error: { code: 'invalid_workspace_config', message: 'package.json workspaces has an unsupported shape.' } }
    }
  }
  const workspaceFile = join(workspacePath, 'pnpm-workspace.yaml')
  if (existsSync(workspaceFile)) {
    let parsed: unknown
    try { parsed = parseYaml(readFileSync(workspaceFile, 'utf8')) } catch (error) {
      return { monorepo: false, error: { code: 'invalid_workspace_config', message: `pnpm-workspace.yaml is not valid YAML: ${String(error).slice(0, 200)}` } }
    }
    if (parsed === null || parsed === undefined) return { monorepo: false }
    if (!isRecord(parsed)) return { monorepo: false, error: { code: 'invalid_workspace_config', message: 'pnpm-workspace.yaml must be a mapping.' } }
    const packages = parsed.packages
    if (packages === undefined) return { monorepo: true }
    if (!Array.isArray(packages) || !packages.every(entry => typeof entry === 'string')) return { monorepo: false, error: { code: 'invalid_workspace_config', message: 'pnpm-workspace.yaml packages must contain only strings.' } }
    return { monorepo: packages.length > 0 }
  }
  return { monorepo: false }
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

function validDependencyFields(packageJson: PackageJsonShape): { error?: { code: string; message: string } } {
  for (const field of DEPENDENCY_FIELDS) {
    const value = packageJson[field]
    if (value === undefined) continue
    if (!isRecord(value)) return { error: { code: 'invalid_package_json', message: `package.json ${field} must be an object.` } }
    if (Object.entries(value).some(([, spec]) => typeof spec !== 'string')) return { error: { code: 'invalid_package_json', message: `package.json ${field} values must be strings.` } }
  }
  if (packageJson.scripts !== undefined && (!isRecord(packageJson.scripts) || Object.values(packageJson.scripts).some(value => typeof value !== 'string')))
    return { error: { code: 'invalid_package_json', message: 'package.json scripts must map names to strings.' } }
  if (packageJson.engines !== undefined && (!isRecord(packageJson.engines) || Object.values(packageJson.engines).some(value => typeof value !== 'string')))
    return { error: { code: 'invalid_package_json', message: 'package.json engines must map names to strings.' } }
  if (packageJson.packageManager !== undefined && typeof packageJson.packageManager !== 'string')
    return { error: { code: 'invalid_package_manager', message: 'package.json packageManager must be a string.' } }
  return {}
}

/** Structured package.json/lock/manager/dependency inspection; no package-manager resolver is reimplemented. */
export function inspectWorkspace(workspacePath: string): WorkspaceInspection {
  const packagePath = join(workspacePath, 'package.json')
  const bytes = readRegularFile(packagePath)
  const diagnostics: EnvironmentDiagnostic[] = []
  const emptyBase = { packageJson: {}, packageJsonDigest: '', manager: 'none' as const, lockFiles: [], dependencies: [], unsupportedProjectFiles: [], diagnostics }
  if (!bytes) return { ...emptyBase, ...blocked('invalid_package_json', 'The workspace has no regular package.json; this project layout is unsupported.') }
  let parsed: unknown
  try { parsed = JSON.parse(bytes.toString('utf8')) } catch {
    return { ...emptyBase, packageJsonDigest: sha256(bytes), ...blocked('invalid_package_json', 'package.json is not valid JSON.') }
  }
  if (!isRecord(parsed)) return { ...emptyBase, packageJsonDigest: sha256(bytes), ...blocked('invalid_package_json', 'package.json must be a JSON object.') }
  const packageJson = parsed as PackageJsonShape
  const packageJsonDigest = sha256(bytes)
  const fields = validDependencyFields(packageJson)
  if (fields.error) return { ...emptyBase, packageJson, packageJsonDigest, ...blocked(fields.error.code, fields.error.message) }

  const lockFiles: { name: string; digest: string }[] = LOCK_NAMES.flatMap(name => {
    const digest = fileDigest(join(workspacePath, name))
    return digest ? [{ name, digest }] : []
  })
  const locks = new Set(lockFiles.map(entry => entry.name))
  const base = { packageJson, packageJsonDigest, lockFiles, diagnostics, unsupportedProjectFiles: [] as string[] }
  const layout = workspaceDeclaration(workspacePath, packageJson)
  if (layout.error) return { ...base, manager: 'none', dependencies: [], ...blocked(layout.error.code, layout.error.message) }
  if (layout.monorepo) return { ...base, manager: 'none', dependencies: [], ...blocked('unsupported_workspace', 'pnpm/package.json workspaces declare a monorepo; prepare a single package or opt into the dedicated pnpm_workspace mode.') }

  if (locks.has('yarn.lock') || locks.has('bun.lockb')) return { ...base, manager: 'none', dependencies: [], ...blocked('unsupported_manager', 'yarn/bun lockfiles are unsupported; this module prepares pnpm or npm projects only.') }
  if (locks.has('pnpm-lock.yaml') && locks.has('package-lock.json')) return { ...base, manager: 'none', dependencies: [], ...blocked('ambiguous_lock', 'Both pnpm-lock.yaml and package-lock.json exist; the manager cannot be chosen safely.') }

  const unsupportedProjectFiles: string[] = ['.pnpmfile.cjs', '.pnpmfile.js', '.npmrc', '.pnpmrc'].filter(name => existsSync(join(workspacePath, name)))
  if (packageJson.pnpm !== undefined && packageJson.pnpm !== null) unsupportedProjectFiles.push('package.json#pnpm')
  const withHooks = { ...base, unsupportedProjectFiles }

  let manager: 'pnpm' | 'npm' | 'none' = locks.has('pnpm-lock.yaml') ? 'pnpm' : locks.has('package-lock.json') ? 'npm' : 'none'
  let declaredVersion: string | undefined
  if (packageJson.packageManager !== undefined) {
    const match = /^(pnpm|npm)@(.+)$/.exec(packageJson.packageManager)
    const version = match?.[2]
    if (!match || !version || valid(version) === null)
      return { ...withHooks, manager, dependencies: [], ...blocked('invalid_package_manager', `Unsupported packageManager declaration: ${String(packageJson.packageManager)}`) }
    const declaredManager = match[1] as 'pnpm' | 'npm'
    declaredVersion = version
    if (manager !== 'none' && manager !== declaredManager)
      return { ...withHooks, manager, declaredVersion, dependencies: [], ...blocked('manager_lock_mismatch', `packageManager names ${declaredManager} but the lockfile indicates ${manager}.`) }
    manager = declaredManager
  }

  const dependencies: InspectedDependency[] = []
  const seen = new Set<string>()
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of Object.entries(packageJson[field] ?? {})) {
      if (seen.has(name)) continue
      seen.add(name)
      dependencies.push({ name, spec })
    }
  }
  dependencies.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const withDeps = { ...withHooks, manager, ...(declaredVersion ? { declaredVersion } : {}), dependencies }
  for (const dependency of dependencies) {
    const problem = dependencyProblem(workspacePath, dependency)
    if (problem) return { ...withDeps, ...blocked(problem.code, problem.message) }
  }

  if (packageJson.engines?.node !== undefined) {
    const engineRange = packageJson.engines.node
    if (validRange(engineRange) === null)
      return { ...withDeps, ...blocked('invalid_engine_range', `engines.node "${engineRange}" is not a valid semver range.`) }
    if (satisfies(process.versions.node, engineRange, { includePrerelease: true }) === false)
      return { ...withDeps, ...blocked('node_version_mismatch', `Node ${process.versions.node} does not satisfy engines.node "${engineRange}".`) }
  }
  const lifecycle = Object.keys(packageJson.scripts ?? {}).filter(name => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name))
  if (lifecycle.length) diagnostics.push({
    code: 'lifecycle_scripts_skipped', severity: 'warning',
    message: `Lifecycle scripts are never run in this environment (${lifecycle.join(', ')}); dependencies requiring native builds are not prepared.`,
  })
  if (dependencies.length && manager === 'none')
    return { ...withDeps, ...blocked('missing_lock', 'Dependencies are declared but no pnpm-lock.yaml/package-lock.json exists; a lock is required.') }
  return withDeps
}

function dependencyProblem(workspacePath: string, dependency: InspectedDependency): { code: string; message: string } | undefined {
  const spec = dependency.spec.trim()
  if (spec.startsWith('workspace:')) return { code: 'unsupported_workspace_dependency', message: `${dependency.name} uses a workspace: dependency; monorepo linking is unsupported.` }
  if (spec.startsWith('link:')) return { code: 'unsafe_link', message: `${dependency.name} uses link:, which can point outside the private workspace.` }
  if (/^(https?|git|ssh|github):/i.test(spec)) return { code: 'network_dependency', message: `${dependency.name} requires a network/git dependency; offline preparation refuses it.` }
  if (/^(catalog|patch|portal):/i.test(spec)) return { code: 'unsupported_dependency', message: `${dependency.name} uses an unsupported dependency protocol: ${spec}` }
  if (spec.startsWith('file:')) {
    const target = spec.slice('file:'.length)
    const resolved = canonical(target.startsWith('/') ? target : join(workspacePath, target))
    if (!inside(canonical(workspacePath), resolved)) return { code: 'unsafe_link', message: `${dependency.name} points outside the workspace (${spec}).` }
    if (!existsSync(resolved)) return { code: 'dependency_source_missing', message: `${dependency.name} file dependency does not exist: ${spec}` }
  }
  return undefined
}

/** Recomputes the dependency list digest for fingerprinting (sorted name+spec). */
export function dependencyDigest(dependencies: readonly InspectedDependency[]): string {
  return sha256(JSON.stringify(dependencies.map(entry => [entry.name, entry.spec])))
}

export function readPackageJson(workspacePath: string): PackageJsonShape | undefined {
  try { return JSON.parse(readFileSync(join(workspacePath, 'package.json'), 'utf8')) as PackageJsonShape } catch { return undefined }
}
