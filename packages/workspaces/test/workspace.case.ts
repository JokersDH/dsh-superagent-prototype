/**
 * WP-04 workspace behaviour on real temporary git projects: a detached attempt worktree, the
 * user's dirty worktree preserved, freeze digests that change with content, and release that only
 * removes the attempt's own worktree.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { WorkspaceConflict, WorkspaceManager, type AssignmentIdentity } from '../src/index.ts'

const run = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const assignment: AssignmentIdentity = {
  ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1,
  contract: { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) },
}

/** A temporary project repository with a dirty tracked file and an untracked file. */
function project(): { dir: string; root: string; head: string; status: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wp04-project-'))
  const root = join(dir, 'project')
  mkdirSync(root)
  run(root, 'init', '-q')
  run(root, 'config', 'user.email', 'fixture@example.test')
  run(root, 'config', 'user.name', 'Fixture')
  writeFileSync(join(root, 'tracked.txt'), 'committed\n')
  writeFileSync(join(root, 'other.txt'), 'other\n')
  run(root, 'add', '.')
  run(root, 'commit', '-qm', 'base')
  const head = run(root, 'rev-parse', 'HEAD')
  // The user's uncommitted work: one modified tracked file and one untracked file.
  writeFileSync(join(root, 'tracked.txt'), 'user dirty change\n')
  writeFileSync(join(root, 'untracked.txt'), 'user scratch\n')
  return { dir, root, head, status: run(root, 'status', '--porcelain=v1') }
}

test('reserve creates a detached attempt worktree and leaves the user worktree untouched', () => {
  const fixture = project()
  const manager = new WorkspaceManager(join(fixture.dir, 'state'))
  try {
    const reserved = manager.reserve({ projectPath: fixture.root, assignment })
    assert.equal(reserved.baseCommit, fixture.head)
    assert.equal(run(reserved.path, 'rev-parse', 'HEAD'), fixture.head)
    assert.equal(readFileSync(join(reserved.path, 'tracked.txt'), 'utf8'), 'committed\n', 'the attempt starts from the committed base, not the dirty tree')
    assert.deepEqual(reserved.userWorktree.changedFiles, ['tracked.txt'])
    assert.deepEqual(reserved.userWorktree.untrackedFiles, ['untracked.txt'])
    assert.match(readFileSync(reserved.userWorktree.patchPath, 'utf8'), /user dirty change/)
    // The user's worktree is byte-for-byte what it was: dirty content kept, same status.
    assert.equal(run(fixture.root, 'status', '--porcelain=v1'), fixture.status)
    assert.equal(readFileSync(join(fixture.root, 'tracked.txt'), 'utf8'), 'user dirty change\n')
    assert.equal(readFileSync(join(fixture.root, 'untracked.txt'), 'utf8'), 'user scratch\n')
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})

test('freeze records a manifest whose digest changes when the attempt worktree changes', () => {
  const fixture = project()
  const manager = new WorkspaceManager(join(fixture.dir, 'state'))
  try {
    const reserved = manager.reserve({ projectPath: fixture.root, assignment })
    const first = manager.freeze({ attemptId: assignment.attemptId })
    assert.match(first.artifactDigest, /^[0-9a-f]{64}$/)
    assert.equal(first.files, 2)
    assert.equal(first.dirty, false)
    assert.ok(existsSync(first.manifestPath))
    const manifest = JSON.parse(readFileSync(first.manifestPath, 'utf8'))
    assert.deepEqual(manifest.files.map((file: { path: string }) => file.path), ['other.txt', 'tracked.txt'])
    assert.equal(manifest.environment.platform, process.platform)
    assert.equal(manager.digest({ attemptId: assignment.attemptId }), first.artifactDigest, 'the digest is stable without changes')

    // A frozen candidate that is then modified no longer matches what the verifier would run.
    writeFileSync(join(reserved.path, 'tracked.txt'), 'modified after freeze\n')
    const second = manager.freeze({ attemptId: assignment.attemptId })
    assert.notEqual(second.artifactDigest, first.artifactDigest, 'a post-freeze modification changes the artifact digest')
    assert.equal(second.dirty, true)
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})

test('release removes only the attempt worktree; the user worktree and history stay intact', () => {
  const fixture = project()
  const manager = new WorkspaceManager(join(fixture.dir, 'state'))
  try {
    const reserved = manager.reserve({ projectPath: fixture.root, assignment })
    manager.freeze({ attemptId: assignment.attemptId })
    manager.release({ attemptId: assignment.attemptId })
    assert.equal(existsSync(reserved.path), false)
    assert.equal(run(fixture.root, 'status', '--porcelain=v1'), fixture.status)
    assert.equal(readFileSync(join(fixture.root, 'tracked.txt'), 'utf8'), 'user dirty change\n')
    assert.equal(run(fixture.root, 'worktree', 'list').includes(reserved.path), false, 'the attempt worktree registration is gone')
    manager.release({ attemptId: assignment.attemptId })
    assert.equal(run(fixture.root, 'status', '--porcelain=v1'), fixture.status, 'a repeated release is a no-op')
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})

test('reserve refuses a duplicate attempt, an invalid id, and an attempt root inside the project', () => {
  const fixture = project()
  try {
    const manager = new WorkspaceManager(join(fixture.dir, 'state'))
    manager.reserve({ projectPath: fixture.root, assignment })
    assert.throws(() => manager.reserve({ projectPath: fixture.root, assignment }), WorkspaceConflict)
    assert.throws(() => manager.reserve({ projectPath: fixture.root, assignment: { ...assignment, attemptId: '../escape' } }), WorkspaceConflict)
    const inside = new WorkspaceManager(join(fixture.root, 'attempts'))
    assert.throws(() => inside.reserve({ projectPath: fixture.root, assignment: { ...assignment, attemptId: 'attempt-2' } }), /must not contain each other/)
    assert.throws(() => manager.freeze({ attemptId: 'unknown' }), WorkspaceConflict)
  } finally { rmSync(fixture.dir, { recursive: true, force: true }) }
})
