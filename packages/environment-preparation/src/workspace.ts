import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { valid } from 'semver'
import { canonical, inside, readRegularFile, sha256 } from './paths.ts'
import { dependencyDigest, inspectWorkspace, type PackageJsonShape } from './project.ts'
import { scanNodeModules, type InstalledScan } from './installed.ts'

export interface WorkspaceMember {
  /** Workspace-relative directory ('' for the root). */
  relative: string
  name: string
  manifestDigest: string
  dependencies: readonly { name: string; spec: string }[]
}

export interface PnpmWorkspaceInspection {
  ok: boolean
  problem?: { code: string; message: string }
  workspaceDigest: string
  members: readonly WorkspaceMember[]
  manifests: readonly { relative: string; digest: string }[]
  lockFiles: readonly { name: string; digest: string }[]
  dependencies: readonly { name: string; spec: string }[]
  unsupportedProjectFiles: readonly string[]
  modulesDirs: readonly string[]
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
const HOOK_NAMES = ['.pnpmfile.cjs', '.pnpmfile.js', '.npmrc', '.pnpmrc']

const fail = (code: string, message: string): PnpmWorkspaceInspection =>
  ({ ok: false, problem: { code, message }, workspaceDigest: '', members: [], manifests: [], lockFiles: [], dependencies: [], unsupportedProjectFiles: [], modulesDirs: [] })

function manifest(directory: string): { data: PackageJsonShape; digest: string } | undefined {
  const bytes = readRegularFile(join(directory, 'package.json'))
  if (!bytes) return undefined
  try {
    const data = JSON.parse(bytes.toString('utf8')) as PackageJsonShape
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
    return { data, digest: sha256(bytes) }
  } catch { return undefined }
}

function expand(patterns: readonly string[], root: string): { dirs: string[]; problem?: { code: string; message: string } } {
  const dirs = new Set<string>()
  for (const pattern of patterns) {
    if (/[!{[}?\]]|\\|\*\*/.test(pattern) || pattern.startsWith('/') || pattern.split('/').some(part => part === '..'))
      return { dirs: [], problem: { code: 'unsupported_workspace_glob', message: `Unsupported workspace package pattern: ${pattern}` } }
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2)
      const base = join(root, prefix)
      if (!existsSync(base)) continue
      for (const name of readdirSync(base).sort()) {
        const path = join(base, name)
        let stat
        try { stat = lstatSync(path) } catch { continue }
        if (stat.isSymbolicLink()) return { dirs: [], problem: { code: 'unsafe_link', message: `Workspace member is a symlink: ${relative(root, path)}` } }
        if (isMember(path)) dirs.add(relative(root, path))
      }
      continue
    }
    if (isMember(join(root, pattern))) dirs.add(relative(root, pattern))
  }
  return { dirs: [...dirs].sort() }
}
const isMember = (path: string): boolean => {
  try {
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false
    const real = realpathSync(path)
    return existsSync(join(path, 'package.json'))
      && inside(canonical(join(path, '..')), real)
  } catch { return false }
}

/** Explicit opt-in restricted pnpm workspace (one Git root, one lock, packages app -> lib workspace:*). */
export function inspectPnpmWorkspace(workspacePath: string): PnpmWorkspaceInspection {
  const root = canonical(workspacePath)
  const rootManifest = manifest(root)
  if (!rootManifest) return fail('invalid_package_json', 'The workspace root package.json is missing or invalid.')
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) return fail('unsupported_workspace', 'A pnpm workspace requires pnpm-workspace.yaml.')
  if (!existsSync(join(root, 'pnpm-lock.yaml'))) return fail('missing_lock', 'A pnpm workspace requires one root pnpm-lock.yaml.')
  if (rootManifest.data.packageManager !== undefined && !/^pnpm@/.test(String(rootManifest.data.packageManager)))
    return fail('unsupported_manager', 'The workspace packageManager must be pnpm.')
  if (rootManifest.data.packageManager && !valid(String(rootManifest.data.packageManager).slice('pnpm@'.length)))
    return fail('invalid_package_manager', 'packageManager is not a valid pnpm version.')

  let document: unknown
  try { document = parseYaml(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) } catch (error) {
    return fail('invalid_workspace_config', `pnpm-workspace.yaml is not valid YAML: ${String(error).slice(0, 200)}`)
  }
  const packages = (document as { packages?: unknown } | null)?.packages
  if (!Array.isArray(packages) || !packages.every(entry => typeof entry === 'string'))
    return fail('invalid_workspace_config', 'pnpm-workspace.yaml packages must be an array of strings.')
  const expanded = expand(packages as string[], root)
  if (expanded.problem) return fail(expanded.problem.code, expanded.problem.message)
  if (!expanded.dirs.length) return fail('invalid_workspace_config', 'The workspace has no package directories.')

  const members: WorkspaceMember[] = []
  const manifests: { relative: string; digest: string }[] = [{ relative: 'package.json', digest: rootManifest.digest }]
  const dependencies: { name: string; spec: string }[] = []
  const unsupported: string[] = HOOK_NAMES.filter(name => existsSync(join(root, name)))
  if (rootManifest.data.pnpm !== undefined) unsupported.push('package.json#pnpm')
  for (const entry of DEP_FIELDS) for (const [name, spec] of Object.entries(rootManifest.data[entry] ?? {})) dependencies.push({ name, spec })
  const localNames = new Set<string>()
  const collect = (relativeDir: string, data: PackageJsonShape, digest: string): { code: string; message: string } | undefined => {
    if (typeof data.name !== 'string' || !data.name) return { code: 'invalid_package_json', message: `${relativeDir || '.'} package.json needs a name.` }
    if (data.peerDependencies && Object.keys(data.peerDependencies).length)
      return { code: 'unsupported_peer_dependency', message: `Workspace peer dependencies are unsupported: ${Object.keys(data.peerDependencies).join(', ')}` }
    if (localNames.has(data.name)) return { code: 'invalid_workspace_config', message: `Duplicate workspace package name: ${data.name}` }
    localNames.add(data.name)
    const deps = DEP_FIELDS.flatMap(field => Object.entries(data[field] ?? {}).map(([name, spec]) => ({ name, spec })))
    members.push({ relative: relativeDir, name: data.name, manifestDigest: digest, dependencies: deps })
    if (relativeDir) manifests.push({ relative: `${relativeDir}/package.json`, digest })
    for (const name of HOOK_NAMES) if (existsSync(join(root, relativeDir, name))) unsupported.push(`${relativeDir}/${name}`)
    if (data.pnpm !== undefined) unsupported.push(`${relativeDir || '.'}/package.json#pnpm`)
    if (existsSync(join(root, relativeDir, 'pnpm-workspace.yaml'))) return { code: 'unsupported_workspace', message: 'Nested pnpm workspace files are unsupported.' }
    return undefined
  }
  collect('', rootManifest.data, rootManifest.digest)
  for (const dir of expanded.dirs) {
    const value = manifest(join(root, dir))
    if (!value) return fail('invalid_package_json', `${dir}/package.json is missing or invalid.`)
    const problem = collect(dir, value.data, value.digest)
    if (problem) return fail(problem.code, problem.message)
    for (const entry of DEP_FIELDS)
      for (const [name, spec] of Object.entries(value.data[entry] ?? {})) dependencies.push({ name, spec })
  }
  for (const dep of dependencies) {
    if (dep.spec.startsWith('workspace:')) continue
    if (/^(file|link):/.test(dep.spec)) return fail('unsupported_workspace_dependency', `Workspace packages may not use ${dep.spec}; only local workspace links are supported.`)
    if (/^(https?|git|ssh|github):/i.test(dep.spec)) return fail('network_dependency', `Workspace dependency ${dep.name} requires the network.`)
    if (/^(catalog|patch|portal):/.test(dep.spec)) return fail('unsupported_dependency', `Unsupported workspace dependency protocol: ${dep.spec}`)
  }
  for (const member of members) for (const dep of member.dependencies)
    if (dep.spec.startsWith('workspace:') && !localNames.has(dep.name))
      return fail('unsupported_workspace_dependency', `workspace: dependency ${dep.name} does not name a local package.`)

  const lockFiles = [{ name: 'pnpm-lock.yaml', digest: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))) }]
  const uniqueDeps = [...new Map(dependencies.map(dep => [`${dep.name}\0${dep.spec}`, dep])).values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const modulesDirs = ['node_modules', ...expanded.dirs.map(dir => `${dir}/node_modules`)].filter(dir => existsSync(join(root, dir)))
  const workspaceDigest = sha256(JSON.stringify({ manifests, lockFiles, dependencies: dependencyDigest(uniqueDeps), members: members.map(m => [m.relative, m.name, m.manifestDigest]) }))
  return { ok: true, workspaceDigest, members, manifests, lockFiles, dependencies: uniqueDeps, unsupportedProjectFiles: unsupported, modulesDirs }
}

/** Scans every package-level node_modules and combines it with the root environment digest. */
export function scanWorkspaceInstalled(workspace: string, modulesDirs: readonly string[]): InstalledScan {
  const scans: InstalledScan[] = []
  const versions: Record<string, string> = {}
  for (const dir of modulesDirs) {
    // A workspace-member package name is a local link; scanNodeModules accepts every declared dep.
    const scan = scanNodeModules(workspace, dir, [])
    if (scan.problem) return scan
    scans.push(scan)
    Object.assign(versions, scan.versions)
  }
  const digest = sha256(JSON.stringify(scans.map(scan => [scan.digest, scan.entries])))
  return { digest, entries: scans.reduce((sum, scan) => sum + scan.entries, 0), versions }
}
