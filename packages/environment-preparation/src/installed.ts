import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { inside, canonical, sha256 } from './paths.ts'

export interface InstalledScan {
  digest: string
  entries: number
  versions: Readonly<Record<string, string>>
  problem?: { code: string; message: string }
}

export interface ScanLimits {
  maxEntries?: number
  maxDepth?: number
}

const DEFAULT_MAX_ENTRIES = 200_000
const DEFAULT_MAX_DEPTH = 16

/**
 * Bounded scan of the actual installed dependency tree. Every symlink is checked for broken/escaping
 * targets; package.json contents and file metadata participate in the digest so an installed version
 * drift changes the environment identity. Directories reached through symlinks are not re-walked.
 */
export function scanInstalledTree(
  workspacePath: string,
  dependencies: readonly { name: string }[],
  limits: ScanLimits = {},
): InstalledScan {
  return scanNodeModules(workspacePath, 'node_modules', dependencies, limits)
}

/** Scans one node_modules directory relative to the workspace (used by pnpm workspace packages). */
export function scanNodeModules(
  workspacePath: string,
  modulesRelative: string,
  dependencies: readonly { name: string }[],
  limits: ScanLimits = {},
): InstalledScan {
  const workspace = canonical(workspacePath)
  const modules = join(workspace, modulesRelative)
  const maxEntries = limits.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH
  const entries: unknown[] = []
  const versions: Record<string, string> = {}
  if (!existsSync(modules)) {
    return {
      digest: sha256(JSON.stringify({ missing: true })), entries: 0, versions,
      ...(dependencies.length ? { problem: { code: 'dependencies_missing', message: `node_modules is missing for ${dependencies.length} declared dependencies.` } } : {}),
    }
  }
  const modulesStat = lstatSync(modules)
  if (modulesStat.isSymbolicLink() && !inside(workspace, canonical(modules)))
    return { digest: '', entries: 0, versions, problem: { code: 'unsafe_link', message: 'node_modules resolves outside the private workspace.' } }
  if (!modulesStat.isDirectory())
    return { digest: '', entries: 0, versions, problem: { code: 'dependencies_missing', message: 'node_modules is not a directory.' } }

  const visitedDirectories = new Set<string>()
  let count = 0
  const walk = (directory: string, depth: number): { code: string; message: string } | undefined => {
    const realDirectory = canonical(directory)
    if (visitedDirectories.has(realDirectory)) return undefined
    visitedDirectories.add(realDirectory)
    let names: string[]
    try { names = readdirSync(directory) } catch { return { code: 'dependency_scan_failed', message: 'A dependency directory could not be read.' } }
    for (const name of names) {
      count += 1
      if (count > maxEntries) return { code: 'dependency_scan_limit', message: `Dependency tree exceeds the ${maxEntries}-entry scan budget.` }
      const path = join(directory, name)
      const rel = relative(workspace, path)
      let stat
      try { stat = lstatSync(path) } catch { continue }
      if (stat.isSymbolicLink()) {
        let target: string
        try { target = readlinkSync(path) } catch { return { code: 'broken_link', message: `Dependency symlink cannot be read: ${rel}` } }
        let real: string
        try { real = realpathSync(path) } catch { return { code: 'broken_link', message: `Dependency symlink is broken: ${rel}` } }
        if (!inside(workspace, real)) return { code: 'unsafe_link', message: `Dependency symlink escapes the workspace: ${rel}` }
        entries.push([rel, 'link', sha256(`link:${target}`), sha256(real)])
        continue
      }
      if (stat.isDirectory()) {
        entries.push([rel, 'dir'])
        if (depth >= maxDepth) return { code: 'dependency_scan_limit', message: `Dependency tree exceeds the ${maxDepth}-level depth budget.` }
        const problem = walk(path, depth + 1)
        if (problem) return problem
        continue
      }
      if (!stat.isFile()) return { code: 'unsupported_dependency_file', message: `Dependency tree contains a non-file entry: ${rel}` }
      const contentDigest = name === 'package.json' ? sha256(readFileSync(path)) : undefined
      entries.push([rel, 'file', stat.size, ...(contentDigest ? [contentDigest] : [])])
    }
    return undefined
  }
  const problem = walk(modules, 0)
  if (problem) return { digest: '', entries: count, versions, problem }
  for (const dependency of dependencies) {
    const packagePath = join(modules, dependency.name, 'package.json')
    if (!existsSync(packagePath)) return { digest: '', entries: count, versions, problem: { code: 'dependencies_missing', message: `Dependency ${dependency.name} is not installed.` } }
    const { inside: contained } = { inside: inside(workspace, canonical(packagePath)) }
    if (!contained) return { digest: '', entries: count, versions, problem: { code: 'unsafe_link', message: `Dependency ${dependency.name} resolves outside the workspace.` } }
    try {
      const value = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
      versions[dependency.name] = typeof value.version === 'string' ? value.version : 'unknown'
    } catch {
      return { digest: '', entries: count, versions, problem: { code: 'dependencies_missing', message: `Dependency ${dependency.name} has an unreadable package.json.` } }
    }
  }
  entries.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)
  return { digest: createHash('sha256').update(JSON.stringify({ entries, versions })).digest('hex'), entries: count, versions }
}
