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
import { dirname, join, relative, resolve, sep } from 'node:path'
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

/**
 * How well the identity is established. `self_declared` is a manifest claim; `inventory_verified`
 * means the manifest's own file digests were checked against the files on disk; `running_confirmed`
 * additionally means a caller-supplied process identity named this exact root. G never discovers a
 * process: the running claim is an input from main/D, not something this module can prove alone.
 */
export type RuntimeEvidence = 'self_declared' | 'inventory_verified' | 'running_confirmed'

export interface RuntimeInventory {
  readonly state: 'complete' | 'partial' | 'none'
  readonly mode: 'hash' | 'size' | 'none'
  readonly listed: number
  readonly checked: number
  readonly hashed: number
  readonly mismatches: readonly { readonly path: string; readonly reason: string }[]
  readonly skipped: number
}

export interface RuntimeRunningClaim {
  readonly root: string
  readonly rootMatches: boolean
  readonly pid: number | null
  readonly startedAt: string | null
  readonly note: string
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
  readonly inventory: RuntimeInventory
  readonly evidence: RuntimeEvidence
  readonly running: RuntimeRunningClaim | null
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

/**
 * Count a signal outside comments and string literals.
 *
 * Stripping comments with a regular expression is unsafe on minified bundles (one line, URLs and
 * regex literals full of `//`), so this walks the text with a small lexer instead: a route inside a
 * comment never counts, and real code inside a 600 KB single-line bundle keeps counting.
 */
const countOutsideComments = (text: string, needle: string): number => {
  let count = 0
  let index = 0
  let comment: 'none' | 'line' | 'block' = 'none'
  let quote: string | null = null
  while (index < text.length) {
    const char = text[index]!
    const next = text[index + 1]
    if (comment === 'line') {
      if (char === '\n') comment = 'none'
      index++
      continue
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') { comment = 'none'; index += 2; continue }
      index++
      continue
    }
    if (quote !== null) {
      // A string literal is code, not a comment: its contents may carry the route. Only the closing
      // quote and escapes change the state, so `//` inside a URL is not a comment.
      if (char === '\\') index += 2
      else {
        if (text.startsWith(needle, index)) count++
        if (char === quote) quote = null
        index++
      }
      continue
    }
    if (char === '/' && next === '/') { comment = 'line'; index += 2; continue }
    if (char === '/' && next === '*') { comment = 'block'; index += 2; continue }
    if (char === "'" || char === '"' || char === '`') { quote = char; index++; continue }
    if (text.startsWith(needle, index)) count++
    index++
  }
  return count
}

interface ManifestEntry { readonly path: string; readonly kind: string; readonly bytes: number | null; readonly sha256: string | null }

const manifestEntries = (files: unknown): ManifestEntry[] | null => {
  if (!Array.isArray(files)) return null
  const entries: ManifestEntry[] = []
  for (const raw of files) {
    if (raw === null || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    if (typeof record.path !== 'string' || typeof record.kind !== 'string') return null
    entries.push({
      path: record.path,
      kind: record.kind,
      bytes: typeof record.bytes === 'number' ? record.bytes : null,
      sha256: typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256) ? record.sha256 : null,
    })
  }
  return entries
}

const inventoryOf = (root: string, base: string, entries: readonly ManifestEntry[] | null, mode: 'hash' | 'size' | 'none'): RuntimeInventory => {
  if (entries === null || mode === 'none')
    return { state: entries === null ? 'none' : 'partial', mode, listed: entries?.length ?? 0, checked: 0, hashed: 0, mismatches: [], skipped: entries?.length ?? 0 }
  const mismatches: { path: string; reason: string }[] = []
  let checked = 0, hashed = 0, skipped = 0
  for (const entry of entries) {
    if (mismatches.length >= 16) { skipped++; continue }
    if (entry.kind !== 'file') continue
    // Manifest paths are relative to the directory that holds install.json (the install root), which
    // is not always the directory the caller named.
    const absolute = resolve(base, entry.path)
    if (!inside(root, absolute)) { mismatches.push({ path: entry.path, reason: 'path escapes the installation root' }); continue }
    let stat
    try {
      stat = statSync(absolute)
    } catch {
      mismatches.push({ path: entry.path, reason: 'missing' })
      continue
    }
    if (!stat.isFile()) { mismatches.push({ path: entry.path, reason: 'not a regular file' }); continue }
    if (entry.bytes !== null && stat.size !== entry.bytes) {
      mismatches.push({ path: entry.path, reason: `size ${stat.size} ≠ manifest ${entry.bytes}` })
      continue
    }
    checked++
    if (mode === 'hash') {
      if (entry.sha256 === null) { mismatches.push({ path: entry.path, reason: 'manifest has no digest' }); continue }
      if (sha256File(absolute) !== entry.sha256) { mismatches.push({ path: entry.path, reason: 'digest mismatch' }); continue }
      hashed++
    }
  }
  const state: RuntimeInventory['state'] = mismatches.length > 0 ? 'partial'
    : skipped === 0 && checked === entries.filter(entry => entry.kind === 'file').length ? 'complete' : 'partial'
  return { state, mode, listed: entries.length, checked, hashed, mismatches, skipped }
}

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
  /** How thoroughly to check the manifest's own file list: digests, sizes only, or not at all. */
  readonly verify?: 'hash' | 'size' | 'none'
  /**
   * A process identity supplied by main/D from its own original start record. The module only
   * compares the recorded root with the inspected one; it never looks for a process.
   */
  readonly running?: {
    readonly root: string
    readonly pid?: number
    readonly startedAt?: string
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
  let entries: ManifestEntry[] | null = null
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
        entries = manifestEntries(parsed.files)
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
  // Scan the whole built entry closure, not just index.js: a package may re-export a symbol from a
  // sibling module, and "the name is not in index.js" is not "the capability is absent".
  const indexText = usageDir === null ? '' : scanTexts(filesUnder(usageDir, 'dist', /\.js$/))
  const coordinatorFiles = app === null ? [] : [
    ...filesUnder(app, 'apps/coordinator/http', /\.(ts|js)$/),
    ...filesUnder(app, 'apps/coordinator/product', /\.(ts|js)$/),
  ]
  const coordinatorText = scanTexts(coordinatorFiles)
  const consoleFiles = app === null ? [] : filesUnder(app, 'apps/console', /\.(ts|tsx|js)$/)
  const consoleText = scanTexts(consoleFiles)
  const signal = (text: string, needle: string): number => countOutsideComments(text, needle)
  const capabilities: RuntimeCapabilities | null = app === null ? null : {
    // The page route, not its export/support siblings: the terminator after the path is what
    // distinguishes them, and the opening quote is consumed by the scanner.
    pageObservation: signal(coordinatorText, "/v1/insights'") + signal(coordinatorText, '/v1/insights"') > 0 &&
      signal(indexText, 'analyzeUsageInsights') > 0,
    numericExport: signal(indexText, 'buildInsightExport') > 0,
    displayDownload: signal(indexText, 'buildDisplayExport') > 0 && signal(coordinatorText, '/v1/insights/export') > 0 &&
      (signal(consoleText, 'downloadUsageObservation') + signal(consoleText, '/v1/insights/export')) > 0,
    supportSummary: signal(indexText, 'buildSupportReport') > 0 && signal(coordinatorText, '/v1/insights/support') > 0,
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
      : signal(consoleText, 'downloadUsageObservation') + signal(consoleText, '/v1/insights/export') > 0 ? 'present' : 'absent',
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

  const inventory = inventoryOf(root, manifestPath === null ? root : dirname(manifestPath), entries, options.verify ?? 'hash')
  // A running claim is an input from main/D: this module compares roots and nothing else, because
  // discovering a process would require exactly the global scan this work must not do.
  let running: RuntimeRunningClaim | null = null
  if (options.running !== undefined) {
    let claimedRoot: string | null = null
    try {
      claimedRoot = realpathSync(resolve(options.running.root))
    } catch {
      claimedRoot = null
    }
    running = {
      root: options.running.root,
      rootMatches: claimedRoot !== null && claimedRoot === root,
      pid: typeof options.running.pid === 'number' ? options.running.pid : null,
      startedAt: typeof options.running.startedAt === 'string' ? options.running.startedAt : null,
      note: claimedRoot === null ? 'the claimed root does not exist'
        : claimedRoot === root ? 'the claimed root is this installation'
          : 'the claimed root is a different installation',
    }
    if (!running.rootMatches) unknown.push('the running process was started from a different root')
  } else unknown.push('no process start identity was supplied')

  const evidence: RuntimeEvidence = origin === null ? 'self_declared'
    : inventory.state === 'complete' && running?.rootMatches === true ? 'running_confirmed'
      : inventory.state === 'complete' ? 'inventory_verified' : 'self_declared'

  return {
    protocol: RUNTIME_IDENTITY_PROTOCOL,
    root,
    layout,
    manifest: { present: manifestPath !== null, state: manifestState, path: manifestPath === null ? null : relative(root, manifestPath),
      bytes: manifestBytes, buildId, sourceCommit, sourceDirty, declaredFiles },
    archive: { sha256: archiveSha256, source: archiveSource },
    capabilities,
    capabilitiesEvidence,
    inventory,
    evidence,
    running,
    origin,
    checks: { buildMatches, sourceMatches, archiveMatches },
    differences,
    unknown,
    authorization: 'none',
  }
}
