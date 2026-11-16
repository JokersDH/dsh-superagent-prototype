/**
 * Evidence-based identity of a *running* installation.
 *
 * An archive digest says which bytes were shipped; it does not say that those bytes are what is
 * running. This module reads the installation directory itself: the install manifest that D/main also
 * read, and the installed files that provide (or fail to provide) each capability. Missing or
 * inconsistent evidence stays `unknown` — a repository HEAD, a path or a branch name is never
 * converted into an identity.
 *
 * Read-only: it never writes, installs, starts or stops anything.
 */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { SupportOrigin } from './support.ts'

export const RUNTIME_IDENTITY_PROTOCOL = 'usage-insights-runtime-identity/1' as const
const MANIFEST_MAX_BYTES = 8 * 1024 * 1024
const TEXT_SCAN_MAX_BYTES = 32 * 1024 * 1024

export interface RuntimeCapabilities {
  readonly pageObservation: boolean
  readonly numericExport: boolean
  readonly displayDownload: boolean
  readonly supportSummary: boolean
}

export interface RuntimeIdentity {
  readonly protocol: typeof RUNTIME_IDENTITY_PROTOCOL
  /** The directory that was read, as resolved, and which layout was found inside it. */
  readonly root: string
  readonly layout: 'install/app' | 'app' | 'unknown'
  readonly manifest: {
    readonly present: boolean
    readonly state: 'parsed' | 'absent' | 'too_large' | 'invalid'
    readonly path: string | null
    readonly bytes: number | null
    readonly buildId: string | null
    readonly sourceCommit: string | null
    readonly sourceDirty: boolean | null
    readonly declaredFiles: number | null
  }
  /** The archive digest, only when it was proven (a hashed file or an explicit verified value). */
  readonly archive: { readonly sha256: string | null; readonly source: 'file' | 'declared' | 'unknown' }
  readonly capabilities: RuntimeCapabilities | null
  readonly capabilitiesEvidence: readonly string[]
  readonly origin: SupportOrigin | null
  readonly checks: {
    readonly buildMatches: boolean | null
    readonly sourceMatches: boolean | null
    readonly archiveMatches: boolean | null
  }
  readonly differences: readonly string[]
  readonly unknown: readonly string[]
  readonly authorization: 'none'
}

export class RuntimeIdentityFault extends Error {
  readonly code: 'unreadable_root' | 'not_a_directory' | 'symlinked_manifest' | 'too_large'
  constructor(code: RuntimeIdentityFault['code'], message: string) {
    super(message)
    this.name = 'RuntimeIdentityFault'
    this.code = code
  }
}

const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}

const readBounded = (path: string, max: number): { bytes: number; text: string | null; tooLarge: boolean } => {
  const stat = statSync(path)
  if (stat.size > max) return { bytes: stat.size, text: null, tooLarge: true }
  return { bytes: stat.size, text: readFileSync(path, 'utf8'), tooLarge: false }
}

const scanTexts = (paths: readonly string[], max = TEXT_SCAN_MAX_BYTES): string => {
  const parts: string[] = []
  let used = 0
  for (const path of paths) {
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    if (!stat.isFile() || used + stat.size > max) continue
    used += stat.size
    parts.push(readFileSync(path, 'utf8'))
  }
  return parts.join('\n')
}

const filesUnder = (root: string, prefix: string, pattern: RegExp): string[] => {
  const base = join(root, prefix)
  let entries: string[]
  try {
    entries = readdirSync(base, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && pattern.test(entry.name))
      .map(entry => join((entry as unknown as { parentPath: string }).parentPath, entry.name))
  } catch {
    return []
  }
  return entries.filter(path => inside(root, path)).sort()
}

const count = (text: string, needle: string): number => text.split(needle).length - 1

const pickLayout = (root: string): { layout: RuntimeIdentity['layout']; app: string | null } => {
  for (const [prefix, layout] of [['install/app', 'install/app'], ['app', 'app']] as const) {
    try {
      if (statSync(join(root, prefix)).isDirectory()) return { layout, app: join(root, prefix) }
    } catch {
      continue
    }
  }
  return { layout: 'unknown', app: null }
}

export interface RuntimeIdentityOptions {
  /** The installation directory: either the extract root (containing `install/app`) or the `install` root. */
  readonly installRoot: string
  /** An explicit archive whose bytes are hashed; never inferred from a path or a branch. */
  readonly archivePath?: string
  /** Values the caller already trusts (for example D's frozen tuple). */
  readonly expected?: {
    readonly buildId?: string
    readonly sourceCommit?: string
    readonly archiveSha256?: string
  }
}

/**
 * Read the running installation's identity and capability evidence.
 *
 * Every field is evidence or `null`. A manifest that declares both build and source yields
 * `install-manifest`; one that declares only part of it yields `incomplete-manifest` with the rest
 * `null`; no manifest yields `origin: null`. Capabilities are decided by what the installed files
 * contain, so a manifest claim cannot make a missing feature look present.
 */
export function inspectRuntimeIdentity(options: RuntimeIdentityOptions): RuntimeIdentity {
  const rootInput = resolve(options.installRoot)
  let root: string
  try {
    root = realpathSync(rootInput)
  } catch {
    throw new RuntimeIdentityFault('unreadable_root', 'The installation root does not exist or is not readable')
  }
  if (!statSync(root).isDirectory()) throw new RuntimeIdentityFault('not_a_directory', 'The installation root must be a directory')

  const { layout, app } = pickLayout(root)
  const manifestCandidates = [join(root, 'install/install.json'), join(root, 'install.json')]
  let manifestPath: string | null = null
  for (const candidate of manifestCandidates) {
    if (!inside(root, candidate)) continue
    try {
      if (statSync(candidate).isFile()) { manifestPath = candidate; break }
    } catch { continue }
  }
  if (manifestPath !== null && lstatSync(manifestPath).isSymbolicLink())
    throw new RuntimeIdentityFault('symlinked_manifest', 'The install manifest must not be a symbolic link')

  const unknown: string[] = []
  let manifestState: RuntimeIdentity['manifest']['state'] = 'absent'
  let manifestBytes: number | null = null
  let buildId: string | null = null
  let sourceCommit: string | null = null
  let sourceDirty: boolean | null = null
  let declaredFiles: number | null = null
  if (manifestPath !== null) {
    const read = readBounded(manifestPath, MANIFEST_MAX_BYTES)
    manifestBytes = read.bytes
    if (read.tooLarge) manifestState = 'too_large'
    else {
      try {
        const parsed = JSON.parse(read.text ?? '') as Record<string, unknown>
        const source = parsed.source !== null && typeof parsed.source === 'object' ? parsed.source as Record<string, unknown> : null
        buildId = typeof parsed.buildId === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(parsed.buildId) ? parsed.buildId : null
        sourceCommit = source !== null && typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit) ? source.commit : null
        sourceDirty = source !== null && typeof source.dirty === 'boolean' ? source.dirty : null
        declaredFiles = Array.isArray(parsed.files) ? parsed.files.length : typeof parsed.files === 'number' ? parsed.files : null
        manifestState = 'parsed'
      } catch {
        manifestState = 'invalid'
      }
    }
  }
  if (manifestState !== 'parsed') unknown.push(`manifest ${manifestState}`)
  if (buildId === null) unknown.push('build id not declared')
  if (sourceCommit === null) unknown.push('source commit not declared')

  // Capability evidence comes from the installed files, never from a manifest claim.
  const usageDir = app === null ? null : join(app, 'packages/usage-insights')
  const indexText = usageDir === null ? '' : (() => {
    try {
      return readBounded(join(usageDir, 'dist/index.js'), TEXT_SCAN_MAX_BYTES).text ?? ''
    } catch {
      return ''
    }
  })()
  const coordinatorFiles = app === null ? [] : [
    ...filesUnder(app, 'apps/coordinator/http', /\.(ts|js)$/),
    ...filesUnder(app, 'apps/coordinator/product', /\.(ts|js)$/),
  ]
  const coordinatorText = scanTexts(coordinatorFiles)
  const consoleFiles = app === null ? [] : filesUnder(app, 'apps/console', /\.(ts|tsx|js)$/)
  const consoleText = scanTexts(consoleFiles)
  const capabilities: RuntimeCapabilities | null = app === null ? null : {
    pageObservation: count(coordinatorText, "'/v1/insights'") + count(coordinatorText, '"/v1/insights"') > 0 &&
      count(indexText, 'analyzeUsageInsights') > 0,
    numericExport: count(indexText, 'buildInsightExport') > 0,
    displayDownload: count(indexText, 'buildDisplayExport') > 0 && count(coordinatorText, '/v1/insights/export') > 0 &&
      (count(consoleText, 'downloadUsageObservation') + count(consoleText, '/v1/insights/export')) > 0,
    supportSummary: count(indexText, 'buildSupportReport') > 0 && count(coordinatorText, '/v1/insights/support') > 0,
  }
  const capabilitiesEvidence = [
    `layout ${layout}`,
    `usage dist ${indexText === '' ? 'absent' : `${Buffer.byteLength(indexText)} bytes`}`,
    `coordinator files ${coordinatorFiles.length}`,
    `console files ${consoleFiles.length}`,
  ]

  let archiveSha256: string | null = null
  let archiveSource: RuntimeIdentity['archive']['source'] = 'unknown'
  if (options.archivePath !== undefined) {
    const archive = resolve(options.archivePath)
    try {
      archiveSha256 = sha256File(archive)
      archiveSource = 'file'
    } catch {
      unknown.push('archive could not be hashed')
    }
  } else if (options.expected?.archiveSha256 !== undefined) {
    archiveSha256 = options.expected.archiveSha256
    archiveSource = 'declared'
  }

  const origin: SupportOrigin | null = buildId === null && sourceCommit === null ? null : {
    kind: 'runtime',
    identitySource: buildId !== null && sourceCommit !== null ? 'install-manifest'
      : buildId !== null || sourceCommit !== null ? 'incomplete-manifest' : 'archive-only',
    buildId,
    sourceCommit,
    archiveSha256,
    capabilities: capabilities === null ? null : {
      pageObservation: capabilities.pageObservation, numericExport: capabilities.numericExport,
      displayDownload: capabilities.displayDownload,
    },
    browserTrigger: capabilities === null ? null
      : count(consoleText, 'downloadUsageObservation') + count(consoleText, '/v1/insights/export') > 0 ? 'present' : 'absent',
    missing: capabilities === null ? []
      : Object.entries({ pageObservation: capabilities.pageObservation, numericExport: capabilities.numericExport,
        displayDownload: capabilities.displayDownload }).filter(([, present]) => !present).map(([name]) => name),
  }

  const differences: string[] = []
  const expectedBuild = options.expected?.buildId
  const expectedSource = options.expected?.sourceCommit
  const expectedArchive = options.expected?.archiveSha256
  const buildMatches = expectedBuild === undefined ? null : buildId === expectedBuild
  const sourceMatches = expectedSource === undefined ? null : sourceCommit === expectedSource
  // A declared expected digest with no archive to hash cannot be compared: reporting `true` there
  // would be a tautology, so the check stays null.
  const archiveMatches = expectedArchive === undefined || options.archivePath === undefined ? null
    : archiveSha256 === null ? null : archiveSha256 === expectedArchive
  if (buildMatches === false) differences.push(`build ${buildId ?? 'unknown'} ≠ expected ${expectedBuild}`)
  if (sourceMatches === false) differences.push(`source ${sourceCommit?.slice(0, 12) ?? 'unknown'} ≠ expected ${expectedSource?.slice(0, 12)}`)
  if (archiveMatches === false) differences.push(`archive ${archiveSha256?.slice(0, 12) ?? 'unknown'} ≠ expected ${expectedArchive?.slice(0, 12)}`)
  if (expectedArchive !== undefined && options.archivePath === undefined)
    unknown.push('the archive digest is declared but not proven against the running files')
  if (capabilities === null) unknown.push('capabilities could not be read')

  return {
    protocol: RUNTIME_IDENTITY_PROTOCOL,
    root,
    layout,
    manifest: { present: manifestPath !== null, state: manifestState, path: manifestPath === null ? null : relative(root, manifestPath),
      bytes: manifestBytes, buildId, sourceCommit, sourceDirty, declaredFiles },
    archive: { sha256: archiveSha256, source: archiveSource },
    capabilities,
    capabilitiesEvidence,
    origin,
    checks: { buildMatches, sourceMatches, archiveMatches },
    differences,
    unknown,
    authorization: 'none',
  }
}
