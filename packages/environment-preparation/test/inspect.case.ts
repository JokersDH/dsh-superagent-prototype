/** A4: read-only inspection, stable codes/Chinese suggestions, no installer and parser validation. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  inspectEnvironment, parseEnvironmentInspection, type EnvironmentProcessPort,
} from '../src/index.ts'
import { clean, copies, makePnpmFixture, pnpmVersion, tempDir, writeJson } from './helpers.ts'

const parse = (value: unknown) => parseEnvironmentInspection(value)

test('inspection is read-only for a dependency-free project and the port may be parsed', async () => {
  const root = tempDir()
  const project = join(root, 'project'), workspace = join(root, 'workspace')
  mkdirSync(project); mkdirSync(workspace)
  for (const directory of [project, workspace]) writeJson(join(directory, 'package.json'), { name: 'inspect-free', private: true })
  try {
    const result = parse(await inspectEnvironment({ projectPath: project, workspacePath: workspace }))
    assert.equal(result.status, 'ready_to_prepare')
    assert.equal(result.node.actual, process.versions.node)
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
    assert.equal(result.readOnlySnapshot.project, result.readOnlySnapshot.project)
  } finally { clean(root) }
})

test('inspection reports a real installed dependency tree without running install', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  const calls: string[][] = []
  const port: EnvironmentProcessPort = {
    run: async (command, args, options) => {
      calls.push([...args])
      const { standaloneProcessPort } = await import('../src/index.ts')
      return standaloneProcessPort.run(command, args, options)
    },
  }
  try {
    const { prepareEnvironment } = await import('../src/index.ts')
    const prepared = await prepareEnvironment({
      projectPath: project, workspacePath: workspace, requestId: 'inspect-source', policy: 'offline_install',
      storeDir: fixture.store, signal: new AbortController().signal,
    })
    assert.equal(prepared.status, 'ready')
    const before = readFileSync(join(workspace, 'package.json'), 'utf8')
    const result = parse(await inspectEnvironment({
      projectPath: project, workspacePath: workspace, policy: 'offline_install', storeDir: fixture.store, processPort: port,
    }))
    assert.equal(result.status, 'unknown', 'cache sufficiency is not claimed without an install')
    assert.equal(result.dependencies.declared, 1)
    assert.equal(result.dependencies.installed, true)
    assert.equal(result.capabilities.offlineStoreAuthorized, true)
    assert.equal(result.capabilities.offlineCacheSufficient, 'unknown')
    assert.equal(calls.every(args => args.join(' ') === '--version'), true, 'inspection never starts install')
    assert.equal(readFileSync(join(workspace, 'package.json'), 'utf8'), before)
    assert.equal(existsSync(join(workspace, '.product-environment')), true, 'the prepared module state is not touched by inspection')
    await prepared.cleanup()
    assert.equal(existsSync(join(workspace, 'node_modules')), false)
  } finally { clean(fixture.root) }
})

test('inspection blocks bad JSON, monorepo, hooks and escaping links with Chinese suggestions', async () => {
  const bad = tempDir()
  const project = join(bad, 'project'), workspace = join(bad, 'workspace')
  mkdirSync(project); mkdirSync(workspace)
  writeFileSync(join(workspace, 'package.json'), '{ not json')
  try {
    const result = parse(await inspectEnvironment({ projectPath: project, workspacePath: workspace }))
    assert.equal(result.status, 'blocked')
    assert.equal(result.code, 'invalid_package_json')
    assert.ok(result.message.length > 0 && result.suggestions.length > 0)
  } finally { clean(bad) }

  const hook = tempDir()
  const hp = join(hook, 'project'), hw = join(hook, 'workspace')
  mkdirSync(hp); mkdirSync(hw)
  writeJson(join(hw, 'package.json'), { name: 'hook', dependencies: { x: '1.0.0' } })
  writeJson(join(hw, 'package-lock.json'), { lockfileVersion: 3 })
  writeFileSync(join(hw, '.pnpmfile.cjs'), 'module.exports={}')
  try {
    const offline = parse(await inspectEnvironment({ projectPath: hp, workspacePath: hw, policy: 'offline_install', storeDir: hook }))
    assert.equal(offline.status, 'blocked')
    assert.equal(offline.code, 'project_hooks_unsupported')
    const existing = parse(await inspectEnvironment({ projectPath: hp, workspacePath: hw }))
    assert.equal(existing.capabilities.projectHooksBlocked, true)
  } finally { clean(hook) }

  const escape = tempDir()
  const ep = join(escape, 'project'), ew = join(escape, 'workspace')
  mkdirSync(ep); mkdirSync(ew)
  writeJson(join(ew, 'package.json'), { name: 'escape', dependencies: { dep: '1.0.0' } })
  writeJson(join(ew, 'pnpm-lock.yaml'), { lockfileVersion: 9 })
  mkdirSync(join(ew, 'node_modules', 'dep'), { recursive: true })
  writeJson(join(ew, 'node_modules', 'dep', 'package.json'), { name: 'dep', version: '1.0.0', main: 'index.js' })
  const outside = join(escape, 'outside.js')
  writeFileSync(outside, 'module.exports=1\n')
  symlinkSync(outside, join(ew, 'node_modules', 'dep', 'index.js'))
  try {
    const result = parse(await inspectEnvironment({ projectPath: ep, workspacePath: ew }))
    assert.equal(result.status, 'blocked')
    assert.equal(result.code, 'unsafe_link')
  } finally { clean(escape) }
})

test('inspection blocks a declared manager mismatch without installing', async () => {
  const fixture = makePnpmFixture()
  const { project, workspace } = copies(fixture)
  try {
    const packageJson = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
    writeJson(join(workspace, 'package.json'), { ...packageJson, packageManager: `pnpm@0.0.${pnpmVersion().split('.').at(-1)}` })
    const result = parse(await inspectEnvironment({
      projectPath: project, workspacePath: workspace, policy: 'offline_install', storeDir: fixture.store,
    }))
    assert.equal(result.status, 'blocked')
    assert.equal(result.code, 'manager_version_mismatch')
    assert.equal(existsSync(join(workspace, '.product-environment')), false)
  } finally { clean(fixture.root) }
})
