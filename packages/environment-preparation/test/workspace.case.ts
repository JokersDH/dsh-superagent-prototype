/** A6: restricted pnpm workspace (one root, one lock, app -> lib workspace:*) offline preparation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanupPreparedEnvironment, prepareEnvironment, verifyPreparedEnvironment,
  type PreparationResult,
} from '../src/index.ts'
import { clean, pnpmVersion, tempDir, writeJson } from './helpers.ts'

interface WorkspaceFixture { root: string; template: string; project: string; workspace: string; store: string; version: string }

function makeWorkspaceFixture(): WorkspaceFixture {
  const root = tempDir('environment-workspace-')
  const template = join(root, 'template')
  const store = join(root, 'store')
  mkdirSync(store)
  const version = pnpmVersion()
  mkdirSync(template, { recursive: true })
  writeJson(join(template, 'package.json'), {
    name: 'environment-workspace', version: '1.0.0', private: true, packageManager: `pnpm@${version}`,
  })
  writeFileSync(join(template, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  for (const [name, body] of [['lib', 'module.exports = () => "lib-ok"\n'], ['app', '']] as const) {
    const directory = join(template, 'packages', name)
    mkdirSync(directory, { recursive: true })
    writeJson(join(directory, 'package.json'), name === 'app'
      ? { name: 'env-app', version: '1.0.0', private: true, dependencies: { 'env-lib': 'workspace:*' }, scripts: { test: 'node --test' } }
      : { name: 'env-lib', version: '1.0.0', main: 'index.js' })
    if (name === 'lib') writeFileSync(join(directory, 'index.js'), body)
    if (name === 'app') writeFileSync(join(directory, 'smoke.test.cjs'), [
      "const test = require('node:test')",
      "const assert = require('node:assert/strict')",
      "test('workspace link resolves', () => { assert.equal(require('env-lib')(), 'lib-ok') })",
      '',
    ].join('\n'))
  }
  const env = {
    ...process.env, COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_HOME: process.env.COREPACK_HOME ?? join(process.env.HOME ?? root, '.cache/node/corepack'),
  }
  execFileSync('pnpm', ['install', '--offline', '--ignore-scripts', '--store-dir', store], { cwd: template, env, stdio: 'ignore' })
  assert.equal(existsSync(join(template, 'pnpm-lock.yaml')), true)
  rmSync(join(template, 'node_modules'), { recursive: true, force: true })
  rmSync(join(template, 'packages', 'app', 'node_modules'), { recursive: true, force: true })
  const project = join(root, 'project'), workspace = join(root, 'workspace')
  cpSync(template, project, { recursive: true })
  cpSync(template, workspace, { recursive: true })
  for (const directory of [project, workspace]) {
    execFileSync('git', ['init', '-q'], { cwd: directory })
    execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: directory })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: directory })
    execFileSync('git', ['add', '.'], { cwd: directory })
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: directory })
  }
  return { root, template, project, workspace, store, version }
}

const ready = (result: PreparationResult) => {
  assert.equal(result.status, 'ready', result.status === 'blocked' ? `${result.code}: ${result.message}` : 'ready')
  return result as Extract<PreparationResult, { status: 'ready' }>
}
const blocked = (result: { status: string; code?: string }, code: string) => {
  assert.equal(result.status, 'blocked')
  assert.equal(result.code, code)
}
const input = (fixture: WorkspaceFixture, overrides: Record<string, unknown> = {}) => ({
  projectPath: fixture.project, workspacePath: fixture.workspace, requestId: 'workspace-request',
  policy: 'offline_install' as const, storeDir: fixture.store, signal: new AbortController().signal,
  mode: 'pnpm_workspace' as const, ...overrides,
})

test('a pnpm workspace installs offline, runs the app test and enters only business files in a patch', async () => {
  const fixture = makeWorkspaceFixture()
  const authorityRoot = tempDir('environment-authority-')
  try {
    const before = readFileSync(join(fixture.project, 'packages/app/package.json'), 'utf8')
    const result = ready(await prepareEnvironment(input(fixture, { authorityRoot })))
    assert.equal(result.fingerprint.length, 64)
    assert.equal(existsSync(join(fixture.workspace, 'packages/app/node_modules/env-lib')), true)
    const run = spawnSync(process.execPath, ['--test'], {
      cwd: join(fixture.workspace, 'packages/app'), env: { ...result.environment }, encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(run.status, 0, String(run.stdout) + String(run.stderr))
    assert.equal(readFileSync(join(fixture.project, 'packages/app/package.json'), 'utf8'), before)
    assert.equal(verifyPreparedEnvironment(result.environmentRef!).status, 'valid')

    writeFileSync(join(fixture.workspace, 'packages/app/feature.js'), 'module.exports = "app"\n')
    writeFileSync(join(fixture.workspace, 'packages/lib/feature.js'), 'module.exports = "lib"\n')
    const status = execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: fixture.workspace, encoding: 'utf8' })
    const entries = status.split('\0').filter(Boolean).map(entry => entry.slice(3).replace(/\/$/, ''))
    const business = entries.filter(entry => !(entry === 'node_modules' || entry === '.product-environment' || entry.endsWith('/node_modules')))
    assert.deepEqual(business.sort(), ['packages/app/feature.js', 'packages/lib/feature.js'])
    assert.equal(execFileSync('git', ['diff'], { cwd: fixture.workspace, encoding: 'utf8' }), '')

    assert.equal((await cleanupPreparedEnvironment(result.environmentRef!)).status, 'cleaned')
    assert.equal(existsSync(join(fixture.workspace, 'node_modules')), false)
    assert.equal(existsSync(join(fixture.workspace, 'packages/app/node_modules')), false)
    assert.equal(existsSync(join(fixture.workspace, 'packages/app/feature.js')), true)
  } finally { clean(fixture.root, authorityRoot) }
})

test('unsupported workspace links, globs, unknown workspace targets and symlink members are blocked', async () => {
  const fixture = makeWorkspaceFixture()
  const authorityRoot = tempDir('environment-authority-')
  try {
    writeJson(join(fixture.workspace, 'packages/app/package.json'), { name: 'env-app', private: true, dependencies: { bad: 'file:../outside.tgz' } })
    blocked(await prepareEnvironment(input(fixture, { authorityRoot, requestId: 'file' })), 'unsupported_workspace_dependency')

    writeFileSync(join(fixture.workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/**'\n")
    blocked(await prepareEnvironment(input(fixture, { authorityRoot, requestId: 'glob' })), 'unsupported_workspace_glob')

    writeFileSync(join(fixture.workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    writeJson(join(fixture.workspace, 'packages/app/package.json'), { name: 'env-app', private: true, dependencies: { missing: 'workspace:*' } })
    blocked(await prepareEnvironment(input(fixture, { authorityRoot, requestId: 'target' })), 'unsupported_workspace_dependency')

    writeJson(join(fixture.workspace, 'packages/app/package.json'), { name: 'env-app', private: true, dependencies: { 'env-lib': 'workspace:*' } })
    const outside = join(fixture.root, 'outside-package')
    mkdirSync(outside)
    writeJson(join(outside, 'package.json'), { name: 'escape', version: '1.0.0' })
    symlinkSync(outside, join(fixture.workspace, 'packages', 'escape'))
    blocked(await prepareEnvironment(input(fixture, { authorityRoot, requestId: 'symlink' })), 'unsafe_link')
  } finally { clean(fixture.root, authorityRoot) }
})
