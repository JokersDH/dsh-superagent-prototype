import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EnvironmentDiagnostic } from './types.ts'
import { fileDigest, inside, canonical, readRegularFile, sha256 } from './paths.ts'

export interface PackageJsonShape {
  name?: string
  private?: boolean
  packageManager?: string
  workspaces?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
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
  diagnostics: readonly EnvironmentDiagnostic[]
  blocked?: { code: string; message: string }
}

const packageManagerPattern = /^(pnpm|npm)@([0-9][0-9A-Za-z.+-]*)(?:\+.*)?$/
const LOCK_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'] as const

const parseVersion = (value: string): [number, number, number] | undefined => {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}
const compareVersion = (a: readonly number[], b: readonly number[]): number => {
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0, right = b[index] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * Minimal conservative Node engine check. Unsupported ranges are reported as a warning rather than
 * guessed; a clearly failing supported comparator blocks.
 */
export function nodeRangeSatisfied(range: string, current = process.versions.node): boolean | undefined {
  const version = parseVersion(current)
  if (!version) return undefined
  const clauses = range.trim().split(/\s+/).filter(Boolean)
  if (!clauses.length) return undefined
  let supported = true
  for (const clause of clauses) {
    const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(clause)
    if (!match) { supported = false; continue }
    const operator = match[1] ?? '='
    const target = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)]
    const comparison = compareVersion(version, target)
    const ok =
      operator === '>=' ? comparison >= 0
        : operator === '>' ? comparison > 0
          : operator === '<=' ? comparison <= 0
            : operator === '<' ? comparison < 0
              : operator === '=' ? comparison === 0
                : operator === '^' ? comparison >= 0 && version[0] === target[0]
                  : comparison >= 0 && version[0] === target[0] && version[1] === target[1]
    if (!ok) return false
  }
  return supported ? true : undefined
}

const blocked = (code: string, message: string): { blocked: { code: string; message: string } } => ({ blocked: { code, message } })

/** Structured package.json/lock/manager/dependency inspection; no package-manager resolver is reimplemented. */
export function inspectWorkspace(workspacePath: string): WorkspaceInspection {
  const packagePath = join(workspacePath, 'package.json')
  const bytes = readRegularFile(packagePath)
  const diagnostics: EnvironmentDiagnostic[] = []
  if (!bytes) {
    return {
      packageJson: {}, packageJsonDigest: '', manager: 'none', lockFiles: [], dependencies: [], diagnostics,
      ...blocked('invalid_package_json', 'The workspace has no regular package.json; this project layout is unsupported.'),
    }
  }
  let packageJson: PackageJsonShape
  try { packageJson = JSON.parse(bytes.toString('utf8')) as PackageJsonShape } catch {
    return {
      packageJson: {}, packageJsonDigest: sha256(bytes), manager: 'none', lockFiles: [], dependencies: [], diagnostics,
      ...blocked('invalid_package_json', 'package.json is not valid JSON.'),
    }
  }
  const packageJsonDigest = sha256(bytes)
  const lockFiles: { name: string; digest: string }[] = LOCK_NAMES.flatMap(name => {
    const digest = fileDigest(join(workspacePath, name))
    return digest ? [{ name, digest }] : []
  })
  const locks = new Set(lockFiles.map(entry => entry.name))

  if (locks.has('yarn.lock') || locks.has('bun.lockb'))
    return { packageJson, packageJsonDigest, manager: 'none', lockFiles, dependencies: [], diagnostics,
      ...blocked('unsupported_manager', 'yarn/bun lockfiles are unsupported; this module prepares pnpm or npm projects only.') }
  if (locks.has('pnpm-lock.yaml') && locks.has('package-lock.json'))
    return { packageJson, packageJsonDigest, manager: 'none', lockFiles, dependencies: [], diagnostics,
      ...blocked('ambiguous_lock', 'Both pnpm-lock.yaml and package-lock.json exist; the manager cannot be chosen safely.') }
  if (packageJson.workspaces !== undefined || existsSync(join(workspacePath, 'pnpm-workspace.yaml')))
    return { packageJson, packageJsonDigest, manager: 'none', lockFiles, dependencies: [], diagnostics,
      ...blocked('unsupported_workspace', 'Monorepo/workspace layouts are unsupported by this package; prepare each package separately or add a dedicated port.') }

  let manager: 'pnpm' | 'npm' | 'none' = locks.has('pnpm-lock.yaml') ? 'pnpm' : locks.has('package-lock.json') ? 'npm' : 'none'
  let declaredVersion: string | undefined
  if (packageJson.packageManager !== undefined) {
    const match = packageManagerPattern.exec(packageJson.packageManager)
    if (!match) return { packageJson, packageJsonDigest, manager, ...(declaredVersion ? { declaredVersion } : {}), lockFiles, dependencies: [], diagnostics,
      ...blocked('invalid_package_manager', `Unsupported packageManager declaration: ${packageJson.packageManager}`) }
    const declaredManager = match[1] as 'pnpm' | 'npm'
    declaredVersion = match[2]!
    if (manager !== 'none' && manager !== declaredManager)
      return { packageJson, packageJsonDigest, manager, declaredVersion, lockFiles, dependencies: [], diagnostics,
        ...blocked('manager_lock_mismatch', `packageManager names ${declaredManager} but the lockfile indicates ${manager}.`) }
    manager = declaredManager
  }

  const dependencies: InspectedDependency[] = []
  const seen = new Set<string>()
  for (const entry of [packageJson.dependencies, packageJson.devDependencies, packageJson.optionalDependencies]) {
    for (const [name, spec] of Object.entries(entry ?? {})) {
      if (seen.has(name)) continue
      seen.add(name)
      dependencies.push({ name, spec })
    }
  }
  dependencies.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

  for (const dependency of dependencies) {
    const problem = dependencyProblem(workspacePath, dependency)
    if (problem) return { packageJson, packageJsonDigest, manager, ...(declaredVersion ? { declaredVersion } : {}), lockFiles, dependencies, diagnostics, ...blocked(problem.code, problem.message) }
  }

  const engineRange = packageJson.engines?.node
  if (engineRange) {
    const satisfied = nodeRangeSatisfied(engineRange)
    if (satisfied === false)
      return { packageJson, packageJsonDigest, manager, ...(declaredVersion ? { declaredVersion } : {}), lockFiles, dependencies, diagnostics,
        ...blocked('node_version_mismatch', `Node ${process.versions.node} does not satisfy engines.node "${engineRange}".`) }
    if (satisfied === undefined) diagnostics.push({ code: 'node_engine_unparsed', severity: 'warning', message: `engines.node "${engineRange}" was not evaluated; the current Node version is recorded only.` })
  }
  const lifecycle = Object.keys(packageJson.scripts ?? {}).filter(name => ['preinstall', 'install', 'postinstall', 'prepare'].includes(name))
  if (lifecycle.length) diagnostics.push({
    code: 'lifecycle_scripts_skipped', severity: 'warning',
    message: `Lifecycle scripts are never run in this environment (${lifecycle.join(', ')}); dependencies requiring native builds are not prepared.`,
  })
  if (dependencies.length && manager === 'none')
    return { packageJson, packageJsonDigest, manager, ...(declaredVersion ? { declaredVersion } : {}), lockFiles, dependencies, diagnostics,
      ...blocked('missing_lock', 'Dependencies are declared but no pnpm-lock.yaml/package-lock.json exists; a lock is required.') }
  return { packageJson, packageJsonDigest, manager, ...(declaredVersion ? { declaredVersion } : {}), lockFiles, dependencies, diagnostics }
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
