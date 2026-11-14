/**
 * Which module entry the CLI loads.
 *
 * A checkout has both `src/*.ts` and a built `dist/*.js`. Running the built entry is correct for an
 * installed package, but in a checkout a stale `dist` would silently analyse with older code than the
 * one under test. The rule is therefore: use `dist` when it is at least as new as the sources, use the
 * sources when the build is stale (and say so), and use `dist` alone when no sources are present.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Newest modification time among the package's TypeScript sources. */
export function newestSourceMtime(sourceDir) {
  let newest = 0
  let entries
  try {
    entries = readdirSync(sourceDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    try {
      newest = Math.max(newest, statSync(join(sourceDir, entry.name)).mtimeMs)
    } catch { /* a file can disappear between listing and stat */ }
  }
  return entries.length === 0 ? null : newest
}

/**
 * @returns {{ entry: string | null, kind: 'dist' | 'source' | 'missing', stale: boolean }}
 */
export function chooseModuleEntry({ distEntry, sourceEntry, sourceDir, stat = statSync, exists = existsSync }) {
  const hasDist = exists(distEntry)
  const hasSource = exists(sourceEntry)
  if (!hasDist && !hasSource) return { entry: null, kind: 'missing', stale: false }
  if (!hasDist) return { entry: sourceEntry, kind: 'source', stale: false }
  if (!hasSource) return { entry: distEntry, kind: 'dist', stale: false }
  const sourceMtime = newestSourceMtime(sourceDir)
  const distMtime = stat(distEntry).mtimeMs
  if (sourceMtime !== null && sourceMtime > distMtime)
    return { entry: sourceEntry, kind: 'source', stale: true }
  return { entry: distEntry, kind: 'dist', stale: false }
}
