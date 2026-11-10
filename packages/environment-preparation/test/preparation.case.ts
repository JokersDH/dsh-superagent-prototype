/**
 * Isolated environment preparation on real fixtures: dependency-free Node, a real pnpm frozen
 * offline install from a local store, unsupported layouts, unsafe links, manager/cache failures,
 * cancellation/timeout cleanup, idempotency/fingerprint and business-patch exclusion.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultEnvironmentExclusions, prepareEnvironment, standaloneProcessPort, type EnvironmentPreparationInput, type PreparationResult,
} from '../src/index.ts'
import {
  clean, copies, input, makePnpmFixture, pnpmVersion, projectState, runNodeTest, tempDir, writeFakeManager, writeJson,
} from './helpers.ts'

const ready = (result: PreparationResult) => {
  assert.equal(result.status, 'ready', result.status === 'blocked' ? `${result.code}: ${result.message}` : 'ready')
  return result as Extract<PreparationResult, { status: 'ready' }>
}
const blockedCode = (result: PreparationResult, code: string) => {
  assert.equal(result.status, 'blocked', `expected blocked ${code}, got ${result.status}`)
  assert.equal((result as Extract<PreparationResult, { status: 'blocked' }>).code, code)
}

function noDependencyProject(): { root: string; project: string; workspace: string } {
  const root = tempDir()
  const project = join(root, 'project'), workspace = join(root, 'workspace')
  mkdirSync(project); mkdirSync(workspace)
  for (const directory of [project, workspace]) {
    writeJson(join(directory, 'package.json'), { name: 'no-deps', version: '1.0.0', private: true, type: 'module' })
    writeFileSync(join(directory, 'smoke.test.mjs'), [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "test('runs without dependencies', () => { assert.equal(1 + 1, 2) })",
      '',
    ].join('\n'))
  }
  return { root, project, workspace }
}

function dependencyWorkspace(packageJson: Record<string, unknown>, locks: Record<string, string> = { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }): { root: string; project: string; workspace: string } {
  const root = tempDir()
  const project = join(root, 'project'), workspace = join(root, 'workspace')
  mkdirSync(project); mkdirSync(workspace)
  writeJson(join(workspace, 'package.json'), packageJson)
  for (const [name, content] of Object.entries(locks)) writeFileSync(join(workspace, name), content)
  return { root, project, workspace }
}

test('a dependency-free Node project is ready and runs the real node test runner', async () => {
  const fixture = noDependencyProject()
  try {
    const result = ready(await prepareEnvironment(input(fixture.project, fixture.workspace, 'existing_only')))
    assert.equal(result.manager.name, 'none')
    assert.match(result.fingerprint, /^[0-9a-f]{64}$/)
    assert.deepEqual(result.excludedPaths, [], 'an absent environment directory is not claimed as owned')
    assert.deepEqual(result.environment.PATH, process.env.PATH)
    assert.equal('HOME' in result.environment, false, 'existing-only does not pass a user HOME')
    const run = runNodeTest(fixture.workspace, result.environment)
    assert.equal(run.status, 0, String(run.stderr))
    const cleanup = await result.cleanup()
    assert.deepEqual(cleanup.removed, [])
    assert.equal(readFileSync(join(fixture.workspace, 'smoke.test.mjs'), 'utf8').includes('runs without dependencies'), true)
  } finally { clean(fixture.root) }
})

test('existing_only refuses missing dependencies and escaping node_modules links', async () => {
  const missing = dependencyWorkspace({ name: 'missing', dependencies: { 'left-pad': '1.3.0' } })
  try {
    blockedCode(await prepareEnvironment(input(missing.project, missing.workspace, 'existing_only')), 'dependencies_missing')
  } finally { clean(missing.root) }

  const escaped = dependencyWorkspace({ name: 'escaped', dependencies: { dep: '1.0.0' } })
  try {
    const outside = join(escaped.root, 'outside-modules')
    mkdirSync(join(outside, 'dep'), { recursive: true })
    writeJson(join(outside, 'dep', 'package.json'), { name: 'dep', version: '1.0.0' })
    symlinkSync(outside, join(escaped.workspace, 'node_modules'), 'dir')
    blockedCode(await prepareEnvironment(input(escaped.project, escaped.workspace, 'existing_only')), 'unsafe_link')
    assert.equal(existsSync(join(escaped.workspace, 'node_modules')), true, 'the unsafe link is not followed or removed')
  } finally { clean(escaped.root) }
})

test('unsupported layouts, external links and ambiguous managers are blocked', async () => {
  const monorepo = dependencyWorkspace({ name: 'mono', workspaces: ['packages/*'] })
  try { blockedCode(await prepareEnvironment(input(monorepo.project, monorepo.workspace, 'existing_only')), 'unsupported_workspace') }
  finally { clean(monorepo.root) }

  const external = dependencyWorkspace({ name: 'external', dependencies: { outside: 'file:../outside.tgz' } })
  try { blockedCode(await prepareEnvironment(input(external.project, external.workspace, 'existing_only')), 'unsafe_link') }
  finally { clean(external.root) }

  const yarn = dependencyWorkspace({ name: 'yarn' }, { 'yarn.lock': '# yarn\n' })
  try { blockedCode(await prepareEnvironment(input(yarn.project, yarn.workspace, 'existing_only')), 'unsupported_manager') }
  finally { clean(yarn.root) }

  const ambiguous = dependencyWorkspace({ name: 'ambiguous' }, { 'pnpm-lock.yaml': 'lockfileVersion: 9\n', 'package-lock.json': '{}' })
  try { blockedCode(await prepareEnvironment(input(ambiguous.project, ambiguous.workspace, 'existing_only')), 'ambiguous_lock') }
  finally { clean(ambiguous.root) }
})

test('a real pnpm project installs offline/frozen/ignore-scripts and passes its own test', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const before = projectState(project)
  try {
    const result = ready(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store,
      requestId: 'offline-ready',
    })))
    assert.equal(result.manager.name, 'pnpm')
    assert.equal(result.manager.actualVersion, pnpmVersion())
    assert.equal(result.diagnostics.some(entry => entry.code === 'lifecycle_scripts_skipped'), true)
    assert.equal(existsSync(join(workspace, 'node_modules', 'env-dep', 'package.json')), true)
    assert.equal(realpathSync(join(workspace, 'node_modules', 'env-dep')).startsWith(realpathSync(workspace)), true, 'dependency resolves inside the workspace')
    assert.equal(existsSync(join(workspace, 'postinstall-ran')), false, 'lifecycle scripts never ran')
    const run = runNodeTest(workspace, result.environment)
    assert.equal(run.status, 0, String(run.stderr))
    assert.equal(existsSync(join(result.environment.HOME!, '.pnpm')), true, 'the child HOME is private to the environment')
    assert.equal(projectState(project).index, before.index, 'the original git index is unchanged')
    assert.equal(projectState(project).status, before.status, 'the original worktree is unchanged')
    assert.equal(projectState(project).files, before.files)

    const cleanup = await result.cleanup()
    assert.equal(cleanup.leftovers.length, 0)
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
    assert.equal(existsSync(join(workspace, 'package.json')), true, 'business files stay intact')
    assert.equal(readFileSync(join(workspace, 'pnpm-lock.yaml'), 'utf8'), readFileSync(join(fixture.template, 'pnpm-lock.yaml'), 'utf8'))
  } finally { clean(fixture.root) }
})

test('the same request reuses its environment; a changed request or lock does not', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const first = ready(await prepareEnvironment(input(project, workspace, 'offline_install', { storeDir: fixture.store, requestId: 'same-request' })))
    const markerPath = join(workspace, '.product-environment', 'state.json')
    const markerBefore = readFileSync(markerPath, 'utf8')
    const second = ready(await prepareEnvironment(input(project, workspace, 'offline_install', { storeDir: fixture.store, requestId: 'same-request' })))
    assert.equal(second.fingerprint, first.fingerprint)
    assert.equal(second.diagnostics.some(entry => entry.code === 'environment_reused'), true)
    assert.equal(readFileSync(markerPath, 'utf8'), markerBefore, 'reuse does not rewrite the marker')

    const changed = ready(await prepareEnvironment(input(project, workspace, 'offline_install', { storeDir: fixture.store, requestId: 'changed-request' })))
    assert.equal(changed.fingerprint, first.fingerprint, 'the fingerprint binds content, not the request key')
    assert.equal(changed.diagnostics.some(entry => entry.code === 'stale_environment_cleared'), true)
    assert.equal(JSON.parse(readFileSync(markerPath, 'utf8')).requestId, 'changed-request')
    assert.equal(runNodeTest(workspace, changed.environment).status, 0)

    const policyFingerprint = ready(await prepareEnvironment(input(project, workspace, 'existing_only', { requestId: 'existing-check' })))
    assert.notEqual(policyFingerprint.fingerprint, first.fingerprint, 'policy participates in the fingerprint')
    await policyFingerprint.cleanup()
  } finally { clean(fixture.root) }
})

test('a changed lock is refused under frozen-lockfile policy and leaves no partial environment', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const lockPath = join(workspace, 'pnpm-lock.yaml')
    const lock = readFileSync(lockPath, 'utf8')
    const specifier = lock.match(/specifier: file:vendor\/([^\s]+)/)
    assert.ok(specifier)
    writeFileSync(lockPath, lock.replace(specifier[0], 'specifier: 1.0.0'))
    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', { storeDir: fixture.store, requestId: 'bad-lock' })), 'lock_mismatch')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
    assert.equal(projectState(project).status, '', 'the original project stays clean')
  } finally { clean(fixture.root) }
})

test('manager mismatch, missing manager and missing offline cache are explicit blocked states', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const packagePath = join(workspace, 'package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    writeJson(packagePath, { ...packageJson, packageManager: 'pnpm@0.0.1' })
    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', { storeDir: fixture.store, requestId: 'version' })), 'manager_version_mismatch')
    writeJson(packagePath, packageJson)

    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'missing-manager', managerCommand: '/definitely/missing/pnpm',
    })), 'manager_missing')

    const emptyStore = join(fixture.root, 'empty-store')
    mkdirSync(emptyStore)
    const fake = writeFakeManager(join(fixture.root, 'fake-offline'), pnpmVersion(), 'offline-error')
    void fake
    blockedCode(await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: emptyStore, requestId: 'no-cache', managerCommand: join(fixture.root, 'fake-offline'),
    })), 'offline_cache_missing')
    assert.equal(existsSync(join(workspace, '.product-environment')), false, 'failed preparation cleans its marker')
  } finally { clean(fixture.root) }
})

test('timeout and cancellation kill the owned process group and clean the workspace', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const fake = join(fixture.root, 'fake-sleep')
    const pidFile = writeFakeManager(fake, pnpmVersion(), 'sleep')
    const timed = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'timeout', managerCommand: fake, timeoutMs: 400,
    }))
    blockedCode(timed, 'timeout')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
    assert.equal(existsSync(pidFile), true)
    const timedPid = Number(readFileSync(pidFile, 'utf8').trim())
    assert.throws(() => process.kill(timedPid, 0), 'the timed-out manager process is gone')

    const controller = new AbortController()
    const pending = prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'cancelled', managerCommand: fake, timeoutMs: 30_000, signal: controller.signal,
    }))
    await new Promise(resolve => setTimeout(resolve, 250))
    controller.abort()
    const cancelled = await pending
    blockedCode(cancelled, 'cancelled')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    const cancelledPid = Number(readFileSync(pidFile, 'utf8').trim())
    assert.throws(() => process.kill(cancelledPid, 0), 'the cancelled manager process is gone')
    assert.equal(projectState(project).status, '', 'neither run touched the original project')
  } finally { clean(fixture.root) }
})

test('an output-flooding manager is killed at the output budget and cleaned', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const fake = join(fixture.root, 'fake-flood')
    const pidFile = writeFakeManager(fake, pnpmVersion(), 'flood')
    const result = await prepareEnvironment(input(project, workspace, 'offline_install', {
      storeDir: fixture.store, requestId: 'flood', managerCommand: fake, maxOutputBytes: 4096, timeoutMs: 10_000,
    }))
    blockedCode(result, 'output_limit')
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    assert.throws(() => process.kill(pid, 0), 'the flooding manager is gone')
  } finally { clean(fixture.root) }
})

test('environment paths are excluded from the business patch while source stays tracked', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const result = ready(await prepareEnvironment(input(project, workspace, 'offline_install', { storeDir: fixture.store, requestId: 'patch' })))
    const excluded = defaultEnvironmentExclusions.excludedPaths(workspace)
    assert.deepEqual(excluded, ['.product-environment', 'node_modules'])
    const status = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: workspace, encoding: 'utf8' })
    const entries = status.split('\0').filter(Boolean).map(entry => entry.slice(3).replace(/\/$/, ''))
    const business = entries.filter(entry => !excluded.some(path => entry === path || entry.startsWith(`${path}/`)))
    assert.deepEqual(business, [], `business patch would include: ${business.join(', ')}`)
    assert.equal(execFileSync('git', ['diff'], { cwd: workspace, encoding: 'utf8' }), '', 'tracked files are unchanged')
    assert.equal(entries.some(entry => entry === 'node_modules' || entry === '.product-environment'), true, 'environment paths exist and are the only untracked entries')
    await result.cleanup()
  } finally { clean(fixture.root) }
})

test('the fingerprint changes with package content and policy', async () => {
  const fixture = noDependencyProject()
  try {
    const first = ready(await prepareEnvironment(input(fixture.project, fixture.workspace, 'existing_only', { requestId: 'fp-1' })))
    const packagePath = join(fixture.workspace, 'package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    writeJson(packagePath, { ...packageJson, description: 'changed' })
    const second = ready(await prepareEnvironment(input(fixture.project, fixture.workspace, 'existing_only', { requestId: 'fp-2' })))
    const third = ready(await prepareEnvironment(input(fixture.project, fixture.workspace, 'offline_install', { requestId: 'fp-3' })))
    assert.notEqual(second.fingerprint, first.fingerprint)
    assert.notEqual(third.fingerprint, second.fingerprint)
  } finally { clean(fixture.root) }
})

test('invalid requests are refused before touching either directory', async () => {
  const fixture = noDependencyProject()
  try {
    await assert.rejects(() => prepareEnvironment(input(fixture.project, fixture.project, 'existing_only')), /separate, non-containing/)
    await assert.rejects(() => prepareEnvironment({ ...input(fixture.project, fixture.workspace, 'existing_only'), requestId: '' }), /requestId/)
    await assert.rejects(() => prepareEnvironment({ ...input(fixture.project, fixture.workspace, 'existing_only'), signal: undefined as never }), /AbortSignal/)
    assert.equal(existsSync(join(fixture.workspace, '.product-environment')), false)
  } finally { clean(fixture.root) }
})


test('cancellation and timeout terminate normal descendants in the owned process group', async () => {
  const root = tempDir('environment-descendants-')
  const pidFile = join(root, 'descendant.pid')
  const script = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
    "setInterval(() => {}, 1000)",
  ].join(';')
  const waitForPid = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (existsSync(pidFile)) return Number(readFileSync(pidFile, 'utf8').trim())
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('descendant pid was not written')
  }
  try {
    const controller = new AbortController()
    const pending = standaloneProcessPort.run(process.execPath, ['-e', script], {
      cwd: root, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 30_000, maxOutputBytes: 4096, signal: controller.signal,
    })
    const cancelledPid = await waitForPid()
    controller.abort()
    const cancelled = await pending
    assert.equal(cancelled.cancelled, true)
    assert.throws(() => process.kill(cancelledPid, 0), 'the cancelled descendant is gone')

    rmSync(pidFile, { force: true })
    const timed = await standaloneProcessPort.run(process.execPath, ['-e', script], {
      cwd: root, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 500, maxOutputBytes: 4096,
    })
    const timedPid = await waitForPid()
    assert.equal(timed.timedOut, true)
    assert.throws(() => process.kill(timedPid, 0), 'the timed-out descendant is gone')
  } finally { clean(root) }
})
