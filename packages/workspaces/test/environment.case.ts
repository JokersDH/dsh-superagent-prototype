import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { WorkspaceManager, WorkspaceConflict, type AssignmentIdentity, type WorkspaceEnvironment, type WorkspaceEnvironmentPort } from '../src/index.ts'

const assignment: AssignmentIdentity = {
  ticketId: 'ticket-env', assignmentId: 'assignment-env', attemptId: 'attempt-env', fenceEpoch: 1,
  contract: { workId: 'work-env', revision: 1, digest: 'a'.repeat(64) },
}
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
function fixture(t: { after(fn: () => void): void }, port?: WorkspaceEnvironmentPort) {
  const directory = mkdtempSync('/tmp/pa-workspace-environment-'), project = join(directory, 'project'), state = join(directory, 'state')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(project)
  git(project, ['init', '-q'])
  git(project, ['config', 'user.email', 'fixture@example.test'])
  git(project, ['config', 'user.name', 'Fixture'])
  writeFileSync(join(project, 'source.mjs'), 'export const base = 1\n')
  git(project, ['add', '.'])
  git(project, ['commit', '-qm', 'base'])
  const manager = new WorkspaceManager(state, port ? { environment: port } : {})
  const reserved = manager.reserve({ projectPath: project, assignment })
  return { directory, project, state, manager, path: reserved.path }
}
const attachment = (excludedPaths: readonly string[]): WorkspaceEnvironment => ({ reference: 'environment:receipt-1', fingerprint: 'b'.repeat(64), excludedPaths })
const fixed = (value: WorkspaceEnvironment): WorkspaceEnvironmentPort => ({ current: () => value })
const environmentFiles = (path: string) => {
  mkdirSync(join(path, 'node_modules/dependency'), { recursive: true })
  writeFileSync(join(path, 'node_modules/dependency/index.js'), 'private dependency bytes\n')
  mkdirSync(join(path, '.product-environment'))
  writeFileSync(join(path, '.product-environment/marker.json'), '{"private":"fixture-only"}\n')
}

test('trusted environment exclusions leave complete staged/untracked/binary business patches and both real indexes untouched', (t) => {
  const h = fixture(t, fixed(attachment(['node_modules', '.product-environment'])))
  environmentFiles(h.path)
  writeFileSync(join(h.path, 'source.mjs'), 'export const base = 2\n')
  writeFileSync(join(h.path, 'staged.mjs'), 'export const staged = true\n')
  git(h.path, ['add', 'staged.mjs'])
  writeFileSync(join(h.path, 'untracked.mjs'), 'export const added = true\n')
  writeFileSync(join(h.path, 'binary.bin'), Buffer.from([0, 1, 2, 255, 0]))
  const userIndex = readFileSync(join(h.project, '.git/index'))
  const attemptIndexPath = git(h.path, ['rev-parse', '--git-path', 'index'])
  const attemptIndex = readFileSync(attemptIndexPath)
  const frozen = h.manager.freeze(assignment)
  const patch = readFileSync(frozen.patchPath)
  assert.doesNotMatch(patch.toString(), /node_modules|product-environment|private dependency|fixture-only/)
  assert.deepEqual(JSON.parse(readFileSync(frozen.manifestPath, 'utf8')).files.map((file: { path: string }) => file.path), ['binary.bin', 'source.mjs', 'staged.mjs', 'untracked.mjs'])
  const clone = join(h.directory, 'clone')
  git(h.directory, ['clone', '-q', h.project, clone])
  git(clone, ['apply', '--binary', frozen.patchPath])
  for (const file of ['source.mjs', 'staged.mjs', 'untracked.mjs', 'binary.bin'])
    assert.deepEqual(readFileSync(join(clone, file)), readFileSync(join(h.path, file)))
  assert.deepEqual(readFileSync(join(h.project, '.git/index')), userIndex)
  assert.deepEqual(readFileSync(attemptIndexPath), attemptIndex)
  assert.equal(git(h.project, ['status', '--porcelain']), '')
})
test('environment proof and exclusion policy are bound into neutral content identity and survive reconstruction', (t) => {
  let value = attachment(['node_modules', '.product-environment'])
  const port: WorkspaceEnvironmentPort = { current: ({ assignment: actual, workspacePath }) => {
    assert.deepEqual(actual, assignment)
    assert.equal(workspacePath, h.path)
    return value
  } }
  const h = fixture(t, port)
  environmentFiles(h.path)
  const frozen = h.manager.freeze(assignment)
  assert.equal(frozen.dirty, false)
  assert.equal(frozen.environment.preparedEnvironmentFingerprint, value.fingerprint)
  assert.equal(frozen.environment.exclusionPolicy, 'workspace-environment/1')
  value = { ...value, excludedPaths: ['.product-environment', 'node_modules', 'node_modules'] }
  assert.equal(new WorkspaceManager(h.state, { environment: port }).digest(assignment), frozen.artifactDigest)
  value = { ...value, fingerprint: 'c'.repeat(64) }
  assert.notEqual(h.manager.digest(assignment), frozen.artifactDigest)
  assert.equal(JSON.parse(readFileSync(frozen.manifestPath, 'utf8')).environment.preparedEnvironmentFingerprint, 'b'.repeat(64))
  assert.notEqual(new WorkspaceManager(h.state).digest(assignment), frozen.artifactDigest)
})
test('every freeze/digest invokes the trusted verifier and refuses dependency drift or unavailable proof', (t) => {
  let expected: string
  let calls = 0
  const h = fixture(t, { current: ({ workspacePath }) => {
    calls++
    const actual = hash(readFileSync(join(workspacePath, 'node_modules/dependency/index.js')))
    if (actual !== expected) throw new Error('untrusted dependency changed')
    return attachment(['node_modules', '.product-environment'])
  } })
  environmentFiles(h.path)
  expected = hash(readFileSync(join(h.path, 'node_modules/dependency/index.js')))
  const frozen = h.manager.freeze(assignment)
  assert.equal(h.manager.digest(assignment), frozen.artifactDigest)
  writeFileSync(join(h.path, 'node_modules/dependency/index.js'), 'mutated dependency\n')
  assert.throws(() => h.manager.digest(assignment), WorkspaceConflict)
  assert.throws(() => h.manager.freeze(assignment), WorkspaceConflict)
  assert.equal(calls, 4)
})
test('arbitrary source, traversal, Git, file and missing paths cannot be registered as exclusions', (t) => {
  let value = attachment([])
  const h = fixture(t, { current: () => value })
  environmentFiles(h.path)
  for (const path of ['.', '..', '/node_modules', 'node_modules/../source.mjs', '.git/node_modules', 'source.mjs', 'src', 'node_modules/dependency/index.js', 'missing/node_modules', 'node_modules\\other']) {
    value = attachment([path])
    assert.throws(() => h.manager.freeze(assignment), WorkspaceConflict, path)
  }
  for (const invalid of [{ ...attachment([]), reference: '/private/authority/receipt' }, { ...attachment([]), fingerprint: 'invalid' }]) {
    value = invalid
    assert.throws(() => h.manager.digest(assignment), WorkspaceConflict)
  }
})
test('environment directories tracked in the current index, base or later HEAD cannot hide business files', (t) => {
  const h = fixture(t, fixed(attachment(['node_modules'])))
  environmentFiles(h.path)
  git(h.path, ['add', 'node_modules'])
  assert.throws(() => h.manager.freeze(assignment), WorkspaceConflict)
  git(h.path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'tracked dependency'])
  git(h.path, ['rm', '-r', '--cached', 'node_modules'])
  assert.throws(() => h.manager.freeze(assignment), WorkspaceConflict, 'HEAD is still a business source even when removed from the index')
  assert.equal(git(h.project, ['status', '--porcelain']), '')
})
test('a dependency committed at reserve remains protected even if deleted from HEAD and index later', (t) => {
  const h = fixture(t)
  environmentFiles(h.project)
  git(h.project, ['add', 'node_modules'])
  git(h.project, ['commit', '-qm', 'tracked business dependency'])
  const second = { ...assignment, attemptId: 'attempt-env-2' }
  const manager = new WorkspaceManager(h.state, { environment: fixed(attachment(['node_modules'])) })
  const reserved = manager.reserve({ projectPath: h.project, assignment: second })
  git(reserved.path, ['rm', '-r', '--cached', 'node_modules'])
  git(reserved.path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'remove dependency from index'])
  assert.throws(() => manager.freeze(second), WorkspaceConflict)
})
test('root and ancestor symbolic links never become trusted exclusion directories', (t) => {
  let value = attachment(['node_modules'])
  const h = fixture(t, { current: () => value })
  const external = join(h.directory, 'external')
  mkdirSync(join(external, 'node_modules'), { recursive: true })
  symlinkSync(external, join(h.path, 'node_modules'))
  assert.throws(() => h.manager.freeze(assignment), WorkspaceConflict)
  symlinkSync(external, join(h.path, 'package-link'))
  value = attachment(['package-link/node_modules'])
  assert.throws(() => h.manager.freeze(assignment), WorkspaceConflict)
})
test('nested workspace dependencies can be excluded without removing either package source', (t) => {
  const h = fixture(t, fixed(attachment(['packages/app/node_modules'])))
  mkdirSync(join(h.path, 'packages/app/node_modules/dependency'), { recursive: true })
  mkdirSync(join(h.path, 'packages/lib'), { recursive: true })
  writeFileSync(join(h.path, 'packages/app/node_modules/dependency/index.js'), 'environment\n')
  writeFileSync(join(h.path, 'packages/app/index.mjs'), 'import "lib"\n')
  writeFileSync(join(h.path, 'packages/lib/index.mjs'), 'export const lib = true\n')
  const frozen = h.manager.freeze(assignment)
  const patch = readFileSync(frozen.patchPath, 'utf8')
  assert.match(patch, /packages\/app\/index.mjs/)
  assert.match(patch, /packages\/lib\/index.mjs/)
  assert.doesNotMatch(patch, /node_modules/)
})
test('ignored dependency directories and literal business filenames do not break the temporary index', (t) => {
  const h = fixture(t, fixed(attachment(['node_modules', '.product-environment'])))
  environmentFiles(h.path)
  writeFileSync(join(h.path, '.gitignore'), 'node_modules/\n')
  git(h.path, ['add', '.gitignore'])
  const filename = 'literal[1]\nsource.mjs'
  writeFileSync(join(h.path, filename), 'export const literal = true\n')
  const index = git(h.path, ['rev-parse', '--git-path', 'index']), before = readFileSync(index)
  const frozen = h.manager.freeze(assignment)
  const clone = join(h.directory, 'clone')
  git(h.directory, ['clone', '-q', h.project, clone])
  git(clone, ['apply', frozen.patchPath])
  assert.equal(readFileSync(join(clone, filename), 'utf8'), 'export const literal = true\n')
  assert.doesNotMatch(readFileSync(frozen.patchPath, 'utf8'), /private dependency bytes|product-environment/)
  assert.deepEqual(readFileSync(index), before)
})
