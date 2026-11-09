import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

/** Canonical path with symlinked ancestors resolved. */
export function canonical(path: string): string {
  try { return realpathSync(resolve(path)) } catch { return resolve(path) }
}

export function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))
}

export function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b)
}

export function fileDigest(path: string): string | undefined {
  try { return sha256(readFileSync(path)) } catch { return undefined }
}

/** A small, deterministic project snapshot: package/lock/index bytes plus a depth-limited dependency tree summary. */
export function projectSnapshot(projectPath: string): string {
  const root = canonical(projectPath)
  const parts: unknown[] = []
  for (const name of ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', '.git/index']) {
    const path = join(root, name)
    parts.push([name, existsSync(path) ? fileDigest(path) ?? 'unreadable' : null])
  }
  const modules = join(root, 'node_modules')
  if (existsSync(modules)) parts.push(['node_modules', treeSummary(modules, 2, root)])
  return sha256(JSON.stringify(parts))
}

/** Paths/sizes/types without absolute paths, used only for invariant comparison. */
export function treeSummary(root: string, depth: number, base = root): unknown[] {
  if (depth < 0) return []
  const entries: unknown[] = []
  let names: string[]
  try { names = readdirSync(root).sort() } catch { return [['unreadable']] }
  for (const name of names) {
    const path = join(root, name)
    let stat
    try { stat = lstatSync(path) } catch { continue }
    const key = relative(base, path)
    if (stat.isSymbolicLink()) {
      entries.push([key, 'link', safeLink(path)])
    } else if (stat.isDirectory()) {
      entries.push([key, 'dir', treeSummary(path, depth - 1, base)])
    } else if (stat.isFile()) {
      entries.push([key, 'file', stat.size, stat.mtimeMs ? Math.floor(stat.mtimeMs) : 0])
    } else {
      entries.push([key, 'other'])
    }
  }
  return entries
}

function safeLink(path: string): string {
  try { return sha256(`link:${readlinkSync(path)}`) } catch { return 'unreadable' }
}

export function directoryBytes(root: string, limit: number): { bytes: number; truncated: boolean } {
  let bytes = 0
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()!
    let names: string[]
    try { names = readdirSync(current) } catch { continue }
    for (const name of names) {
      const path = join(current, name)
      let stat
      try { stat = lstatSync(path) } catch { continue }
      if (stat.isDirectory()) {
        if (name === '.git') continue
        stack.push(path)
      } else {
        bytes += stat.size
        if (bytes > limit) return { bytes, truncated: true }
      }
    }
  }
  return { bytes, truncated: false }
}

/** Resolves a path and proves its real target stays inside the workspace. */
export function realInside(workspace: string, path: string): { real: string; inside: boolean } {
  const real = canonical(path)
  return { real, inside: inside(canonical(workspace), real) }
}

/** Reads a file as UTF-8 without following an escaping symlink; undefined when absent/unreadable/not a regular file. */
export function readRegularFile(path: string): Buffer | undefined {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined
    return readFileSync(path)
  } catch { return undefined }
}

export function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}
