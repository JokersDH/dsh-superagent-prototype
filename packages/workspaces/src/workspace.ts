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
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  manifestPath: string
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

const ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const gitBuffer = (cwd: string, args: readonly string[]): Buffer =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })

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
    const patch = changedFiles.length ? gitBuffer(projectRoot, ['diff', 'HEAD']) : Buffer.alloc(0)
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
   * Freezes the attempt worktree: a manifest of every regular file (and symlink) with its digest,
   * the base/head commits and the worktree's dirty status. The returned digest is the artifact
   * identity the verification binds to; later changes make it differ.
   */
  freeze(ref: { attemptId: string }): FrozenArtifact {
    const record = this.record(ref.attemptId)
    const path = this.attemptPath(ref.attemptId)
    if (!existsSync(path)) throw new WorkspaceConflict(`Attempt ${ref.attemptId} has no workspace to freeze`)
    const headCommit = git(path, ['rev-parse', 'HEAD'])
    const status = statusEntries(gitBuffer(path, ['status', '--porcelain=v1', '-z']).toString('utf8'))
    const listed = gitBuffer(path, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)
    const untracked = gitBuffer(path, ['ls-files', '-z', '--others', '--exclude-standard']).toString('utf8').split('\0').filter(Boolean)
    const files = [...new Set([...listed, ...untracked])].sort().map(file => {
      const absolute = join(path, file)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        return { path: file, kind: 'symlink' as const, sha256: sha256(Buffer.concat([Buffer.from('symlink:'), Buffer.from(readFileSync(absolute, 'utf8'))])), bytes: stat.size }
      }
      if (!stat.isFile()) return { path: file, kind: 'other' as const, sha256: digestOfOther(file), bytes: stat.size }
      const data = readFileSync(absolute)
      return { path: file, kind: 'file' as const, sha256: sha256(data), bytes: data.byteLength }
    })
    const environment: Record<string, string> = { node: process.version, platform: process.platform, arch: process.arch }
    const artifactDigest = sha256(JSON.stringify({ baseCommit: record.baseCommit, headCommit, status, files, environment }))
    const manifestPath = join(this.manifestRoot, `${ref.attemptId}.json`)
    mkdirSync(this.manifestRoot, { recursive: true, mode: 0o700 })
    writeFileSync(manifestPath, `${JSON.stringify({ attemptId: ref.attemptId, baseCommit: record.baseCommit, headCommit, status, files, environment, artifactDigest }, null, 2)}\n`, { mode: 0o600 })
    return { attemptId: ref.attemptId, baseCommit: record.baseCommit, headCommit, artifactDigest, manifestPath, files: files.length, dirty: status.length > 0, environment }
  }

  /** Recomputes the artifact digest of the attempt worktree, for staleness checks before and after verification. */
  digest(ref: { attemptId: string }): string { return this.freeze(ref).artifactDigest }

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

const digestOfOther = (file: string): string => sha256(Buffer.from(`other:${file}`))
