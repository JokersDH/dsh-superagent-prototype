/**
 * Controlled git worktrees for attempts (WP-04). The user's project repository is only ever read
 * (`rev-parse`, `status`, `diff`, `ls-files`): it is never reset, checked out, cleaned or stashed.
 * Each attempt gets a detached worktree under our own state directory; a freeze captures a
 * content-addressed manifest of that worktree plus its environment, so a later modification is a
 * digest mismatch rather than a silent verification of different content.
 *
 * A git worktree is not a sandbox: it shares the repository's objects, refs, hooks and remotes.
 * Delivery stays patch/branch based; nothing here merges, deploys or rewrites user content.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** The attempt an attempt-worktree belongs to; the Assignment identity is recorded, never invented. */
export interface AssignmentIdentity {
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: { workId: string; revision: number; digest: string }
}

export interface UserWorktreeSnapshot {
  /** The repository's HEAD at reserve time, which is also the attempt's base commit. */
  baseCommit: string
  /** Patch of the user's tracked dirty changes at reserve time, kept as audit evidence only. */
  patchPath: string
  changedFiles: readonly string[]
  untrackedFiles: readonly string[]
}

export interface ReservedWorkspace {
  attemptId: string
  /** The attempt worktree path (under our root; not the user's tree). */
  path: string
  projectPath: string
  baseCommit: string
  userWorktree: UserWorktreeSnapshot
  /** Worktrees share the user repository's git metadata and are not a security sandbox. */
  sharedGitMetadata: 'user_repository'
}

export interface FrozenArtifact {
  attemptId: string
  baseCommit: string
  headCommit: string
  artifactDigest: string
  /** Attempt-neutral, content-addressed manifest of the frozen content. */
  manifestPath: string
  /** Per-attempt index that maps this attempt to the content-addressed manifest/patch. */
  manifestRefPath: string
  /** Content-addressed diff of the attempt worktree against its base commit (includes deletions and untracked contents). */
  patchPath: string
  files: number
  dirty: boolean
  environment: Readonly<Record<string, string>>
}

export interface ReserveOptions {
  /** The user's project repository (read-only for this manager). */
  projectPath: string
  assignment: AssignmentIdentity
  /** Base commit for the attempt worktree; defaults to the project's HEAD. */
  baseCommit?: string
}

export class WorkspaceConflict extends Error {}

interface ManifestEntry {
  path: string
  kind: 'file' | 'symlink' | 'deleted' | 'other'
  sha256: string
  bytes: number
  executable?: boolean
}

const ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const MAX_GIT_BUFFER = 64 * 1024 * 1024
const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_GIT_BUFFER }).trim()

const gitBuffer = (cwd: string, args: readonly string[]): Buffer =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_GIT_BUFFER })

const gitBufferWithIndex = (cwd: string, args: readonly string[], indexFile: string): Buffer =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_INDEX_FILE: indexFile }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_GIT_BUFFER })

/**
 * Working-tree patch against a base commit that includes the contents of untracked files. Git's
 * real index is untouched: a temporary index is seeded from the base, the untracked paths are marked
 * intent-to-add there, and `git diff --binary <base>` renders tracked changes plus new files (text,
 * binary, symlink and executable modes) without modifying the user's tree or index.
 */
function workingTreePatch(cwd: string, base: string, untracked: readonly string[]): Buffer {
  if (!untracked.length) return gitBuffer(cwd, ['diff', '--binary', base])
  const directory = mkdtempSync(join(tmpdir(), 'pa-worktree-patch-'))
  try {
    const indexFile = join(directory, 'index')
    gitBufferWithIndex(cwd, ['read-tree', base], indexFile)
    gitBufferWithIndex(cwd, ['add', '-N', '--', ...untracked], indexFile)
    return gitBufferWithIndex(cwd, ['diff', '--binary', base], indexFile)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

/** Parses `git status --porcelain=v1 -z` into status codes and paths. */
function statusEntries(raw: string): { status: string; path: string }[] {
  const entries: { status: string; path: string }[] = []
  let index = 0
  while (index < raw.length) {
    const status = raw.slice(index, index + 2)
    index += 3 // two status characters plus the separating space
    const end = raw.indexOf('\0', index)
    const path = raw.slice(index, end === -1 ? raw.length : end)
    index = end === -1 ? raw.length : end + 1
    if (path) entries.push({ status, path })
  }
  return entries
}

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))
}

/** Canonical path with symlinked ancestors resolved, so /var ↔ /private/var comparisons are honest. */
function canonical(path: string): string {
  let current = resolve(path)
  const rest: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    rest.unshift(current.slice(parent.length).replace(/^[\\/]+/, ''))
    current = parent
  }
  try { current = realpathSync(current) } catch { /* keep the resolved path */ }
  return rest.length ? join(current, ...rest) : current
}

interface AttemptRecord {
  assignment: AssignmentIdentity
  projectPath: string
  baseCommit: string
  userWorktree: UserWorktreeSnapshot
}

export class WorkspaceManager {
  private readonly rootDir: string
  constructor(rootDir: string) {
    this.rootDir = canonical(rootDir)
  }

  get attemptRoot(): string { return join(this.rootDir, 'attempts') }
  get manifestRoot(): string { return join(this.rootDir, 'manifests') }
  private recordPath(attemptId: string): string { return join(this.rootDir, 'attempt-records', `${attemptId}.json`) }
  private patchPath(attemptId: string): string { return join(this.rootDir, 'attempt-records', `${attemptId}.user.patch`) }
  attemptPath(attemptId: string): string { return join(this.attemptRoot, attemptId) }

  /**
   * Reserves a detached worktree for an attempt at the project's base commit. The user's dirty
   * tracked changes are written to an audit patch; the user's worktree itself is never modified.
   */
  reserve(options: ReserveOptions): ReservedWorkspace {
    const { assignment } = options
    if (!ATTEMPT_ID.test(assignment.attemptId)) throw new WorkspaceConflict(`Invalid attempt id: ${assignment.attemptId}`)
    if (!existsSync(options.projectPath)) throw new WorkspaceConflict(`Project path does not exist: ${options.projectPath}`)
    const projectRoot = realpathSync(git(options.projectPath, ['rev-parse', '--show-toplevel']))
    if (inside(projectRoot, this.rootDir) || inside(this.rootDir, projectRoot)) {
      throw new WorkspaceConflict('The attempt root and the user project must not contain each other')
    }
    const path = this.attemptPath(assignment.attemptId)
    if (existsSync(path)) throw new WorkspaceConflict(`Attempt ${assignment.attemptId} already has a workspace at ${path}`)
    if (existsSync(this.recordPath(assignment.attemptId))) throw new WorkspaceConflict(`Attempt ${assignment.attemptId} is already recorded`)
    const baseCommit = options.baseCommit ?? git(projectRoot, ['rev-parse', 'HEAD'])

    mkdirSync(this.attemptRoot, { recursive: true, mode: 0o700 })
    mkdirSync(dirname(this.recordPath(assignment.attemptId)), { recursive: true, mode: 0o700 })
    git(projectRoot, ['worktree', 'add', '--detach', path, baseCommit])

    // Audit snapshot of the user's dirty worktree: read-only commands, no reset/clean/stash.
    const status = statusEntries(gitBuffer(projectRoot, ['status', '--porcelain=v1', '-z']).toString('utf8'))
    const changedFiles = status.filter(entry => !entry.status.includes('?')).map(entry => entry.path).sort()
    const untrackedFiles = status.filter(entry => entry.status === '??').map(entry => entry.path).sort()
    // The audit patch is the complete user delta at reserve time, including untracked new files.
    const patch = workingTreePatch(projectRoot, 'HEAD', untrackedFiles)
    const patchPath = this.patchPath(assignment.attemptId)
    writeFileSync(patchPath, patch, { mode: 0o600 })
    const userWorktree: UserWorktreeSnapshot = { baseCommit, patchPath, changedFiles, untrackedFiles }
    const record: AttemptRecord = { assignment: structuredClone(assignment), projectPath: projectRoot, baseCommit, userWorktree }
    writeFileSync(this.recordPath(assignment.attemptId), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    return {
      attemptId: assignment.attemptId,
      path,
      projectPath: projectRoot,
      baseCommit,
      userWorktree,
      sharedGitMetadata: 'user_repository',
    }
  }

  /**
   * Freezes the attempt worktree: a content-addressed manifest of every tracked/untracked path with
   * its identity. Deleted tracked files are recorded as `deleted` (a legitimate deliverable) and the
   * attempt's diff is captured, including that deletion; the user's tree is never touched. Symlinks
   * hash their link text (never the target's contents or a dangling target), regular files include
   * their executable bit, and the manifest is addressed by its digest so re-freezing never overwrites
   * an earlier audit manifest.
   */
  freeze(ref: { attemptId: string }): FrozenArtifact {
    const frozen = this.computeManifest(ref.attemptId)
    const manifestPath = join(this.manifestRoot, `${frozen.artifactDigest}.json`)
    const patchPath = join(this.manifestRoot, `${frozen.artifactDigest}.patch`)
    const refDir = join(this.manifestRoot, 'attempts')
    const manifestRefPath = join(refDir, `${ref.attemptId}.${frozen.artifactDigest}.json`)
    mkdirSync(this.manifestRoot, { recursive: true, mode: 0o700 })
    mkdirSync(refDir, { recursive: true, mode: 0o700 })
    // The content-addressed manifest must not claim an attempt: an identical later attempt shares
    // the same bytes. Attempt identity lives in its own (attempt, digest) index instead.
    if (!existsSync(manifestPath)) {
      writeFileSync(manifestPath, `${JSON.stringify({ baseCommit: frozen.baseCommit, headCommit: frozen.headCommit,
        status: frozen.status, files: frozen.entries, patchSha256: frozen.patchSha256, environment: frozen.environment, artifactDigest: frozen.artifactDigest }, null, 2)}\n`, { mode: 0o600 })
    }
    if (!existsSync(patchPath)) writeFileSync(patchPath, frozen.patch, { mode: 0o600 })
    if (!existsSync(manifestRefPath)) {
      writeFileSync(manifestRefPath, `${JSON.stringify({ attemptId: ref.attemptId, artifactDigest: frozen.artifactDigest, manifestPath, patchPath,
        frozenAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
    }
    return { attemptId: ref.attemptId, baseCommit: frozen.baseCommit, headCommit: frozen.headCommit, artifactDigest: frozen.artifactDigest,
      manifestPath, manifestRefPath, patchPath, files: frozen.entries.length, dirty: frozen.status.length > 0, environment: frozen.environment }
  }

  /** Recomputes the artifact digest without writing anything, so an audit manifest is preserved. */
  digest(ref: { attemptId: string }): string { return this.computeManifest(ref.attemptId).artifactDigest }

  private computeManifest(attemptId: string): {
    baseCommit: string; headCommit: string; status: { status: string; path: string }[]
    entries: ManifestEntry[]; patch: Buffer; patchSha256: string
    environment: Record<string, string>; artifactDigest: string
  } {
    const record = this.record(attemptId)
    const path = this.attemptPath(attemptId)
    if (!existsSync(path)) throw new WorkspaceConflict(`Attempt ${attemptId} has no workspace to freeze`)
    const headCommit = git(path, ['rev-parse', 'HEAD'])
    const status = statusEntries(gitBuffer(path, ['status', '--porcelain=v1', '-z']).toString('utf8'))
    const deleted = new Set(status.filter(entry => entry.status.includes('D')).map(entry => entry.path))
    const listed = gitBuffer(path, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
    const untracked = gitBuffer(path, ['ls-files', '-z', '--others', '--exclude-standard']).toString('utf8').split('\0').filter(Boolean)
    const entries: ManifestEntry[] = [...new Set([...listed, ...untracked])].sort().map(file => {
      const absolute = join(path, file)
      let stat
      try { stat = lstatSync(absolute) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && deleted.has(file)) {
          return { path: file, kind: 'deleted', sha256: sha256(`deleted:${file}`), bytes: 0 }
        }
        throw error
      }
      if (stat.isSymbolicLink()) {
        // The link text is the content; never resolve (or read) a dangling/outside target.
        const target = readlinkSync(absolute)
        return { path: file, kind: 'symlink', sha256: sha256(`symlink:${target}`), bytes: Buffer.byteLength(target) }
      }
      if (!stat.isFile()) return { path: file, kind: 'other', sha256: sha256(`other:${file}`), bytes: stat.size }
      const data = readFileSync(absolute)
      return { path: file, kind: 'file', sha256: sha256(data), bytes: data.byteLength, executable: (stat.mode & 0o111) !== 0 }
    })
    // The delivery patch must reproduce new/untracked files as well as tracked changes/deletions.
    const patch = workingTreePatch(path, 'HEAD', untracked)
    const patchSha256 = sha256(patch)
    const environment: Record<string, string> = { node: process.version, platform: process.platform, arch: process.arch }
    const artifactDigest = sha256(JSON.stringify({ baseCommit: record.baseCommit, headCommit, status, entries, patchSha256, environment }))
    return { baseCommit: record.baseCommit, headCommit, status, entries, patch, patchSha256, environment, artifactDigest }
  }

  /** Removes the attempt's own worktree; the user's project worktree is untouched and the manifest stays for audit. */
  release(ref: { attemptId: string }): void {
    const metaPath = this.recordPath(ref.attemptId)
    if (!existsSync(metaPath)) return
    const record = JSON.parse(readFileSync(metaPath, 'utf8')) as AttemptRecord
    const path = this.attemptPath(ref.attemptId)
    if (!inside(this.rootDir, path)) throw new WorkspaceConflict(`Refusing to release a workspace outside the attempt root: ${path}`)
    if (existsSync(path)) git(record.projectPath, ['worktree', 'remove', '--force', path])
    rmSync(metaPath, { force: true })
  }

  private record(attemptId: string): AttemptRecord {
    if (!ATTEMPT_ID.test(attemptId)) throw new WorkspaceConflict(`Invalid attempt id: ${attemptId}`)
    const metaPath = this.recordPath(attemptId)
    if (!existsSync(metaPath)) throw new WorkspaceConflict(`Attempt ${attemptId} has no reserved workspace`)
    return JSON.parse(readFileSync(metaPath, 'utf8')) as AttemptRecord
  }
}

