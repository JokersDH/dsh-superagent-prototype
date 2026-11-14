/**
 * Bounded, read-only project metadata observation for `tools/project-recipes`.
 *
 * Rules this module enforces (see docs/project-recipes/facts-contract.md):
 *  - only an explicitly authorized absolute root, never the caller's cwd, home directory or `/`;
 *  - only allow-listed *names* directly under that root — no recursion, no sibling, no parent;
 *  - `O_NOFOLLOW` + `fstat` on every read: a symlink or non-regular file is refused, not followed;
 *  - hard byte budgets for each file, for the whole observation and for the number of reads;
 *  - `package.json` is parsed as JSON; lockfiles are hashed as opaque bytes and never parsed;
 *  - the result carries names, digests, counts and closed-enum flags only — no script bodies,
 *    no absolute paths, no environment, no credentials;
 *  - nothing is written, executed or installed, and no version command is run.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'
import type { ProjectFacts } from '../../packages/project-recipes/src/index.ts'

/**
 * Closed name lists kept local so this reader has no runtime dependency on the library build; a test
 * asserts they match the package's exported constants.
 */
export const KNOWN_LOCKFILE_NAMES = ['package-lock.json', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb'] as const
export const FOREIGN_MARKER_NAMES = ['pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle'] as const

/** Names this reader may open. Anything else is never touched. */
export const METADATA_NAMES = ['package.json', 'tsconfig.json', 'pnpm-workspace.yaml', ...KNOWN_LOCKFILE_NAMES, ...FOREIGN_MARKER_NAMES] as const
export type MetadataName = (typeof METADATA_NAMES)[number]

export interface MetadataLimits {
  readonly maxJsonBytes: number
  readonly maxLockfileBytes: number
  readonly maxFiles: number
  readonly maxTotalBytes: number
}

export const DEFAULT_METADATA_LIMITS: MetadataLimits = Object.freeze({
  maxJsonBytes: 256 * 1024,
  maxLockfileBytes: 4 * 1024 * 1024,
  maxFiles: 12,
  maxTotalBytes: 8 * 1024 * 1024,
})

export type MetadataRefusalCode =
  | 'root_not_absolute'
  | 'root_missing'
  | 'root_not_directory'
  | 'root_forbidden'
  | 'symlink'
  | 'not_regular_file'
  | 'too_large'
  | 'budget_exceeded'
  | 'unreadable'
  | 'invalid_json'
  | 'not_object'

export class MetadataRefused extends Error {
  readonly code: MetadataRefusalCode
  /** Relative name of the offending entry, or the root label; never file content. */
  readonly target: string
  constructor(code: MetadataRefusalCode, target: string, message: string) {
    super(message)
    this.name = 'MetadataRefused'
    this.code = code
    this.target = target
  }
}

export interface Observation {
  readonly facts: ProjectFacts
  /** Path-free remarks for the caller's stderr (e.g. "lockfile too large, digest omitted"). */
  readonly notes: readonly string[]
}

interface Budget {
  files: number
  bytes: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Resolve and validate an explicitly authorized root. The caller always names it; we never guess. */
export function authorizeRoot(root: string): string {
  if (!isAbsolute(root)) throw new MetadataRefused('root_not_absolute', root, 'root must be an absolute path')
  let resolved: string
  try {
    resolved = realpathSync(root)
    if (!statSync(resolved).isDirectory()) throw new MetadataRefused('root_not_directory', root, 'root is not a directory')
  } catch (error) {
    if (error instanceof MetadataRefused) throw error
    throw new MetadataRefused('root_missing', root, 'root does not exist')
  }
  const home = (() => {
    try {
      return realpathSync(homedir())
    } catch {
      return homedir()
    }
  })()
  if (resolved === sep || resolved === home)
    throw new MetadataRefused('root_forbidden', root, 'root must be a project directory, not / or the home directory')
  return resolved
}

/** Presence-only probe: no read, but a symlink is still refused so a link cannot fake a lockfile. */
function probe(root: string, name: MetadataName): 'file' | 'missing' {
  const path = join(root, name)
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return 'missing'
  }
  if (stats.isSymbolicLink()) throw new MetadataRefused('symlink', name, 'refusing to follow a symlink')
  if (!stats.isFile()) throw new MetadataRefused('not_regular_file', name, 'metadata entry is not a regular file')
  return 'file'
}

function readBounded(root: string, name: MetadataName, maxBytes: number, budget: Budget, limits: MetadataLimits): Buffer {
  const path = join(root, name)
  const stats = lstatSync(path)
  if (stats.isSymbolicLink()) throw new MetadataRefused('symlink', name, 'refusing to follow a symlink')
  if (!stats.isFile()) throw new MetadataRefused('not_regular_file', name, 'metadata entry is not a regular file')
  if (stats.size > maxBytes) throw new MetadataRefused('too_large', name, `${name} exceeds ${maxBytes} bytes`)
  if (budget.files + 1 > limits.maxFiles) throw new MetadataRefused('budget_exceeded', name, 'metadata file budget exhausted')
  budget.files += 1

  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile()) throw new MetadataRefused('not_regular_file', name, 'metadata entry is not a regular file')
    if (opened.size > maxBytes) throw new MetadataRefused('too_large', name, `${name} exceeds ${maxBytes} bytes`)
    if (budget.bytes + opened.size > limits.maxTotalBytes)
      throw new MetadataRefused('budget_exceeded', name, 'total metadata byte budget exhausted')
    const buffer = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < opened.size) {
      const read = readSync(fd, buffer, offset, opened.size - offset, offset)
      if (read <= 0) throw new MetadataRefused('unreadable', name, 'file shrank while being read')
      offset += read
    }
    budget.bytes += opened.size
    // The parent must still be the authorized root: no path swap between probe and read.
    if (realpathSync(dirname(join(root, name))) !== root) throw new MetadataRefused('root_missing', name, 'root changed while being read')
    return buffer
  } finally {
    closeSync(fd)
  }
}

/** Read one explicit JSON file (config snapshot, injected facts). Same NOFOLLOW/byte rules. */
export function readJsonFile(path: string, maxBytes = 2 * 1024 * 1024): unknown {
  const absolute = isAbsolute(path) ? path : join(process.cwd(), path)
  let stats
  try {
    stats = lstatSync(absolute)
  } catch {
    throw new MetadataRefused('unreadable', basename(absolute), 'file does not exist or cannot be inspected')
  }
  if (stats.isSymbolicLink()) throw new MetadataRefused('symlink', basename(absolute), 'refusing to follow a symlink')
  if (!stats.isFile()) throw new MetadataRefused('not_regular_file', basename(absolute), 'not a regular file')
  if (stats.size > maxBytes) throw new MetadataRefused('too_large', basename(absolute), `file exceeds ${maxBytes} bytes`)
  const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fstatSync(fd)
    const buffer = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < opened.size) {
      const read = readSync(fd, buffer, offset, opened.size - offset, offset)
      if (read <= 0) throw new MetadataRefused('unreadable', basename(absolute), 'file shrank while being read')
      offset += read
    }
    try {
      return JSON.parse(buffer.toString('utf8')) as unknown
    } catch {
      throw new MetadataRefused('invalid_json', basename(absolute), 'file is not valid JSON')
    }
  } finally {
    closeSync(fd)
  }
}

const managerDeclaration = (field: unknown): { kind: 'pnpm' | 'npm' | 'unsupported'; version?: string } | undefined => {
  if (typeof field !== 'string') return undefined
  const match = /^(pnpm|npm|yarn|bun|other)@([0-9][0-9A-Za-z.+-]*)$/.exec(field.trim())
  if (!match) return undefined
  const name = match[1]!
  const version = match[2]!
  if (name === 'pnpm' || name === 'npm') return { kind: name, version }
  return { kind: 'unsupported' }
}

const SCRIPT_NAME = /^[A-Za-z0-9:._-]{1,128}$/

/**
 * Observe one authorized project root. Deterministic for a fixed tree; the only clock input is
 * `observedAt`, which the caller must supply.
 */
export function observeProjectMetadata(input: {
  readonly root: string
  readonly projectId: string
  readonly observedAt: string
  readonly provider?: string
  readonly limits?: Partial<MetadataLimits>
}): Observation {
  const root = authorizeRoot(input.root)
  const limits: MetadataLimits = { ...DEFAULT_METADATA_LIMITS, ...(input.limits ?? {}) }
  const budget: Budget = { files: 0, bytes: 0 }
  const notes: string[] = []
  const missing = new Set<ProjectFacts['missing'][number]>()
  const inputs: string[] = []

  const has = (name: MetadataName): boolean => probe(root, name) === 'file'

  const locks: { name: (typeof KNOWN_LOCKFILE_NAMES)[number]; digest?: string }[] = []
  for (const name of KNOWN_LOCKFILE_NAMES) {
    if (!has(name)) continue
    const stats = lstatSync(join(root, name))
    if (stats.size > limits.maxLockfileBytes) {
      notes.push(`${name} 超过 ${limits.maxLockfileBytes} 字节，未计算摘要。`)
      missing.add('lockfile')
      locks.push({ name })
      continue
    }
    const digest = createHash('sha256').update(readBounded(root, name, limits.maxLockfileBytes, budget, limits)).digest('hex')
    inputs.push(digest)
    locks.push({ name, digest })
  }
  if (locks.length === 0) missing.add('lockfile')

  const foreignMarkers = FOREIGN_MARKER_NAMES.filter((marker) => has(marker))
  const hasPackageJson = has('package.json')
  const hasTsconfig = has('tsconfig.json')
  const hasPnpmWorkspace = has('pnpm-workspace.yaml')

  let stack: ProjectFacts['stack']
  let packageManagerField: string | undefined
  let enginesNode: string | undefined
  let workspaceDeclaration: ProjectFacts['workspace']['declaration'] = hasPnpmWorkspace ? 'pnpm_workspace_yaml' : 'none'
  let scripts: string[] = []
  let manager: ProjectFacts['manager'] = { kind: 'none' }

  if (hasPackageJson) {
    const bytes = readBounded(root, 'package.json', limits.maxJsonBytes, budget, limits)
    inputs.push(createHash('sha256').update(bytes).digest('hex'))
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8')) as unknown
    } catch {
      throw new MetadataRefused('invalid_json', 'package.json', 'package.json is not valid JSON')
    }
    if (!isRecord(parsed)) throw new MetadataRefused('not_object', 'package.json', 'package.json must be a JSON object')

    if (typeof parsed.packageManager === 'string') packageManagerField = parsed.packageManager.trim().slice(0, 120)
    const engines = isRecord(parsed.engines) ? parsed.engines : undefined
    if (engines && typeof engines.node === 'string') enginesNode = engines.node.trim().slice(0, 200)
    else missing.add('enginesNode')

    const workspaces = parsed.workspaces
    const declaredWorkspaces = Array.isArray(workspaces) ? workspaces.length > 0 : isRecord(workspaces)
    if (declaredWorkspaces) workspaceDeclaration = 'package_json_workspaces'

    if (isRecord(parsed.scripts)) {
      const names = Object.keys(parsed.scripts)
      const kept = names.filter((name) => SCRIPT_NAME.test(name)).sort()
      scripts = kept.slice(0, 512)
      if (kept.length !== names.length) notes.push('部分脚本名包含非安全字符，已省略（脚本正文从未读取）。')
      if (kept.length > scripts.length) notes.push('脚本名超过 512 条，已截断。')
    } else {
      missing.add('scripts')
    }

    stack = {
      kind: 'node',
      ...(packageManagerField === undefined ? {} : { packageManagerField }),
      ...(enginesNode === undefined ? {} : { enginesNode }),
    }

    const declared = managerDeclaration(packageManagerField)
    const families = new Set<'pnpm' | 'npm'>(locks.flatMap((lock) => (lock.name === 'pnpm-lock.yaml' ? (['pnpm'] as const) : lock.name === 'package-lock.json' || lock.name === 'npm-shrinkwrap.json' ? (['npm'] as const) : [])))
    if (declared?.kind === 'unsupported') manager = { kind: 'unsupported', name: packageManagerField?.startsWith('yarn') ? 'yarn' : packageManagerField?.startsWith('bun') ? 'bun' : 'other' }
    else if (declared) manager = { kind: declared.kind, ...(declared.version === undefined ? {} : { declaredVersion: declared.version }) }
    else if (families.size === 1) manager = { kind: [...families][0]! }
    else if (families.size > 1) manager = { kind: 'unknown', reason: 'ambiguous_lock' }
    else if (locks.some((lock) => lock.name === 'yarn.lock')) manager = { kind: 'unsupported', name: 'yarn' }
    else if (locks.some((lock) => lock.name === 'bun.lockb')) manager = { kind: 'unsupported', name: 'bun' }
    else if (packageManagerField !== undefined) manager = { kind: 'unknown', reason: 'unobserved' }
    else manager = { kind: 'none' }
    if (manager.kind === 'unknown') missing.add('manager')
  } else {
    missing.add('packageJson')
    stack = foreignMarkers.length > 0
      ? { kind: 'not_node', markers: foreignMarkers }
      : { kind: 'unknown', reason: 'unobserved' }
    if (foreignMarkers.length === 0) missing.add('manager')
  }

  const facts: ProjectFacts = {
    protocol: 'project-facts/1',
    projectId: input.projectId,
    observedAt: input.observedAt,
    provenance: {
      source: 'authorized_metadata',
      provider: input.provider ?? 'project-recipes-cli/1',
      authority: 'none',
      scope: workspaceDeclaration === 'none' ? 'package' : 'workspace_root',
      inputs: [...new Set(inputs)].sort().slice(0, 16),
    },
    stack,
    manager,
    locks: locks.slice(0, KNOWN_LOCKFILE_NAMES.length),
    workspace: { declaration: workspaceDeclaration },
    scripts,
    languages: hasPackageJson ? (hasTsconfig ? ['node', 'typescript'] : ['node']) : [],
    missing: [...missing],
  }
  if (hasTsconfig) notes.push('观察到 tsconfig.json 标记（只探测存在性，未读取内容）。')
  return { facts, notes }
}
